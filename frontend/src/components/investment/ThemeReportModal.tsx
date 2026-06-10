'use client';

import { useState, useEffect, useCallback } from 'react';
import { authLib } from '@/lib/auth';
import { API_URL } from '@/lib/api-url';

const PHASE_META: Record<string, { label: string; color: string; bg: string }> = {
  surge: { label: '🔥 급등', color: '#DC2626', bg: 'rgba(220,38,38,0.14)' },
  emerging: { label: '✨ 신규 관심', color: '#7C3AED', bg: 'rgba(124,58,237,0.14)' },
  hot: { label: '📈 고관심', color: '#059669', bg: 'rgba(5,150,105,0.14)' },
  fading: { label: '📉 시들', color: '#D97706', bg: 'rgba(217,119,6,0.14)' },
  quiet: { label: '⚪ 무관심', color: '#6B7280', bg: 'rgba(107,114,128,0.12)' },
};

const PERIODS: Array<{ key: string; label: string }> = [
  { key: '1w', label: '1주' },
  { key: '1m', label: '1개월' },
  { key: '3m', label: '3개월' },
  { key: '6m', label: '6개월' },
  { key: '1y', label: '1년' },
];

interface ReportData {
  theme_name: string;
  attention_phase: string | null;
  interest_score: number | null;
  change_rate: number | null;
  basis_date: string | null;
  period: string;
  index_chart: Array<{ date: string; value: number }>;
  period_return: number | null;
  score_reason: string;
  badge_reason: string;
  members: Array<{ code: string; name: string; return_pct: number | null }>;
  news: Array<{ title: string; link: string; pub_date?: string }>;
  news_count: number;
  conclusion: string;
  data_source: string;
}

function LineChart({ points }: { points: Array<{ date: string; value: number }> }) {
  if (points.length < 2) {
    return <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>차트 데이터 부족</div>;
  }
  const W = 560, H = 160, P = 24;
  const vals = points.map((p) => p.value);
  const min = Math.min(...vals, 0), max = Math.max(...vals, 0);
  const range = max - min || 1;
  const x = (i: number) => P + (i / (points.length - 1)) * (W - 2 * P);
  const y = (v: number) => P + (1 - (v - min) / range) * (H - 2 * P);
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const last = points[points.length - 1].value;
  const up = last >= 0;
  const zeroY = y(0);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 160 }}>
      <line x1={P} y1={zeroY} x2={W - P} y2={zeroY} stroke="var(--border)" strokeWidth="1" strokeDasharray="3 3" />
      <path d={path} fill="none" stroke={up ? '#DC2626' : '#2563EB'} strokeWidth="2" />
      <circle cx={x(points.length - 1)} cy={y(last)} r="3" fill={up ? '#DC2626' : '#2563EB'} />
      <text x={W - P} y={y(last) - 6} textAnchor="end" fontSize="11" fontWeight="700" fill={up ? '#DC2626' : '#2563EB'}>
        {last >= 0 ? '+' : ''}{last.toFixed(1)}%
      </text>
      <text x={P} y={H - 6} fontSize="9" fill="var(--text-muted)">{points[0].date}</text>
      <text x={W - P} y={H - 6} textAnchor="end" fontSize="9" fill="var(--text-muted)">{points[points.length - 1].date}</text>
    </svg>
  );
}

interface Props {
  themeId: number | string;
  themeName: string;
  onClose: () => void;
  onAddToBasket?: () => void;
  inBasket?: boolean;
}

