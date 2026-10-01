"""반기 기업 종합보고서 작성 (기획 6장, P4-5·P4-6).

흐름(기업 한 곳, 수 분):
  1) 수집   — 출처마다 id 를 붙인다
             P 기업정보 · G 공공데이터 · F 원장 사실 · R 투자유치 · M 월간 요약 · A 이번 반기 기사 ·
             D 자료함 문서 · X 직전 반기 보고서 · W 웹 검색 보강
  2) 웹 보강 — Claude web search 로 빈칸(대표자·경영진·제품·경쟁사·인증·재무)을 채운다(출처 주소 포함)
  3) 초안   — Claude(작성 모델)가 표지 요약 + 10개 항목을 블록(문단·표·타임라인)으로, 문장마다 출처 id
  4) 교차 검토 — Gemini(구글 검색 그라운딩) 1차 → Claude(2차) — 보고서 모드: 합의 안 된 문장은 남기고 표시
  5) 이미지 — 기본 차트 2개(투자유치 타임라인, 재무 추이 또는 사건 타임라인) + 자료함 그림 후보(AI 가 골라 측션)
  6) 영업 대화 노트(내부용) — 핵심 메시지 3·예상 질문과 답·조심할 표현
  7) 부록 — 출처 목록·주요 기사·DART 공시·투자유치 출처·참고 자료·용어 풀이·검증 요약·면책 문구(프로그램이 만든다)

원칙: 출처 없는 사실은 쓰지 않는다 · 숫자·날짜·이름은 출처 표기 그대로 · 추측·전망은 5·7·10번에만 '분석' 표시 ·
고객 개인의 투자 금액·지분은 쓰지 않는다 · 투자 권유·수익·상장 보장 표현 금지 · 기사 사진은 쓰지 않는다.

매니저 보고서는 대표 승인 없이 매니저가 검토·출력한다(2026-10-01 결정). 이 모듈은 '자동 생성본'
(owner_user_id 없음)을 만들고, 담당자가 고치면 자기 버전이 따로 생긴다(reports API).
"""
from __future__ import annotations

import io
import json
import logging
import re
import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any, Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.company_report import (
    CompanyDocument, CompanyFact, CompanyFundingRound, CompanyMonthlyDigest, CompanyPublicData, CompanyReport,
    ReportImage,
)
from app.models.news_briefing import NewsArticle, PortfolioCompany
from app.services import llm_client
from app.services.company_report import charts, config, cross_review, storage
from app.services.company_report.keys import get_service_key, release
from app.services.company_report.timeutil import now_kst, today_kst

logger = logging.getLogger(__name__)

SECTIONS: list[tuple[int, str]] = [
    (1, "기업정보"), (2, "대표자정보"), (3, "주요특징 및 사업영역"), (4, "제품라인업"), (5, "투자유치 현황"),
    (6, "최근 1년 주요성과"), (7, "성장전략"), (8, "최신동향"), (9, "최근 결산정보 요약"), (10, "결론"),
]
ANALYSIS_SECTIONS = {5, 7, 10}
STAGES = ["개발", "출시", "매출 발생", "흑자", "상장 준비", "상장"]
DISCLAIMER = (
    "본 보고서는 Dr.GM Family Office 가 공개 자료·기업 제공 자료·언론 보도를 바탕으로 정리한 참고 자료이며, "
    "투자 권유나 수익·상장을 보장하지 않습니다. 비상장 기업 투자는 원금 손실 위험이 있고 회수까지 오랜 시간이 걸릴 수 있습니다. "
    "보고서의 사실은 기준일 현재 확인된 출처에 따른 것이며, 이후 달라질 수 있습니다."
)
MAX_ARTICLES = 40
MAX_FACTS = 80
DOC_TEXT_EACH = 6000
DOC_TEXT_TOTAL = 40000
MAX_IMAGES = 10
MAX_DOC_IMAGE_CANDIDATES = 12
REVIEW_GROUPS = [[0, 1, 2, 3, 4], [5, 6, 7], [8, 9, 10]]  # 0 = 한 장 요약


# --------------------------------------------------------------------------- 기간

def half_range(year: int, half: int) -> tuple[date, date]:
    """(시작일, 끝일 포함)"""
    return (date(year, 1, 1), date(year, 6, 30)) if half == 1 else (date(year, 7, 1), date(year, 12, 31))


def half_label(year: int, half: int) -> str:
    return f"{year}년 {'상반기' if half == 1 else '하반기'}"


def half_months(year: int, half: int) -> list[str]:
    start = 1 if half == 1 else 7
    return [f"{year}-{m:02d}" for m in range(start, start + 6)]


def prev_half(year: int, half: int) -> tuple[int, int]:
    return (year - 1, 2) if half == 1 else (year, 1)


def latest_closed_half(today: Optional[date] = None) -> tuple[int, int]:
    """오늘 기준 이미 끝난 가장 최근 반기(7월 이후면 그해 상반기, 1~6월이면 작년 하반기)."""
    t = today or today_kst()
    return (t.year, 1) if t.month >= 7 else (t.year - 1, 2)


# --------------------------------------------------------------------------- 1) 수집

@dataclass
class Bundle:
    company: PortfolioCompany
    year: int
    half: int
    sources: list[dict] = field(default_factory=list)       # [{id, text}] — AI 에게 보낼 근거
    table: dict[str, dict] = field(default_factory=dict)     # id → {type, title, url, date, …}
    rounds: list[CompanyFundingRound] = field(default_factory=list)
    articles: list[NewsArticle] = field(default_factory=list)
    dart: list[NewsArticle] = field(default_factory=list)
    documents: list[CompanyDocument] = field(default_factory=list)
    prev_report: Optional[CompanyReport] = None
    counters: dict[str, int] = field(default_factory=lambda: defaultdict(int))

    def add(self, prefix: str, text: str, meta: dict) -> str:
        self.counters[prefix] += 1
        sid = f"{prefix}{self.counters[prefix]}"
        self.sources.append({"id": sid, "text": text})
        self.table[sid] = {"id": sid, **meta}
        return sid


def _d(v) -> str:
    return v.isoformat() if isinstance(v, (date, datetime)) else (str(v) if v else "")


def _eok(v: Optional[int]) -> str:
    if v is None:
        return "비공개"
    x = v / 1e8
    return f"{x:,.0f}억 원" if x >= 10 or x == int(x) else f"{x:,.1f}억 원"


