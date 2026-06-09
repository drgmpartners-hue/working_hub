"""일일 분석 리포트 생성 (HTML 이메일용).

- 테마 랭킹 Top 10 (점수·국면·배경)
- 상승 종목 Top 5 / 하락 종목 Top 5 (점수·배경)
"""
from __future__ import annotations

from datetime import date

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.stock import StockTheme
from app.models.stock_metrics import StockDailyMetric

_PHASE_LABEL = {"breakout": "🚀 고점돌파", "turnaround": "⚓ 바닥탈출", "neutral": "➡️ 중립"}
_ALIGN_LABEL = {"bullish": "정배열", "bearish": "역배열", "mixed": "혼조"}


def _fmt_pct(v) -> str:
    if v is None:
        return "-"
    sign = "+" if v > 0 else ""
    return f"{sign}{v:.1f}%"


async def build_report_data(db: AsyncSession) -> dict:
    """리포트 원본 데이터 수집."""
    # 테마 Top 10
    themes = (
        await db.execute(
            select(StockTheme).where(StockTheme.ai_score.isnot(None))
            .order_by(StockTheme.ai_score.desc()).limit(10)
        )
    ).scalars().all()

    latest = (await db.execute(select(func.max(StockDailyMetric.trade_date)))).scalar()
    gainers = []
    losers = []
    if latest:
        base = select(StockDailyMetric).where(
            StockDailyMetric.trade_date == latest, StockDailyMetric.return_1m.isnot(None)
        )
        gainers = (await db.execute(base.order_by(StockDailyMetric.return_1m.desc()).limit(5))).scalars().all()
        losers = (await db.execute(base.order_by(StockDailyMetric.return_1m.asc()).limit(5))).scalars().all()

    return {"date": str(latest or date.today()), "themes": themes, "gainers": gainers, "losers": losers}


def render_html(data: dict) -> str:
    """리포트 데이터 → HTML."""
    navy = "#1E3A5F"

    def theme_rows():
        rows = ""
        for i, t in enumerate(data["themes"], 1):
            phase = _PHASE_LABEL.get(t.phase or "neutral", "")
            bg = (t.news_summary or "").split("(")[0][:60]
            rows += (
                f"<tr><td style='padding:6px 10px'>{i}</td>"
                f"<td style='padding:6px 10px;font-weight:600'>{t.theme_name}</td>"
                f"<td style='padding:6px 10px;color:{navy};font-weight:700'>{(t.ai_score or 0):.1f}</td>"
                f"<td style='padding:6px 10px'>{phase}</td>"
                f"<td style='padding:6px 10px;color:#6B7280;font-size:12px'>{bg}</td></tr>"
            )
        return rows or "<tr><td colspan=5 style='padding:10px;color:#9CA3AF'>데이터 없음 (배치 미실행)</td></tr>"

    def stock_rows(items, up: bool):
        color = "#059669" if up else "#DC2626"
        rows = ""
        for s in items:
            phase = _PHASE_LABEL.get(s.phase or "neutral", "")
            align = _ALIGN_LABEL.get(s.ma_alignment or "mixed", "")
            bg = f"종합 {(s.composite_score or 0):.0f}점 · {align} · {phase}"
            rows += (
                f"<tr><td style='padding:6px 10px;font-weight:600'>{s.name or s.code}</td>"
                f"<td style='padding:6px 10px;color:{color};font-weight:700'>{_fmt_pct(s.return_1m)}</td>"
                f"<td style='padding:6px 10px;color:#6B7280;font-size:12px'>{bg}</td></tr>"
            )
        return rows or "<tr><td colspan=3 style='padding:10px;color:#9CA3AF'>데이터 없음</td></tr>"

    th = "style='padding:6px 10px;text-align:left;color:#6B7280;font-size:12px;border-bottom:1px solid #E5E7EB'"
    return f"""
<div style="font-family:'Apple SD Gothic Neo',sans-serif;max-width:680px;margin:0 auto;color:#1A1A2E">
  <div style="background:{navy};color:#fff;padding:18px 20px;border-radius:10px 10px 0 0">
    <h2 style="margin:0;font-size:18px">📊 주식·ETF 일일 분석 리포트</h2>
    <p style="margin:4px 0 0;font-size:13px;opacity:.85">{data['date']} 기준 · Working Hub</p>
  </div>
  <div style="border:1px solid #E5E7EB;border-top:none;padding:20px;border-radius:0 0 10px 10px">

    <h3 style="font-size:15px;margin:0 0 8px">🏆 테마 랭킹 Top 10</h3>
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:24px">
      <tr><th {th}>순위</th><th {th}>테마</th><th {th}>점수</th><th {th}>국면</th><th {th}>배경</th></tr>
      {theme_rows()}
    </table>

    <h3 style="font-size:15px;margin:0 0 8px;color:#059669">📈 상승 종목 Top 5 (1개월)</h3>
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:24px">
      <tr><th {th}>종목</th><th {th}>수익률</th><th {th}>배경</th></tr>
      {stock_rows(data['gainers'], True)}
    </table>

    <h3 style="font-size:15px;margin:0 0 8px;color:#DC2626">📉 하락 종목 Top 5 (1개월)</h3>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <tr><th {th}>종목</th><th {th}>수익률</th><th {th}>배경</th></tr>
      {stock_rows(data['losers'], False)}
    </table>

    <p style="margin:20px 0 0;font-size:11px;color:#9CA3AF">
      ※ 점수·국면은 KIS 실시세 기반 5축(모멘텀·수급·실적·관심도·밸류) 집계입니다.
      가중치는 사후검증으로 지속 보정됩니다. 투자 판단의 참고용입니다.
    </p>
  </div>
</div>
"""


async def build_report_html(db: AsyncSession) -> str:
    return render_html(await build_report_data(db))
