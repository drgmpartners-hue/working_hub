"""반기 보고서 기본 차트 (기획 6장 '이미지', P4-6).

시스템이 데이터로 직접 그리는 그림이라 저작권 문제가 없고 언제든 만들 수 있다.
① 투자유치 타임라인: 라운드별 금액(막대) + 누적 투자금(선)            → 5번 항목
② 재무 추이: 매출·영업이익 3개년(막대)                               → 9번 항목
   재무 자료가 2개년 미만이면 ③ 이번 반기 주요 사건 타임라인으로 대신 → 8번 항목

PNG(인쇄용 200dpi). 한글은 나눔고딕(서버 Dockerfile 의 fonts-nanum), 없으면 Noto CJK.
"""
from __future__ import annotations

import io
import logging
import textwrap
from datetime import date
from typing import Optional

logger = logging.getLogger(__name__)

NAVY = "#1F2A44"
GOLD = "#B8975A"
GRAY = "#8A93A6"
RED = "#C0504D"
DPI = 200

_font_ready = False


def _setup():
    global _font_ready
    import matplotlib

    matplotlib.use("Agg")
    if _font_ready:
        return
    from matplotlib import font_manager, rcParams

    names = {f.name for f in font_manager.fontManager.ttflist}
    for cand in ("NanumGothic", "NanumBarunGothic", "Noto Sans CJK KR", "Noto Sans CJK JP", "Noto Sans CJK SC"):
        if cand in names:
            rcParams["font.family"] = cand
            break
    else:
        logger.info("한글 글꼴을 찾지 못했습니다(fonts-nanum 필요). 차트 글자가 깨질 수 있습니다.")
    rcParams["axes.unicode_minus"] = False
    _font_ready = True


def _save(fig) -> bytes:
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=DPI, bbox_inches="tight", facecolor="white")
    import matplotlib.pyplot as plt

    plt.close(fig)
    return buf.getvalue()


def _eok(v: Optional[float]) -> str:
    if v is None:
        return "비공개"
    x = v / 1e8
    return f"{x:,.0f}억" if x >= 10 or x == int(x) else f"{x:,.1f}억"


def funding_timeline(rounds: list[dict]) -> Optional[bytes]:
    """rounds: [{date: date|None, round: str, amount: int|None(원), disclosed: bool}] — 날짜 순으로 그린다.
    금액 비공개 라운드는 회색 점으로 표시하고 누적에는 넣지 않는다. 라운드가 없으면 None."""
    rows = [r for r in rounds if r.get("date") or r.get("amount")]
    if not rows:
        return None
    _setup()
    import matplotlib.pyplot as plt

    rows.sort(key=lambda r: r.get("date") or date.min)
    labels = [f"{(r.get('round') or '투자')}\n{r['date'].strftime('%Y.%m') if r.get('date') else '시기 미상'}" for r in rows]
    amounts = [(r["amount"] / 1e8) if (r.get("amount") and r.get("disclosed", True)) else None for r in rows]
    cum, run = [], 0.0
    for a in amounts:
        run += a or 0
        cum.append(run)
    fig, ax = plt.subplots(figsize=(7.2, 3.6))
    xs = list(range(len(rows)))
    for x, a in zip(xs, amounts):
        if a is None:
            ax.scatter([x], [0], color=GRAY, zorder=3)
            ax.annotate("비공개", (x, 0), textcoords="offset points", xytext=(0, 6), ha="center", fontsize=8, color=GRAY)
        else:
            ax.bar([x], [a], color=NAVY, width=0.55, zorder=2)
            top_all = max([v for v in amounts if v] or [1])
            if a >= top_all * 0.18:  # 막대 안쪽 위(누적 선 점과 겹치지 않게)
                ax.annotate(_eok(a * 1e8), (x, a), textcoords="offset points", xytext=(0, -12), ha="center", fontsize=8,
                            color="white", fontweight="bold", zorder=5)
            else:
                ax.annotate(_eok(a * 1e8), (x, a), textcoords="offset points", xytext=(0, 3), ha="center", fontsize=8, color=NAVY)
    if any(a for a in amounts):
        ax2 = ax.twinx()
        ax2.plot(xs, cum, color=GOLD, marker="o", linewidth=2, zorder=4)
        ax2.set_ylabel("누적 투자금(억 원)", color=GOLD, fontsize=9)
        ax2.tick_params(axis="y", colors=GOLD, labelsize=8)
        ax2.set_ylim(0, max(cum) * 1.25 or 1)
        ax2.annotate(f"누적 {_eok(cum[-1] * 1e8)}", (xs[-1], cum[-1]), textcoords="offset points", xytext=(0, 9),
                     ha="center", fontsize=8, color=GOLD, fontweight="bold")
        for s in ("top",):
            ax2.spines[s].set_visible(False)
    ax.set_xticks(xs)
    ax.set_xticklabels(labels, fontsize=8)
    ax.set_ylabel("라운드 금액(억 원)", fontsize=9)
    top = max([a for a in amounts if a] or [1])
    ax.set_ylim(0, top * 1.3)
    ax.tick_params(axis="y", labelsize=8)
    ax.grid(axis="y", color="#E5E7EB", zorder=0)
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)
    ax.set_title("투자유치 타임라인", fontsize=11, color=NAVY, loc="left", pad=10)
    return _save(fig)