def _ref_url(refs) -> Optional[str]:
    for r in refs or []:
        if isinstance(r, dict) and r.get("url"):
            return r["url"]
    return None


async def gather(db: AsyncSession, company: PortfolioCompany, year: int, half: int) -> Bundle:
    b = Bundle(company=company, year=year, half=half)
    start, end = half_range(year, half)
    c = company

    # P 기업 기본정보
    prof = {
        "정식 기업명": c.name, "영문명": c.name_en, "대표자": c.ceo_name, "설립일": _d(c.established_at),
        "본사 소재지": c.address, "업종": c.industry, "상장 여부": ("상장" + (f"({c.stock_code})" if c.stock_code else "")) if c.is_listed else "비상장",
        "홈페이지": c.homepage, "사업자번호": c.biz_reg_no, "이전 사명·약칭": ", ".join(c.aliases or []),
    }
    src = {"dart": "DART 기업개황", "web": "웹 검색", "manual": "담당자 입력"}.get(c.profile_source or "", "등록 정보")
    b.add("P", "기업 기본정보(" + src + "): " + " / ".join(f"{k}: {v}" for k, v in prof.items() if v),
          {"type": "profile", "title": f"{c.name} 기업 기본정보({src})", "url": c.homepage or None, "date": ""})

    # G 공공데이터(최신 스냅샷)
    rows = (await db.execute(select(CompanyPublicData).where(CompanyPublicData.company_id == c.id, CompanyPublicData.error.is_(None))
                             .order_by(CompanyPublicData.as_of.desc()))).scalars().all()
    seen_src = set()
    labels = {"nps": "국민연금 가입 사업장(임직원 수)", "kipris": "KIPRIS 특허·상표", "nts": "국세청 사업자 상태", "kis": "주가(KIS)"}
    for r in rows:
        if r.source in seen_src or not r.data:
            continue
        seen_src.add(r.source)
        b.add("G", f"{labels.get(r.source, r.source)} {r.as_of.isoformat()} 기준: {json.dumps(r.data, ensure_ascii=False)[:800]}",
              {"type": "public", "title": f"{labels.get(r.source, r.source)}({r.as_of.isoformat()})", "url": None, "date": r.as_of.isoformat()})

    # F 원장 사실(등록 이후 전 기간, 확정 우선)
    facts = (await db.execute(select(CompanyFact).where(
        CompanyFact.company_id == c.id, CompanyFact.status.in_(["confirmed", "candidate"]))
        .order_by(CompanyFact.fact_date.desc().nullslast()).limit(MAX_FACTS))).scalars().all()
    for f in facts:
        st = "확정" if f.status == "confirmed" else "후보"
        b.add("F", f"원장 사실({st}, {f.fact_type}, {_d(f.fact_date)}) {f.title}",
              {"type": "fact", "title": f.title, "url": _ref_url(f.source_refs), "date": _d(f.fact_date), "status": f.status})

    # R 투자유치
    b.rounds = list((await db.execute(select(CompanyFundingRound).where(
        CompanyFundingRound.company_id == c.id, CompanyFundingRound.status != "rejected")
        .order_by(CompanyFundingRound.round_date.nullslast()))).scalars().all())
    for r in b.rounds:
        inv = ", ".join(f"{i.get('name', '')}({i.get('type', '')}{', 리드' if i.get('lead') else ''})"
                        for i in (r.investors or []) if isinstance(i, dict))
        amt = _eok(r.amount) if r.amount and r.amount_disclosed else "비공개"
        val = f", 기업가치 {_eok(r.valuation)}" if r.valuation else ""
        fol = ", 후속 투자" if r.is_follow_on else ""
        b.add("R", f"투자유치({_d(r.round_date)}) {r.round_name or '라운드 미상'} 금액 {amt}{val}{fol} 투자사: {inv or '미상'}",
              {"type": "funding", "title": f"{r.round_name or '투자유치'} {amt}", "url": _ref_url(r.source_refs),
               "date": _d(r.round_date), "round_id": r.id})

    # M 이번 반기 월간 요약 6개
    digests = (await db.execute(select(CompanyMonthlyDigest).where(
        CompanyMonthlyDigest.company_id == c.id, CompanyMonthlyDigest.month.in_(half_months(year, half)))
        .order_by(CompanyMonthlyDigest.month))).scalars().all()
    for dg in digests:
        facts_txt = "; ".join(x.get("text", "") for x in ((dg.content or {}).get("facts") or []) if isinstance(x, dict))
        b.add("M", f"월간 요약 {dg.month}: {dg.summary or ''} 주요 사실: {facts_txt}".strip(),
              {"type": "digest", "title": f"{c.name} {dg.month} 월간 요약", "url": None, "date": dg.month})

    # A 이번 반기 기사(관련도·주의 우선) / DART 공시(최근 1년)
    s_dt, e_dt = datetime.combine(start, datetime.min.time()), datetime.combine(end + timedelta(days=1), datetime.min.time())
    arts = (await db.execute(select(NewsArticle).where(
        NewsArticle.company_id == c.id, NewsArticle.is_hidden == False, NewsArticle.is_representative == True,  # noqa: E712
        NewsArticle.published_at >= s_dt, NewsArticle.published_at < e_dt))).scalars().all()
    tag_order = {"caution": 0, "positive": 1, "neutral": 2}
    arts = sorted(arts, key=lambda a: (a.source_type == "dart", tag_order.get(a.tag or "", 3), -(a.relevance_score or 0),
                                       -(a.published_at or datetime.min).timestamp()))
    b.articles = [a for a in arts if a.source_type != "dart"][:MAX_ARTICLES]
    for a in b.articles:
        b.add("A", f"기사({_d(a.published_at.date() if a.published_at else None)}, {a.press or '-'}, {a.tag or '-'}) {a.title} — {a.summary or a.description or ''}",
              {"type": "article", "title": a.title, "url": a.url, "date": _d(a.published_at.date() if a.published_at else None), "press": a.press})
    year_ago = datetime.combine(end - timedelta(days=365), datetime.min.time())
    b.dart = list((await db.execute(select(NewsArticle).where(
        NewsArticle.company_id == c.id, NewsArticle.source_type == "dart", NewsArticle.is_hidden == False,  # noqa: E712
        NewsArticle.published_at >= year_ago, NewsArticle.published_at < e_dt)
        .order_by(NewsArticle.published_at.desc()).limit(30))).scalars().all())
    for a in b.dart:
        b.add("A", f"DART 공시({_d(a.published_at.date() if a.published_at else None)}) {a.title} — {a.summary or a.description or ''}",
              {"type": "dart", "title": a.title, "url": a.url, "date": _d(a.published_at.date() if a.published_at else None), "press": "DART"})

    # D 자료함(보고서에 사용 + 읽기 완료)
    b.documents = list((await db.execute(select(CompanyDocument).where(
        CompanyDocument.company_id == c.id, CompanyDocument.use_in_report == True,  # noqa: E712
        CompanyDocument.extract_status == "done").order_by(CompanyDocument.created_at))).scalars().all())
    budget = DOC_TEXT_TOTAL
    for d in b.documents:
        excerpt = (d.extracted_text or "")[:min(DOC_TEXT_EACH, max(budget, 0))]
        budget -= len(excerpt)
        warn = " ※이 자료에는 고객 개인의 투자 금액·지분이 있다. 그 개인 정보는 절대 쓰지 마라." if d.has_personal_investment else ""
        b.add("D", f"자료함 문서 '{d.filename}'({d.doc_type or '기타'}){warn} 메모: {d.ai_memo or ''} 핵심: {'; '.join(d.ai_facts or [])} "
                   f"본문 일부: {excerpt}",
              {"type": "document", "title": d.filename, "url": None, "date": d.created_at.date().isoformat() if d.created_at else "",
               "is_public": d.is_public, "document_id": d.id})

    # X 직전 반기 보고서(같은 기업, 자동 생성본 최신)
    py, ph = prev_half(year, half)
    b.prev_report = (await db.execute(select(CompanyReport).where(
        CompanyReport.company_id == c.id, CompanyReport.period_year == py, CompanyReport.period_half == ph,
        CompanyReport.status.in_(["draft", "final"])).order_by(CompanyReport.version.desc()))).scalars().first()
    if b.prev_report and b.prev_report.content:
        summ = (b.prev_report.content.get("summary") or {})
        lines = [x.get("text", "") for x in (summ.get("three_lines") or []) if isinstance(x, dict)]
        b.add("X", f"직전 보고서({half_label(py, ph)}) 요약: " + " / ".join(lines) + f" (당시 단계: {summ.get('stage') or '-'})",
              {"type": "prev_report", "title": f"{c.name} {half_label(py, ph)} 보고서", "url": None, "date": ""})
    return b


