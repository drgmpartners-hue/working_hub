'use client';

import { useState, useEffect, useCallback } from 'react';
import { authLib } from '@/lib/auth';
import { API_URL } from '@/lib/api-url';

const PHASE_META: Record<string, { label: string; color: string; bg: string }> = {
  surge: { label: '🔥 급등', color: '#DC2626', bg: 'rgba(220,38,38,0.14)' },
  emerging: { label: '✨ 신규 관심', color: '#7C3AED', bg: 'rgba(124,58,237,0.14)' },
  hot: { label: '📈 고관심', color: '#059669', bg: 'rgba(5,150,105,0.14)' },
  fading: { label: '📉 시들', color: '#D97706', bg: 'rgba(217,119,6,0.14)' },
  quiet: { label: '⚪ 무관심', color: 'var(--text-muted)', bg: 'rgba(107,114,128,0.12)' },
};
const PERIODS = [
  { key: '1w', label: '1주' }, { key: '1m', label: '1개월' }, { key: '3m', label: '3개월' },
  { key: '6m', label: '6개월' }, { key: '1y', label: '1년' },
];
const AXES: Array<[string, string]> = [
  ['momentum', '모멘텀'], ['supply', '수급'], ['fundamentals', '실적'], ['attention', '관심도'], ['valuation', '밸류'],
];

interface ReportData {
  theme_name: string; attention_phase: string | null; interest_score: number | null;
  change_rate: number | null; basis_date: string | null; period: string;
  metrics: {
    period_returns?: Record<string, number | null>;
    index_chart?: Array<{ date: string; value: number }>;
    investors?: { d5: Inv; d20: Inv; sample: number };
    contributions?: Array<{ code: string; name: string; return_pct: number | null }>;
    axes?: Record<string, number> | null;
    axes_delta?: Record<string, number> | null;
    news_count?: number;
    news?: Array<{ title: string; link: string; pub_date?: string }>;
    sample_size?: number;
  };
  sections: Record<string, string>;
  data_source: string;
}
interface Inv { foreign: number; institution: number; individual: number }

const num = (v: number | null | undefined, suffix = '%') =>
  v == null ? '—' : `${v >= 0 ? '+' : ''}${v}${suffix}`;
const sgnColor = (v: number | null | undefined) => (v == null ? 'var(--text-muted)' : v >= 0 ? '#DC2626' : '#2563EB');

function LineChart({ points }: { points: Array<{ date: string; value: number }> }) {
  if (!points || points.length < 2) {
    return <div style={{ padding: '28px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>차트 표본 부족 (시세 일시 지연)</div>;
  }
  const W = 560, H = 170, P = 26;
  const vals = points.map((p) => p.value);
  const min = Math.min(...vals, 0), max = Math.max(...vals, 0), range = max - min || 1;
  const x = (i: number) => P + (i / (points.length - 1)) * (W - 2 * P);
  const y = (v: number) => P + (1 - (v - min) / range) * (H - 2 * P);
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const last = points[points.length - 1].value;
  const up = last >= 0;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 170 }}>
      <line x1={P} y1={y(0)} x2={W - P} y2={y(0)} stroke="var(--border)" strokeWidth="1" strokeDasharray="3 3" />
      <path d={path} fill="none" stroke={up ? '#DC2626' : '#2563EB'} strokeWidth="2" />
      <circle cx={x(points.length - 1)} cy={y(last)} r="3" fill={up ? '#DC2626' : '#2563EB'} />
      <text x={W - P} y={y(last) - 6} textAnchor="end" fontSize="11" fontWeight="700" fill={up ? '#DC2626' : '#2563EB'}>{num(last)}</text>
      <text x={P} y={H - 6} fontSize="9" fill="var(--text-muted)">{points[0].date}</text>
      <text x={W - P} y={H - 6} textAnchor="end" fontSize="9" fill="var(--text-muted)">{points[points.length - 1].date}</text>
    </svg>
  );
}

function InvestorBars({ inv, title }: { inv: Inv; title: string }) {
  const rows: Array<[string, number]> = [['외국인', inv.foreign], ['기관', inv.institution], ['개인', inv.individual]];
  const maxAbs = Math.max(1, ...rows.map(([, v]) => Math.abs(v)));
  return (
    <div>
      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 4 }}>{title}</div>
      {rows.map(([label, v]) => (
        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
          <span style={{ width: 40, fontSize: '0.74rem', color: 'var(--text-muted)' }}>{label}</span>
          <div style={{ flex: 1, height: 14, position: 'relative', display: 'flex', justifyContent: 'center' }}>
            <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, backgroundColor: 'var(--border)' }} />
            <div style={{ position: 'absolute', top: 1, height: 12, borderRadius: 2,
              width: `${(Math.abs(v) / maxAbs) * 48}%`,
              [v >= 0 ? 'left' : 'right']: '50%' as const,
              backgroundColor: v >= 0 ? '#DC2626' : '#2563EB' }} />
          </div>
          <span style={{ width: 64, textAlign: 'right', fontSize: '0.74rem', fontWeight: 700, color: sgnColor(v) }}>{num(v, '억')}</span>
        </div>
      ))}
    </div>
  );
}

