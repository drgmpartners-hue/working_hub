'use client';

import { useState, useEffect } from 'react';
import type { CSSProperties } from 'react';
import { Button } from '@/components/common/Button';
import { Card } from '@/components/common/Card';
import { authLib } from '@/lib/auth';
import { API_URL } from '@/lib/api-url';

export interface StockTheme {
  id: number;
  theme_name: string;
  ai_score: number;
  stock_count: number;
  news_summary: string;
  category?: string;
  analyzed_at?: string;
}

interface ThemeScore {
  score: number;
  phase: 'breakout' | 'turnaround' | 'neutral';
  axes: { momentum: number; supply: number; fundamentals: number; attention: number; valuation: number };
  data_source: string; // 'live' | 'mock'
}

const PHASE_META: Record<string, { label: string; color: string; bg: string }> = {
  breakout: { label: '🚀 고점돌파', color: '#DC2626', bg: 'rgba(220,38,38,0.12)' },
  turnaround: { label: '⚓ 바닥탈출', color: '#2563EB', bg: 'rgba(37,99,235,0.12)' },
};

const AXIS_LABELS: Array<[keyof ThemeScore['axes'], string]> = [
  ['momentum', '모멘텀'],
  ['supply', '수급'],
  ['fundamentals', '실적'],
  ['attention', '관심도'],
  ['valuation', '밸류'],
];

