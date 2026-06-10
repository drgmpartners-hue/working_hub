'use client';

import { useState, useEffect } from 'react';
import type { CSSProperties } from 'react';
import { Button } from '@/components/common/Button';
import { Card } from '@/components/common/Card';
import { authLib } from '@/lib/auth';
import { API_URL } from '@/lib/api-url';
import { ThemeReportModal } from './ThemeReportModal';

export interface StockTheme {
  id: number;
  theme_name: string;
  ai_score: number;
  stock_count: number;
  news_summary: string;
  category?: string;
  phase?: 'breakout' | 'turnaround' | 'neutral' | null;
  interest_score?: number | null;
  attention_phase?: 'surge' | 'emerging' | 'hot' | 'fading' | 'quiet' | null;
  change_rate?: number | null;
  up_count?: number | null;
  down_count?: number | null;
  basis_date?: string | null;
}

interface ThemeAnalysis {
  attention_phase: string | null;
  interest_score: number | null;
  change_rate: number | null;
  up_count: number | null;
  down_count: number | null;
  basis_date: string | null;
  reason: string | null;
  flow: Array<{ date: string; change_rate: number | null }>;
  members: Array<{ code: string; name: string }>;
  score_detail: { axes?: Record<string, number> } | null;
}

// 관심도 국면 (네이버 테마 시세 흐름 기반)
const PHASE_META: Record<string, { label: string; color: string; bg: string }> = {
  surge: { label: '🔥 급등', color: '#DC2626', bg: 'rgba(220,38,38,0.14)' },
  emerging: { label: '✨ 신규 관심', color: '#7C3AED', bg: 'rgba(124,58,237,0.14)' },
  hot: { label: '📈 고관심', color: '#059669', bg: 'rgba(5,150,105,0.14)' },
  fading: { label: '📉 시들', color: '#D97706', bg: 'rgba(217,119,6,0.14)' },
  quiet: { label: '⚪ 무관심', color: '#6B7280', bg: 'rgba(107,114,128,0.12)' },
};

const FILTERS: Array<{ key: string; label: string }> = [
  { key: 'active', label: '추천 🔥✨📈' },
  { key: 'fav', label: '♡ 즐겨찾기' },
  { key: 'surge', label: '🔥 급등' },
  { key: 'emerging', label: '✨ 신규' },
  { key: 'hot', label: '📈 고관심' },
  { key: 'fading', label: '📉 시들' },
  { key: 'all', label: '전체' },
];

const AXIS_LABELS: Array<[string, string]> = [
  ['momentum', '모멘텀'], ['supply', '수급'], ['fundamentals', '실적'], ['attention', '관심도'], ['valuation', '밸류'],
];

