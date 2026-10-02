"""업로드 공통 (수정_tasks P2-13).

예전에는 `await file.read()` 로 크기 제한 없이 통째로 메모리에 올렸다(큰 파일 하나로 서버 메모리가 찰 수 있음).
이제 조금씩 읽으면서 한도를 넘으면 바로 413 으로 끊는다. 파일을 디스크에 쓴 뒤 DB 저장이 실패하면 지우는 도우미도 둔다.
"""
from __future__ import annotations

import os
from typing import Optional

from fastapi import HTTPException, UploadFile

CHUNK = 1024 * 1024
MB = 1024 * 1024

IMAGE_MAX = 20 * MB    # 계좌 화면 캡처·문자 이미지
EXCEL_MAX = 10 * MB    # 고객 대량 등록 엑셀


async def read_limited(file: UploadFile, max_bytes: int, what: str = "파일") -> bytes:
    """업로드를 1MB 씩 읽다가 max_bytes 를 넘으면 413. 빈 파일은 400."""
    buf = bytearray()
    while True:
        chunk = await file.read(CHUNK)
        if not chunk:
            break
        buf.extend(chunk)
        if len(buf) > max_bytes:
            raise HTTPException(413, f"{what}이(가) 너무 큽니다(최대 {max_bytes // MB}MB).")
    if not buf:
        raise HTTPException(400, f"{what}이(가) 비어 있습니다.")
    return bytes(buf)


def remove_quietly(path: Optional[str]) -> None:
    """저장 실패 뒤 남은 파일 정리(고아 파일 방지). 없으면 무시."""
    if not path:
        return
    try:
        os.remove(path)
    except OSError:
        pass