# --------------------------------------------------------------------------- 2) 웹 보강

WEB_PROMPT = """'{name}'({industry}, 대표 {ceo}) 에 대해 웹 검색으로 아래 빈칸을 확인하라. 회사 홈페이지·공식 보도자료·신뢰할 만한 언론을 우선한다.
확인하지 못한 항목은 넣지 마라. 동명이인·동명 회사를 조심하라(업종·대표자 이름으로 확인).

확인할 것:
{gaps}

JSON 으로만 답하라:
{{"facts": [{{"topic": "대표자|경영진|제품|사업영역|경쟁사|인증|재무|기타", "text": "확인한 사실 한 문장(숫자·날짜 원문 그대로)", "url": "출처 주소", "title": "출처 제목", "date": "YYYY-MM-DD 또는 빈칸"}}]}}"""


def _gaps(b: Bundle) -> list[str]:
    have = " ".join(s["text"] for s in b.sources)
    gaps = ["대표자의 학력·경력·창업 이력·수상(공개된 것만, 사생활 제외)", "주요 경영진(CTO·CFO 등) 이름·직책·경력",
            "주요 제품·서비스와 단계(개발·출시·매출)", "주요 경쟁사와 시장에서의 평가", "기업 인증(벤처·이노비즈 등)·특허 수"]
    if not re.search(r"매출|영업이익|재무", have):
        gaps.append("최근 사업연도 매출액·영업이익·당기순이익(감사보고서·공시·기사)")
    return gaps


async def web_enrich(db: AsyncSession, b: Bundle, claude_key: str, model: str) -> int:
    c = b.company
    prompt = WEB_PROMPT.format(name=c.name, industry=c.industry or "업종 미상", ceo=c.ceo_name or "미상",
                               gaps="\n".join(f"- {g}" for g in _gaps(b)))
    await release(db)
    try:
        r = await llm_client.claude_text(claude_key, prompt, model=model, web_search=True, max_tokens=4000, timeout=240,
                                         stage="report_web")
        data = llm_client.parse_json(r.text)
    except llm_client.LLMError as e:
        logger.info("웹 보강 실패(%s): %s", c.name, e)
        return 0
    n = 0
    for f in (data or {}).get("facts", [])[:25] if isinstance(data, dict) else []:
        if not isinstance(f, dict) or not f.get("text") or not str(f.get("url") or "").startswith("http"):
            continue  # 출처 주소 없는 웹 사실은 쓰지 않는다
        b.add("W", f"웹 확인({f.get('topic', '기타')}) {f['text']}",
              {"type": "web", "title": f.get("title") or f["url"], "url": f["url"], "date": f.get("date") or ""})
        n += 1
    return n


# --------------------------------------------------------------------------- 3) 초안

