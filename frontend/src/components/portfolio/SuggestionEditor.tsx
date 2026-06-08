'use client';

import { useState, useCallback } from 'react';
import type { Holding } from './SnapshotDataTable';
import { authLib } from '@/lib/auth';
import { API_URL } from '@/lib/api-url';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

interface SuggestionEditorProps {
  holdings: Holding[];
  snapshotId: string;
  accountId: string;
  totalEvaluation: number;
}

interface SuggestionResponse {
  id: string;
  portal_link?: string;
  suggestion_id?: string;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

const fmt = (n: number) => n.toLocaleString('ko-KR');

/* ------------------------------------------------------------------ */
/*  Toast                                                               */
/* ------------------------------------------------------------------ */

function Toast({ message, type }: { message: string; type: 'success' | 'error' | 'info' }) {
  const bg = type === 'success' ? '#10B981' : type === 'error' ? '#EF4444' : '#1E3A5F';
  return (
    <div
      style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        padding: '12px 20px',
        backgroundColor: bg,
        color: '#fff',
        borderRadius: 10,
        fontSize: '0.875rem',
        fontWeight: 600,
        boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
        zIndex: 9999,
        animation: 'slideInRight 0.25s ease',
        maxWidth: 320,
      }}
    >
      {message}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                      */
/* ------------------------------------------------------------------ */

export function SuggestionEditor({ holdings, snapshotId, accountId, totalEvaluation }: SuggestionEditorProps) {
  /* Initialise weights from existing weight field (0~1 → 0~100%) */
  const initialWeights = Object.fromEntries(
    holdings.map((h) => [h.id, h.weight != null ? parseFloat((h.weight * 100).toFixed(1)) : 0])
  );

  const [weights, setWeights] = useState<Record<string, number>>(initialWeights);
  const [sending, setSending] = useState(false);
  const [suggestionId, setSuggestionId] = useState<string | null>(null);
  const [portalLink, setPortalLink] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  /* ---- derived ---- */
  const totalWeight = Object.values(weights).reduce((sum, w) => sum + (isNaN(w) ? 0 : w), 0);
  const isValid = Math.abs(totalWeight - 100) < 0.01;

  /* ---- helpers ---- */
  function showToast(message: string, type: 'success' | 'error' | 'info' = 'success') {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }

  function handleWeightChange(holdingId: string, raw: string) {
    const val = parseFloat(raw);
    setWeights((prev) => ({ ...prev, [holdingId]: isNaN(val) ? 0 : val }));
  }

  /* ---- after-evaluation calc ---- */
  function afterEval(holdingId: string): number {
    const w = weights[holdingId] ?? 0;
    return totalEvaluation * (w / 100);
  }

  function diff(holdingId: string): number {
    const h = holdings.find((hh) => hh.id === holdingId);
    return afterEval(holdingId) - (h?.evaluation_amount ?? 0);
  }

  /* ---- POST suggestion ---- */
  const handleSendSuggestion = useCallback(async () => {
    if (!isValid) return;
    setSending(true);
    try {
      const suggested_weights: Record<string, number> = {};
      for (const h of holdings) {
        suggested_weights[h.id] = (weights[h.id] ?? 0) / 100;
      }

      const res = await fetch(`${API_URL}/api/v1/portfolios/suggestions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authLib.getAuthHeader(),
        },
        body: JSON.stringify({
          account_id: accountId,
          snapshot_id: snapshotId,
          suggested_weights,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showToast(err?.detail || '제안 생성에 실패했습니다.', 'error');
        return;
      }

      const data: SuggestionResponse = await res.json();
      const sid = data.id ?? data.suggestion_id ?? null;
      const link = data.portal_link ?? null;
      setSuggestionId(sid);
      setPortalLink(link);
      showToast('리밸런싱 제안이 생성되었습니다.', 'success');
    } catch {
      showToast('제안 생성 중 오류가 발생했습니다.', 'error');
    } finally {
      setSending(false);
    }
  }, [isValid, holdings, weights, accountId, snapshotId]);

  /* ---- Copy link ---- */
  async function handleCopyLink() {
    const link = portalLink ?? (suggestionId ? `${window.location.origin}/client/suggestion/${suggestionId}` : null);
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      showToast('링크가 복사되었습니다', 'success');
    } catch {
      showToast('복사에 실패했습니다.', 'error');
    }
  }

  /* ---- Email send ---- */
  async function handleEmailSend() {
    if (!suggestionId) return;
    try {
      const res = await fetch(`${API_URL}/api/v1/portfolios/suggestions/${suggestionId}/send`, {
        method: 'POST',
        headers: { ...authLib.getAuthHeader() },
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const detail = err?.detail ?? '';
        if (detail.includes('이메일') || detail.includes('email') || res.status === 422) {
          showToast('고객 이메일을 등록해주세요.', 'error');
        } else {
          showToast(detail || '이메일 발송에 실패했습니다.', 'error');
        }
        return;
      }

      showToast('이메일이 발송되었습니다.', 'success');
    } catch {
      showToast('이메일 발송 중 오류가 발생했습니다.', 'error');
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Styles                                                            */
  /* ---------------------------------------------------------------- */

  const thStyle: React.CSSProperties = {
    padding: '10px 12px',
    fontSize: '0.75rem',
    fontWeight: 600,
    color: 'var(--text-muted)',
    textAlign: 'right',
    backgroundColor: 'var(--bg-surface)',
    borderBottom: '1px solid var(--border)',
    whiteSpace: 'nowrap',
  };

  const tdStyle: React.CSSProperties = {
    padding: '9px 12px',
    fontSize: '0.8125rem',
    color: 'var(--text-secondary)',
    textAlign: 'right',
    borderBottom: '1px solid var(--border)',
    whiteSpace: 'nowrap',
  };

  const totalStyle: React.CSSProperties = {
    padding: '10px 12px',
    fontSize: '0.8125rem',
    fontWeight: 700,
    color: 'var(--text-primary)',
    textAlign: 'right',
    backgroundColor: 'var(--bg-surface)',
    whiteSpace: 'nowrap',
  };

  const weightSumColor = isValid ? '#10B981' : '#EF4444';

  /* ---------------------------------------------------------------- */
  /*  Render                                                            */
  /* ---------------------------------------------------------------- */

  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 12,
        overflow: 'hidden',
        backgroundColor: 'var(--bg-card)',
        marginTop: 16,
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '14px 20px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          backgroundColor: 'var(--bg-card)',
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1E3A5F" strokeWidth="2">
          <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
          <polyline points="17 6 23 6 23 12" />
        </svg>
        <span style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--text-primary)' }}>
          리밸런싱 제안
        </span>
        <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
          수정비중을 입력하면 변경 후 평가금액이 자동 계산됩니다.
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              fontSize: '0.8125rem',
              fontWeight: 700,
              color: weightSumColor,
            }}
          >
            합계: {totalWeight.toFixed(1)}%
            {isValid && ' ✓'}
          </span>
        </div>
      </div>

      {/* Table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, textAlign: 'center', width: 40 }}>NO</th>
              <th style={{ ...thStyle, textAlign: 'left' }}>상품명</th>
              <th style={thStyle}>평가금액</th>
              <th style={thStyle}>수익률</th>
              <th style={thStyle}>현재비중</th>
              <th style={{ ...thStyle, textAlign: 'center', width: 110 }}>수정비중(%)</th>
              <th style={thStyle}>변경후 평가금액</th>
              <th style={{ ...thStyle, textAlign: 'center', width: 100 }}>(+/-)</th>
            </tr>
          </thead>
          <tbody>
            {holdings.map((h, idx) => {
              const currentWeight = h.weight != null ? h.weight * 100 : 0;
              const afterAmount = afterEval(h.id);
              const diffAmount = diff(h.id);
              const diffColor = diffAmount > 0 ? '#10B981' : diffAmount < 0 ? '#EF4444' : '#374151';
              const isNewItem = h.id.startsWith('virtual_') || h.id.startsWith('__new__');
              const isRow1Product = (h.product_name ?? '').includes('예수금') || (h.product_name ?? '').includes('자동운용상품');

              return (
                <tr
                  key={h.id}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLTableRowElement).style.backgroundColor = isNewItem ? '#EFF6FF' : '#F9FAFB';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLTableRowElement).style.backgroundColor = isNewItem ? '#F0F7FF' : 'transparent';
                  }}
                  style={{ transition: 'background-color 0.1s ease', backgroundColor: isNewItem ? '#F0F7FF' : 'transparent' }}
                >
                  <td style={{ ...tdStyle, textAlign: 'center', color: 'var(--text-muted)' }}>
                    {h.seq ?? idx + 1}
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'left' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{h.product_name}</span>
                      {isNewItem && !isRow1Product && (
                        <span style={{ fontSize: '0.625rem', fontWeight: 700, color: 'var(--blue-600)', backgroundColor: 'rgba(56,189,248,0.16)', border: '1px solid rgba(56,189,248,0.35)', padding: '1px 6px', borderRadius: 4, flexShrink: 0 }}>신규</span>
                      )}
                    </div>
                    {h.product_type && (
                      <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: 1 }}>
                        {h.product_type}
                      </div>
                    )}
                  </td>
                  <td style={tdStyle}>{h.evaluation_amount != null ? fmt(h.evaluation_amount) : '-'}</td>
                  <td
                    style={{
                      ...tdStyle,
                      color:
                        h.return_rate == null
                          ? '#374151'
                          : h.return_rate > 0
                          ? '#10B981'
                          : h.return_rate < 0
                          ? '#EF4444'
                          : '#374151',
                      fontWeight: h.return_rate != null && h.return_rate !== 0 ? 600 : undefined,
                    }}
                  >
                    {h.return_rate != null
                      ? `${h.return_rate > 0 ? '+' : ''}${h.return_rate.toFixed(2)}%`
                      : '-'}
                  </td>
                  <td style={tdStyle}>
                    {currentWeight !== 0 ? `${currentWeight.toFixed(1)}%` : '-'}
                  </td>

                  {/* 수정비중 input */}
                  <td style={{ ...tdStyle, textAlign: 'center', padding: '6px 10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        max="100"
                        value={weights[h.id] ?? 0}
                        onChange={(e) => handleWeightChange(h.id, e.target.value)}
                        style={{
                          width: 68,
                          padding: '5px 8px',
                          fontSize: '0.8125rem',
                          border: `1px solid ${
                            weights[h.id] != null && weights[h.id] > 0 ? '#1E3A5F' : '#E1E5EB'
                          }`,
                          borderRadius: 6,
                          outline: 'none',
                          textAlign: 'right',
                          color: 'var(--text-primary)',
                          backgroundColor: 'var(--bg-card)',
                          transition: 'border-color 0.15s',
                        }}
                      />
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>%</span>
                    </div>
                  </td>

                  {/* 변경후 평가금액 */}
                  <td style={{ ...tdStyle, fontWeight: 500 }}>
                    {totalEvaluation > 0 ? fmt(Math.round(afterAmount)) : '-'}
                  </td>

                  {/* (+/-) */}
                  <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 600, color: diffColor }}>
                    {totalEvaluation > 0 && h.evaluation_amount != null
                      ? `${diffAmount >= 0 ? '+' : ''}${fmt(Math.round(diffAmount))}`
                      : '-'}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4} style={{ ...totalStyle, textAlign: 'left' }}>합계</td>
              <td style={totalStyle}>
                {holdings.reduce((s, h) => s + (h.weight != null ? h.weight * 100 : 0), 0).toFixed(1)}%
              </td>
              <td style={{ ...totalStyle, textAlign: 'center' }}>
                <span style={{ color: weightSumColor, fontWeight: 700 }}>
                  {totalWeight.toFixed(1)}%{isValid && ' ✓'}
                </span>
              </td>
              <td style={totalStyle}>
                {totalEvaluation > 0 ? fmt(Math.round(totalEvaluation)) : '-'}
              </td>
              <td style={totalStyle}>-</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Bottom action bar */}
      <div
        style={{
          padding: '14px 20px',
          borderTop: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap',
          backgroundColor: 'var(--bg-surface)',
        }}
      >
        {/* Weight hint */}
        {!isValid && (
          <span style={{ fontSize: '0.8125rem', color: 'var(--danger)', fontWeight: 500 }}>
            수정비중 합계가 100%가 되어야 제안을 발송할 수 있습니다. (현재: {totalWeight.toFixed(1)}%)
          </span>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* 링크 복사 / 이메일 발송 (제안 생성 후) */}
          {suggestionId && (
            <>
              <button
                onClick={handleCopyLink}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '8px 16px',
                  fontSize: '0.8125rem',
                  fontWeight: 600,
                  color: 'var(--blue-400)',
                  backgroundColor: 'var(--bg-card-2)',
                  border: '1px solid #C7D2E2',
                  borderRadius: 8,
                  cursor: 'pointer',
                  transition: 'background-color 0.15s',
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#DDE6F0';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#EEF2F7';
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                </svg>
                링크 복사
              </button>

              <button
                onClick={handleEmailSend}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '8px 16px',
                  fontSize: '0.8125rem',
                  fontWeight: 600,
                  color: '#fff',
                  backgroundColor: 'var(--blue-600)',
                  border: '1px solid var(--blue-500)',
                  borderRadius: 8,
                  cursor: 'pointer',
                  transition: 'background-color 0.15s',
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#162E4A';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#1E3A5F';
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                  <polyline points="22,6 12,13 2,6" />
                </svg>
                이메일 발송
              </button>
            </>
          )}

          {/* 리밸런싱 제안 발송 버튼 */}
          <button
            onClick={handleSendSuggestion}
            disabled={!isValid || sending}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 20px',
              fontSize: '0.8125rem',
              fontWeight: 700,
              color: isValid ? '#fff' : '#9CA3AF',
              backgroundColor: isValid ? '#3B82F6' : '#E5E7EB',
              border: 'none',
              borderRadius: 8,
              cursor: isValid && !sending ? 'pointer' : 'not-allowed',
              transition: 'all 0.15s',
              minWidth: 44,
            }}
            onMouseEnter={(e) => {
              if (isValid && !sending)
                (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#2563EB';
            }}
            onMouseLeave={(e) => {
              if (isValid && !sending)
                (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#3B82F6';
            }}
          >
            {sending ? (
              <span
                style={{
                  display: 'inline-block',
                  width: 12,
                  height: 12,
                  border: '2px solid rgba(255,255,255,0.4)',
                  borderTopColor: '#fff',
                  borderRadius: '50%',
                  animation: 'spin 0.7s linear infinite',
                }}
              />
            ) : (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            )}
            {suggestionId ? '제안 재발송' : '리밸런싱 제안 발송'}
          </button>
        </div>
      </div>

      {/* Toast */}
      {toast && <Toast message={toast.message} type={toast.type} />}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
        @keyframes slideInRight {
          from { transform: translateX(80px); opacity: 0; }
          to   { transform: translateX(0);   opacity: 1; }
        }
      `}</style>
    </div>
  );
}

export default SuggestionEditor;
