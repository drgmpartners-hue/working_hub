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


def relevance(title: str, description: str, required: list[str], boost: list[str], exclude: list[str]) -> Relevance:
    """규칙 점수(0~100). 필수어가 제목에 +60, 요약문에 +40, 보조어 1개당 +10(최대 +30), 제외어가 있으면 0."""
    t, d = _norm_text(title), _norm_text(description)
    for ex in exclude:
        e = _norm_text(ex)
        if e and (e in t or e in d):
            return Relevance(0, True, f"제외어 '{ex}'")
    score = 0
    hit = None
    for rq in required:
        r = _norm_text(rq)
        if not r:
            continue
        if r in t:
            score, hit = 60, rq
            break
        if r in d and score < 40:
            score, hit = 40, rq
    if score == 0:
        return Relevance(0, True, "필수어 없음")
    b = sum(1 for bw in boost if _norm_text(bw) and (_norm_text(bw) in t or _norm_text(bw) in d))
    score = min(100, score + min(30, b * 10))
    return Relevance(score, False, f"필수어 '{hit}'" + (f" + 보조어 {b}개" if b else ""))


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
