'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/common/Button';
import { Card } from '@/components/common/Card';
import { authLib } from '@/lib/auth';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export interface StockTheme {
  id: number;
  theme_name: string;
  ai_score: number;
  stock_count: number;
  news_summary: string;
  category?: string;
  analyzed_at?: string;
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
  const [error, setError] = useState<string | null>(null);

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
    try {
      const res = await fetch(`${API_URL}/api/v1/stocks/themes/analyze`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authLib.getAuthHeader(),
        },
        body: JSON.stringify({ theme_id: theme.id }),
      });
      if (!res.ok) throw new Error('테마 분석 실패');
      const updated: StockTheme = await res.json();
      setThemes((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    } catch (err) {
      setError(err instanceof Error ? err.message : '분석 중 오류가 발생했습니다.');
    } finally {
      setAnalyzingId(null);
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
      <div style={{ textAlign: 'center', padding: '48px 0', color: '#6B7280', fontSize: '0.875rem' }}>
        등록된 테마가 없습니다.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {themes.map((theme) => {
        const inBasket = isInBasket(theme.id);
        const isAnalyzing = analyzingId === theme.id;

        return (
          <Card
            key={theme.id}
            padding={16}
            hoverable
            style={{
              border: inBasket ? '1px solid #2E8B8B' : '1px solid #E1E5EB',
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
                  <span style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#1A1A2E' }}>
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

                {/* Actions */}
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={isAnalyzing}
                    onClick={() => analyzeTheme(theme)}
                    style={{ fontSize: '0.8125rem', color: '#1E3A5F', border: '1px solid #E1E5EB' }}
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
