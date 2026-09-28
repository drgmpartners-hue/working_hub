"""파일 저장소(기업DB). Railway Volume에 저장한다(기획 7-2·7-3).

경로 우선순위: COMPANY_DB_ROOT → {RAILWAY_VOLUME_MOUNT_PATH}/company-db → ./data/company-db(로컬 개발)
실제 저장 경로는 company-db/{company_id | _portfolio}/{folder}/{file_id}.{ext} — 사명이 바뀌어도 옮기지 않는다.
"""
from __future__ import annotations

import logging
import os
from pathlib import Path

logger = logging.getLogger(__name__)


def root() -> Path:
    explicit = os.environ.get("COMPANY_DB_ROOT")
    if explicit:
        p = Path(explicit)
    elif os.environ.get("RAILWAY_VOLUME_MOUNT_PATH"):
        p = Path(os.environ["RAILWAY_VOLUME_MOUNT_PATH"]) / "company-db"
    else:
        p = Path.cwd() / "data" / "company-db"
    p.mkdir(parents=True, exist_ok=True)
    return p


def is_persistent() -> bool:
    """Volume(또는 명시 경로)에 저장 중인지. 아니면 재배포 때 지워진다."""
    return bool(os.environ.get("COMPANY_DB_ROOT") or os.environ.get("RAILWAY_VOLUME_MOUNT_PATH"))


def make_key(company_id: str | None, folder: str, file_id: str, ext: str) -> str:
    owner = company_id or "_portfolio"
    ext = (ext or "bin").lower().lstrip(".")
    return f"{owner}/{folder}/{file_id}.{ext}"


def _safe_path(key: str) -> Path:
    base = root().resolve()
    p = (base / key).resolve()
    if base not in p.parents:
        raise ValueError("잘못된 저장 경로")
    return p


def save_bytes(key: str, data: bytes) -> int:
    p = _safe_path(key)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_bytes(data)
    tmp.replace(p)
    return len(data)


def path_of(key: str) -> Path:
    return _safe_path(key)


def read_bytes(key: str) -> bytes:
    return _safe_path(key).read_bytes()


def exists(key: str) -> bool:
    try:
        return _safe_path(key).exists()
    except ValueError:
        return False


def usage() -> dict:
    total, files = 0, 0
    for dirpath, _, names in os.walk(root()):
        for n in names:
            try:
                total += os.path.getsize(os.path.join(dirpath, n))
                files += 1
            except OSError:
                pass
    return {"bytes": total, "files": files, "persistent": is_persistent(), "root": str(root())}
