'use client';

import { forwardRef, useState, useMemo } from 'react';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
} from 'recharts';

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

interface ReportData {
  snapshot: {
    id: string;
    snapshot_date: string;
    deposit_amount?: number;
    total_purchase?: number;
    total_evaluation?: number;
    total_return?: number;
    total_return_rate?: number;
  };
  account: {
    id: string;
    account_type: string;
    account_number?: string;
    securities_company?: string;
    monthly_payment?: number;
  };
  holdings: Holding[];
  history: { date: string; return_rate?: number }[];
}

/* ------------------------------------------------------------------ */
/*  Props                                                               */
/* ------------------------------------------------------------------ */

interface ReportViewProps {
  reportData: ReportData | null;
  clientName: string;
  modifiedWeights: Record<string, number>;
  onWeightChange: (holdingId: string, value: number) => void;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                           */
/* ------------------------------------------------------------------ */

const COLORS = [
  '#1E3A5F',
  '#3B82F6',
  '#10B981',
  '#F59E0B',
  '#EF4444',
  '#8B5CF6',
  '#EC4899',
  '#14B8A6',
];

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

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginBottom: 12,
        marginTop: 4,
      }}
    >
      <span
        style={{
          width: 4,
          height: 18,
          backgroundColor: '#1E3A5F',
          borderRadius: 2,
          display: 'inline-block',
          flexShrink: 0,
        }}
      />
      <span style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#1A1A2E' }}>
        {children}
      </span>
    </div>
  );
}

function SubTitle({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        marginBottom: 10,
        marginTop: 8,
      }}
    >
      <span style={{ color: '#1E3A5F', fontWeight: 700 }}>●</span>
      <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#374151' }}>
        {children}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  ReportView (forwardRef for html2canvas)                             */
/* ------------------------------------------------------------------ */

