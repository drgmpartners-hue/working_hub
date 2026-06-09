"""사후검증 기반 가중치 보정 (08-stock-etf-recommend §7).

원칙: 각 축의 가중치를 '느낌'이 아니라 데이터로 정한다.
방법: 과거 시점(anchor)의 축 점수가 '이후 horizon일 실제 수익'을 예측했는지
      역사적 백테스트로 상관관계를 측정 → 예측력 높은 축에 가중치 가산.

가격 기반 축(모멘텀·정배열)은 KIS 과거 시세로 즉시 검증 가능.
⚠️ 수급·실적·관심도는 과거 스냅샷이 없어 역사 복원 불가 → 전향적(forward) 스냅샷
   누적 후 보정 예정. 본 엔진은 가격축 예측력으로 모멘텀 가중치를 우선 보정한다.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.services import indicator_engine
from app.services.collectors.key_access import get_user_key
from app.services.collectors.kis_client import KISClient
from app.services.theme_stock_map import THEME_STOCKS

logger = logging.getLogger(__name__)

_CACHE_DIR = Path(__file__).resolve().parents[2] / ".cache"
_CACHE_DIR.mkdir(exist_ok=True)
_WEIGHTS_FILE = _CACHE_DIR / "theme_weights.json"

# 기본(prior) 가중치 — 보정 전/폴백
DEFAULT_WEIGHTS = {
    "breakout":   {"momentum": 0.15, "supply": 0.10, "fundamentals": 0.40, "attention": 0.30, "valuation": 0.05},
    "turnaround": {"momentum": 0.30, "supply": 0.40, "fundamentals": 0.10, "attention": 0.12, "valuation": 0.08},
    "neutral":    {"momentum": 0.30, "supply": 0.25, "fundamentals": 0.20, "attention": 0.15, "valuation": 0.10},
}


def _pearson(xs: list[float], ys: list[float]) -> Optional[float]:
    n = len(xs)
    if n < 5:
        return None
    mx, my = sum(xs) / n, sum(ys) / n
    cov = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    vx = sum((x - mx) ** 2 for x in xs)
    vy = sum((y - my) ** 2 for y in ys)
    if vx <= 0 or vy <= 0:
        return None
    return round(cov / (vx ** 0.5 * vy ** 0.5), 4)


def _replay_pairs(closes: list[float], horizon: int, step: int = 5) -> list[tuple[float, float]]:
    """과거 anchor마다 (모멘텀점수, 이후 horizon일 수익률) 쌍 생성."""
    pairs: list[tuple[float, float]] = []
    n = len(closes)
    i = 20  # 모멘텀 계산 최소 구간
    while i + horizon < n:
        mom = indicator_engine.compute_momentum_score(closes[: i + 1])
        fwd = (closes[i + horizon] - closes[i]) / closes[i] * 100
        pairs.append((mom, fwd))
        i += step
    return pairs


def _load_weights() -> dict:
    """보정된 가중치 로드. 없으면 DEFAULT_WEIGHTS."""
    if _WEIGHTS_FILE.exists():
        try:
            data = json.loads(_WEIGHTS_FILE.read_text(encoding="utf-8"))
            if all(k in data for k in ("breakout", "turnaround", "neutral")):
                return data
        except Exception:
            pass
    return DEFAULT_WEIGHTS


def _apply_momentum_factor(weights: dict, factor: float) -> dict:
    """모멘텀 가중치에 factor 적용 후 각 국면별 합=1 재정규화."""
    out = {}
    for phase, w in weights.items():
        adj = dict(w)
        adj["momentum"] = max(0.01, adj["momentum"] * factor)
        total = sum(adj.values())
        out[phase] = {k: round(v / total, 4) for k, v in adj.items()}
    return out


async def run_calibration(
    db: AsyncSession,
    user_id: str,
    horizon: int = 20,
    max_codes: int = 20,
) -> dict:
    """역사적 백테스트로 모멘텀 예측력(상관계수) 측정 → 제안 가중치 산출.

    반환: {sample_codes, pairs, r_momentum, momentum_factor,
           current_weights, proposed_weights, data_source, note}
    """
    creds = await get_user_key(db, user_id, "kis")
    current = _load_weights()
    if not creds:
        return {
            "sample_codes": 0, "pairs": 0, "r_momentum": None, "momentum_factor": 1.0,
            "current_weights": current, "proposed_weights": current,
            "data_source": "mock", "note": "KIS 키 없음 — 보정 불가",
        }

    client = KISClient(*creds)
    # 테마 매핑 전체에서 고유 종목 표본
    codes: list[str] = []
    for members in THEME_STOCKS.values():
        for code, _ in members:
            if code not in codes:
                codes.append(code)
    codes = codes[:max_codes]

    all_mom: list[float] = []
    all_fwd: list[float] = []
    used = 0
    for code in codes:
        try:
            ohlcv = await client.get_daily_ohlcv(code, min_rows=250)
            closes = [d["close"] for d in ohlcv if d.get("close")]
            if len(closes) < 20 + horizon + 5:
                continue
            pairs = _replay_pairs(closes, horizon)
            for m, f in pairs:
                all_mom.append(m)
                all_fwd.append(f)
            used += 1
        except Exception as e:
            logger.info("보정 표본 수집 실패(무시) %s: %s", code, e)

    r = _pearson(all_mom, all_fwd)
    # 상관계수 → 모멘텀 가중치 배수: r=+0.3 → 1.45, r=0 → 1.0, r=-0.3 → 0.55 (clamp 0.5~1.5)
    factor = 1.0 if r is None else max(0.5, min(1.5, 1.0 + r * 1.5))
    proposed = _apply_momentum_factor(DEFAULT_WEIGHTS, factor)

    return {
        "sample_codes": used,
        "pairs": len(all_fwd),
        "horizon": horizon,
        "r_momentum": r,
        "momentum_factor": round(factor, 3),
        "current_weights": current,
        "proposed_weights": proposed,
        "data_source": "live" if used else "mock",
        "note": (
            "모멘텀(가격축) 예측력으로 보정. 수급·실적·관심도는 전향적 스냅샷 누적 후 보정 예정."
            if used else "표본 부족"
        ),
    }


def apply_weights(weights: dict) -> None:
    """보정 가중치를 영속화(theme_scoring이 로드)."""
    _WEIGHTS_FILE.write_text(json.dumps(weights, ensure_ascii=False, indent=2), encoding="utf-8")