function Section({ title, children, narrative }: { title: string; children?: React.ReactNode; narrative?: string }) {
  return (
    <section style={{ marginBottom: 18 }}>
      <div style={{ fontSize: '0.82rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: 8, paddingBottom: 4, borderBottom: '1px solid var(--border)' }}>{title}</div>
      {children}
      {narrative && <p style={{ margin: '8px 0 0', fontSize: '0.83rem', color: 'var(--text-primary)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{narrative}</p>}
    </section>
  );
}

const LOAD_STEPS = ['다기간 시세 수집', '투자자 수급 분석', '뉴스·촉매 수집', 'AI 종합 작성'];
function Loader() {
  const [step, setStep] = useState(0);
  useEffect(() => { const t = setInterval(() => setStep((s) => Math.min(s + 1, LOAD_STEPS.length - 1)), 2500); return () => clearInterval(t); }, []);
  return (
    <div style={{ padding: '40px 0', textAlign: 'center' }}>
      <div style={{ width: 32, height: 32, margin: '0 auto 16px', border: '3px solid var(--border)', borderTopColor: '#2E8B8B', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      {LOAD_STEPS.map((s, i) => (
        <div key={i} style={{ fontSize: '0.82rem', color: i <= step ? '#2E8B8B' : 'var(--text-muted)', fontWeight: i === step ? 700 : 400, margin: '3px 0' }}>
          {i < step ? '✓ ' : i === step ? '⏳ ' : '· '}{s}
        </div>
      ))}
      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 10 }}>AI가 보고서를 작성 중입니다 (~15초)</div>
    </div>
  );
}

interface Props {
  themeId: number | string; themeName: string; onClose: () => void;
  onAddToBasket?: () => void; inBasket?: boolean;
}

export function ThemeReportModal({ themeId, themeName, onClose, onAddToBasket, inBasket }: Props) {
  const [period, setPeriod] = useState('3m');
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (p: string, refresh = false) => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`${API_URL}/api/v1/stocks/themes/${themeId}/report?period=${p}${refresh ? '&refresh=true' : ''}`, { headers: { ...authLib.getAuthHeader() } });
      if (!res.ok) throw new Error('보고서를 불러오지 못했습니다.');
      setData(await res.json());
    } catch (e) { setError(e instanceof Error ? e.message : '오류'); } finally { setLoading(false); }
  }, [themeId]);

  useEffect(() => { load(period); }, [period, load]);

  const phase = data?.attention_phase || 'quiet';
  const pm = PHASE_META[phase];
  const m = data?.metrics;
  const s = data?.sections || {};

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(660px, 100%)', maxHeight: '90vh', overflowY: 'auto', backgroundColor: 'var(--bg-card)', borderRadius: 14, border: '1px solid var(--border)', padding: 22 }}>
        {/* 헤더 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 2 }}>
          <span style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-primary)' }}>{themeName}</span>
          {pm && <span style={{ padding: '2px 9px', borderRadius: 999, fontSize: '0.72rem', fontWeight: 700, color: pm.color, backgroundColor: pm.bg }}>{pm.label}</span>}
          {data?.interest_score != null && <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>관심점수 <b style={{ color: 'var(--text-primary)' }}>{data.interest_score}</b></span>}
          <button onClick={() => load(period, true)} title="새로고침(재생성)" style={{ marginLeft: 'auto', background: 'none', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.7rem', padding: '3px 8px' }}>↻ 재생성</button>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 22, lineHeight: 1 }}>×</button>
        </div>
        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 14 }}>{data?.basis_date || ''} 장마감 기준 · 증권 리서치 보고서</div>

        {/* 기간 탭 */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
          {PERIODS.map((p) => (
            <button key={p.key} onClick={() => setPeriod(p.key)} style={{ flex: 1, height: 30, borderRadius: 6, cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600,
              border: period === p.key ? '1px solid #2E8B8B' : '1px solid var(--border)',
              backgroundColor: period === p.key ? 'rgba(46,139,139,0.12)' : 'var(--bg-surface)',
              color: period === p.key ? '#2E8B8B' : 'var(--text-muted)' }}>{p.label}</button>
          ))}
        </div>

        {error && <div style={{ padding: 12, color: '#DC2626', fontSize: '0.85rem' }}>{error}</div>}
        {loading && <Loader />}

        {data && !loading && m && (
          <>
            {/* ① 핵심 요약 */}
            <div style={{ padding: 14, borderRadius: 10, backgroundColor: pm?.bg || 'var(--bg-surface)', marginBottom: 18 }}>
              <div style={{ fontSize: '0.78rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: 6 }}>① 핵심 요약</div>
              <p style={{ margin: 0, fontSize: '0.86rem', color: 'var(--text-primary)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{s.summary || '요약 생성 실패'}</p>
            </div>

            {/* ② 다기간 흐름 */}
            <Section title="② 다기간 흐름" narrative={s.flow}>
              <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                {PERIODS.map((p) => (
                  <div key={p.key} style={{ flex: 1, textAlign: 'center', padding: '6px 0', borderRadius: 6, backgroundColor: 'var(--bg-surface)', border: p.key === period ? '1px solid #2E8B8B' : '1px solid var(--border)' }}>
                    <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>{p.label}</div>
                    <div style={{ fontSize: '0.82rem', fontWeight: 700, color: sgnColor(m.period_returns?.[p.key]) }}>{num(m.period_returns?.[p.key])}</div>
                  </div>
                ))}
              </div>
              <LineChart points={m.index_chart || []} />
            </Section>

            {/* ③ 국면 진단 */}
            <Section title="③ 국면 진단" narrative={s.phase} />

            {/* ④ 주도주 분석 */}
            <Section title="④ 주도주 분석" narrative={s.leaders}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {(m.contributions || []).map((c) => (
                  <span key={c.code} style={{ padding: '3px 9px', borderRadius: 6, fontSize: '0.76rem', backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
                    {c.name} <b style={{ color: sgnColor(c.return_pct) }}>{num(c.return_pct)}</b>
                  </span>
                ))}
              </div>
            </Section>

            {/* ⑤ 수급 동향 */}
            <Section title="⑤ 수급 동향 — 투자자별 순매수" narrative={s.supply}>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 220 }}><InvestorBars inv={m.investors?.d5 || { foreign: 0, institution: 0, individual: 0 }} title="최근 5일 (억원)" /></div>
                <div style={{ flex: 1, minWidth: 220 }}><InvestorBars inv={m.investors?.d20 || { foreign: 0, institution: 0, individual: 0 }} title="최근 20일 (억원)" /></div>
              </div>
              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 4 }}>표본 {m.investors?.sample ?? 0}종목 · 빨강=순매수 / 파랑=순매도</div>
            </Section>

            {/* ⑥ 5축 정밀 해석 */}
            <Section title="⑥ 5축 정밀 해석" narrative={s.axes_interp}>
              {m.axes ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {AXES.map(([k, label]) => {
                    const v = m.axes?.[k] ?? 0; const d = m.axes_delta?.[k];
                    return (
                      <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ width: 48, fontSize: '0.74rem', color: 'var(--text-muted)' }}>{label}</span>
                        <div style={{ flex: 1, height: 8, borderRadius: 4, backgroundColor: 'var(--border)', overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${Math.max(0, Math.min(100, v))}%`, backgroundColor: '#2E8B8B' }} />
                        </div>
                        <span style={{ width: 30, textAlign: 'right', fontSize: '0.76rem', fontWeight: 700, color: 'var(--text-primary)' }}>{Math.round(v)}</span>
                        {d != null && d !== 0 && <span style={{ width: 38, textAlign: 'right', fontSize: '0.68rem', color: sgnColor(d) }}>{d >= 0 ? '▲' : '▼'}{Math.abs(d)}</span>}
                      </div>
                    );
                  })}
                </div>
              ) : <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>5축 데이터 없음 (배치 점수 계산 후 표시)</div>}
            </Section>

            {/* ⑦ 촉매 & 뉴스 */}
            <Section title={`⑦ 촉매 & 뉴스 (관련 기사 ${(m.news_count ?? 0).toLocaleString()}건)`} narrative={s.catalyst}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {(m.news || []).map((n, i) => (
                  <a key={i} href={n.link} target="_blank" rel="noreferrer" style={{ fontSize: '0.78rem', color: '#2E8B8B', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} dangerouslySetInnerHTML={{ __html: '· ' + n.title }} />
                ))}
                {(!m.news || m.news.length === 0) && <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>뉴스 없음</span>}
              </div>
            </Section>

            {/* ⑧ 리스크 */}
            <Section title="⑧ 리스크 점검" narrative={s.risk} />

            {/* ⑨ 종합 판단 */}
            <div style={{ padding: 14, borderRadius: 10, border: `1px solid ${pm?.color || 'var(--border)'}`, marginBottom: 16 }}>
              <div style={{ fontSize: '0.82rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: 6 }}>⑨ 종합 판단</div>
              <p style={{ margin: 0, fontSize: '0.86rem', color: 'var(--text-primary)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{s.verdict || '판단 생성 실패'}</p>
            </div>

            {data.data_source !== 'live' && (
              <div style={{ fontSize: '0.7rem', color: '#D97706', marginBottom: 10 }}>⚠ 일부 데이터 수집 제한 (KIS/AI 설정 확인). 가능한 데이터로 작성됨.</div>
            )}

            {onAddToBasket && (
              <button onClick={onAddToBasket} disabled={inBasket} style={{ width: '100%', height: 44, borderRadius: 8, border: 'none', cursor: inBasket ? 'default' : 'pointer', backgroundColor: inBasket ? 'var(--bg-surface)' : '#2E8B8B', color: inBasket ? 'var(--text-muted)' : '#fff', fontSize: '0.92rem', fontWeight: 700 }}>
                {inBasket ? '✓ 바스켓에 담김' : '+ 바스켓에 담기'}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default ThemeReportModal;