const ReportView = forwardRef<HTMLDivElement, ReportViewProps>(
  ({ reportData, clientName, modifiedWeights, onWeightChange }, ref) => {
    const [historyRange, setHistoryRange] = useState<'6m' | '1y'>('6m');

    /* ---------- computed data ---------- */

    const holdings = reportData?.holdings ?? [];
    const snap = reportData?.snapshot ?? null;
    const account = reportData?.account ?? null;
    const totalEval = snap?.total_evaluation ?? 0;

    // 지역분산 pie data
    const regionData = useMemo(() => {
      const map: Record<string, number> = {};
      holdings.forEach((h) => {
        const key = h.region || '기타';
        map[key] = (map[key] ?? 0) + (h.evaluation_amount ?? 0);
      });
      return Object.entries(map)
        .filter(([, v]) => v > 0)
        .map(([name, value]) => ({ name, value }));
    }, [holdings]);

    // 위험도분산 pie data
    const riskData = useMemo(() => {
      const map: Record<string, number> = {};
      holdings.forEach((h) => {
        const key = h.risk_level || '등급미상';
        map[key] = (map[key] ?? 0) + (h.evaluation_amount ?? 0);
      });
      return Object.entries(map)
        .filter(([, v]) => v > 0)
        .map(([name, value]) => ({ name, value }));
    }, [holdings]);

    // history filter
    const historyData = useMemo(() => {
      if (!reportData?.history) return [];
      const all = [...reportData.history].sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
      );
      if (historyRange === '6m') {
        const cutoff = new Date();
        cutoff.setMonth(cutoff.getMonth() - 6);
        return all.filter((d) => new Date(d.date) >= cutoff);
      }
      const cutoff = new Date();
      cutoff.setFullYear(cutoff.getFullYear() - 1);
      return all.filter((d) => new Date(d.date) >= cutoff);
    }, [reportData, historyRange]);

    /* ---------- styles ---------- */

    const thStyle: React.CSSProperties = {
      padding: '8px 10px',
      fontSize: '0.75rem',
      fontWeight: 600,
      color: '#6B7280',
      textAlign: 'right',
      backgroundColor: '#F5F7FA',
      borderBottom: '1px solid #E1E5EB',
      whiteSpace: 'nowrap',
    };
    const thLeftStyle: React.CSSProperties = { ...thStyle, textAlign: 'left' };
    const tdStyle: React.CSSProperties = {
      padding: '8px 10px',
      fontSize: '0.8125rem',
      color: '#374151',
      textAlign: 'right',
      borderBottom: '1px solid #F3F4F6',
      whiteSpace: 'nowrap',
    };
    const tdLeftStyle: React.CSSProperties = { ...tdStyle, textAlign: 'left' };
    const totalRowStyle: React.CSSProperties = {
      ...tdStyle,
      fontWeight: 700,
      color: '#1A1A2E',
      backgroundColor: '#F5F7FA',
    };

    /* ---------- empty state ---------- */

    if (!reportData) {
      return (
        <div
          style={{
            padding: '60px 20px',
            textAlign: 'center',
            color: '#9CA3AF',
            fontSize: '0.875rem',
            border: '1px solid #E1E5EB',
            borderRadius: 12,
            backgroundColor: '#FFFFFF',
          }}
        >
          <svg
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#D1D5DB"
            strokeWidth="1"
            style={{ margin: '0 auto 16px', display: 'block' }}
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="9" y1="12" x2="15" y2="12" />
            <line x1="9" y1="16" x2="15" y2="16" />
          </svg>
          <p style={{ margin: 0, fontWeight: 600 }}>보고서를 생성하세요</p>
          <p style={{ margin: '6px 0 0', fontSize: '0.8125rem' }}>
            계좌와 날짜를 선택하고 "보고서 생성" 버튼을 클릭하세요.
          </p>
        </div>
      );
    }

    /* ---------- null guard ---------- */

    if (!snap || !account) {
      return (
        <div style={{ padding: '40px 20px', textAlign: 'center', color: '#9CA3AF', fontSize: '0.875rem' }}>
          보고서 데이터가 올바르지 않습니다.
        </div>
      );
    }

    /* ---------- render ---------- */

    return (
      <div
        ref={ref}
        style={{
          backgroundColor: '#FFFFFF',
          padding: '32px',
          fontFamily:
            "'Pretendard', 'Noto Sans KR', -apple-system, BlinkMacSystemFont, sans-serif",
          maxWidth: '860px',
          margin: '0 auto',
          border: '1px solid #E1E5EB',
          borderRadius: 12,
        }}
      >
        {/* ===== 1. 헤더 ===== */}
        <div
          style={{
            borderBottom: '3px solid #1E3A5F',
            paddingBottom: 16,
            marginBottom: 24,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <div>
              <div style={{ fontSize: '0.75rem', color: '#6B7280', marginBottom: 4, fontWeight: 500 }}>
                {account?.securities_company || '증권사'}
              </div>
              <h1
                style={{
                  margin: 0,
                  fontSize: '1.375rem',
                  fontWeight: 800,
                  color: '#1E3A5F',
                  letterSpacing: '-0.5px',
                }}
              >
                세액공제 투자상품 종합보고서
              </h1>
              <div style={{ marginTop: 4, fontSize: '0.8125rem', color: '#6B7280' }}>
                고객명: <strong style={{ color: '#1A1A2E' }}>{clientName}</strong>
                &nbsp;·&nbsp;{accountTypeLabel(account?.account_type ?? '')}
              </div>
            </div>
            <div style={{ fontSize: '0.8125rem', color: '#9CA3AF', textAlign: 'right' }}>
              <div>작성일: {new Date().toLocaleDateString('ko-KR')}</div>
              <div>조회일: {snap.snapshot_date}</div>
            </div>
          </div>
        </div>

        {/* ===== 2. 개요 ===== */}
        <div style={{ marginBottom: 28 }}>
          <SectionTitle>개요</SectionTitle>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
              <thead>
                <tr>
                  {['구분', '조회일', '계좌번호', '월납입액', '예수금', '납입원금', '평가금액', '수익금액', '누적수익률'].map(
                    (h) => (
                      <th key={h} style={thLeftStyle}>
                        {h}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={tdLeftStyle}>{accountTypeLabel(account?.account_type ?? '')}</td>
                  <td style={tdLeftStyle}>{snap.snapshot_date}</td>
                  <td style={tdLeftStyle}>{account?.account_number || '-'}</td>
                  <td style={tdLeftStyle}>
                    {account?.monthly_payment ? `${fmt(account.monthly_payment)}원` : '-'}
                  </td>
                  <td style={tdLeftStyle}>{fmt(snap.deposit_amount)}</td>
                  <td style={tdLeftStyle}>{fmt(snap.total_purchase)}</td>
                  <td style={{ ...tdLeftStyle, fontWeight: 600 }}>{fmt(snap.total_evaluation)}</td>
                  <td
                    style={{
                      ...tdLeftStyle,
                      color: returnRateColor(snap.total_return),
                      fontWeight: 600,
                    }}
                  >
                    {snap.total_return != null
                      ? `${snap.total_return > 0 ? '+' : ''}${fmt(snap.total_return)}`
                      : '-'}
                  </td>
                  <td
                    style={{
                      ...tdLeftStyle,
                      color: returnRateColor(snap.total_return_rate),
                      fontWeight: 700,
                    }}
                  >
                    {snap.total_return_rate != null
                      ? `${snap.total_return_rate > 0 ? '+' : ''}${snap.total_return_rate.toFixed(2)}%`
                      : '-'}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* ===== 3. 포트폴리오 분석 ===== */}
        <div style={{ marginBottom: 28 }}>
          <SectionTitle>{accountTypeLabel(account?.account_type ?? '')} 포트폴리오 분석</SectionTitle>
          <SubTitle>포트폴리오 현황</SubTitle>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
              <thead>
                <tr>
                  <th style={{ ...thStyle, textAlign: 'center', width: 36 }}>NO</th>
                  <th style={thLeftStyle}>상품명</th>
                  <th style={thStyle}>위험도</th>
                  <th style={thStyle}>매입금액</th>
                  <th style={thStyle}>평가금액</th>
                  <th style={thStyle}>평가손익</th>
                  <th style={thStyle}>수익률</th>
                </tr>
              </thead>
              <tbody>
                {holdings.map((h, idx) => (
                  <tr key={h.id}>
                    <td style={{ ...tdStyle, textAlign: 'center', color: '#9CA3AF' }}>
                      {h.seq ?? idx + 1}
                    </td>
                    <td style={tdLeftStyle}>
                      <div style={{ fontWeight: 500 }}>{h.product_name}</div>
                      {h.product_type && (
                        <div style={{ fontSize: '0.6875rem', color: '#9CA3AF', marginTop: 1 }}>
                          {h.product_type}
                          {h.region ? ` · ${h.region}` : ''}
                        </div>
                      )}
                    </td>
                    <td style={tdStyle}>{h.risk_level ?? '-'}</td>
                    <td style={tdStyle}>{fmt(h.purchase_amount)}</td>
                    <td style={{ ...tdStyle, fontWeight: 500 }}>{fmt(h.evaluation_amount)}</td>
                    <td style={{ ...tdStyle, color: returnRateColor(h.return_amount) }}>
                      {h.return_amount != null
                        ? `${h.return_amount > 0 ? '+' : ''}${fmt(h.return_amount)}`
                        : '-'}
                    </td>
                    <td style={{ ...tdStyle, color: returnRateColor(h.return_rate), fontWeight: 600 }}>
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
                  <td style={totalRowStyle}>{fmt(snap.total_purchase)}</td>
                  <td style={totalRowStyle}>{fmt(snap.total_evaluation)}</td>
                  <td style={{ ...totalRowStyle, color: returnRateColor(snap.total_return) }}>
                    {snap.total_return != null
                      ? `${snap.total_return > 0 ? '+' : ''}${fmt(snap.total_return)}`
                      : '-'}
                  </td>
                  <td style={{ ...totalRowStyle, color: returnRateColor(snap.total_return_rate) }}>
                    {snap.total_return_rate != null
                      ? `${snap.total_return_rate > 0 ? '+' : ''}${snap.total_return_rate.toFixed(2)}%`
                      : '-'}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* ===== 4. 차트 (지역분산 + 위험도 분산) ===== */}
        {(regionData.length > 0 || riskData.length > 0) && (
          <div style={{ marginBottom: 28 }}>
            <SubTitle>분산 분석</SubTitle>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
              {/* 지역분산 */}
              {regionData.length > 0 && (
                <div>
                  <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#374151', marginBottom: 8, textAlign: 'center' }}>
                    지역 분산
                  </div>
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie
                        data={regionData}
                        cx="50%"
                        cy="50%"
                        outerRadius={75}
                        dataKey="value"
                        label={({ percent }: { percent?: number }) => percent != null ? `${(percent * 100).toFixed(1)}%` : ''}
                        labelLine={false}
                      >
                        {regionData.map((_, i) => (
                          <Cell key={i} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(v: unknown) => [`${typeof v === 'number' ? v.toLocaleString('ko-KR') : v}원`, '평가금액']}
                      />
                      <Legend iconSize={10} iconType="circle" wrapperStyle={{ fontSize: '0.75rem' }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* 위험도 분산 */}
              {riskData.length > 0 && (
                <div>
                  <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#374151', marginBottom: 8, textAlign: 'center' }}>
                    위험도 분산
                  </div>
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie
                        data={riskData}
                        cx="50%"
                        cy="50%"
                        outerRadius={75}
                        dataKey="value"
                        label={({ percent }: { percent?: number }) => percent != null ? `${(percent * 100).toFixed(1)}%` : ''}
                        labelLine={false}
                      >
                        {riskData.map((_, i) => (
                          <Cell key={i} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(v: unknown) => [`${typeof v === 'number' ? v.toLocaleString('ko-KR') : v}원`, '평가금액']}
                      />
                      <Legend iconSize={10} iconType="circle" wrapperStyle={{ fontSize: '0.75rem' }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ===== 5. 수익률 그래프 ===== */}
        {historyData.length > 0 && (
          <div style={{ marginBottom: 28 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <SubTitle>수익률 추이</SubTitle>
              <div style={{ display: 'flex', gap: 6 }}>
                {(['6m', '1y'] as const).map((r) => (
                  <button
                    key={r}
                    onClick={() => setHistoryRange(r)}
                    style={{
                      padding: '4px 12px',
                      borderRadius: 6,
                      border: `1px solid ${historyRange === r ? '#1E3A5F' : '#E1E5EB'}`,
                      backgroundColor: historyRange === r ? '#1E3A5F' : '#FFFFFF',
                      color: historyRange === r ? '#FFFFFF' : '#6B7280',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {r === '6m' ? '6개월' : '1년'}
                  </button>
                ))}
              </div>
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={historyData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10, fill: '#9CA3AF' }}
                  tickFormatter={(v: string) => v.slice(5)}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: '#9CA3AF' }}
                  tickFormatter={(v: number) => `${v}%`}
                  width={40}
                />
                <Tooltip
                  formatter={(v: unknown) => [`${typeof v === 'number' ? v.toFixed(2) : v}%`, '수익률']}
                  labelStyle={{ fontSize: '0.75rem' }}
                />
                <Line
                  type="monotone"
                  dataKey="return_rate"
                  stroke="#1E3A5F"
                  strokeWidth={2}
                  dot={{ r: 3, fill: '#1E3A5F' }}
                  activeDot={{ r: 5 }}
                  label={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* ===== 6. 포트폴리오 변경 ===== */}
        <div>
          <SubTitle>포트폴리오 변경 제안</SubTitle>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
              <thead>
                <tr>
                  <th style={{ ...thStyle, textAlign: 'center', width: 36 }}>NO</th>
                  <th style={thLeftStyle}>상품명</th>
                  <th style={thStyle}>상품코드</th>
                  <th style={thStyle}>기준가</th>
                  <th style={thStyle}>평가금액</th>
                  <th style={thStyle}>수익률</th>
                  <th style={thStyle}>현재비중</th>
                  <th style={{ ...thStyle, color: '#1E3A5F' }}>수정비중</th>
                  <th style={thStyle}>변경후금액</th>
                </tr>
              </thead>
              <tbody>
                {holdings.map((h, idx) => {
                  const modW = modifiedWeights[h.id];
                  const changedAmt =
                    modW != null && totalEval > 0
                      ? Math.round((totalEval * modW) / 100)
                      : null;
                  return (
                    <tr key={h.id}>
                      <td style={{ ...tdStyle, textAlign: 'center', color: '#9CA3AF' }}>
                        {h.seq ?? idx + 1}
                      </td>
                      <td style={tdLeftStyle}>{h.product_name}</td>
                      <td style={tdStyle}>{h.product_code ?? '-'}</td>
                      <td style={tdStyle}>{fmt(h.reference_price)}</td>
                      <td style={tdStyle}>{fmt(h.evaluation_amount)}</td>
                      <td style={{ ...tdStyle, color: returnRateColor(h.return_rate), fontWeight: 600 }}>
                        {h.return_rate != null
                          ? `${h.return_rate > 0 ? '+' : ''}${h.return_rate.toFixed(2)}%`
                          : '-'}
                      </td>
                      <td style={tdStyle}>
                        {h.weight != null ? `${h.weight.toFixed(1)}%` : '-'}
                      </td>
                      <td style={tdStyle}>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={0.1}
                          placeholder="-"
                          value={modW ?? ''}
                          onChange={(e) => {
                            const v = parseFloat(e.target.value);
                            onWeightChange(h.id, isNaN(v) ? 0 : v);
                          }}
                          style={{
                            width: 64,
                            padding: '4px 6px',
                            fontSize: '0.8125rem',
                            border: '1px solid #CBD5E1',
                            borderRadius: 6,
                            textAlign: 'right',
                            outline: 'none',
                            color: '#1E3A5F',
                            fontWeight: 600,
                          }}
                        />
                      </td>
                      <td style={{ ...tdStyle, fontWeight: changedAmt != null ? 600 : undefined }}>
                        {changedAmt != null ? `${fmt(changedAmt)}원` : '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={6} style={{ ...totalRowStyle, textAlign: 'left' }}>
                    합계
                  </td>
                  <td style={totalRowStyle}>
                    {/* 현재비중 합계 */}
                    {holdings.every((h) => h.weight != null)
                      ? `${holdings.reduce((s, h) => s + (h.weight ?? 0), 0).toFixed(1)}%`
                      : '-'}
                  </td>
                  <td style={totalRowStyle}>
                    {/* 수정비중 합계 */}
                    {Object.values(modifiedWeights).length > 0
                      ? `${Object.values(modifiedWeights).reduce((s, v) => s + v, 0).toFixed(1)}%`
                      : '-'}
                  </td>
                  <td style={totalRowStyle}>
                    {/* 변경후금액 합계 */}
                    {Object.keys(modifiedWeights).length > 0 && totalEval > 0
                      ? `${fmt(
                          Math.round(
                            Object.values(modifiedWeights).reduce((s, v) => s + (totalEval * v) / 100, 0)
                          )
                        )}원`
                      : '-'}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            marginTop: 28,
            paddingTop: 14,
            borderTop: '1px solid #E1E5EB',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: '0.6875rem',
            color: '#9CA3AF',
          }}
        >
          <span>본 보고서는 참고 자료이며 투자 결과에 대한 책임은 투자자 본인에게 있습니다.</span>
          <span>Working Hub Manager</span>
        </div>
      </div>
    );
  }
);

ReportView.displayName = 'ReportView';

export default ReportView;
