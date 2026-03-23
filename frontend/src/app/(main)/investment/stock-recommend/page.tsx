/**
 * 주식/ETF 추천 프로그램
 * /investment/stock-recommend
 *
 * 2-step wizard:
 *  Step 1: 테마 분석 – ThemeList + ThemeBasket
 *  Step 2: 종목 확인 – StockList + StockAnalysisPopup
 */
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/common/Button';
import { Card } from '@/components/common/Card';
import { ThemeList } from '@/components/investment/ThemeList';
import { StockList } from '@/components/investment/StockList';
import { authLib } from '@/lib/auth';
import type { StockTheme } from '@/components/investment/ThemeList';
import { API_URL } from '@/lib/api-url';

/* ------------------------------------------------------------------ */
/*  ThemeBasket sub-component                                           */
/* ------------------------------------------------------------------ */

interface ThemeBasketProps {
  basket: StockTheme[];
  onRemove: (id: number) => void;
  onRecommend: () => void;
  loading: boolean;
}

function ThemeBasket({ basket, onRemove, onRecommend, loading }: ThemeBasketProps) {
  return (
    <div
      style={{
        backgroundColor: '#FFFFFF',
        border: '1px solid #E1E5EB',
        borderRadius: 12,
        padding: 20,
        boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
        position: 'sticky',
        top: 24,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            backgroundColor: '#EBF5F5',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#2E8B8B" strokeWidth="2" strokeLinecap="round">
            <circle cx="9" cy="21" r="1" />
            <circle cx="20" cy="21" r="1" />
            <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
          </svg>
        </div>
        <h3 style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 700, color: '#1A1A2E' }}>
          분석 바스켓
        </h3>
        {basket.length > 0 && (
          <span
            style={{
              marginLeft: 'auto',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 20,
              height: 20,
              borderRadius: '50%',
              backgroundColor: '#2E8B8B',
              color: '#fff',
              fontSize: '0.6875rem',
              fontWeight: 700,
            }}
          >
            {basket.length}
          </span>
        )}
      </div>

      {basket.length === 0 ? (
        <div
          style={{
            padding: '24px 12px',
            textAlign: 'center',
            color: '#9CA3AF',
            fontSize: '0.8125rem',
            border: '2px dashed #E1E5EB',
            borderRadius: 8,
          }}
        >
          테마를 선택하면<br />바스켓에 담깁니다
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
          {basket.map((theme) => (
            <div
              key={theme.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 10px',
                borderRadius: 8,
                backgroundColor: '#F5F7FA',
                border: '1px solid #E1E5EB',
              }}
            >
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 6,
                  backgroundColor: '#EBF5F5',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  color: '#2E8B8B',
                  flexShrink: 0,
                }}
              >
                {theme.ai_score}
              </div>
              <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#1A1A2E', flex: 1, minWidth: 0 }}>
                {theme.theme_name}
              </span>
              <button
                onClick={() => onRemove(theme.id)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#9CA3AF',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 2,
                  borderRadius: 4,
                  flexShrink: 0,
                }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = '#DC2626')}
                onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = '#9CA3AF')}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      <Button
        variant="primary"
        size="md"
        fullWidth
        loading={loading}
        disabled={basket.length === 0}
        onClick={onRecommend}
        style={{ backgroundColor: '#2E8B8B', borderColor: '#2E8B8B' }}
        onMouseEnter={(e) => {
          if (basket.length > 0) {
            (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#247474';
            (e.currentTarget as HTMLButtonElement).style.borderColor = '#247474';
          }
        }}
        onMouseLeave={(e) => {
          if (basket.length > 0) {
            (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#2E8B8B';
            (e.currentTarget as HTMLButtonElement).style.borderColor = '#2E8B8B';
          }
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 8v4l3 3" />
        </svg>
        {loading ? 'AI 분석 중...' : '종목 추천 받기'}
      </Button>
      {basket.length > 0 && (
        <p style={{ margin: '8px 0 0', fontSize: '0.75rem', color: '#6B7280', textAlign: 'center' }}>
          {basket.length}개 테마를 기반으로 AI 추천
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Step indicator                                                      */
/* ------------------------------------------------------------------ */

function StepIndicator({ currentStep }: { currentStep: 1 | 2 }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
      {([1, 2] as const).map((step, i) => {
        const isActive = currentStep === step;
        const isDone = currentStep > step;
        return (
          <div key={step} style={{ display: 'flex', alignItems: 'center' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: isDone ? '#2E8B8B' : isActive ? '#1E3A5F' : '#E1E5EB',
                  color: isDone || isActive ? '#fff' : '#9CA3AF',
                  fontSize: '0.8125rem',
                  fontWeight: 700,
                  transition: 'all 0.2s ease',
                }}
              >
                {isDone ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : step}
              </div>
              <span style={{ fontSize: '0.6875rem', color: isActive ? '#1A1A2E' : '#9CA3AF', whiteSpace: 'nowrap', fontWeight: isActive ? 600 : 400 }}>
                {step === 1 ? '테마 분석' : '종목 확인'}
              </span>
            </div>
            {i < 1 && (
              <div
                style={{
                  width: 48,
                  height: 2,
                  backgroundColor: isDone ? '#2E8B8B' : '#E1E5EB',
                  margin: '0 4px',
                  marginBottom: 18,
                  transition: 'background-color 0.2s ease',
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main page                                                           */
/* ------------------------------------------------------------------ */

export default function StockRecommendPage() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [basket, setBasket] = useState<StockTheme[]>([]);
  const [recommendationId, setRecommendationId] = useState<number | null>(null);
  const [recommending, setRecommending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addToBasket(theme: StockTheme) {
    setBasket((prev) => {
      if (prev.some((t) => t.id === theme.id)) return prev;
      return [...prev, theme];
    });
  }

  function removeFromBasket(themeId: number) {
    setBasket((prev) => prev.filter((t) => t.id !== themeId));
  }

  async function requestRecommendation() {
    if (basket.length === 0) return;
    setRecommending(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/v1/stocks/recommendations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authLib.getAuthHeader(),
        },
        body: JSON.stringify({
          theme_ids: basket.map((t) => t.id),
        }),
      });
      if (!res.ok) throw new Error('추천 요청에 실패했습니다.');
      const data = await res.json();

      // Poll for completion if needed
      const recId: number = data.id;
      setRecommendationId(recId);

      if (data.status === 'processing') {
        await pollRecommendation(recId);
      }

      setStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : '알 수 없는 오류');
    } finally {
      setRecommending(false);
    }
  }

  async function pollRecommendation(recId: number) {
    const poll = async (): Promise<void> => {
      const res = await fetch(`${API_URL}/api/v1/stocks/recommendations/${recId}`, {
        headers: { ...authLib.getAuthHeader() },
      });
      if (!res.ok) throw new Error('추천 상태 조회 실패');
      const data = await res.json();
      if (data.status === 'processing' || data.status === 'pending') {
        await new Promise((r) => setTimeout(r, 2000));
        return poll();
      }
      if (data.status === 'error') {
        throw new Error('추천 생성 중 오류가 발생했습니다.');
      }
    };
    return poll();
  }

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
      {/* Page header */}
      <div style={{ marginBottom: 28 }}>
        <button
          onClick={() => router.push('/dashboard')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            marginBottom: 14,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: '#6B7280',
            fontSize: '0.8125rem',
            padding: 0,
          }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = '#1A1A2E')}
          onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = '#6B7280')}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          대시보드로 돌아가기
        </button>

        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <div
              style={{
                width: 36,
                height: 4,
                borderRadius: 2,
                background: 'linear-gradient(90deg, #2E8B8B 0%, #059669 100%)',
                marginBottom: 12,
              }}
            />
            <h1
              style={{
                margin: 0,
                fontSize: '24px',
                fontWeight: 800,
                color: '#1A1A2E',
                letterSpacing: '-0.4px',
              }}
            >
              주식/ETF 추천 프로그램
            </h1>
            <p style={{ margin: '6px 0 0', fontSize: '0.875rem', color: '#6B7280' }}>
              AI가 테마별 주식/ETF를 분석하고 최적의 종목을 추천합니다.
            </p>
          </div>

          <StepIndicator currentStep={step} />
        </div>
      </div>

      {/* Error */}
      {error && (
        <div
          style={{
            marginBottom: 16,
            padding: '12px 16px',
            backgroundColor: '#FEF2F2',
            border: '1px solid #FECACA',
            borderRadius: 8,
            color: '#B91C1C',
            fontSize: '0.875rem',
          }}
        >
          {error}
        </div>
      )}

      {/* Step 1: 테마 분석 */}
      {step === 1 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 20, alignItems: 'start' }}>
          {/* Theme list */}
          <div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                marginBottom: 16,
                padding: '12px 16px',
                backgroundColor: '#FFFFFF',
                border: '1px solid #E1E5EB',
                borderRadius: 10,
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2E8B8B" strokeWidth="2" strokeLinecap="round">
                <rect x="3" y="3" width="7" height="7" />
                <rect x="14" y="3" width="7" height="7" />
                <rect x="14" y="14" width="7" height="7" />
                <rect x="3" y="14" width="7" height="7" />
              </svg>
              <div>
                <p style={{ margin: 0, fontSize: '0.875rem', fontWeight: 600, color: '#1A1A2E' }}>
                  테마 목록
                </p>
                <p style={{ margin: 0, fontSize: '0.75rem', color: '#6B7280' }}>
                  분석하고 싶은 테마를 선택해 바스켓에 담으세요.
                </p>
              </div>
            </div>
            <ThemeList
              basket={basket}
              onAddToBasket={addToBasket}
              onRemoveFromBasket={removeFromBasket}
            />
          </div>

          {/* Basket sidebar */}
          <ThemeBasket
            basket={basket}
            onRemove={removeFromBasket}
            onRecommend={requestRecommendation}
            loading={recommending}
          />
        </div>
      )}

      {/* Step 2: 종목 확인 */}
      {step === 2 && (
        <div>
          {/* Step 2 header */}
          <Card padding={16} style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  flex: 1,
                  flexWrap: 'wrap',
                }}
              >
                <span style={{ fontSize: '0.875rem', color: '#6B7280' }}>분석 바스켓:</span>
                {basket.map((theme) => (
                  <span
                    key={theme.id}
                    style={{
                      padding: '3px 10px',
                      borderRadius: 6,
                      fontSize: '0.8125rem',
                      backgroundColor: '#EBF5F5',
                      color: '#2E8B8B',
                      fontWeight: 600,
                    }}
                  >
                    {theme.theme_name}
                  </span>
                ))}
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setStep(1);
                  setRecommendationId(null);
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
                테마 재선택
              </Button>
            </div>
          </Card>

          {/* Section header */}
          <div style={{ marginBottom: 16 }}>
            <h2 style={{ margin: '0 0 4px', fontSize: '1rem', fontWeight: 700, color: '#1A1A2E' }}>
              AI 추천 종목
            </h2>
            <p style={{ margin: 0, fontSize: '0.8125rem', color: '#6B7280' }}>
              선택한 테마를 기반으로 AI가 추천한 종목입니다. 종목을 클릭하면 상세 분석을 볼 수 있습니다.
            </p>
          </div>

          {recommendationId ? (
            <StockList recommendationId={recommendationId} />
          ) : (
            <div style={{ textAlign: 'center', padding: '48px 0', color: '#6B7280', fontSize: '0.875rem' }}>
              추천 데이터를 불러오는 중...
            </div>
          )}
        </div>
      )}
    </div>
  );
}