DRAFT_SYSTEM = (
    "너는 Dr.GM Family Office 의 기업분석 담당자다. 비상장·상장 투자기업에 투자한 고객이 읽는 반기 보고서를 쓴다. "
    "목적: 고객이 사실로 안심하고, 영업 담당자가 자신 있게 설명할 근거를 준다."
)
DRAFT_PROMPT = """'{name}'의 {label} 보고서(기준일 {as_of})를 쓴다. 아래 [출처]만 근거로 쓴다.

문장 규칙
- 두괄식: 각 항목의 첫 문장이 그 항목의 결론이다.
- 고등학생도 읽을 쉬운 말. 한 문장에 한 내용, 60자 안팎. 전문용어는 처음 나올 때 괄호로 푼다. 예: 영업이익(본업으로 번 돈)
- 모든 사실 문장에 출처 id 를 source_ids 에 단다. 출처 없는 사실은 쓰지 않는다. 숫자·날짜·고유명사는 출처 표기 그대로, 기준 시점을 밝힌다.
- 추측·해석은 5·7·10번에만 쓰고 kind 를 "analysis" 로 한다(나머지는 "fact").
- 진전은 형용사 대신 날짜·숫자·사건으로 보여준다. 리스크는 숨기지 말고 '무슨 일 → 회사의 대응 → 지켜볼 점' 순서로 차분하게 쓴다.
- 금지: 투자 권유·매수·매도, 수익·상장 보장으로 읽히는 표현('곧 상장', '수익 확실' 등), 사생활.
- 고객 개인이 당사를 통해 투자한 금액·지분은 쓰지 않는다. 회사·VC·조합의 투자 정보는 쓴다.
- 확인 안 된 칸은 '공개 자료 없음' 으로 쓴다(그 칸은 source_ids 비움 허용).
- 직전 보고서(X 출처)가 있으면 '지난 보고서 이후 달라진 점'을 쓴다. 없으면 이번이 첫 보고서라고 쓴다.

항목별 내용
1 기업정보: table — 열 ["항목","내용"]. 행: 정식 기업명(국문·영문), 설립일, 대표자, 본사 소재지, 업종, 임직원 수, 자본금, 지분구조(주요 주주·지분율), 상장 여부, 기업 인증, 주요 특허 수, 홈페이지
2 대표자정보: table 열 ["이름","직책","학력·경력","비고"] + para(창업 이력·수상·공개 발언 요지)
3 주요특징 및 사업영역: para(한 줄 정의 → 사업영역 → 경쟁우위 → 시장 평가 → 주요 경쟁사)
4 제품라인업: table 열 ["제품·서비스","설명(300자 이내)","대상 고객","단계","매출 기여"]
5 투자유치 현황: table 열 ["일자","라운드","금액","투자사","투자사 유형","기업가치","출처"] (비공개 금액은 '비공개', 추정 금지) + para(누적 투자금과 변화) + para kind=analysis(후속 투자 여부·전략적 투자자·정책금융 참여의 의미·라운드 간격)
6 최근 1년 주요성과: table 열 ["날짜","성과","수치"] — 이번 반기 먼저, 직전 반기는 요약. 계약·수주, 인증·허가, 수상, 파트너십
7 성장전략: para kind=fact '회사가 밝힌 전략' + para kind=analysis '분석'
8 최신동향: timeline — 이번 반기 6개월 월별 한 줄씩(date 는 YYYY-MM). 6번과 겹치지 않게 활동 중심
9 최근 결산정보 요약: table 열 ["항목","{fy}년","전년","증감률"] — 매출액, 영업이익, 당기순이익, 자산총계, 부채총계, 자본총계, 부채비율. 숫자는 원문 그대로, 계산한 비율은 note 에 계산식 + para 3~5문장 해석. 재무 자료가 없으면 표 없이 '공개 재무 자료 없음' 한 문장
10 결론: para kind=analysis 3~5문장 — 이번 반기의 진전, 핵심 강점, 주요 리스크와 회사의 대응, 다음 반기에 지켜볼 점

출력 JSON(이 형식 그대로):
{{"summary": {{"three_lines": [{{"text": "...", "source_ids": ["F1"]}}],
              "changes": [{{"text": "...", "source_ids": ["X1","M2"]}}],
              "stage": "개발|출시|매출 발생|흑자|상장 준비|상장 중 하나",
              "stage_note": {{"text": "지금 어느 단계인지 한 문장", "source_ids": ["..."]}}}},
 "sections": [{{"no": 1, "blocks": [
     {{"type": "table", "columns": ["항목","내용"], "rows": [{{"cells": ["정식 기업명","..."], "source_ids": ["P1"], "note": ""}}]}},
     {{"type": "para", "items": [{{"text": "...", "source_ids": ["A3"], "kind": "fact"}}]}},
     {{"type": "timeline", "items": [{{"date": "2026-03", "text": "...", "source_ids": ["M3"]}}]}}
 ]}}, ... 1부터 10까지 모두],
 "financials": {{"unit": "억 원", "years": [2023, 2024, 2025], "series": {{"매출액": [45, 90, 120], "영업이익": [-12, 5, 15]}}, "source_ids": ["D1"]}},
 "glossary": [{{"term": "영업이익", "desc": "본업으로 번 돈"}}]}}
financials 는 출처에서 확인한 연도별 숫자만(모르면 null). 확인한 연도가 2개 미만이면 "financials": null.

[출처]
{sources}
"""


def _src_text(sources: list[dict], limit: int = 160_000) -> str:
    out, n = [], 0
    for s in sources:
        line = f"[{s['id']}] {s['text']}"
        n += len(line)
        if n > limit:
            break
        out.append(line)
    return "\n".join(out)


async def draft(db: AsyncSession, b: Bundle, claude_key: str, model: str, as_of: date, report_id: str) -> dict:
    fy = b.year - 1  # 반기 보고서 시점(1월 말·7월 말)에 나와 있는 결산은 보통 직전 사업연도
    prompt = DRAFT_PROMPT.format(name=b.company.name, label=half_label(b.year, b.half), as_of=as_of.isoformat(), fy=fy,
                                 sources=_src_text(b.sources))
    await release(db)
    r = await llm_client.claude_json(claude_key, prompt, system=DRAFT_SYSTEM, model=model, max_tokens=16000, timeout=420,
                                     stage="report_draft")
    await cross_review.log_draft(db, "report", report_id, r, model, prompt)
    if not isinstance(r.data, dict):
        raise llm_client.LLMError("초안 형식이 올바르지 않습니다")
    return r.data


# --------------------------------------------------------------------------- 4) 문장 펼치기·검토·다시 조립

def _sent(x: Any) -> Optional[dict]:
    if isinstance(x, dict) and str(x.get("text") or "").strip():
        return {"text": str(x["text"]).strip(), "source_ids": [str(i) for i in (x.get("source_ids") or []) if i]}
    if isinstance(x, str) and x.strip():
        return {"text": x.strip(), "source_ids": []}
    return None


