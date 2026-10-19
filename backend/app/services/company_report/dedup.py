"""URL 정규화·중복 제거·관련도 점수·제목 유사도 묶기 (기획 3장 F3, 9장)."""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
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


LEAD_CHARS = 60   # 첫 문장으로 볼 최대 길이(공백 뺀 글자 수, 기자명 머리말 다음부터)
_BYLINE = re.compile(r"^.{0,60}?(기자|특파원|통신원)\s*[=\]]\s*|^\[[^\]]{0,30}\]\s*|^\([^)]{0,30}\)\s*")


_SENT_END = re.compile(r"[.!?。…](\s|$)")


def _lead(description: str) -> str:
    """본문 첫 문장: 앞의 [서울=뉴시스] 홍길동 기자 = 같은 머리말을 떼고, 첫 마침표까지(최대 LEAD_CHARS 글자)."""
    d = _TAG.sub("", description or "").strip()
    for _ in range(3):
        nd = _BYLINE.sub("", d, count=1).strip()
        if nd == d:
            break
        d = nd
    m = _SENT_END.search(d)
    if m:
        d = d[: m.end()]
    return _norm_text(d)[:LEAD_CHARS]


def relevance(title: str, description: str, required: list[str], boost: list[str], exclude: list[str],
              names: tuple | list = ()) -> Relevance:
    """규칙 점수(0~100). 제외어가 있으면 제외.
    기업 이름(필수어 + names: 기업명·별칭·대표자)이 제목에 있으면 60, 본문 첫머리(첫 문장)에 있으면 45,
    본문 중간에 한두 번 나올 뿐이면 '단순 언급'으로 제외(저장·요약하지 않음). 보조어 1개당 +10(최대 +30)."""
    t, d = _norm_text(title), _norm_text(description)
    for ex in exclude:
        e = _norm_text(ex)
        if e and (e in t or e in d):
            return Relevance(0, True, f"제외어 '{ex}'")
    terms = [x for x in dict.fromkeys([*required, *names]) if _norm_text(x)]
    score, hit, where = 0, None, "제목"
    for rq in terms:
        if _norm_text(rq) in t:
            score, hit = 60, rq
            break
    if not score:
        lead = _lead(description)
        for rq in terms:
            if _norm_text(rq) in lead:
                score, hit, where = 45, rq, "첫머리"
                break
    if not score:
        if any(_norm_text(rq) in d for rq in terms):
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
