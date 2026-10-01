"""매니저별 사용 프로그램 (docs/login_logic P11).

대표가 관리자 > 매니저 관리에서 매니저마다 쓸 수 있는 프로그램을 골라 열어 준다.
- users.allowed_programs: NULL = 전부 허용(기존 계정), 목록 = 그 프로그램만.
- 대표는 언제나 전부. 대행 중에는 대행 대상 매니저의 권한을 따른다.
- 메인·대시보드·내 정보·설정은 누구나.

서버 판정(check_path)은 그 프로그램만 쓰는 API 에만 건다. 고객 목록(/clients)·상품 마스터 읽기·투자상품 목록처럼
여러 프로그램이 같이 쓰는 API 는 막지 않는다(막으면 다른 프로그램이 깨진다). 화면(메뉴·주소)은 프론트에서 막는다.
"""
from __future__ import annotations

from typing import Optional

from fastapi import HTTPException

# (키, 이름, 메뉴 묶음) — 프론트 frontend/src/lib/programs.ts 와 같은 순서·키
PROGRAMS: list[tuple[str, str, str]] = [
    ("customers", "고객 정보 관리", "데이터 관리"),
    ("product_master", "증권사 상품 관리", "데이터 관리"),
    ("wrap_accounts", "투자상품 관리", "데이터 관리"),
    ("commission_drgm", "Dr.GM 수당정산", "업무 자동화"),
    ("commission_securities", "증권사 수당정산", "업무 자동화"),
    ("portfolio", "주식, 펀드 관리", "투자 분석"),
    ("retirement", "은퇴플랜 관리", "투자 분석"),
    ("stock_recommend", "주식·ETF 추천", "투자 분석"),
    ("company_report", "기업 리포트", "콘텐츠 제작"),
]
PROGRAM_KEYS = [k for k, _, _ in PROGRAMS]

# API 경로(/api/v1 뒤) → 이 중 하나라도 허용돼 있으면 통과. 긴 접두어가 먼저 맞도록 정렬해 둔다.
_OPEN = None  # 공용
PATH_RULES: list[tuple[str, Optional[set[str]]]] = sorted(
    [
        ("/company-report", {"company_report"}),
        ("/commissions", {"commission_drgm", "commission_securities"}),
        ("/crawling", {"commission_drgm", "commission_securities"}),
        ("/upload", {"commission_drgm", "commission_securities"}),
        ("/stocks", {"stock_recommend"}),
        ("/portfolios", {"portfolio", "stock_recommend"}),
        ("/snapshots", {"portfolio"}),
        ("/reports", {"portfolio"}),
        ("/recommended-portfolio", {"portfolio"}),
        ("/messaging", {"portfolio"}),
        ("/call-reservations", {"portfolio"}),
        ("/retirement/wrap-accounts", _OPEN),  # 투자상품 목록: 투자상품 관리·은퇴플랜·포트폴리오 공용
        ("/retirement", {"retirement"}),
    ],
    key=lambda x: -len(x[0]),
)
API_PREFIX = "/api/v1"


def allowed_set(user) -> Optional[set[str]]:
    """허용 프로그램. None = 전부."""
    from app.core.permissions import is_owner

    if user is None or is_owner(user):
        return None
    progs = getattr(user, "allowed_programs", None)
    if progs is None:
        return None
    return {p for p in progs if p in PROGRAM_KEYS}


def effective_list(user) -> list[str]:
    """화면에 내려 줄 목록(대표·전부 허용이면 전체 키)."""
    s = allowed_set(user)
    return list(PROGRAM_KEYS) if s is None else [k for k in PROGRAM_KEYS if k in s]


def programs_for_path(path: str) -> Optional[set[str]]:
    if not path.startswith(API_PREFIX):
        return None
    sub = path[len(API_PREFIX):]
    for prefix, progs in PATH_RULES:
        if sub == prefix or sub.startswith(prefix + "/"):
            return progs
    return None


def check_path(user, path: str) -> None:
    """요청 경로가 이 사용자가 열지 않은 프로그램 전용 API 면 403."""
    need = programs_for_path(path)
    if not need:
        return
    have = allowed_set(user)
    if have is None or have & need:
        return
    names = [n for k, n, _ in PROGRAMS if k in need]
    raise HTTPException(status_code=403, detail=f"'{' / '.join(names)}' 사용 권한이 없습니다. 대표에게 요청하세요.")


def normalize(values: Optional[list[str]]) -> Optional[list[str]]:
    """저장용: 알 수 없는 키 거부, 순서 정리. None 은 '전부 허용'."""
    if values is None:
        return None
    bad = [v for v in values if v not in PROGRAM_KEYS]
    if bad:
        raise HTTPException(status_code=422, detail=f"알 수 없는 프로그램: {', '.join(bad)}")
    return [k for k in PROGRAM_KEYS if k in set(values)]