def normalize(d: dict) -> dict:
    """AI 초안을 안전한 구조로 정리하고 모든 문장에 id 를 단다(검토·편집·출력이 같은 id 를 쓴다)."""
    n = 0

    def nid() -> str:
        nonlocal n
        n += 1
        return f"s{n}"

    sm = d.get("summary") or {}
    summary = {
        "three_lines": [dict(s, id=nid()) for s in (_sent(x) for x in (sm.get("three_lines") or [])[:3]) if s],
        "changes": [dict(s, id=nid()) for s in (_sent(x) for x in (sm.get("changes") or [])[:4]) if s],
        "stage": sm.get("stage") if sm.get("stage") in STAGES else None,
        "stage_note": (lambda s: dict(s, id=nid()) if s else None)(_sent(sm.get("stage_note"))),
    }
    by_no = {int(s.get("no")): s for s in (d.get("sections") or []) if isinstance(s, dict) and str(s.get("no", "")).isdigit()}
    sections = []
    for no, title in SECTIONS:
        blocks = []
        for blk in (by_no.get(no) or {}).get("blocks") or []:
            if not isinstance(blk, dict):
                continue
            t = blk.get("type")
            if t == "para":
                items = []
                for x in blk.get("items") or []:
                    s = _sent(x)
                    if s:
                        kind = (x.get("kind") if isinstance(x, dict) else None) or "fact"
                        if kind == "analysis" and no not in ANALYSIS_SECTIONS:
                            kind = "fact"
                        items.append(dict(s, id=nid(), kind=kind))
                if items:
                    blocks.append({"type": "para", "items": items})
            elif t == "table":
                cols = [str(c) for c in (blk.get("columns") or [])][:8]
                rows = []
                for row in blk.get("rows") or []:
                    if not isinstance(row, dict):
                        continue
                    cells = [("" if c is None else str(c)) for c in (row.get("cells") or [])][:len(cols) or 8]
                    if not any(x.strip() for x in cells):
                        continue
                    rows.append({"id": nid(), "cells": cells, "source_ids": [str(i) for i in (row.get("source_ids") or []) if i],
                                 "note": str(row.get("note") or "")[:300]})
                if cols and rows:
                    blocks.append({"type": "table", "columns": cols, "rows": rows})
            elif t == "timeline":
                items = []
                for x in blk.get("items") or []:
                    s = _sent(x)
                    if s:
                        items.append(dict(s, id=nid(), date=str((x or {}).get("date") or "")[:10]))
                if items:
                    blocks.append({"type": "timeline", "items": items})
        sections.append({"no": no, "title": title, "blocks": blocks})
    fin = d.get("financials") if isinstance(d.get("financials"), dict) else None
    gloss = [{"term": str(g.get("term"))[:40], "desc": str(g.get("desc") or "")[:200]}
             for g in (d.get("glossary") or []) if isinstance(g, dict) and g.get("term")][:30]
    return {"summary": summary, "sections": sections, "financials": fin, "glossary": gloss}


def flatten(content: dict) -> list[dict]:
    """검토용 문장 목록. section: 0=한 장 요약, 1~10. 표의 '공개 자료 없음' 칸처럼 출처 없는 행은 검토에서 뺀다."""
    out = []
    sm = content["summary"]
    for s in sm["three_lines"] + sm["changes"] + ([sm["stage_note"]] if sm.get("stage_note") else []):
        out.append({"id": s["id"], "section": 0, "text": s["text"], "source_ids": s["source_ids"]})
    for sec in content["sections"]:
        for blk in sec["blocks"]:
            if blk["type"] == "para":
                for s in blk["items"]:
                    out.append({"id": s["id"], "section": sec["no"], "text": s["text"], "source_ids": s["source_ids"]})
            elif blk["type"] == "timeline":
                for s in blk["items"]:
                    out.append({"id": s["id"], "section": sec["no"], "text": f"{s.get('date', '')} {s['text']}".strip(),
                                "source_ids": s["source_ids"]})
            elif blk["type"] == "table":
                for row in blk["rows"]:
                    if row["source_ids"]:
                        text = " | ".join(f"{c}: {v}" for c, v in zip(blk["columns"], row["cells"]) if v)
                        out.append({"id": row["id"], "section": sec["no"], "text": text, "source_ids": row["source_ids"],
                                    "is_row": True})
    return out


def apply_review(content: dict, kept: list[dict], removed: list[dict]) -> dict:
    """검토 결과를 원래 구조에 되돌린다. 문장은 고친 글로 바꾸고, 표 행은 칸을 그대로 두되 고친 내용을 note 에 남긴다."""
    k = {s["id"]: s for s in kept}
    gone = {s["id"] for s in removed}

    def fix_sent(s: dict) -> Optional[dict]:
        if s["id"] in gone:
            return None
        r = k.get(s["id"])
        if not r:
            return s
        new = {**s, "text": r["text"], "source_ids": r.get("source_ids") or s["source_ids"]}
        if r.get("disputed"):
            new["disputed"] = True
            new["review_note"] = (r.get("review1_issue") or "")[:300]
        return new

    sm = content["summary"]
    for key in ("three_lines", "changes"):
        sm[key] = [x for x in (fix_sent(s) for s in sm[key]) if x]
    if sm.get("stage_note"):
        sm["stage_note"] = fix_sent(sm["stage_note"])
    for sec in content["sections"]:
        blocks = []
        for blk in sec["blocks"]:
            if blk["type"] in ("para", "timeline"):
                items = []
                for s in blk["items"]:
                    if blk["type"] == "timeline":
                        r = k.get(s["id"])
                        if s["id"] in gone:
                            continue
                        if r:
                            txt = r["text"]
                            if s.get("date") and txt.startswith(s["date"]):
                                txt = txt[len(s["date"]):].strip()
                            s = {**s, "text": txt, "source_ids": r.get("source_ids") or s["source_ids"],
                                 **({"disputed": True, "review_note": (r.get("review1_issue") or "")[:300]} if r.get("disputed") else {})}
                        items.append(s)
                    else:
                        x = fix_sent(s)
                        if x:
                            items.append(x)
                if items:
                    blocks.append({**blk, "items": items})
            elif blk["type"] == "table":
                rows = []
                for row in blk["rows"]:
                    if row["id"] in gone:
                        continue
                    r = k.get(row["id"])
                    if r:
                        orig = " | ".join(f"{c}: {v}" for c, v in zip(blk["columns"], row["cells"]) if v)
                        if r["text"] != orig:
                            row = {**row, "disputed": True, "review_note": f"검토 의견: {r['text']}"[:300]}
                        if r.get("disputed"):
                            row = {**row, "disputed": True, "review_note": (r.get("review1_issue") or row.get("review_note") or "")[:300]}
                        row = {**row, "source_ids": r.get("source_ids") or row["source_ids"]}
                    rows.append(row)
                if rows:
                    blocks.append({**blk, "rows": rows})
            else:
                blocks.append(blk)
        sec["blocks"] = blocks
    return content