export function ThemeReportModal({ themeId, themeName, onClose, onAddToBasket, inBasket }: Props) {
  const [period, setPeriod] = useState('3m');
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (p: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/v1/stocks/themes/${themeId}/report?period=${p}`, {
        headers: { ...authLib.getAuthHeader() },
      });
      if (!res.ok) throw new Error('보고서를 불러오지 못했습니다.');
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : '오류');
    } finally {
      setLoading(false);
    }
  }, [themeId]);

  useEffect(() => { load(period); }, [period, load]);

  const phase = data?.attention_phase || 'quiet';
  const pm = PHASE_META[phase];

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(640px, 100%)', maxHeight: '88vh', overflowY: 'auto', backgroundColor: 'var(--bg-card)', borderRadius: 14, border: '1px solid var(--border)', padding: 20 }}
      >
        {/* 헤더 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <span style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--text-primary)' }}>{themeName}</span>
          {pm && <span style={{ padding: '2px 9px', borderRadius: 999, fontSize: '0.72rem', fontWeight: 700, color: pm.color, backgroundColor: pm.bg }}>{pm.label}</span>}
          {data?.interest_score != null && <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>관심점수 <b style={{ color: 'var(--text-primary)' }}>{data.interest_score}</b></span>}
          <button onClick={onClose} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 22, lineHeight: 1 }}>×</button>
        </div>
        {data?.basis_date && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 14 }}>{data.basis_date} 장마감 기준 · 보고서</div>}

        {error && <div style={{ padding: 12, color: '#DC2626', fontSize: '0.85rem' }}>{error}</div>}

        {/* 기간 탭 */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          {PERIODS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              style={{
                flex: 1, height: 30, borderRadius: 6, cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600,
                border: period === p.key ? '1px solid #2E8B8B' : '1px solid var(--border)',
                backgroundColor: period === p.key ? 'rgba(46,139,139,0.12)' : 'var(--bg-surface)',
                color: period === p.key ? '#2E8B8B' : 'var(--text-muted)',
              }}
            >{p.label}</button>
          ))}
        </div>

        {/* ① 흐름 차트 */}
        <section style={{ marginBottom: 16, padding: 12, borderRadius: 10, backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
            ① 흐름 — 테마 지수 {data?.period_return != null && (
              <span style={{ color: data.period_return >= 0 ? '#DC2626' : '#2563EB' }}>
                ({data.period_return >= 0 ? '+' : ''}{data.period_return}%)
              </span>
            )}
          </div>
          {loading ? <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-muted)' }}>불러오는 중…</div> : data && <LineChart points={data.index_chart} />}
        </section>

        {data && !loading && (
          <>
            {/* ② 점수 근거 ③ 뱃지 근거 */}
            <section style={{ marginBottom: 14 }}>
              <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>② 왜 이 점수인가</div>
              <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>{data.score_reason}</p>
            </section>
            <section style={{ marginBottom: 14 }}>
              <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>③ 왜 이 뱃지({pm?.label})인가</div>
              <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>{data.badge_reason}</p>
            </section>

            {/* ④ 속한 종목 */}
            <section style={{ marginBottom: 14 }}>
              <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>④ 속한 종목</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {data.members.map((m) => (
                  <span key={m.code} style={{ padding: '3px 9px', borderRadius: 6, fontSize: '0.75rem', backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
                    {m.name}
                    {m.return_pct != null && (
                      <b style={{ marginLeft: 5, color: m.return_pct >= 0 ? '#DC2626' : '#2563EB' }}>
                        {m.return_pct >= 0 ? '+' : ''}{m.return_pct}%
                      </b>
                    )}
                  </span>
                ))}
              </div>
            </section>

            {/* ⑤ 뉴스 흐름 */}
            <section style={{ marginBottom: 14 }}>
              <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
                ⑤ 뉴스 흐름 <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>관련 기사 {data.news_count.toLocaleString()}건</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {data.news.map((n, i) => (
                  <a key={i} href={n.link} target="_blank" rel="noreferrer"
                    style={{ fontSize: '0.78rem', color: '#2E8B8B', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    dangerouslySetInnerHTML={{ __html: '· ' + n.title }} />
                ))}
                {data.news.length === 0 && <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>뉴스 없음</span>}
              </div>
            </section>

            {/* ⑥ 결론 */}
            <section style={{ marginBottom: 16, padding: 12, borderRadius: 10, backgroundColor: pm?.bg || 'var(--bg-surface)' }}>
              <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>⑥ 결론 — 담을까?</div>
              <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-primary)', lineHeight: 1.6 }}>{data.conclusion}</p>
            </section>

            {onAddToBasket && (
              <button
                onClick={onAddToBasket}
                disabled={inBasket}
                style={{
                  width: '100%', height: 42, borderRadius: 8, border: 'none', cursor: inBasket ? 'default' : 'pointer',
                  backgroundColor: inBasket ? 'var(--bg-surface)' : '#2E8B8B', color: inBasket ? 'var(--text-muted)' : '#fff',
                  fontSize: '0.9rem', fontWeight: 700,
                }}
              >{inBasket ? '✓ 바스켓에 담김' : '+ 바스켓에 담기'}</button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default ThemeReportModal;
