'use client';

import { useState, useEffect } from 'react';
import { CallReservationForm } from './CallReservationForm';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

interface SuggestionHolding {
  holding_id: string;
  product_name: string;
  current_weight: number;
  suggested_weight: number;
}

interface SuggestionData {
  id: string;
  ai_comment: string;
  expires_at: string;
  is_expired: boolean;
  holdings: SuggestionHolding[];
}

interface SuggestionPanelProps {
  token: string;
  suggestId: string;
  portalJwt: string;
}

export function SuggestionPanel({ token, suggestId, portalJwt }: SuggestionPanelProps) {
  const [suggestion, setSuggestion] = useState<SuggestionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reserved, setReserved] = useState(false);

  useEffect(() => {
    const fetchSuggestion = async () => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch(
          `${API_URL}/api/v1/client-portal/${token}/suggestion/${suggestId}`,
          {
            headers: { Authorization: `Bearer ${portalJwt}` },
          }
        );
        if (res.ok) {
          const data = await res.json();
          setSuggestion(data);
        } else {
          setError('제안 내용을 불러오지 못했습니다.');
        }
      } catch {
        setError('네트워크 오류가 발생했습니다.');
      } finally {
        setLoading(false);
      }
    };

    fetchSuggestion();
  }, [token, suggestId, portalJwt]);

  if (loading) {
    return (
      <div
        style={{
          backgroundColor: '#fff',
          borderRadius: 16,
          padding: 24,
          textAlign: 'center',
          color: '#9CA3AF',
          fontSize: 14,
          border: '1px solid #E5E7EB',
        }}
      >
        제안 내용을 불러오는 중...
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          backgroundColor: '#FEF2F2',
          borderRadius: 16,
          padding: 24,
          textAlign: 'center',
          color: '#DC2626',
          fontSize: 14,
          border: '1px solid #FECACA',
        }}
      >
        {error}
      </div>
    );
  }

  if (!suggestion) return null;

  // 만료된 제안
  if (suggestion.is_expired) {
    return (
      <div
        style={{
          backgroundColor: '#F9FAFB',
          borderRadius: 16,
          padding: 24,
          textAlign: 'center',
          border: '1px solid #E5E7EB',
        }}
      >
        <div style={{ fontSize: 32, marginBottom: 12 }}>⏰</div>
        <p style={{ fontSize: 16, fontWeight: 700, color: '#374151', marginBottom: 8 }}>
          제안 기간이 만료되었습니다
        </p>
        <p style={{ fontSize: 13, color: '#9CA3AF' }}>
          새로운 포트폴리오 제안은 담당자에게 문의해주세요.
        </p>
      </div>
    );
  }

  // 예약 완료 상태
  if (reserved) {
    return (
      <div
        style={{
          backgroundColor: '#F0FDF4',
          borderRadius: 16,
          padding: 32,
          textAlign: 'center',
          border: '1px solid #BBF7D0',
        }}
      >
        <div
          style={{
            width: 64,
            height: 64,
            backgroundColor: '#059669',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 16px',
            fontSize: 28,
          }}
        >
          ✓
        </div>
        <p style={{ fontSize: 17, fontWeight: 700, color: '#065F46', marginBottom: 8 }}>
          예약이 완료되었습니다
        </p>
        <p style={{ fontSize: 14, color: '#047857', lineHeight: 1.6 }}>
          담당자가 선택하신 시간에
          <br />
          연락드릴 예정입니다.
        </p>
      </div>
    );
  }

  return (
    <div
      style={{
        backgroundColor: '#fff',
        borderRadius: 16,
        overflow: 'hidden',
        border: '1px solid #E5E7EB',
        boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
      }}
    >
      {/* 헤더 */}
      <div
        style={{
          background: 'linear-gradient(135deg, #1E3A5F 0%, #2D5A9B 100%)',
          padding: '20px 24px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 18 }}>✨</span>
          <span style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>
            담당자 추천 포트폴리오 변경안
          </span>
        </div>
        <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', margin: 0 }}>
          만료일:{' '}
          {new Date(suggestion.expires_at).toLocaleDateString('ko-KR', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}
        </p>
      </div>

      {/* 제안 내용 */}
      <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* 비중 변경 표 */}
        {suggestion.holdings && suggestion.holdings.length > 0 && (
          <div>
            <p style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 12 }}>
              비중 변경 내역
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {suggestion.holdings.map((h) => {
                const diff = h.suggested_weight - h.current_weight;
                return (
                  <div
                    key={h.holding_id}
                    style={{
                      backgroundColor: '#F9FAFB',
                      borderRadius: 10,
                      padding: '12px 14px',
                    }}
                  >
                    <p
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: '#111827',
                        marginBottom: 6,
                        lineHeight: 1.4,
                      }}
                    >
                      {h.product_name}
                    </p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span
                        style={{
                          fontSize: 13,
                          color: '#6B7280',
                          backgroundColor: '#E5E7EB',
                          padding: '2px 8px',
                          borderRadius: 6,
                        }}
                      >
                        {(h.current_weight * 100).toFixed(1)}%
                      </span>
                      <span style={{ fontSize: 12, color: '#9CA3AF' }}>→</span>
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 700,
                          color: '#1E3A5F',
                          backgroundColor: '#DBEAFE',
                          padding: '2px 8px',
                          borderRadius: 6,
                        }}
                      >
                        {(h.suggested_weight * 100).toFixed(1)}%
                      </span>
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          color: diff > 0 ? '#059669' : diff < 0 ? '#DC2626' : '#9CA3AF',
                          marginLeft: 'auto',
                        }}
                      >
                        {diff > 0 ? '+' : ''}{(diff * 100).toFixed(1)}%p
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* AI 코멘트 */}
        {suggestion.ai_comment && (
          <div
            style={{
              backgroundColor: '#F0F4FF',
              border: '1px solid #C7D2FE',
              borderRadius: 12,
              padding: '14px 16px',
            }}
          >
            <p style={{ fontSize: 12, fontWeight: 700, color: '#4338CA', marginBottom: 6 }}>
              AI 변경 이유
            </p>
            <p style={{ fontSize: 14, color: '#1E1B4B', lineHeight: 1.7, margin: 0 }}>
              {suggestion.ai_comment}
            </p>
          </div>
        )}

        {/* 통화 예약 폼 */}
        <CallReservationForm suggestId={suggestId} onSuccess={() => setReserved(true)} />
      </div>
    </div>
  );
}

export default SuggestionPanel;