async def review(db: AsyncSession, b: Bundle, content: dict, claude_key: str, gemini_key: Optional[str],
                 models: dict, report_id: str) -> dict:
    sentences = flatten(content)
    src_by = {s["id"]: s for s in b.sources}
    kept_all, removed_all, disputed_all = [], [], []
    ok = True
    for group in REVIEW_GROUPS:
        sens = [s for s in sentences if s["section"] in group]
        if not sens:
            continue
        cited = sorted({sid for s in sens for sid in s["source_ids"] if sid in src_by})
        outcome = await cross_review.review_sentences(
            db, sources=[src_by[x] for x in cited], sentences=sens, claude_key=claude_key, gemini_key=gemini_key,
            models=models, target_type="report", target_id=report_id, mode="report", grounding=True,
        )
        ok = ok and outcome.review2_ok
        issues = {x["id"]: x for x in outcome.disputed}
        for k in outcome.sentences:  # 불합의 문장에 1차 지적·2차 판정 이유를 붙여 둔다(담당자 화면 표시)
            if k.get("disputed") and k["id"] in issues:
                k.setdefault("review1_issue", issues[k["id"]].get("review1_issue"))
                k.setdefault("review2_reason", issues[k["id"]].get("review2_reason"))
        kept_all.extend(outcome.sentences)
        # 표의 행은 출처가 비어도 지우지 않는다('공개 자료 없음' 칸) — merge 가 '근거 없음'으로 지운 행은 되살린다
        for r in outcome.removed:
            if r.get("is_row") and r.get("reason") == "근거 없음":
                continue
            removed_all.append(r)
        disputed_all.extend(outcome.disputed)
    content = apply_review(content, kept_all, removed_all)
    return {
        "content": content,
        "summary": {"total": len(sentences), "removed": len(removed_all), "disputed": len(disputed_all), "review_ok": ok},
        "disputed": [{"id": s["id"], "section": s.get("section"), "text": s.get("text"), "issue": s.get("review1_issue"),
                      "decision_reason": s.get("review2_reason")} for s in disputed_all][:80],
        "removed": [{"id": s["id"], "section": s.get("section"), "text": s.get("text"), "reason": s.get("reason")}
                    for s in removed_all][:80],
    }


# --------------------------------------------------------------------------- 5) 이미지

def _store_png(company_id: str, data: bytes) -> str:
    key = storage.make_key(company_id, "reportimg", str(uuid.uuid4()), "png")
    storage.save_bytes(key, data)
    return key


def _fin_series(fin: Optional[dict]) -> tuple[list, dict, str]:
    if not fin:
        return [], {}, "억 원"
    years = [y for y in (fin.get("years") or []) if str(y).isdigit()][:5]
    series = {}
    for k, vals in (fin.get("series") or {}).items():
        if isinstance(vals, list):
            clean = []
            for v in vals[:len(years)]:
                try:
                    clean.append(None if v is None else float(v))
                except (TypeError, ValueError):
                    clean.append(None)
            series[str(k)] = clean
    return years, series, str(fin.get("unit") or "억 원")


IMAGE_PROMPT = """위 그림들은 '{name}' 자료함 문서에서 꺼낸 그림이다(각 그림의 출처: {where}).
고객용 반기 보고서에 넣을 만한 그림을 최대 {n}장 골라라. 넣을 만한 것: 제품·서비스 사진, 사업 구조도, 공장·연구소, 인증서·수상, 도표, 조직도.
넣지 말 것: 로고만 있는 그림, 장식, 글자만 가득한 스캔, 사람 얼굴 위주 사진, 개인정보·계약 금액이 보이는 그림.
항목 번호: 3 주요특징·사업영역, 4 제품라인업, 6 주요성과(인증·수상), 7 성장전략, 9 재무.
JSON: {{"selected": [{{"image": 그림번호, "section_no": 4, "caption": "그림 설명 한 줄(30자 안팎)"}}]}}"""


async def build_images(db: AsyncSession, b: Bundle, report: CompanyReport, content: dict, claude_key: Optional[str],
                       model: str) -> list[ReportImage]:
    """기본 차트 2개(항상 선택) + 자료함 그림 후보(AI 가 고른 것만 선택). 기존 이미지는 지우고 다시 만든다."""
    for old in (await db.execute(select(ReportImage).where(ReportImage.report_id == report.id))).scalars().all():
        await db.delete(old)
    imgs: list[ReportImage] = []
    order = 0

    def add(kind, data_or_key, section, caption, source_label, selected, **kw) -> ReportImage:
        nonlocal order
        order += 1
        key = data_or_key if isinstance(data_or_key, str) else _store_png(b.company.id, data_or_key)
        w, h = kw.pop("size", (None, None))
        im = ReportImage(report_id=report.id, section_no=section, kind=kind, storage_key=key, caption=caption[:300],
                         source_label=(source_label or "")[:200], width=w, height=h, sort_order=order, selected=selected, **kw)
        db.add(im)
        imgs.append(im)
        return im

    # ① 투자유치 타임라인
    rounds = [{"date": r.round_date, "round": r.round_name, "amount": r.amount, "disclosed": r.amount_disclosed} for r in b.rounds]
    png = charts.funding_timeline(rounds)
    if png:
        add("chart", png, 5, "투자유치 타임라인(라운드별 금액·누적 투자금)", "Dr.GM 작성(투자유치 기록)", True,
            size=charts.png_size(png))
    # ② 재무 추이 → 없으면 ③ 사건 타임라인
    years, series, unit = _fin_series(content.get("financials"))
    png = charts.financial_trend(years, series, unit) if years else None
    if png:
        add("chart", png, 9, f"재무 추이({unit})", "Dr.GM 작성(재무 자료)", True, size=charts.png_size(png))
    events = []
    for sec in content["sections"]:
        if sec["no"] == 8:
            for blk in sec["blocks"]:
                if blk["type"] == "timeline":
                    events += [{"label": s.get("date"), "text": s["text"]} for s in blk["items"]]
    if not png or len(imgs) < 2:
        ev = charts.event_timeline(events, title=f"{half_label(b.year, b.half)} 주요 사건")
        if ev:
            add("chart", ev, 8, f"{half_label(b.year, b.half)} 주요 사건", "Dr.GM 작성(월간 요약)", True, size=charts.png_size(ev))

    # 자료함 그림 후보(고객 개인 투자 정보가 있는 문서는 그림도 쓰지 않는다)
    cands = []
    for d in b.documents:
        if d.has_personal_investment:
            continue
        for i, im in enumerate(d.extracted_images or []):
            cands.append((d, i, im))
    cands = sorted(cands, key=lambda x: -((x[2].get("width") or 0) * (x[2].get("height") or 0)))[:MAX_DOC_IMAGE_CANDIDATES]
    room = MAX_IMAGES - len(imgs)
    picks: dict[int, dict] = {}
    if cands and claude_key and room > 0:
        try:
            from PIL import Image

            payload = []
            for d, i, im in cands:
                raw = storage.read_bytes(im["key"])
                pim = Image.open(io.BytesIO(raw)).convert("RGB")
                pim.thumbnail((768, 768))
                buf = io.BytesIO()
                pim.save(buf, "JPEG", quality=80)
                payload.append((buf.getvalue(), "image/jpeg"))
            where = "; ".join(f"그림{n + 1}={d.filename}{' p.' + str(im.get('page')) if im.get('page') else ''}"
                              for n, (d, i, im) in enumerate(cands))
            await release(db)
            r = await llm_client.claude_images_json(claude_key, payload, IMAGE_PROMPT.format(name=b.company.name, where=where,
                                                                                            n=min(room, 6)),
                                                    model=model, stage="report_images")
            for p in (r.data or {}).get("selected", []) if isinstance(r.data, dict) else []:
                try:
                    idx = int(p.get("image")) - 1
                except (TypeError, ValueError):
                    continue
                if 0 <= idx < len(cands):
                    picks[idx] = p
        except Exception as e:
            logger.info("자료 그림 선정 실패: %s", e)
    for n, (d, i, im) in enumerate(cands):
        p = picks.get(n)
        sel = bool(p) and len([x for x in imgs if x.selected]) < MAX_IMAGES
        sec = None
        if p:
            try:
                sec = int(p.get("section_no"))
            except (TypeError, ValueError):
                sec = None
        cap = (p or {}).get("caption") or f"{d.filename}{' ' + str(im.get('page')) + '쪽' if im.get('page') else ''} 그림"
        add("document", im["key"], sec if sec in range(1, 11) else 4, str(cap), f"회사 제공 자료: {d.filename}", sel,
            document_id=d.id, size=(im.get("width"), im.get("height")),
            rights_note=None if d.is_public else "회사 제공 내부 자료(외부 공개 전 확인)")
    await db.flush()
    return imgs


