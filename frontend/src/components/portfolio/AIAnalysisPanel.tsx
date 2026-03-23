'use client';

import { useState } from 'react';
import { Button } from '@/components/common/Button';
import { Card } from '@/components/common/Card';
import { authLib } from '@/lib/auth';
import type { PortfolioItem } from './TemplateEditPanel';
import { API_URL } from '@/lib/api-url';

interface RebalancingSuggestion {
  product_name: string;
  current_weight: number;
  suggested_weight: number;
  action: 'buy' | 'sell' | 'hold';
  reason: string;
}

interface AIAnalysisResult {
  ai_analysis: string;
  rebalancing_suggestions: RebalancingSuggestion[];
  generated_at: string;
}

interface AIAnalysisPanelProps {
  analysisId: number;
  onApplySuggestions?: (updatedItems: PortfolioItem[]) => void;
}

export function AIAnalysisPanel({ analysisId, onApplySuggestions }: AIAnalysisPanelProps) {
  const [result, setResult] = useState<AIAnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);

  async function requestAnalysis() {
    if (!analysisId) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setApplied(false);
    try {
      const res = await fetch(`${API_URL}/api/v1/portfolios/${analysisId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...authLib.getAuthHeader(),
        },
        body: JSON.stringify({ request_ai_analysis: true }),
      });
      if (!res.ok) throw new Error('AI 분석 요청에 실패했습니다.');
      const data = await res.json();
      setResult({
        ai_analysis: data.ai_analysis ?? '분석 결과가 없습니다.',
        rebalancing_suggestions: data.rebalancing_suggestions ?? [],
        generated_at: data.updated_at ?? new Date().toISOString(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }

  async function applySuggestions() {
    if (!result || !result.rebalancing_suggestions.length) return;
    setApplying(true);
    try {
      // Fetch current items then patch suggested weights
      const res = await fetch(`${API_URL}/api/v1/portfolios/${analysisId}/items`, {
        headers: { ...authLib.getAuthHeader() },
      });
      if (!res.ok) throw new Error('항목 조회 실패');
      const rawItems: PortfolioItem[] = await res.json();

      const updated: PortfolioItem[] = rawItems.map((item) => {
        const suggestion = result.rebalancing_suggestions.find(
          (s) => s.product_name === item.product_name
        );
        if (!suggestion) return item;
        return { ...item, weight: suggestion.suggested_weight };
      });

      onApplySuggestions?.(updated);
      setApplied(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '제안 적용 중 오류가 발생했습니다.');
    } finally {
      setApplying(false);
    }
  }

  const actionColor = (action: string) => {
    if (action === 'buy') return { bg: '#ECFDF5', text: '#059669', label: '매수' };
    if (action === 'sell') return { bg: '#FEF2F2', text: '#DC2626', label: '매도' };
    return { bg: '#F5F7FA', text: '#6B7280', label: '유지' };
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Request button */}
      <Card padding={20}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 10,
              backgroundColor: '#EEF2F7',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#1E3A5F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4l3 3" />
            </svg>
          </div>
          <div style={{ flex: 1 }}>
            <h3 style={{ margin: '0 0 4px', fontSize: '0.9375rem', fontWeight: 600, color: '#1A1A2E' }}>
              AI 포트폴리오 분석
            </h3>
            <p style={{ margin: '0 0 14px', fontSize: '0.8125rem', color: '#6B7280', lineHeight: 1.5 }}>
              현재 포트폴리오를 AI로 분석하여 리밸런싱 제안을 받습니다.
              분석에는 10~30초가 소요될 수 있습니다.
            </p>
            <Button
              variant="primary"
              size="sm"
              loading={loading}
              onClick={requestAnalysis}
              disabled={!analysisId || loading}
            >
              {loading ? 'AI 분석 중...' : 'AI 분석 요청'}
            </Button>
          </div>
        </div>
      </Card>

      {/* Error */}
      {error && (
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
        </div>
      )}

      {/* Result */}
      {result && (
        <>
          {/* AI Analysis Text */}
          <Card padding={20}>
            <h3
              style={{
                margin: '0 0 12px',
                fontSize: '0.875rem',
                fontWeight: 600,
                color: '#1E3A5F',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 15h-2v-6h2zm0-8h-2V7h2z" />
              </svg>
              AI 분석 결과
            </h3>
            <p
              style={{
                margin: 0,
                fontSize: '0.875rem',
                color: '#374151',
                lineHeight: 1.7,
                whiteSpace: 'pre-wrap',
              }}
            >
              {result.ai_analysis}
            </p>
            <p style={{ margin: '10px 0 0', fontSize: '0.75rem', color: '#9CA3AF' }}>
              생성일시: {new Date(result.generated_at).toLocaleString('ko-KR')}
            </p>
          </Card>

          {/* Rebalancing Suggestions */}
          {result.rebalancing_suggestions.length > 0 && (
            <Card padding={20}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 14,
                }}
              >
                <h3
                  style={{
                    margin: 0,
                    fontSize: '0.875rem',
                    fontWeight: 600,
                    color: '#1E3A5F',
                  }}
                >
                  리밸런싱 제안 ({result.rebalancing_suggestions.length}건)
                </h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {applied && (
                    <span style={{ fontSize: '0.8125rem', color: '#059669', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      적용 완료
                    </span>
                  )}
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={applying}
                    onClick={applySuggestions}
                    disabled={applied}
                  >
                    제안 적용
                  </Button>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {result.rebalancing_suggestions.map((s, i) => {
                  const colors = actionColor(s.action);
                  const weightDiff = s.suggested_weight - s.current_weight;
                  return (
                    <div
                      key={i}
                      style={{
                        padding: '12px 14px',
                        borderRadius: 8,
                        border: '1px solid #E1E5EB',
                        backgroundColor: '#FAFBFC',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#1A1A2E' }}>
                          {s.product_name}
                        </span>
                        <span
                          style={{
                            padding: '2px 8px',
                            borderRadius: 4,
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            backgroundColor: colors.bg,
                            color: colors.text,
                          }}
                        >
                          {colors.label}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8125rem', color: '#6B7280' }}>
                        <span>현재 {s.current_weight.toFixed(1)}%</span>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="9 18 15 12 9 6" />
                        </svg>
                        <span style={{ fontWeight: 600, color: colors.text }}>
                          제안 {s.suggested_weight.toFixed(1)}%
                        </span>
                        <span style={{ color: weightDiff > 0 ? '#059669' : '#DC2626' }}>
                          ({weightDiff > 0 ? '+' : ''}{weightDiff.toFixed(1)}%p)
                        </span>
                      </div>
                      {s.reason && (
                        <p style={{ margin: 0, fontSize: '0.8125rem', color: '#374151', lineHeight: 1.5 }}>
                          {s.reason}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

export default AIAnalysisPanel;
