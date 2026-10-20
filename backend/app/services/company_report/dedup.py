"""URL 정규화·중복 제거·관련도 점수·제목 유사도 묶기 (기획 3장 F3, 9장)."""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from typing import Optional
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

_TRACKING = re.compile(r"^(utm_|fbclid$|gclid$|ref$|from$|nclick|sc_)", re.I)
_TAG = re.compile(r"<[^>]+>")


def normalize_url(url: str) -> str:
    """추적 파라미터·프래그먼트·끝 슬래시 제거, 호스트 소문자."""
    try:
        p = urlparse(url.strip())
    except Exception:
        return url.strip()
    q = [(k, v) for k, v in parse_qsl(p.query, keep_blank_values=True) if not _TRACKING.match(k)]
    host = p.netloc.lower()
    if host.startswith("www."):
        host = host[4:]
    path = p.path.rstrip("/") or "/"
    return urlunparse(("https" if p.scheme in ("http", "https") else p.scheme, host, path, "", urlencode(q), ""))


def url_hash(url: str) -> str:
    return hashlib.sha256(normalize_url(url).encode()).hexdigest()


def _norm_text(t: str) -> str:
    return re.sub(r"\s+", "", _TAG.sub("", t or "")).lower()


@dataclass
class Relevance:
    score: int
    excluded: bool
    reason: str


LEAD_CHARS = 80   # 첫 문장으로 볼 최대 길이(기자명 머리말 다음부터)
_BYLINE = re.compile(r"^.{0,60}?(기자|특파원|통신원)\s*[=\]]\s*|^\[[^\]]{0,30}\]\s*|^\([^)]{0,30}\)\s*|^【[^】]{0,30}】\s*")
_SENT_END = re.compile(r"[.!?。…](\s|$)")
_HANGUL = re.compile(r"[가-힣]")
_WORDCH = re.compile(r"[A-Za-z0-9]")
# 이름 바로 뒤에 붙어도 되는 말(조사·서술). 이 밖의 글자가 붙으면 다른 낱말의 일부로 본다(에이치엘 ≠ 에이치엘비).
PARTICLES = {
    "은", "는", "이", "가", "을", "를", "의", "와", "과", "도", "에", "로", "만", "측", "께", "랑", "나", "님",
    "에서", "에게", "으로", "까지", "부터", "보다", "처럼", "마저", "조차", "이나", "이랑", "라는", "이라", "이라는",
    "이다", "였다", "이며", "이고", "에선", "에서는", "에는", "에도", "에서도", "와의", "과의", "로서", "로써",
    "으로서", "으로써", "로부터", "으로부터", "만의", "과도", "와도", "에게서", "한테", "이자", "인", "엔",
}


def _lead_raw(description: str) -> str:
    """본문 첫 문장(원문 그대로): [서울=뉴시스] 홍길동 기자 = 같은 머리말을 떼고 첫 마침표까지."""
    d = _TAG.sub("", description or "").strip()
    for _ in range(3):
        nd = _BYLINE.sub("", d, count=1).strip()
        if nd == d:
            break
        d = nd
    m = _SENT_END.search(d)
    if m:
        d = d[: m.end()]
    return d[:LEAD_CHARS]


def _lead(description: str) -> str:
    return _norm_text(_lead_raw(description))


def _term_re(term: str) -> Optional[re.Pattern]:
    chars = [c for c in _TAG.sub("", term or "") if not c.isspace()]
    if not chars:
        return None
    return re.compile(r"\s?".join(re.escape(c) for c in chars), re.I)


def find_word(term: str, text: str) -> Optional[int]:
    """text 안에서 term 이 '낱말로' 나오는 첫 위치(없으면 None). 띄어쓰기·대소문자 무시.
    앞에 같은 종류 글자(한글/영숫자)가 붙거나, 뒤에 조사가 아닌 한글·영숫자가 붙으면 다른 낱말의 일부로 본다."""
    rx = _term_re(term)
    if not rx:
        return None
    t = _TAG.sub("", text or "")
    for m in rx.finditer(t):
        s, e = m.start(), m.end()
        first, last = m.group(0)[0], m.group(0)[-1]
        prev = t[s - 1] if s > 0 else ""
        if prev and ((_HANGUL.match(first) and _HANGUL.match(prev)) or (_WORDCH.match(first) and _WORDCH.match(prev))):
            continue
        nxt = t[e] if e < len(t) else ""
        if _WORDCH.match(last) and nxt and _WORDCH.match(nxt):
            continue
        run = re.match(r"[가-힣]+", t[e:])
        if run and run.group(0) not in PARTICLES:
            continue
        return s
    return None


def _any_word(terms, text: str) -> Optional[str]:
    for x in terms:
        if find_word(x, text) is not None:
            return x
    return None


# 주가·시황 나열 기사(여러 종목 등락을 늘어놓은 기사). 그 기업이 제목의 주인공이면 예외.
MARKET_TITLE = re.compile(
    r"시황|장\s?마감|마감\s?종합|개장|상승률\s?상위|하락률\s?상위|신고가\s?종목|신저가\s?종목|급등주|급락주|"
    r"순매수\s?상위|순매도\s?상위|거래대금\s?상위|시총\s?상위|시가총액\s?상위|시간외|관련주|테마주|"
    r"오늘의\s?(증시|종목|특징주)|종목\s?(동향|정리|브리핑|시세)|"
    r"(코스피|코스닥|증시|지수)[^\n]{0,20}(마감|출발|강보합|약보합|상승|하락|반등|급등|급락|강세|약세)")
