"""Notion API proxy — user's Notion token으로 데이터베이스 조회."""
import asyncio
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
import httpx

from app.db.session import get_db
from app.core.deps import get_current_user
from app.models.user_api_key import UserApiKey

router = APIRouter(prefix="/notion", tags=["Notion"])

NOTION_BASE = "https://api.notion.com/v1"
NOTION_VERSION = "2022-06-28"
MAX_RETRIES = 3


async def _notion_request(
    method: str,
    url: str,
    token: str,
    json: dict | None = None,
    client: httpx.AsyncClient | None = None,
) -> httpx.Response:
    """Notion API 호출 with 재시도 (503 등 일시적 오류 대응).

    네트워크 오류/타임아웃은 HTTPException(504)으로 변환한다. 이렇게 해야
    CORS 헤더가 포함된 정상 오류 응답이 나가서 프런트가 'Failed to fetch' 대신
    실제 사유를 표시할 수 있다.

    client를 넘기면 커넥션을 재사용한다 (페이지네이션 루프에서 필수 —
    매 페이지 TLS 새 연결이 조회 시간을 배로 늘려 504의 원인이 됐음).
    """
    res: httpx.Response | None = None
    for attempt in range(MAX_RETRIES):
        try:
            if client is not None:
                if method == "GET":
                    res = await client.get(url, headers=_headers(token))
                else:
                    res = await client.post(url, headers=_headers(token), json=json or {})
            else:
                async with httpx.AsyncClient(timeout=15) as one_off:
                    if method == "GET":
                        res = await one_off.get(url, headers=_headers(token))
                    else:
                        res = await one_off.post(url, headers=_headers(token), json=json or {})
            if res.status_code != 503:
                return res
        except httpx.HTTPError:  # Timeout, ConnectError 등 네트워크 계열
            res = None
        if attempt < MAX_RETRIES - 1:
            await asyncio.sleep(1 * (attempt + 1))
    if res is not None:
        return res  # 마지막 응답(503 등) 반환
    raise HTTPException(504, "Notion 서버에 연결하지 못했습니다(응답 지연/네트워크 오류). 잠시 후 다시 시도해주세요.")


def _handle_error(res: httpx.Response):
    """Notion API 에러를 사용자 친화적 메시지로 변환."""
    if res.status_code == 401:
        raise HTTPException(401, "Notion 인증 실패: Integration Token을 확인해주세요.")
    elif res.status_code == 403:
        raise HTTPException(403, "Notion 접근 권한이 없습니다. 페이지에 통합을 연결했는지 확인해주세요.")
    elif res.status_code == 404:
        raise HTTPException(404, "Notion 데이터베이스를 찾을 수 없습니다.")
    elif res.status_code == 503:
        raise HTTPException(503, "Notion 서버가 일시적으로 응답하지 않습니다. 잠시 후 다시 시도해주세요.")
    else:
        raise HTTPException(res.status_code, f"Notion API 오류 ({res.status_code}): 잠시 후 다시 시도해주세요.")


async def _get_notion_token(user_id: str, db: AsyncSession) -> str:
    """사용자의 Notion Integration Token을 DB에서 가져온다."""
    from app.api.v1.user_api_keys import _decrypt
    result = await db.execute(
        select(UserApiKey).where(
            and_(UserApiKey.user_id == user_id, UserApiKey.provider == "notion")
        )
    )
    key = result.scalar_one_or_none()
    if not key:
        raise HTTPException(404, "Notion API 키가 설정되지 않았습니다. 설정 > API 관리에서 등록해주세요.")
    try:
        return _decrypt(key.api_key)
    except Exception:
        # 서버 SECRET_KEY 변경 등으로 저장된 키를 복호화할 수 없는 경우 (InvalidToken)
        raise HTTPException(
            400,
            "저장된 Notion 키를 복호화할 수 없습니다(서버 암호화 키 불일치). "
            "설정 > API 관리에서 Notion 키를 다시 등록해주세요.",
        )


def _headers(token: str) -> dict:
    return {
        "Authorization": f"Bearer {token}",
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
    }


# ── 1. 연결된 데이터베이스 목록 조회 ──────────────────────────────
class NotionDbItem(BaseModel):
    id: str
    title: str
    icon: Optional[str] = None


