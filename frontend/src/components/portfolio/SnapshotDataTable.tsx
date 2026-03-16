'use client';

import { useState, useCallback } from 'react';
import { authLib } from '@/lib/auth';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

/* ------------------------------------------------------------------ */
/*  Constants                                                           */
/* ------------------------------------------------------------------ */

const RISK_LEVELS = ['절대안정형', '안정형', '성장형', '절대성장형'];
const REGIONS = ['국내', '미국', '글로벌', '베트남', '인도', '중국', '기타'];

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export interface Holding {
  id: string;
  seq?: number;
  product_name: string;
  product_code?: string;
  product_type?: string;
  risk_level?: string;
  region?: string;
  purchase_amount?: number;
  evaluation_amount?: number;
  return_amount?: number;
  return_rate?: number;
  weight?: number;
  reference_price?: number;
}

export interface Snapshot {
  id: string;
  client_account_id: string;
  snapshot_date: string;
  deposit_amount?: number;
  total_purchase?: number;
  total_evaluation?: number;
  total_return?: number;
  total_return_rate?: number;
  holdings: Holding[];
}

/* ------------------------------------------------------------------ */
/*  Props                                                               */
/* ------------------------------------------------------------------ */

interface SnapshotDataTableProps {
  clientName: string;
  accountType: string;
  snapshot: Snapshot | null;
  isLoading: boolean;
  /** 인라인 편집 활성화 여부 (탭 2에서만 true) */
  editable?: boolean;
  /** 홀딩 저장 후 스냅샷 새로고침 콜백 */
  onHoldingUpdated?: (snapshotId: string) => void;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

const fmt = (n?: number) => (n != null ? n.toLocaleString('ko-KR') : '-');

const accountTypeLabel = (t: string) =>
  ({ irp: 'IRP', pension1: '연금저축1', pension2: '연금저축2' } as Record<string, string>)[t] || t;

const returnRateColor = (rate?: number) => {
  if (rate == null) return '#374151';
  if (rate > 0) return '#10B981';
  if (rate < 0) return '#EF4444';
  return '#374151';
};

const riskLevelStyle = (level?: string): React.CSSProperties => {
  if (!level) return {};
  if (level === '절대성장형') return { backgroundColor: '#FEF2F2', color: '#DC2626' };
  if (level === '성장형') return { backgroundColor: '#FFFBEB', color: '#D97706' };
  if (level === '안정형') return { backgroundColor: '#ECFDF5', color: '#059669' };
  if (level === '절대안정형') return { backgroundColor: '#EFF6FF', color: '#2563EB' };
  return { backgroundColor: '#F3F4F6', color: '#374151' };
};

/* ------------------------------------------------------------------ */
/*  Sub-components                                                      */
/* ------------------------------------------------------------------ */

function SummaryCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div
      style={{
        backgroundColor: accent ? '#EEF2F7' : '#F9FAFB',
        border: `1px solid ${accent ? '#C7D2E2' : '#E1E5EB'}`,
        borderRadius: 10,
        padding: '12px 16px',
        flex: 1,
        minWidth: 120,
      }}
    >
      <div style={{ fontSize: '0.75rem', color: '#6B7280', fontWeight: 500, marginBottom: 4 }}>
        {label}
      </div>
      <div
        style={{
          fontSize: '1rem',
          fontWeight: 700,
          color: accent ? '#1E3A5F' : '#1A1A2E',
          letterSpacing: '-0.3px',
        }}
      >
        {value}
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 20 }}>
      {[1, 2, 3, 4].map((i) => (
        <div
          key={i}
          style={{
            height: 40,
            backgroundColor: '#F3F4F6',
            borderRadius: 6,
            animation: 'pulse 1.5s ease-in-out infinite',
            opacity: 1 - i * 0.15,
          }}
        />
      ))}
      <style>{`@keyframes pulse { 0%,100%{opacity:1}50%{opacity:.5} }`}</style>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Inline-editable holding row                                         */
/* ------------------------------------------------------------------ */