_PCT = re.compile(r"\d+(?:\.\d+)?\s?%|[▲▼↑↓]")
MARKET_PCT_MIN = 5          # 본문 앞부분에 등락률이 이만큼 나오면 나열 기사로 본다
SUBJECT_CHARS = 2           # 제목이 (태그·따옴표 다음) 기업명으로 시작하면 그 기업이 주인공


def _title_head(title: str) -> str:
    t = _TAG.sub("", title or "").strip()
    for _ in range(2):
        t = re.sub(r"^(\[[^\]]{0,20}\]|【[^】]{0,20}】|\([^)]{0,20}\)|<[^>]{0,20}>)\s*", "", t)
    return t[:60]


def market_list(title: str, description: str, company_terms) -> Optional[str]:
    """주가·시황 나열 기사면 이유, 아니면 None. 제목 머리에 그 기업이 나오면(그 기업 단독 기사) None."""
    head = _title_head(title)
    pos = [find_word(x, head) for x in company_terms]
    if any(p is not None and p <= SUBJECT_CHARS for p in pos):
        return None
    if MARKET_TITLE.search(_TAG.sub("", title or "")):
        return "주가·시황 나열 기사(제목)"
    if len(_PCT.findall(_TAG.sub("", description or ""))) >= MARKET_PCT_MIN:
        return "주가·시황 나열 기사(등락률 나열)"
    return None


def relevance(title: str, description: str, required: list[str], boost: list[str], exclude: list[str],
              names: tuple | list = (), people: tuple | list = ()) -> Relevance:
    """규칙 점수(0~100). 이름은 '낱말'로만 맞춘다(다른 낱말의 일부는 불일치).
    - 제외어 → 제외. 주가·시황 나열 기사(그 기업이 제목 주인공이 아니면) → 제외.
    - 기업 이름(필수어 + names: 기업명·영문명·별칭)이 제목에 있으면 60, 본문 첫 문장에 있으면 45.
    - 대표자 이름(people)은 기사 어딘가에 기업명도 함께 있을 때만 인정(동명이인 방지).
    - 본문 중간에만 나오면 '단순 언급'으로 제외. 보조어 1개당 +10(최대 +30)."""
    t, d = _norm_text(title), _norm_text(description)
    for ex in exclude:
        e = _norm_text(ex)
        if e and (e in t or e in d):
            return Relevance(0, True, f"제외어 '{ex}'")
    company = [x for x in dict.fromkeys([*required, *names]) if _norm_text(x)]
    persons = [x for x in dict.fromkeys(people) if _norm_text(x)]
    full = f"{title or ''}\n{description or ''}"
    company_anywhere = _any_word(company, full)

    mk = market_list(title, description, company)
    if mk:
        return Relevance(0, True, mk)

    lead = _lead_raw(description)
    p_title = _any_word(persons, title) if persons else None
    p_lead = _any_word(persons, lead) if persons else None
    score, hit, where = 0, None, ""
    if h := _any_word(company, title):
        score, hit, where = 60, h, "제목"
    elif p_title and company_anywhere:
        score, hit, where = 60, f"{p_title}(+기업명 '{company_anywhere}')", "제목 대표자"
    elif h := _any_word(company, lead):
        score, hit, where = 45, h, "첫머리"
    elif p_lead and company_anywhere:
        score, hit, where = 45, f"{p_lead}(+기업명 '{company_anywhere}')", "첫머리 대표자"
    elif (p_title or p_lead) and not company_anywhere:
        return Relevance(0, True, "대표자 이름만 있고 기업명 없음(동명이인 의심)")
    if not score:
        if company_anywhere:
            return Relevance(0, True, "단순 언급(제목·첫머리에 기업명 없음)")
        return Relevance(0, True, "필수어 없음")
    b = sum(1 for bw in boost if _norm_text(bw) and (_norm_text(bw) in t or _norm_text(bw) in d))
    score = min(100, score + min(30, b * 10))
    return Relevance(score, False, f"{where} '{hit}'" + (f" + 보조어 {b}개" if b else ""))


def _bigrams(t: str) -> set[str]:
    s = _norm_text(t)
    return {s[i : i + 2] for i in range(len(s) - 1)}


def title_similarity(a: str, b: str) -> float:
    A, B = _bigrams(a), _bigrams(b)
    if not A or not B:
        return 0.0
    return len(A & B) / len(A | B)


def group_similar(articles: list[dict], threshold: float = 0.55) -> list[list[int]]:
    """제목이 비슷한 기사(같은 보도자료)를 묶어 인덱스 그룹을 돌려준다. 입력 순서 유지."""
    groups: list[list[int]] = []
    reps: list[str] = []
    for i, a in enumerate(articles):
        for g, rep in zip(groups, reps):
            if title_similarity(a.get("title", ""), rep) >= threshold:
                g.append(i)
                break
        else:
            groups.append([i])
            reps.append(a.get("title", ""))
    return groups