# --------------------------------------------------------------------------- 6) 영업 대화 노트

SALES_PROMPT = """아래는 '{name}' {label} 고객용 보고서의 확정 문장이다. 영업 담당자가 고객과 통화·면담할 때 볼 1장짜리 내부 노트를 만든다.
보고서에 있는 사실만 쓴다. 투자 권유·수익·상장 보장 표현 금지.

{body}

JSON:
{{"key_messages": ["고객에게 꼭 전할 핵심 메시지 3개(한 문장씩)"],
  "qa": [{{"q": "고객이 물을 만한 질문", "a": "이렇게 답하세요(보고서 사실 근거)"}}],
  "careful": ["조심할 표현과 이유(예: '곧 상장합니다' → 상장 시기는 회사도 확정하지 않음)"]}}
qa 는 3~5개, careful 은 2~4개."""


def plain_text(content: dict) -> str:
    lines = []
    sm = content["summary"]
    lines += [f"[요약] {s['text']}" for s in sm["three_lines"]]
    lines += [f"[달라진 점] {s['text']}" for s in sm["changes"]]
    for sec in content["sections"]:
        for blk in sec["blocks"]:
            if blk["type"] == "para":
                lines += [f"[{sec['no']} {sec['title']}] {s['text']}" for s in blk["items"]]
            elif blk["type"] == "timeline":
                lines += [f"[{sec['no']} {sec['title']}] {s.get('date', '')} {s['text']}" for s in blk["items"]]
            elif blk["type"] == "table":
                lines += [f"[{sec['no']} {sec['title']}] " + " | ".join(r["cells"]) for r in blk["rows"]]
    return "\n".join(lines)


async def sales_note(db: AsyncSession, b: Bundle, content: dict, claude_key: str, model: str) -> Optional[dict]:
    await release(db)
    try:
        r = await llm_client.claude_json(claude_key, SALES_PROMPT.format(name=b.company.name, label=half_label(b.year, b.half),
                                                                       body=plain_text(content)[:30000]),
                                         model=model, max_tokens=2500, stage="report_sales")
    except llm_client.LLMError as e:
        logger.info("영업 노트 실패: %s", e)
        return None
    d = r.data if isinstance(r.data, dict) else {}
    return {"key_messages": [str(x) for x in (d.get("key_messages") or [])][:3],
            "qa": [{"q": str(x.get("q")), "a": str(x.get("a"))} for x in (d.get("qa") or []) if isinstance(x, dict)][:5],
            "careful": [str(x) for x in (d.get("careful") or [])][:4]}


# --------------------------------------------------------------------------- 7) 출처 번호·부록

def cited_ids(content: dict) -> list[str]:
    """본문에 처음 나온 순서대로 출처 id."""
    order: list[str] = []

    def take(ids):
        for i in ids or []:
            if i not in order:
                order.append(i)

    sm = content["summary"]
    for s in sm["three_lines"] + sm["changes"] + ([sm["stage_note"]] if sm.get("stage_note") else []):
        take(s.get("source_ids"))
    for sec in content["sections"]:
        for blk in sec["blocks"]:
            for x in blk.get("items") or blk.get("rows") or []:
                take(x.get("source_ids"))
    return order