function ThemeScorePanel({ sc }: { sc: ThemeScore }) {
  return (
    <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 8, backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        {PHASE_META[sc.phase] && (
          <span style={{ padding: '1px 7px', borderRadius: 999, fontSize: '0.6875rem', fontWeight: 700, color: PHASE_META[sc.phase].color, backgroundColor: PHASE_META[sc.phase].bg }}>
            {PHASE_META[sc.phase].label}
          </span>
        )}
        <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>
          {sc.data_source === 'live' ? '실데이터 5축 집계' : '예시(매핑 대기)'}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {AXIS_LABELS.map(([key, label]) => (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 38, fontSize: '0.6875rem', color: 'var(--text-muted)' }}>{label}</span>
            <div style={{ flex: 1, height: 5, borderRadius: 3, backgroundColor: 'var(--border)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${Math.max(0, Math.min(100, sc.axes[key]))}%`, backgroundColor: '#2E8B8B', borderRadius: 3 }} />
            </div>
            <span style={{ width: 28, textAlign: 'right', fontSize: '0.6875rem', fontWeight: 600, color: 'var(--text-primary)' }}>{Math.round(sc.axes[key])}</span>
          </div>
        ))}
      </div>
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
  const [sortBy, setSortBy] = useState<'score_desc' | 'score_asc' | 'name_asc' | 'name_desc'>('score_desc');
  const [scores, setScores] = useState<Record<string | number, ThemeScore>>({});

  useEffect(() => {
    fetchThemes();
  }, []);

  async function fetchThemes() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/v1/stocks/themes`, {
        headers: { ...authLib.getAuthHeader() },
      });
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
      // 5축 집계 점수 (소속 종목 실데이터 기반)
      const res = await fetch(`${API_URL}/api/v1/stocks/themes/${theme.id}/score`, {
        headers: { ...authLib.getAuthHeader() },
      });
      if (!res.ok) throw new Error('테마 분석 실패');
      const sc: ThemeScore = await res.json();
      setScores((prev) => ({ ...prev, [theme.id]: sc }));
      setThemes((prev) => prev.map((t) => (t.id === theme.id ? { ...t, ai_score: sc.score } : t)));
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
      const res = await fetch(`${API_URL}/api/v1/stocks/themes/collect`, {
        method: 'POST',
        headers: { ...authLib.getAuthHeader() },
      });
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
      const res = await fetch(`${API_URL}/api/v1/stocks/themes/refresh`, {
        method: 'POST',
        headers: { ...authLib.getAuthHeader() },
      });
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

  const getScoreColor = (score: number) => {
    if (score >= 80) return '#059669';
    if (score >= 60) return '#D97706';
    return '#DC2626';
  };

  const getScoreBg = (score: number) => {
    if (score >= 80) return '#ECFDF5';
    if (score >= 60) return '#FFFBEB';
    return '#FEF2F2';
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '48px 0' }}>
        <div
          style={{
            width: 28,
            height: 28,
            border: '2px solid #E1E5EB',
            borderTopColor: '#2E8B8B',
            borderRadius: '50%',
            animation: 'spin 0.7s linear infinite',
          }}
        />
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          padding: '14px 16px',
          backgroundColor: '#FEF2F2',
          border: '1px solid #FECACA',
          borderRadius: 8,
          color: '#B91C1C',
          fontSize: '0.875rem',
        }}
      >
        {error}
        <button
          onClick={fetchThemes}
          style={{
            marginLeft: 12,
            color: '#1E3A5F',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            textDecoration: 'underline',
            fontSize: '0.875rem',
          }}
        >
          다시 시도
        </button>
      </div>
    );
  }

  if (themes.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 16px', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
        <p style={{ margin: '0 0 16px' }}>등록된 테마가 없습니다.</p>
        <button
          onClick={refreshThemes}
          disabled={refreshing}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 20px',
            borderRadius: 8,
            border: 'none',
            cursor: refreshing ? 'default' : 'pointer',
            backgroundColor: '#2E8B8B',
            color: '#fff',
            fontSize: '0.875rem',
            fontWeight: 600,
            opacity: refreshing ? 0.7 : 1,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
            style={refreshing ? { animation: 'spin 0.7s linear infinite' } : undefined}>
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
          {refreshing ? '테마 반영 중...' : '테마 반영하기'}
        </button>
        <p style={{ margin: '12px 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          소스에서 추천 테마를 불러옵니다.
        </p>
      </div>
    );
  }

  const displayThemes = themes
    .filter((t) =>
      search.trim() === '' ? true : t.theme_name.toLowerCase().includes(search.trim().toLowerCase())
    )
    .sort((a, b) => {
      switch (sortBy) {
        case 'score_desc':
          return (b.ai_score ?? -1) - (a.ai_score ?? -1);
        case 'score_asc':
          return (a.ai_score ?? -1) - (b.ai_score ?? -1);
        case 'name_asc':
          return a.theme_name.localeCompare(b.theme_name, 'ko');
        case 'name_desc':
          return b.theme_name.localeCompare(a.theme_name, 'ko');
        default:
          return 0;
      }
    });

  const controlStyle: CSSProperties = {
    height: 34,
    padding: '0 10px',
    borderRadius: 6,
    border: '1px solid var(--border)',
    backgroundColor: 'var(--bg-card)',
    color: 'var(--text-primary)',
    fontSize: '0.8125rem',
    outline: 'none',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* 검색 + 정렬 + 테마 반영 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 180 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round"
            style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="테마명 검색"
            style={{ ...controlStyle, width: '100%', paddingLeft: 30 }}
          />
        </div>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
          style={{ ...controlStyle, cursor: 'pointer' }}
        >
          <option value="score_desc">점수 높은순</option>
          <option value="score_asc">점수 낮은순</option>
          <option value="name_asc">테마명 가나다순</option>
          <option value="name_desc">테마명 가나다 역순</option>
        </select>
        <button
          onClick={refreshThemes}
          disabled={refreshing}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            height: 34,
            padding: '0 12px',
            borderRadius: 6,
            border: '1px solid var(--border)',
            cursor: refreshing ? 'default' : 'pointer',
            backgroundColor: 'var(--bg-card)',
            color: 'var(--text-muted)',
            fontSize: '0.75rem',
            fontWeight: 600,
            opacity: refreshing ? 0.7 : 1,
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
            style={refreshing ? { animation: 'spin 0.7s linear infinite' } : undefined}>
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
          {refreshing ? '반영 중...' : '테마 반영'}
        </button>
        <button
          onClick={collectMapping}
          disabled={collecting}
          title="네이버 금융 테마에서 테마·소속종목을 자동 수집(역설계). 1~2분 소요."
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            height: 34,
            padding: '0 12px',
            borderRadius: 6,
            border: '1px solid #2E8B8B',
            cursor: collecting ? 'default' : 'pointer',
            backgroundColor: collecting ? 'var(--bg-card)' : 'rgba(46,139,139,0.10)',
            color: '#2E8B8B',
            fontSize: '0.75rem',
            fontWeight: 700,
            opacity: collecting ? 0.7 : 1,
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
            style={collecting ? { animation: 'spin 0.7s linear infinite' } : undefined}>
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
          {collecting ? '수집 중...' : '역설계 수집'}
        </button>
      </div>

      {displayThemes.length === 0 && (
        <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
          &lsquo;{search}&rsquo; 검색 결과가 없습니다.
        </div>
      )}

      {displayThemes.map((theme) => {
        const inBasket = isInBasket(theme.id);
        const isAnalyzing = analyzingId === theme.id;

        return (
          <Card
            key={theme.id}
            padding={16}
            hoverable
            style={{
              border: inBasket ? '1px solid #2E8B8B' : '1px solid var(--border)',
              transition: 'border-color 0.15s ease',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
              {/* Score badge */}
              <div
                style={{
                  minWidth: 50,
                  height: 50,
                  borderRadius: 10,
                  backgroundColor: getScoreBg(theme.ai_score),
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <span
                  style={{
                    fontSize: '1.0625rem',
                    fontWeight: 800,
                    color: getScoreColor(theme.ai_score),
                    lineHeight: 1,
                  }}
                >
                  {theme.ai_score}
                </span>
                <span style={{ fontSize: '0.6rem', color: getScoreColor(theme.ai_score), marginTop: 1 }}>
                  AI점수
                </span>
              </div>

              {/* Content */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    {theme.theme_name}
                  </span>
                  {theme.category && (
                    <span
                      style={{
                        padding: '1px 7px',
                        borderRadius: 4,
                        fontSize: '0.6875rem',
                        backgroundColor: '#EEF2F7',
                        color: '#1E3A5F',
                        fontWeight: 500,
                      }}
                    >
                      {theme.category}
                    </span>
                  )}
                  <span style={{ fontSize: '0.8125rem', color: '#6B7280', marginLeft: 'auto' }}>
                    종목 {theme.stock_count}개
                  </span>
                </div>
                <p
                  style={{
                    margin: '0 0 10px',
                    fontSize: '0.8125rem',
                    color: '#6B7280',
                    lineHeight: 1.5,
                    overflow: 'hidden',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical' as const,
                  }}
                >
                  {theme.news_summary || '뉴스 요약 없음'}
                </p>

                {/* 5축 집계 결과 (분석 후 표시) */}
                {scores[theme.id] && <ThemeScorePanel sc={scores[theme.id]} />}

                {/* Actions */}
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={isAnalyzing}
                    onClick={() => analyzeTheme(theme)}
                    style={{ fontSize: '0.8125rem', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <circle cx="11" cy="11" r="8" />
                      <path d="m21 21-4.35-4.35" />
                    </svg>
                    {isAnalyzing ? '분석 중...' : '분석'}
                  </Button>

                  {inBasket ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => onRemoveFromBasket(theme.id)}
                      style={{ borderColor: '#2E8B8B', color: '#2E8B8B' }}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      담김
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onAddToBasket(theme)}
                      style={{ border: '1px solid #2E8B8B', color: '#2E8B8B' }}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                        <line x1="12" y1="5" x2="12" y2="19" />
                        <line x1="5" y1="12" x2="19" y2="12" />
                      </svg>
                      바스켓 담기
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

export default ThemeList;
