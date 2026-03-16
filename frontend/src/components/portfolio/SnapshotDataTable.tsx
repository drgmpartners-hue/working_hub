'use client';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

interface Holding {
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

interface Snapshot {
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

/* ------------------------------------------------------------------ */
/*  Loading skeleton                                                    */
/* ------------------------------------------------------------------ */

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
/*  Main component                                                      */
/* ------------------------------------------------------------------ */

export function SnapshotDataTable({
  clientName,
  accountType,
  snapshot,
  isLoading,
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

  const tdStyle: React.CSSProperties = {
    padding: '10px 12px',
    fontSize: '0.8125rem',
    color: '#374151',
    textAlign: 'right',
    borderBottom: '1px solid #F3F4F6',
    whiteSpace: 'nowrap',
  };

  const tdLeftStyle: React.CSSProperties = {
    ...tdStyle,
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
        <span
          style={{
            fontSize: '0.9375rem',
            fontWeight: 700,
            color: '#1A1A2E',
          }}
        >
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
                  <th style={thStyle}>위험도</th>
                  <th style={thStyle}>매입금액</th>
                  <th style={thStyle}>평가금액</th>
                  <th style={thStyle}>평가손익</th>
                  <th style={thStyle}>수익률</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.holdings.map((h, idx) => (
                  <tr
                    key={h.id}
                    style={{
                      transition: 'background-color 0.1s ease',
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLTableRowElement).style.backgroundColor = '#F9FAFB';
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLTableRowElement).style.backgroundColor = 'transparent';
                    }}
                  >
                    <td style={{ ...tdStyle, textAlign: 'center', color: '#9CA3AF' }}>
                      {h.seq ?? idx + 1}
                    </td>
                    <td style={tdLeftStyle}>
                      <div style={{ fontWeight: 500, color: '#1A1A2E' }}>{h.product_name}</div>
                      {h.product_type && (
                        <div style={{ fontSize: '0.6875rem', color: '#9CA3AF', marginTop: 1 }}>
                          {h.product_type}
                          {h.region ? ` · ${h.region}` : ''}
                        </div>
                      )}
                    </td>
                    <td style={tdStyle}>
                      {h.risk_level ? (
                        <span
                          style={{
                            fontSize: '0.6875rem',
                            fontWeight: 600,
                            padding: '2px 6px',
                            borderRadius: 4,
                            backgroundColor:
                              h.risk_level.includes('고') || h.risk_level.includes('매우')
                                ? '#FEF2F2'
                                : h.risk_level.includes('중')
                                ? '#FFFBEB'
                                : '#ECFDF5',
                            color:
                              h.risk_level.includes('고') || h.risk_level.includes('매우')
                                ? '#DC2626'
                                : h.risk_level.includes('중')
                                ? '#D97706'
                                : '#059669',
                          }}
                        >
                          {h.risk_level}
                        </span>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td style={tdStyle}>{fmt(h.purchase_amount)}</td>
                    <td style={{ ...tdStyle, fontWeight: 500 }}>{fmt(h.evaluation_amount)}</td>
                    <td
                      style={{
                        ...tdStyle,
                        color: returnRateColor(h.return_amount),
                        fontWeight: h.return_amount != null && h.return_amount !== 0 ? 500 : undefined,
                      }}
                    >
                      {h.return_amount != null
                        ? `${h.return_amount > 0 ? '+' : ''}${fmt(h.return_amount)}`
                        : '-'}
                    </td>
                    <td
                      style={{
                        ...tdStyle,
                        color: returnRateColor(h.return_rate),
                        fontWeight: 600,
                      }}
                    >
                      {h.return_rate != null
                        ? `${h.return_rate > 0 ? '+' : ''}${h.return_rate.toFixed(2)}%`
                        : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3} style={{ ...totalRowStyle, textAlign: 'left' }}>
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
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

export default SnapshotDataTable;