@router.get("/databases", response_model=list[NotionDbItem])
async def list_databases(
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Notion 워크스페이스에서 접근 가능한 데이터베이스 목록 조회."""
    token = await _get_notion_token(current_user.id, db)
    res = await _notion_request("POST", f"{NOTION_BASE}/search", token, {"filter": {"value": "database", "property": "object"}})
    if res.status_code != 200:
        _handle_error(res)

    items = []
    for r in res.json().get("results", []):
        title_parts = r.get("title", [])
        title = "".join(t.get("plain_text", "") for t in title_parts) or "(제목 없음)"
        icon = None
        if r.get("icon"):
            icon_obj = r["icon"]
            if icon_obj.get("type") == "emoji":
                icon = icon_obj.get("emoji")
        items.append(NotionDbItem(id=r["id"], title=title, icon=icon))
    return items


# ── 2. 데이터베이스 속성(컬럼) 조회 ──────────────────────────────
class NotionProperty(BaseModel):
    name: str
    type: str


@router.get("/databases/{database_id}/properties", response_model=list[NotionProperty])
async def get_database_properties(
    database_id: str,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """데이터베이스의 속성(컬럼) 목록 조회."""
    token = await _get_notion_token(current_user.id, db)
    res = await _notion_request("GET", f"{NOTION_BASE}/databases/{database_id}", token)
    if res.status_code != 200:
        _handle_error(res)

    props = res.json().get("properties", {})
    return [NotionProperty(name=name, type=p["type"]) for name, p in props.items()]


# ── 3. 데이터베이스 행(페이지) 조회 ──────────────────────────────
class NotionRow(BaseModel):
    id: str
    properties: dict  # { column_name: extracted_value }


def _extract_value(prop: dict) -> Optional[str]:
    """Notion property에서 plain text 값을 추출."""
    t = prop.get("type", "")
    if t == "title":
        return "".join(p.get("plain_text", "") for p in prop.get("title", []))
    elif t == "rich_text":
        return "".join(p.get("plain_text", "") for p in prop.get("rich_text", []))
    elif t == "number":
        return str(prop.get("number", "")) if prop.get("number") is not None else None
    elif t == "email":
        return prop.get("email")
    elif t == "phone_number":
        return prop.get("phone_number")
    elif t == "date":
        d = prop.get("date")
        return d.get("start") if d else None
    elif t == "select":
        s = prop.get("select")
        return s.get("name") if s else None
    elif t == "multi_select":
        return ", ".join(s.get("name", "") for s in prop.get("multi_select", []))
    elif t == "status":
        s = prop.get("status")
        return s.get("name") if s else None
    elif t == "checkbox":
        return str(prop.get("checkbox", False))
    elif t == "url":
        return prop.get("url")
    elif t == "relation":
        items = prop.get("relation", [])
        return ", ".join(r.get("id", "")[:8] for r in items) if items else None
    elif t == "people":
        items = prop.get("people", [])
        return ", ".join(p.get("name", "") for p in items) if items else None
    elif t == "files":
        items = prop.get("files", [])
        return ", ".join(f.get("name", "") for f in items) if items else None
    elif t == "created_time":
        return prop.get("created_time", "")[:10] if prop.get("created_time") else None
    elif t == "last_edited_time":
        return prop.get("last_edited_time", "")[:10] if prop.get("last_edited_time") else None
    elif t == "created_by":
        return prop.get("created_by", {}).get("name")
    elif t == "last_edited_by":
        return prop.get("last_edited_by", {}).get("name")
    elif t == "formula":
        f = prop.get("formula", {})
        ft = f.get("type", "")
        val = f.get(ft)
        return str(val) if val is not None else None
    elif t == "rollup":
        r = prop.get("rollup", {})
        rt = r.get("type", "")
        if rt == "array":
            arr = r.get("array", [])
            return ", ".join(str(_extract_value(item) or "") for item in arr) if arr else None
        val = r.get(rt)
        return str(val) if val is not None else None
    elif t == "unique_id":
        u = prop.get("unique_id", {})
        prefix = u.get("prefix", "")
        number = u.get("number", "")
        return f"{prefix}-{number}" if prefix else str(number)
    return None


def _build_notion_filter(schema_props: dict, filters: list) -> dict | None:
    """[{property, value}] → Notion query filter (타입별 조건). 못 만드는 타입은 생략.

    서버 필터는 순수 최적화다 — 프런트가 어차피 클라이언트에서 한 번 더 거르므로
    일부 조건이 생략돼도 결과는 같고, 전송량만 달라진다.
    """
    conds = []
    for f in filters:
        if not isinstance(f, dict):
            continue
        name = str(f.get("property") or "").strip()
        value = str(f.get("value") or "").strip()
        if not name or not value or name not in schema_props:
            continue
        ptype = schema_props[name].get("type")
        if ptype == "title":
            conds.append({"property": name, "title": {"contains": value}})
        elif ptype == "rich_text":
            conds.append({"property": name, "rich_text": {"contains": value}})
        elif ptype == "select":
            conds.append({"property": name, "select": {"equals": value}})
        elif ptype == "multi_select":
            conds.append({"property": name, "multi_select": {"contains": value}})
        elif ptype == "status":
            conds.append({"property": name, "status": {"equals": value}})
        elif ptype == "rollup":
            # 롤업(show_original·select) — any.select.equals가 실측으로 동작.
            # 다른 롤업 원본 타입이면 400 → 조회 루프에서 무필터 폴백
            conds.append({"property": name, "rollup": {"any": {"select": {"equals": value}}}})
        # formula는 실측 결과 값이 있어도 0건을 반환(관계형 참조 수식에서 Notion 필터 미동작)
        # → 서버 필터에서 제외. relation·number·date 등도 생략 → 클라이언트 필터가 처리
    if not conds:
        return None
    return conds[0] if len(conds) == 1 else {"and": conds}


@router.get("/databases/{database_id}/rows", response_model=list[NotionRow])
async def query_database(
    database_id: str,
    filters: Optional[str] = None,
    props: Optional[str] = None,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """데이터베이스 행(페이지)을 조회하여 속성값을 추출.

    filters: JSON 문자열 [{"property": 컬럼명, "value": 값}] — 서버측(Notion) 필터로
    해당 조건에 맞는 행만 받아온다. 수천 행 DB 전체 다운로드로 인한 504 방지.
    props: JSON 문자열 [컬럼명, ...] — 지정 시 해당 속성만 응답에 포함(filter_properties).
    롤업·관계형 등 무거운 속성 해석을 생략해 페이지당 응답 시간을 크게 줄인다.
    """
    token = await _get_notion_token(current_user.id, db)

    # 필터/속성 축소에 필요한 스키마 1회 조회
    import json as _json
    schema_props: dict | None = None
    if filters or props:
        schema_res = await _notion_request("GET", f"{NOTION_BASE}/databases/{database_id}", token)
        if schema_res.status_code == 200:
            schema_props = schema_res.json().get("properties", {})

    # 서버측 필터 구성 (실패 시 전체 조회로 폴백)
    notion_filter = None
    if filters and schema_props:
        try:
            parsed = _json.loads(filters)
            if isinstance(parsed, list) and parsed:
                notion_filter = _build_notion_filter(schema_props, parsed)
        except Exception:
            notion_filter = None

    # 필요한 속성만 요청 (filter_properties — 속성 ID 기준)
    query_url = f"{NOTION_BASE}/databases/{database_id}/query"
    if props and schema_props:
        try:
            names = _json.loads(props)
            ids = [
                schema_props[n]["id"]
                for n in names
                if isinstance(n, str) and n in schema_props and schema_props[n].get("id")
            ]
            if ids:
                query_url += "?" + "&".join(f"filter_properties={pid}" for pid in ids)
        except Exception:
            pass

    all_results = []
    start_cursor = None

    # 페이지네이션: page_size 명시 + 총 시간 예산 + 페이지 상한 + 커서 무한루프 방어
    # (무제한 직렬 페이지네이션이 게이트웨이 타임아웃 → 프런트 'Failed to fetch'의 원인이었음)
    # 커넥션 1개를 루프 전체에서 재사용 — 페이지마다 TLS 새 연결로 25초 예산을
    # 정상 데이터 양에도 초과(504)하던 문제 해결. 예산도 50초로 상향.
    import time
    BUDGET_SECONDS = 50
    MAX_PAGES = 30          # 30 × 100행 = 최대 3,000행
    started = time.monotonic()
    pages = 0
    async with httpx.AsyncClient(timeout=15) as client:
        while True:
            if time.monotonic() - started > BUDGET_SECONDS:
                raise HTTPException(
                    504,
                    f"Notion 데이터 조회가 너무 오래 걸립니다 ({pages}페이지/{len(all_results)}행까지 수집 후 중단). "
                    "잠시 후 다시 시도해주세요.",
                )
            if pages >= MAX_PAGES:
                break  # 상한 도달 — 수집된 범위까지 반환
            body: dict = {"page_size": 100}
            if notion_filter:
                body["filter"] = notion_filter
            if start_cursor:
                body["start_cursor"] = start_cursor
            res = await _notion_request("POST", query_url, token, body, client=client)
            if res.status_code == 400 and notion_filter:
                # 필터 형식이 이 DB와 안 맞는 경우(롤업 원본 타입 상이 등) → 무필터로 재시작
                notion_filter = None
                all_results = []
                start_cursor = None
                pages = 0
                continue
            if res.status_code != 200:
                _handle_error(res)
            data = res.json()
            all_results.extend(data.get("results", []))
            pages += 1
            if not data.get("has_more"):
                break
            next_cursor = data.get("next_cursor")
            if not next_cursor or next_cursor == start_cursor:
                break  # 커서가 없거나 제자리 → 무한루프 방지
            start_cursor = next_cursor

    rows = []
    for page in all_results:
        extracted: dict = {}
        for name, prop in page.get("properties", {}).items():
            val = _extract_value(prop)
            if val is not None:
                extracted[name] = val
        rows.append(NotionRow(id=page["id"], properties=extracted))
    return rows
