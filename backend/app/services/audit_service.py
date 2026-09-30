"""감사 로그 기록 헬퍼 (docs/login_logic P6-1, 지시서 5.4·10장).

- actor(실제 행위자)와 effective(권한이 적용된 계정)를 항상 함께 남긴다.
- payload_summary 에는 주민번호·비밀번호·API 키·토큰을 절대 담지 않는다(키 이름 블랙리스트).
- 크기 상한 4KB. 기록 실패가 본 요청을 실패시키지 않는다(예외는 삼키고 앱 로그에만 남김).
"""
from __future__ import annotations

import json
import logging
from typing import Any, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit_log import AuditLog

logger = logging.getLogger(__name__)

_BLACKLIST = ("ssn", "password", "passwd", "secret", "token", "api_key", "apikey", "credential", "authorization")
_MAX_BYTES = 4096


def _is_sensitive(name: str) -> bool:
    n = name.lower()
    return n == "key" or n.endswith("_key") or any(b in n for b in _BLACKLIST)


def sanitize(value: Any, depth: int = 0) -> Any:
    """민감 키 제거 + 깊이 제한."""
    if depth > 4:
        return "…"
    if isinstance(value, dict):
        return {k: sanitize(v, depth + 1) for k, v in value.items() if not _is_sensitive(str(k))}
    if isinstance(value, (list, tuple)):
        return [sanitize(v, depth + 1) for v in list(value)[:50]]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value[:500] if isinstance(value, str) else value
    return str(value)[:200]


def _cap(summary: Optional[dict]) -> Optional[dict]:
    if summary is None:
        return None
    clean = sanitize(summary)
    raw = json.dumps(clean, ensure_ascii=False, default=str)
    if len(raw.encode("utf-8")) <= _MAX_BYTES:
        return clean
    return {"_truncated": True, "keys": list(clean.keys())[:50] if isinstance(clean, dict) else None}


async def record(
    db: AsyncSession,
    *,
    actor_id: Optional[str],
    effective_id: Optional[str],
    action: str,
    resource_type: Optional[str] = None,
    resource_id: Optional[str] = None,
    client_id: Optional[str] = None,
    method: Optional[str] = None,
    path: Optional[str] = None,
    status_code: Optional[int] = None,
    payload_summary: Optional[dict] = None,
    ip: Optional[str] = None,
    user_agent: Optional[str] = None,
    commit: bool = True,
) -> None:
    """감사 로그 1건 기록. 실패해도 예외를 올리지 않는다."""
    try:
        db.add(
            AuditLog(
                actor_user_id=actor_id,
                effective_user_id=effective_id,
                is_impersonated=bool(actor_id and effective_id and actor_id != effective_id),
                action=action[:50],
                resource_type=(resource_type or None) and resource_type[:50],
                resource_id=(str(resource_id)[:64] if resource_id is not None else None),
                client_id=client_id,
                method=method,
                path=(path or None) and path[:300],
                status_code=status_code,
                payload_summary=_cap(payload_summary),
                ip=(ip or None) and ip[:45],
                user_agent=(user_agent or None) and user_agent[:300],
            )
        )
        if commit:
            await db.commit()
    except Exception:  # pragma: no cover - 기록 실패는 본 요청에 영향 없음
        logger.warning("감사 로그 기록 실패: %s", action, exc_info=True)
        try:
            await db.rollback()
        except Exception:
            pass


def request_meta(request) -> dict:
    """요청에서 method·path·ip·user_agent 추출 (X-Forwarded-For 우선)."""
    try:
        fwd = request.headers.get("x-forwarded-for")
        ip = fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else None)
        return {
            "method": request.method,
            "path": request.url.path,
            "ip": ip,
            "user_agent": request.headers.get("user-agent"),
        }
    except Exception:  # pragma: no cover
        return {}


# ---------------------------------------------------------------------------
# 1층: 쓰기 요청 전수 기록 (지시서 10.2) — main.py 미들웨어에서 호출
# ---------------------------------------------------------------------------

_WRITE_METHODS = ("POST", "PUT", "PATCH", "DELETE")
# 기록에서 제외: 로그인 계열(자격증명), 대행 시작·종료(라우터가 직접 상세 기록), 고객 포털(비로그인)
_SKIP_PREFIXES = (
    "/api/v1/auth/login",
    "/api/v1/auth/google",
    "/api/v1/auth/logout",
    "/api/v1/auth/impersonate",
    "/api/v1/client-portal",
)


def _resource_from_path(path: str) -> tuple[Optional[str], Optional[str]]:
    """/api/v1/<resource>/<id>/... → (resource, id). 경로 규칙상 두 번째 조각이 id 인 경우가 대부분."""
    parts = [p for p in path.split("/") if p]
    try:
        i = parts.index("v1")
    except ValueError:
        return None, None
    rest = parts[i + 1:]
    if not rest:
        return None, None
    if rest[0] == "retirement" and len(rest) > 1:  # /retirement/<sub>/<id>
        rest = [f"retirement/{rest[1]}"] + rest[2:]
    resource = rest[0][:50]
    rid = rest[1][:64] if len(rest) > 1 else None
    return resource, rid


async def log_write_request(request, status_code: int) -> None:
    """인증된 쓰기 요청 1건 기록. 로그인하지 않은 요청(auth_ctx 없음)은 기록하지 않는다."""
    if request.method not in _WRITE_METHODS:
        return
    path = request.url.path
    if not path.startswith("/api/v1/") or path.startswith(_SKIP_PREFIXES):
        return
    ctx = getattr(request.state, "auth_ctx", None)
    if ctx is None:
        return
    extra = getattr(request.state, "audit", None) or {}
    resource, rid = _resource_from_path(path)
    client_id = extra.get("client_id") or (rid if resource == "clients" and rid and len(rid) == 36 else None)
    action = extra.get("action") or {"POST": "create", "PUT": "update", "PATCH": "update", "DELETE": "delete"}[request.method]

    from app.db.session import get_db  # 테스트의 get_db 대체(override)도 그대로 따른다

    dep = request.app.dependency_overrides.get(get_db, get_db)
    agen = dep()
    try:
        db = await agen.__anext__()
        await record(
            db,
            actor_id=ctx.actor.id,
            effective_id=ctx.effective.id,
            action=action,
            resource_type=extra.get("resource_type") or resource,
            resource_id=extra.get("resource_id") or rid,
            client_id=client_id,
            status_code=status_code,
            payload_summary=extra.get("summary") or (dict(request.query_params) or None),
            **request_meta(request),
        )
    except Exception:  # pragma: no cover
        logger.warning("감사 로그(미들웨어) 기록 실패: %s %s", request.method, path, exc_info=True)
    finally:
        try:
            await agen.aclose()
        except Exception:
            pass