def build_appendix(b: Bundle, content: dict, review_summary: dict, as_of: date) -> tuple[dict, dict]:
    """(appendix, sources) — sources 는 본문에 실제로 인용된 출처만, 번호(no)를 붙여서."""
    order = [i for i in cited_ids(content) if i in b.table]
    sources = {}
    for n, sid in enumerate(order, start=1):
        meta = dict(b.table[sid])
        if meta.get("type") == "document" and not meta.get("is_public"):
            meta["url"] = None  # 비공개 자료는 링크 없이 이름만
        sources[sid] = {**meta, "no": n}
    citation_list = [{"no": sources[s]["no"], "id": s, "title": sources[s].get("title"), "press": sources[s].get("press"),
                      "date": sources[s].get("date"), "url": sources[s].get("url")} for s in order]
    top_articles = [{"title": a.title, "press": a.press, "date": _d(a.published_at.date() if a.published_at else None), "url": a.url}
                    for a in sorted(b.articles, key=lambda a: -(a.relevance_score or 0))[:30]]
    dart = [{"title": a.title, "date": _d(a.published_at.date() if a.published_at else None), "url": a.url} for a in b.dart]
    funding = []
    for r in b.rounds:
        funding.append({"round": r.round_name, "date": _d(r.round_date),
                        "links": [{"title": x.get("title") or x.get("url"), "url": x.get("url")}
                                  for x in (r.source_refs or []) if isinstance(x, dict) and x.get("url")][:5]})
    docs = [{"name": d.filename, "type": d.doc_type, "is_public": d.is_public} for d in b.documents]
    appendix = {
        "citations": citation_list,
        "articles": top_articles,
        "dart": dart,
        "funding_sources": funding,
        "documents": docs,
        "glossary": content.get("glossary") or [],
        "verification": {**review_summary, "source_count": len(order), "as_of": as_of.isoformat()},
        "disclaimer": DISCLAIMER,
    }
    return appendix, sources


# --------------------------------------------------------------------------- 실행

async def create_report(db: AsyncSession, company_id: str, year: int, half: int, user_id: Optional[str]) -> CompanyReport:
    """자동 생성본 새 버전을 'generating' 으로 만든다(실제 작성은 run_report). 커밋까지 한다."""
    ver = (await db.execute(select(func.max(CompanyReport.version)).where(
        CompanyReport.company_id == company_id, CompanyReport.period_year == year, CompanyReport.period_half == half,
        CompanyReport.owner_user_id.is_(None)))).scalar() or 0
    r = CompanyReport(company_id=company_id, report_type="half_year", period_year=year, period_half=half, version=ver + 1,
                      status="generating", progress=0, progress_step="대기", created_by=user_id, as_of_date=today_kst())
    db.add(r)
    await db.commit()
    await db.refresh(r)
    return r


async def _step(db: AsyncSession, r: CompanyReport, step: str, pct: int) -> None:
    r.progress_step, r.progress = step, pct
    await db.commit()


async def run_report(db: AsyncSession, report_id: str) -> CompanyReport:
    """보고서 한 건 작성(백그라운드). 실패하면 status=failed 와 이유를 남긴다."""
    r = await db.get(CompanyReport, report_id)
    if r is None:
        raise ValueError("보고서를 찾을 수 없습니다.")
    company = await db.get(PortfolioCompany, r.company_id)
    try:
        claude = await get_service_key(db, "claude")
        gemini = await get_service_key(db, "gemini")
        models = await config.get_models(db)
        if not claude:
            raise llm_client.LLMError("Claude 키가 없어 보고서를 쓰지 못했습니다(설정 > API 키).")
        from app.services.company_report import usage

        await usage.flush(db)  # 앞서 쌓인 사용량은 먼저 비용 기록으로 넘기고, 이 보고서 사용량만 따로 센다
        as_of = today_kst()
        r.as_of_date, r.main_model, r.review_model, r.error = as_of, models["writer"], models["review"], None

        await _step(db, r, "자료 모으는 중", 5)
        b = await gather(db, company, r.period_year, r.period_half)

        await _step(db, r, "웹에서 빈칸 확인 중", 15)
        web_n = await web_enrich(db, b, claude[0], models["writer"])

        await _step(db, r, "초안 쓰는 중", 30)
        raw = await draft(db, b, claude[0], models["writer"], as_of, r.id)
        content = normalize(raw)

        await _step(db, r, "교차 검토 중", 55)
        rv = await review(db, b, content, claude[0], gemini[0] if gemini else None, models, r.id)
        content = rv["content"]

        await _step(db, r, "그림 준비 중", 75)
        images = await build_images(db, b, r, content, claude[0], models["writer"])

        await _step(db, r, "영업 대화 노트 쓰는 중", 88)
        note = await sales_note(db, b, content, claude[0], models["writer"])

        appendix, sources = build_appendix(b, content, rv["summary"], as_of)
        content["appendix"] = appendix
        content["cover"] = {"company": company.name, "company_en": company.name_en, "period": half_label(r.period_year, r.period_half),
                            "as_of": as_of.isoformat(), "brand": "Dr.GM Family Office"}
        content["stats"] = {"web_facts": web_n, "documents": len(b.documents), "articles": len(b.articles),
                            "images_selected": len([i for i in images if i.selected]), "image_candidates": len(images)}
        r.content, r.sources, r.sales_note = content, sources, note
        r.review = {"summary": rv["summary"], "disputed": rv["disputed"], "removed": rv["removed"]}
        r.status, r.progress, r.progress_step = "draft", 100, "완료"
        import copy

        r.token_usage = copy.deepcopy(llm_client._USAGE)
        await usage.flush(db)  # 월별 비용 기록(발송 설정 > 비용)
        await db.commit()
        await _index(db, r, company)
        return r
    except Exception as e:
        logger.warning("반기 보고서 작성 실패(%s): %s", report_id, e)
        await db.rollback()
        r = await db.get(CompanyReport, report_id)
        r.status, r.error = "failed", str(e)[:1000]
        r.progress_step = "실패"
        await db.commit()
        return r


async def run_in_background(report_id: str) -> None:
    from app.db.session import AsyncSessionLocal

    async with AsyncSessionLocal() as db:
        await run_report(db, report_id)


async def _index(db: AsyncSession, r: CompanyReport, company: PortfolioCompany) -> None:
    """통합 검색: 보고서 요약·항목 글이 찾히게."""
    try:
        from app.models.company_report import SearchIndex

        body = plain_text(r.content)[:20000]
        eid = f"report:{r.id}"
        row = (await db.execute(select(SearchIndex).where(SearchIndex.entity_type == "report_section",
                                                          SearchIndex.entity_id == eid))).scalar_one_or_none()
        title = f"{company.name} {half_label(r.period_year, r.period_half)} 보고서 v{r.version}"
        if row is None:
            row = SearchIndex(entity_type="report_section", entity_id=eid, company_id=company.id, title=title)
            db.add(row)
        row.title, row.body, row.norm = title, body, re.sub(r"\s+", "", (title + body).lower())[:20000]
        row.doc_date, row.url_path = r.as_of_date, f"/content/company-report/companies/{company.id}?tab=report&report={r.id}"
        await db.commit()
    except Exception as e:
        await db.rollback()
        logger.info("보고서 색인 실패: %s", e)
