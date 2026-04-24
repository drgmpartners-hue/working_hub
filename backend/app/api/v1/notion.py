"""Notion API proxy — user's Notion token으로 데이터베이스 조회."""
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
    return _decrypt(key.api_key)


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
    async with httpx.AsyncClient(timeout=15) as client:
        res = await client.post(
            f"{NOTION_BASE}/search",
            headers=_headers(token),
            json={"filter": {"value": "database", "property": "object"}},
        )
    if res.status_code != 200:
        raise HTTPException(res.status_code, f"Notion API 오류: {res.text[:200]}")

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
    async with httpx.AsyncClient(timeout=10) as client:
        res = await client.get(
            f"{NOTION_BASE}/databases/{database_id}",
            headers=_headers(token),
        )
    if res.status_code != 200:
        raise HTTPException(res.status_code, f"Notion API 오류: {res.text[:200]}")

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
    elif t == "checkbox":
        return str(prop.get("checkbox", False))
    elif t == "url":
        return prop.get("url")
    elif t == "formula":
        f = prop.get("formula", {})
        return str(f.get(f.get("type", ""), ""))
    elif t == "rollup":
        r = prop.get("rollup", {})
        return str(r.get(r.get("type", ""), ""))
    return None


@router.get("/databases/{database_id}/rows", response_model=list[NotionRow])
async def query_database(
    database_id: str,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """데이터베이스의 모든 행(페이지)을 조회하여 속성값을 추출."""
    token = await _get_notion_token(current_user.id, db)
    all_results = []
    start_cursor = None

    # 페이지네이션 처리
    async with httpx.AsyncClient(timeout=15) as client:
        while True:
            body: dict = {}
            if start_cursor:
                body["start_cursor"] = start_cursor
            res = await client.post(
                f"{NOTION_BASE}/databases/{database_id}/query",
                headers=_headers(token),
                json=body,
            )
            if res.status_code != 200:
                raise HTTPException(res.status_code, f"Notion API 오류: {res.text[:200]}")
            data = res.json()
            all_results.extend(data.get("results", []))
            if not data.get("has_more"):
                break
            start_cursor = data.get("next_cursor")

    rows = []
    for page in all_results:
        props = {}
        for name, prop in page.get("properties", {}).items():
            val = _extract_value(prop)
            if val is not None:
                props[name] = val
        rows.append(NotionRow(id=page["id"], properties=props))
    return rows