function FlowBars({ flow }: { flow: Array<{ date: string; change_rate: number | null }> }) {
  const pts = flow.slice(-14);
  if (pts.length === 0) return null;
  const maxAbs = Math.max(1, ...pts.map((p) => Math.abs(p.change_rate ?? 0)));
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2, height: 32 }} title="최근 등락 흐름">
      {pts.map((p, i) => {
        const v = p.change_rate ?? 0;
        const h = Math.max(2, (Math.abs(v) / maxAbs) * 14);
        return (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', height: 32, flex: 1 }}>
            <div style={{ height: 14, display: 'flex', alignItems: 'flex-end' }}>
              <div style={{ width: '100%', height: v >= 0 ? h : 0, backgroundColor: '#DC2626', borderRadius: 1 }} />
            </div>
            <div style={{ height: 14, display: 'flex', alignItems: 'flex-start' }}>
              <div style={{ width: '100%', height: v < 0 ? h : 0, backgroundColor: '#2563EB', borderRadius: 1 }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AnalysisPanel({ a }: { a: ThemeAnalysis }) {
  const pm = a.attention_phase ? PHASE_META[a.attention_phase] : null;
  const axes = a.score_detail?.axes;
  return (
    <div style={{ marginTop: 8, padding: '10px 12px', borderRadius: 8, backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
        {pm && <span style={{ padding: '1px 8px', borderRadius: 999, fontSize: '0.7rem', fontWeight: 700, color: pm.color, backgroundColor: pm.bg }}>{pm.label}</span>}
        {a.interest_score != null && <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>관심점수 <b style={{ color: 'var(--text-primary)' }}>{a.interest_score}</b></span>}
        {a.basis_date && <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>{a.basis_date} 장마감 기준</span>}
      </div>
      {a.reason && <p style={{ margin: '0 0 8px', fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>{a.reason}</p>}
      {a.flow.length > 1 && <div style={{ marginBottom: 8 }}><FlowBars flow={a.flow} /></div>}
      {axes && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 8 }}>
          {AXIS_LABELS.map(([key, label]) => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 38, fontSize: '0.68rem', color: 'var(--text-muted)' }}>{label}</span>
              <div style={{ flex: 1, height: 5, borderRadius: 3, backgroundColor: 'var(--border)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.max(0, Math.min(100, axes[key] ?? 0))}%`, backgroundColor: '#2E8B8B', borderRadius: 3 }} />
              </div>
              <span style={{ width: 26, textAlign: 'right', fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-primary)' }}>{Math.round(axes[key] ?? 0)}</span>
            </div>
          ))}
        </div>
      )}
      {a.members.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {a.members.slice(0, 10).map((m) => (
            <span key={m.code} style={{ padding: '2px 7px', borderRadius: 5, fontSize: '0.68rem', backgroundColor: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>{m.name}</span>
          ))}
        </div>
      )}
    </div>
  );
}

interface ThemeListProps {
  basket: StockTheme[];
  onAddToBasket: (theme: StockTheme) => void;
  onRemoveFromBasket: (themeId: number) => void;
}

export function ThemeList({ basket, onAddToBasket, onRemoveFromBasket }: ThemeListProps) {
  const [themes, setThemes] = useState<StockTheme[]>([]);
  const [loading, setLoading] = useState(false);
  const [analyzingId, setAnalyzingId] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'interest_desc' | 'change_desc' | 'name_asc'>('interest_desc');
  const [phaseFilter, setPhaseFilter] = useState('active');
  const [analyses, setAnalyses] = useState<Record<string | number, ThemeAnalysis>>({});
  const [reportTheme, setReportTheme] = useState<StockTheme | null>(null);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchThemes();
    fetchFavorites();
  }, []);

  async function fetchFavorites() {
    try {
      const res = await fetch(`${API_URL}/api/v1/stocks/themes/favorites`, { headers: { ...authLib.getAuthHeader() } });
      if (res.ok) setFavorites(new Set(await res.json()));
    } catch { /* silent */ }
  }

  async function toggleFavorite(theme: StockTheme) {
    // 낙관적 업데이트
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(theme.theme_name)) next.delete(theme.theme_name);
      else next.add(theme.theme_name);
      return next;
    });
    try {
      await fetch(`${API_URL}/api/v1/stocks/themes/${theme.id}/favorite`, { method: 'POST', headers: { ...authLib.getAuthHeader() } });
    } catch {
      fetchFavorites(); // 실패 시 동기화
    }
  }

  async function fetchThemes() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/v1/stocks/themes`, { headers: { ...authLib.getAuthHeader() } });
      if (!res.ok) throw new Error('테마 목록을 불러오는 데 실패했습니다.');
      const data = await res.json();
      setThemes(Array.isArray(data) ? data : data.themes ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : '알 수 없는 오류');
    } finally {
      setLoading(false);
    }
  }

  async function analyzeTheme(theme: StockTheme) {
    setAnalyzingId(theme.id);
    setError(null);
    try {
      // 분석 = 이미 읽어온 데이터(DB)만. 추가 조회/KIS 없음.
      const res = await fetch(`${API_URL}/api/v1/stocks/themes/${theme.id}/analysis`, { headers: { ...authLib.getAuthHeader() } });
      if (!res.ok) throw new Error('테마 분석 실패');
      const a: ThemeAnalysis = await res.json();
      setAnalyses((prev) => ({ ...prev, [theme.id]: a }));
    } catch (err) {
      setError(err instanceof Error ? err.message : '분석 중 오류가 발생했습니다.');
    } finally {
      setAnalyzingId(null);
    }
  }

  async function collectMapping() {
    setCollecting(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/v1/stocks/themes/collect`, { method: 'POST', headers: { ...authLib.getAuthHeader() } });
      if (!res.ok) throw new Error('역설계 수집에 실패했습니다.');
      await fetchThemes();
    } catch (err) {
      setError(err instanceof Error ? err.message : '역설계 수집 중 오류가 발생했습니다.');
    } finally {
      setCollecting(false);
    }
  }

  async function refreshThemes() {
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/v1/stocks/themes/refresh`, { method: 'POST', headers: { ...authLib.getAuthHeader() } });
      if (!res.ok) throw new Error('테마 반영에 실패했습니다.');
      const data = await res.json();
      setThemes(Array.isArray(data) ? data : data.themes ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : '테마 반영 중 오류가 발생했습니다.');
    } finally {
      setRefreshing(false);
    }
  }

  const isInBasket = (id: number) => basket.some((t) => t.id === id);

  const scoreColor = (s: number | null | undefined) => {
    const v = s ?? 0;
    if (v >= 70) return '#059669';
    if (v >= 50) return '#D97706';
    return '#6B7280';
  };
  const scoreBg = (s: number | null | undefined) => {
    const v = s ?? 0;
    if (v >= 70) return 'rgba(5,150,105,0.12)';
    if (v >= 50) return 'rgba(217,119,6,0.12)';
    return 'rgba(107,114,128,0.10)';
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '48px 0' }}>
        <div style={{ width: 28, height: 28, border: '2px solid #E1E5EB', borderTopColor: '#2E8B8B', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '14px 16px', backgroundColor: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, color: '#B91C1C', fontSize: '0.875rem' }}>
        {error}
        <button onClick={fetchThemes} style={{ marginLeft: 12, color: '#1E3A5F', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', fontSize: '0.875rem' }}>다시 시도</button>
      </div>
    );
  }

  if (themes.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 16px', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
        <p style={{ margin: '0 0 16px' }}>등록된 테마가 없습니다.</p>
        <button onClick={refreshThemes} disabled={refreshing} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 20px', borderRadius: 8, border: 'none', cursor: refreshing ? 'default' : 'pointer', backgroundColor: '#2E8B8B', color: '#fff', fontSize: '0.875rem', fontWeight: 600, opacity: refreshing ? 0.7 : 1 }}>
          {refreshing ? '테마 반영 중...' : '테마 반영하기'}
        </button>
      </div>
    );
  }

  // 기준일 (목록 데이터에서)
  const basisDate = themes.find((t) => t.basis_date)?.basis_date || null;

  const displayThemes = themes
    .filter((t) => (search.trim() === '' ? true : t.theme_name.toLowerCase().includes(search.trim().toLowerCase())))
    .filter((t) => {
      const ph = t.attention_phase;
      if (phaseFilter === 'all') return true;
      if (phaseFilter === 'fav') return favorites.has(t.theme_name);
      if (phaseFilter === 'active') return ph === 'surge' || ph === 'emerging' || ph === 'hot';
      return ph === phaseFilter;
    })
    .sort((a, b) => {
      switch (sortBy) {
        case 'interest_desc': return (b.interest_score ?? -1) - (a.interest_score ?? -1);
        case 'change_desc': return (b.change_rate ?? -999) - (a.change_rate ?? -999);
        case 'name_asc': return a.theme_name.localeCompare(b.theme_name, 'ko');
        default: return 0;
      }
    });

  const controlStyle: CSSProperties = { height: 34, padding: '0 10px', borderRadius: 6, border: '1px solid var(--border)', backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: '0.8125rem', outline: 'none' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* 기준일 배너 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '8px 12px', borderRadius: 8, backgroundColor: 'rgba(46,139,139,0.08)', border: '1px solid rgba(46,139,139,0.22)', fontSize: '0.75rem' }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: '#2E8B8B', flexShrink: 0 }} />
        <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
          {basisDate ? `${basisDate} 장마감 기준` : '흐름 데이터 수집 전 — 배치 후 표시'}
        </span>
        <span style={{ color: 'var(--text-muted)' }}>· 네이버 테마 시세 흐름 · 매일 1회 갱신 (실시간 아님)</span>
      </div>

      {/* 국면 필터 */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {FILTERS.map((f) => (
          <button key={f.key} onClick={() => setPhaseFilter(f.key)} style={{
            height: 30, padding: '0 11px', borderRadius: 999, cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600,
            border: phaseFilter === f.key ? '1px solid #2E8B8B' : '1px solid var(--border)',
            backgroundColor: phaseFilter === f.key ? 'rgba(46,139,139,0.14)' : 'var(--bg-card)',
            color: phaseFilter === f.key ? '#2E8B8B' : 'var(--text-muted)',
          }}>{f.label}</button>
        ))}
      </div>

      {/* 검색 + 정렬 + 수집 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 160 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
          </svg>
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="테마명 검색" style={{ ...controlStyle, width: '100%', paddingLeft: 30 }} />
        </div>
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)} style={{ ...controlStyle, cursor: 'pointer' }}>
          <option value="interest_desc">관심점수순</option>
          <option value="change_desc">등락률순</option>
          <option value="name_asc">가나다순</option>
        </select>
        <button onClick={refreshThemes} disabled={refreshing} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 34, padding: '0 12px', borderRadius: 6, border: '1px solid var(--border)', cursor: refreshing ? 'default' : 'pointer', backgroundColor: 'var(--bg-card)', color: 'var(--text-muted)', fontSize: '0.75rem', fontWeight: 600, opacity: refreshing ? 0.7 : 1 }}>
          {refreshing ? '반영 중...' : '테마 반영'}
        </button>
        <button onClick={collectMapping} disabled={collecting} title="네이버 금융 테마에서 테마·소속종목을 자동 수집(역설계)." style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 34, padding: '0 12px', borderRadius: 6, border: '1px solid #2E8B8B', cursor: collecting ? 'default' : 'pointer', backgroundColor: collecting ? 'var(--bg-card)' : 'rgba(46,139,139,0.10)', color: '#2E8B8B', fontSize: '0.75rem', fontWeight: 700, opacity: collecting ? 0.7 : 1 }}>
          {collecting ? '수집 중...' : '역설계 수집'}
        </button>
      </div>

      {displayThemes.length === 0 && (
        <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
          해당 국면/검색 결과가 없습니다.
        </div>
      )}

      {displayThemes.map((theme) => {
        const inBasket = isInBasket(theme.id);
        const isAnalyzing = analyzingId === theme.id;
        const pm = theme.attention_phase ? PHASE_META[theme.attention_phase] : null;
        const chg = theme.change_rate;

        return (
          <Card key={theme.id} padding={16} hoverable style={{ border: inBasket ? '1px solid #2E8B8B' : '1px solid var(--border)', transition: 'border-color 0.15s ease' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
              {/* 관심점수 뱃지 */}
              <div style={{ minWidth: 50, height: 50, borderRadius: 10, backgroundColor: scoreBg(theme.interest_score), display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <span style={{ fontSize: '1.0625rem', fontWeight: 800, color: scoreColor(theme.interest_score), lineHeight: 1 }}>{theme.interest_score ?? '—'}</span>
                <span style={{ fontSize: '0.55rem', color: scoreColor(theme.interest_score), marginTop: 1 }}>관심점수</span>
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                  <button
                    onClick={() => toggleFavorite(theme)}
                    title={favorites.has(theme.theme_name) ? '즐겨찾기 해제' : '즐겨찾기'}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', lineHeight: 1, padding: 0, color: favorites.has(theme.theme_name) ? '#DC2626' : 'var(--text-muted)' }}
                  >
                    {favorites.has(theme.theme_name) ? '♥' : '♡'}
                  </button>
                  <span style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--text-primary)' }}>{theme.theme_name}</span>
                  {pm && <span style={{ padding: '1px 8px', borderRadius: 999, fontSize: '0.625rem', fontWeight: 700, color: pm.color, backgroundColor: pm.bg }}>{pm.label}</span>}
                  {chg != null && <span style={{ fontSize: '0.8rem', fontWeight: 700, color: chg >= 0 ? '#DC2626' : '#2563EB' }}>{chg >= 0 ? '+' : ''}{chg}%</span>}
                  {(theme.up_count != null || theme.down_count != null) && (
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>▲{theme.up_count ?? 0} ▼{theme.down_count ?? 0}</span>
                  )}
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>종목 {theme.stock_count}개</span>
                </div>

                {analyses[theme.id] && <AnalysisPanel a={analyses[theme.id]} />}

                <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  <Button size="sm" variant="ghost" loading={isAnalyzing} onClick={() => analyzeTheme(theme)} style={{ fontSize: '0.8125rem', color: 'var(--text-primary)', border: '1px solid var(--border)' }}>
                    {isAnalyzing ? '분석 중...' : '분석'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setReportTheme(theme)} style={{ fontSize: '0.8125rem', color: '#1E3A5F', border: '1px solid #1E3A5F' }}>
                    📄 보고서
                  </Button>
                  {inBasket ? (
                    <Button size="sm" variant="secondary" onClick={() => onRemoveFromBasket(theme.id)} style={{ borderColor: '#2E8B8B', color: '#2E8B8B' }}>담김</Button>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => onAddToBasket(theme)} style={{ border: '1px solid #2E8B8B', color: '#2E8B8B' }}>+ 바스켓 담기</Button>
                  )}
                </div>
              </div>
            </div>
          </Card>
        );
      })}

      {reportTheme && (
        <ThemeReportModal
          themeId={reportTheme.id}
          themeName={reportTheme.theme_name}
          onClose={() => setReportTheme(null)}
          inBasket={isInBasket(reportTheme.id)}
          onAddToBasket={() => { onAddToBasket(reportTheme); }}
        />
      )}
    </div>
  );
}

export default ThemeList;