def financial_trend(years: list, series: dict[str, list[Optional[float]]], unit: str = "억 원") -> Optional[bytes]:
    """years: [2023, 2024, 2025], series: {"매출액": [...], "영업이익": [...]} — 값은 unit 단위 숫자.
    값이 있는 연도가 2개 미만이면 None(→ 사건 타임라인으로 대신)."""
    years = [str(y) for y in years]
    filled = [i for i in range(len(years)) if any((v[i] if i < len(v) else None) is not None for v in series.values())]
    if len(filled) < 2:
        return None
    _setup()
    import matplotlib.pyplot as plt

    names = [k for k, v in series.items() if any(x is not None for x in v)][:3]
    colors = [NAVY, GOLD, GRAY]
    fig, ax = plt.subplots(figsize=(7.2, 3.6))
    n = len(names)
    w = 0.8 / max(n, 1)
    for j, name in enumerate(names):
        vals = series[name]
        for i in range(len(years)):
            v = vals[i] if i < len(vals) else None
            if v is None:
                continue
            x = i - 0.4 + w / 2 + j * w
            ax.bar([x], [v], width=w * 0.9, color=(RED if v < 0 and name != names[0] else colors[j]), zorder=2)
            ax.annotate(f"{v:,.0f}", (x, v), textcoords="offset points", xytext=(0, 3 if v >= 0 else -10), ha="center", fontsize=7)
    ax.axhline(0, color="#9CA3AF", linewidth=0.8)
    ax.set_xticks(range(len(years)))
    ax.set_xticklabels([f"{y}년" for y in years], fontsize=9)
    ax.set_ylabel(unit, fontsize=9)
    ax.tick_params(axis="y", labelsize=8)
    ax.grid(axis="y", color="#E5E7EB", zorder=0)
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)
    from matplotlib.patches import Patch

    handles = [Patch(color=colors[j], label=nm) for j, nm in enumerate(names)]
    if any(v is not None and v < 0 for nm in names[1:] for v in series[nm]):
        handles.append(Patch(color=RED, label="적자"))
    ax.legend(handles=handles, fontsize=8, frameon=False, loc="upper left")
    ax.set_title("재무 추이", fontsize=11, color=NAVY, loc="left", pad=10)
    return _save(fig)


def event_timeline(events: list[dict], title: str = "이번 반기 주요 사건") -> Optional[bytes]:
    """events: [{label: '2026-03' 또는 날짜, text: '...'}] 최대 8개. 없으면 None."""
    ev = [e for e in events if (e.get("text") or "").strip()][:8]
    if not ev:
        return None
    _setup()
    import matplotlib.pyplot as plt

    h = 0.6 + 0.55 * len(ev)
    fig, ax = plt.subplots(figsize=(7.2, max(2.2, h)))
    ax.axvline(0.08, color=GOLD, linewidth=2)
    for i, e in enumerate(ev):
        y = len(ev) - i
        ax.scatter([0.08], [y], color=NAVY, s=40, zorder=3)
        ax.text(0.0, y, str(e.get("label") or ""), ha="right", va="center", fontsize=8, color=GRAY)
        ax.text(0.12, y, textwrap.shorten(str(e["text"]), width=56, placeholder="…"), ha="left", va="center", fontsize=9, color="#111827")
    ax.set_xlim(-0.25, 1.2)
    ax.set_ylim(0.3, len(ev) + 0.7)
    ax.axis("off")
    ax.set_title(title, fontsize=11, color=NAVY, loc="left", pad=6)
    return _save(fig)


def png_size(data: bytes) -> tuple[Optional[int], Optional[int]]:
    try:
        from PIL import Image

        return Image.open(io.BytesIO(data)).size
    except Exception:
        return None, None