interface HoldingRowProps {
  holding: Holding;
  index: number;
  snapshotId: string;
  editable: boolean;
  onSaved: (snapshotId: string) => void;
}

function HoldingRow({ holding: initialHolding, index, snapshotId, editable, onSaved }: HoldingRowProps) {
  const [riskLevel, setRiskLevel] = useState(initialHolding.risk_level ?? '');
  const [region, setRegion] = useState(initialHolding.region ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const isDirty =
    riskLevel !== (initialHolding.risk_level ?? '') ||
    region !== (initialHolding.region ?? '');

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch(
        `${API_URL}/api/v1/snapshots/${snapshotId}/holdings/${initialHolding.id}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
          body: JSON.stringify({ risk_level: riskLevel || null, region: region || null }),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err?.detail || '저장 실패');
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onSaved(snapshotId);
    } catch {
      alert('저장 중 오류가 발생했습니다.');
    } finally {
      setSaving(false);
    }
  }, [snapshotId, initialHolding.id, riskLevel, region, onSaved]);

  const h = initialHolding;

  const tdStyle: React.CSSProperties = {
    padding: '9px 12px',
    fontSize: '0.8125rem',
    color: '#374151',
    textAlign: 'right',
    borderBottom: '1px solid #F3F4F6',
    whiteSpace: 'nowrap',
  };

  return (
    <tr
      onMouseEnter={(e) => { (e.currentTarget as HTMLTableRowElement).style.backgroundColor = '#F9FAFB'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLTableRowElement).style.backgroundColor = 'transparent'; }}
      style={{ transition: 'background-color 0.1s ease' }}
    >
      <td style={{ ...tdStyle, textAlign: 'center', color: '#9CA3AF' }}>
        {h.seq ?? index + 1}
      </td>
      <td style={{ ...tdStyle, textAlign: 'left' }}>
        <div style={{ fontWeight: 500, color: '#1A1A2E' }}>{h.product_name}</div>
        {h.product_type && (
          <div style={{ fontSize: '0.6875rem', color: '#9CA3AF', marginTop: 1 }}>{h.product_type}</div>
        )}
      </td>

      {/* 위험도 */}
      <td style={{ ...tdStyle, textAlign: 'center', padding: '6px 8px' }}>
        {editable ? (
          <select
            value={riskLevel}
            onChange={(e) => setRiskLevel(e.target.value)}
            style={{
              width: '100%',
              padding: '5px 6px',
              fontSize: '0.75rem',
              border: '1px solid #E1E5EB',
              borderRadius: 6,
              outline: 'none',
              backgroundColor: '#fff',
              cursor: 'pointer',
              color: '#1A1A2E',
            }}
          >
            <option value="">선택</option>
            {RISK_LEVELS.map((rl) => (
              <option key={rl} value={rl}>{rl}</option>
            ))}
          </select>
        ) : (
          riskLevel ? (
            <span
              style={{
                fontSize: '0.6875rem',
                fontWeight: 600,
                padding: '2px 6px',
                borderRadius: 4,
                ...riskLevelStyle(riskLevel),
              }}
            >
              {riskLevel}
            </span>
          ) : '-'
        )}
      </td>

      {/* 지역 */}
      <td style={{ ...tdStyle, textAlign: 'center', padding: '6px 8px' }}>
        {editable ? (
          <select
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            style={{
              width: '100%',
              padding: '5px 6px',
              fontSize: '0.75rem',
              border: '1px solid #E1E5EB',
              borderRadius: 6,
              outline: 'none',
              backgroundColor: '#fff',
              cursor: 'pointer',
              color: '#1A1A2E',
            }}
          >
            <option value="">선택</option>
            {REGIONS.map((rg) => (
              <option key={rg} value={rg}>{rg}</option>
            ))}
          </select>
        ) : (
          region ? (
            <span
              style={{
                fontSize: '0.75rem',
                fontWeight: 500,
                color: '#1E3A5F',
                backgroundColor: '#EEF2F7',
                padding: '2px 6px',
                borderRadius: 4,
              }}
            >
              {region}
            </span>
          ) : '-'
        )}
      </td>

      <td style={tdStyle}>{fmt(h.purchase_amount)}</td>
      <td style={{ ...tdStyle, fontWeight: 500 }}>{fmt(h.evaluation_amount)}</td>
      <td style={{ ...tdStyle, color: returnRateColor(h.return_amount), fontWeight: h.return_amount != null && h.return_amount !== 0 ? 500 : undefined }}>
        {h.return_amount != null ? `${h.return_amount > 0 ? '+' : ''}${fmt(h.return_amount)}` : '-'}
      </td>
      <td style={{ ...tdStyle, color: returnRateColor(h.return_rate), fontWeight: 600 }}>
        {h.return_rate != null ? `${h.return_rate > 0 ? '+' : ''}${h.return_rate.toFixed(2)}%` : '-'}
      </td>
      <td style={{ ...tdStyle, color: '#374151' }}>
        {h.weight != null ? `${(h.weight * 100).toFixed(1)}%` : '-'}
      </td>

      {/* 저장 버튼 (editable 모드에서만) */}
      {editable && (
        <td style={{ ...tdStyle, textAlign: 'center', padding: '6px 8px' }}>
          <button
            onClick={handleSave}
            disabled={saving || (!isDirty && !saved)}
            title="저장"
            style={{
              padding: '4px 10px',
              fontSize: '0.7rem',
              fontWeight: 600,
              color: '#fff',
              backgroundColor: saved ? '#10B981' : isDirty ? '#1E3A5F' : '#D1D5DB',
              border: 'none',
              borderRadius: 5,
              cursor: saving || (!isDirty && !saved) ? 'not-allowed' : 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              transition: 'background-color 0.15s',
              minWidth: 44,
              justifyContent: 'center',
            }}
          >
            {saving ? (
              <span
                style={{
                  display: 'inline-block',
                  width: 9,
                  height: 9,
                  border: '1.5px solid #fff',
                  borderTopColor: 'transparent',
                  borderRadius: '50%',
                  animation: 'spin 0.7s linear infinite',
                }}
              />
            ) : saved ? (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              '저장'
            )}
          </button>
        </td>
      )}
    </tr>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                      */
/* ------------------------------------------------------------------ */

export function SnapshotDataTable({
  clientName,
  accountType,
  snapshot,
  isLoading,
  editable = false,
  onHoldingUpdated,
}: SnapshotDataTableProps) {
  const thStyle: React.CSSProperties = {
    padding: '10px 12px',
    fontSize: '0.75rem',
    fontWeight: 600,
    color: '#6B7280',
    textAlign: 'right',
    backgroundColor: '#F5F7FA',
    borderBottom: '1px solid #E1E5EB',
    whiteSpace: 'nowrap',
  };

  const thLeftStyle: React.CSSProperties = {
    ...thStyle,
    textAlign: 'left',
  };

  const totalRowStyle: React.CSSProperties = {
    padding: '10px 12px',
    fontSize: '0.8125rem',
    fontWeight: 700,
    color: '#1A1A2E',
    textAlign: 'right',
    backgroundColor: '#F5F7FA',
    whiteSpace: 'nowrap',
  };

  const handleHoldingUpdated = useCallback(
    (snapshotId: string) => {
      onHoldingUpdated?.(snapshotId);
    },
    [onHoldingUpdated]
  );

  return (
    <div
      style={{
        border: '1px solid #E1E5EB',
        borderRadius: 12,
        overflow: 'hidden',
        backgroundColor: '#FFFFFF',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '14px 20px',
          borderBottom: '1px solid #E1E5EB',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          backgroundColor: '#FFFFFF',
        }}
      >
        <span style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#1A1A2E' }}>
          {clientName || '고객명'}
        </span>
        <span
          style={{
            fontSize: '0.75rem',
            fontWeight: 600,
            color: '#1E3A5F',
            backgroundColor: '#EEF2F7',
            padding: '2px 8px',
            borderRadius: 5,
          }}
        >
          {accountTypeLabel(accountType)}
        </span>
        {snapshot && (
          <span style={{ fontSize: '0.75rem', color: '#9CA3AF', marginLeft: 'auto' }}>
            조회일: {snapshot.snapshot_date}
          </span>
        )}
        {editable && snapshot && (
          <span
            style={{
              fontSize: '0.6875rem',
              color: '#6B7280',
              backgroundColor: '#F3F4F6',
              padding: '2px 8px',
              borderRadius: 4,
            }}
          >
            위험도·지역 수정 가능
          </span>
        )}
      </div>

      {isLoading ? (
        <LoadingSkeleton />
      ) : !snapshot ? (
        <div
          style={{
            padding: '40px 20px',
            textAlign: 'center',
            color: '#9CA3AF',
            fontSize: '0.875rem',
          }}
        >
          데이터가 없습니다.
        </div>
      ) : (
        <>
          {/* Summary cards */}
          <div
            style={{
              display: 'flex',
              gap: 10,
              padding: '14px 20px',
              flexWrap: 'wrap',
              borderBottom: '1px solid #E1E5EB',
            }}
          >
            <SummaryCard label="예수금" value={`${fmt(snapshot.deposit_amount)}원`} />
            <SummaryCard label="납입원금" value={`${fmt(snapshot.total_purchase)}원`} />
            <SummaryCard label="평가금액" value={`${fmt(snapshot.total_evaluation)}원`} accent />
            <SummaryCard
              label="누적수익률"
              value={
                snapshot.total_return_rate != null
                  ? `${snapshot.total_return_rate > 0 ? '+' : ''}${snapshot.total_return_rate.toFixed(2)}%`
                  : '-'
              }
              accent={snapshot.total_return_rate != null && snapshot.total_return_rate > 0}
            />
          </div>

          {/* Table */}
          <div style={{ overflowX: 'auto' }}>
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: '0.8125rem',
              }}
            >
              <thead>
                <tr>
                  <th style={{ ...thStyle, textAlign: 'center', width: 40 }}>NO</th>
                  <th style={thLeftStyle}>상품명</th>
                  <th style={{ ...thStyle, textAlign: 'center', width: editable ? 130 : 90 }}>위험도</th>
                  <th style={{ ...thStyle, textAlign: 'center', width: editable ? 110 : 70 }}>지역</th>
                  <th style={thStyle}>매입금액</th>
                  <th style={thStyle}>평가금액</th>
                  <th style={thStyle}>평가손익</th>
                  <th style={thStyle}>수익률</th>
                  <th style={thStyle}>비중</th>
                  {editable && <th style={{ ...thStyle, textAlign: 'center', width: 60 }}>저장</th>}
                </tr>
              </thead>
              <tbody>
                {snapshot.holdings.map((h, idx) => (
                  <HoldingRow
                    key={h.id}
                    holding={h}
                    index={idx}
                    snapshotId={snapshot.id}
                    editable={editable}
                    onSaved={handleHoldingUpdated}
                  />
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={editable ? 4 : 4} style={{ ...totalRowStyle, textAlign: 'left' }}>
                    합계
                  </td>
                  <td style={totalRowStyle}>{fmt(snapshot.total_purchase)}</td>
                  <td style={totalRowStyle}>{fmt(snapshot.total_evaluation)}</td>
                  <td
                    style={{
                      ...totalRowStyle,
                      color: returnRateColor(snapshot.total_return),
                    }}
                  >
                    {snapshot.total_return != null
                      ? `${snapshot.total_return > 0 ? '+' : ''}${fmt(snapshot.total_return)}`
                      : '-'}
                  </td>
                  <td
                    style={{
                      ...totalRowStyle,
                      color: returnRateColor(snapshot.total_return_rate),
                    }}
                  >
                    {snapshot.total_return_rate != null
                      ? `${snapshot.total_return_rate > 0 ? '+' : ''}${snapshot.total_return_rate.toFixed(2)}%`
                      : '-'}
                  </td>
                  <td style={totalRowStyle}>100%</td>
                  {editable && <td style={totalRowStyle} />}
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

export default SnapshotDataTable;
