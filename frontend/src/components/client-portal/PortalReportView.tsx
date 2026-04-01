'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import type { DistributionItem, HistoryPoint, PeriodKey } from '@/components/portfolio/PortfolioCharts';
import { API_URL } from '@/lib/api-url';

const PortfolioCharts = dynamic(
  () => import('@/components/portfolio/PortfolioCharts').then((m) => m.PortfolioCharts),
  { ssr: false }
);

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

interface AccountSnapshot {
  account_id: string;
  account_type: string;
  account_number: string;
  dates: string[];
}

interface HoldingItem {
  id: string;
  product_name: string;
  risk_level: string | null;
  region: string | null;
  purchase_amount: number | null;
  evaluation_amount: number | null;
  return_amount: number | null;
  return_rate: number | null;
  weight: number | null;
  seq: number | null;
}

interface ReportData {
  snapshot_id: string;
  account_id: string;
  account_type: string;
  account_number?: string;
  snapshot_date: string;
  deposit_amount: number | null;
  total_purchase: number;
  total_evaluation: number;
  total_return: number | null;
  total_return_rate: number | null;
  holdings: HoldingItem[];
  region_distribution?: DistributionItem[];
  risk_distribution?: DistributionItem[];
  ai_comment: string | null;
  is_latest: boolean;
}

interface PortalReportViewProps {
  token: string;
  portalJwt: string;
  snapshots: AccountSnapshot[];
  onAccountChange?: (accountId: string) => void;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

const fmt = (n: number) => n.toLocaleString('ko-KR');

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  IRP: 'IRP',
  irp: 'IRP',
  연금저축: '연금저축',
  연금저축_거치: '연금저축 거치',
};

function computeDistribution(holdings: HoldingItem[], key: 'region' | 'risk_level'): DistributionItem[] {
  const totalEval = holdings.reduce((s, h) => s + (h.evaluation_amount ?? 0), 0);
  if (totalEval === 0) return [];
  const map: Record<string, number> = {};
  for (const h of holdings) {
    const label = (key === 'region' ? h.region : h.risk_level) || '미분류';
    map[label] = (map[label] ?? 0) + (h.evaluation_amount ?? 0);
  }
  return Object.entries(map).map(([name, value]) => ({
    name,
    value: Math.round((value / totalEval) * 10000) / 100,
  }));
}

/* ------------------------------------------------------------------ */
/*  Main component                                                      */
/* ------------------------------------------------------------------ */

export function PortalReportView({ token, portalJwt, snapshots, onAccountChange }: PortalReportViewProps) {
  const [selectedAccountId, setSelectedAccountId] = useState<string>(snapshots[0]?.account_id ?? '');
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [report, setReport] = useState<ReportData | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState('');
  const [activePeriod, setActivePeriod] = useState<PeriodKey>('3m');
  const [historyData, setHistoryData] = useState<HistoryPoint[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const currentAccount = snapshots.find((s) => s.account_id === selectedAccountId);
  const availableDates = currentAccount?.dates ?? [];

  useEffect(() => {
    if (availableDates.length > 0) setSelectedDate(availableDates[0]);
    else { setSelectedDate(''); setReport(null); }
  }, [selectedAccountId]);

  // Notify parent when selected account changes
  useEffect(() => {
    if (selectedAccountId) onAccountChange?.(selectedAccountId);
  }, [selectedAccountId]);

  useEffect(() => {
    if (!selectedAccountId || !selectedDate) return;
    const fetchReport = async () => {
      setReportLoading(true);
      setReportError('');
      try {
        const res = await fetch(
          `${API_URL}/api/v1/client-portal/${token}/report?account_id=${selectedAccountId}&date=${selectedDate}`,
          { headers: { Authorization: `Bearer ${portalJwt}` } }
        );
        if (res.ok) setReport(await res.json());
        else setReportError('');
      } catch { setReportError(''); }
      finally { setReportLoading(false); }
    };
    fetchReport();
  }, [selectedAccountId, selectedDate, token, portalJwt]);

  useEffect(() => {
    if (!selectedAccountId) return;
    const fetchHistory = async () => {
      setHistoryLoading(true);
      try {
        const res = await fetch(
          `${API_URL}/api/v1/client-portal/${token}/history?account_id=${selectedAccountId}&period=${activePeriod}`,
          { headers: { Authorization: `Bearer ${portalJwt}` } }
        );
        if (res.ok) {
          const data = await res.json();
          const items = (data.history ?? []).map((h: Record<string, unknown>) => ({
            date: h.snapshot_date ?? h.date ?? '',
            return_rate: h.total_return_rate ?? h.return_rate ?? null,
          }));
          setHistoryData(items);
        }
      } catch { /* silent */ }
      finally { setHistoryLoading(false); }
    };
    fetchHistory();
  }, [selectedAccountId, activePeriod, portalJwt, token]);

  const sortedHoldings = report ? [...report.holdings].sort((a, b) => (a.seq ?? 999) - (b.seq ?? 999)) : [];
  const regionDist = report?.region_distribution?.length ? report.region_distribution : computeDistribution(sortedHoldings, 'region');
  const riskDist = report?.risk_distribution?.length ? report.risk_distribution : computeDistribution(sortedHoldings, 'risk_level');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* 계좌 선택 탭 */}
      <div style={{ backgroundColor: '#fff', borderRadius: 14, padding: 4, display: 'flex', gap: 4, border: '1px solid #E5E7EB' }}>
        {snapshots.map((s) => (
          <button
            key={s.account_id}
            onClick={() => setSelectedAccountId(s.account_id)}
            style={{
              flex: 1, padding: '10px 8px', fontSize: 14,
              fontWeight: selectedAccountId === s.account_id ? 700 : 500,
              color: selectedAccountId === s.account_id ? '#fff' : '#6B7280',
              backgroundColor: selectedAccountId === s.account_id ? '#1E3A5F' : 'transparent',
              border: 'none', borderRadius: 10, cursor: 'pointer', whiteSpace: 'nowrap',
            }}
          >
            {ACCOUNT_TYPE_LABELS[s.account_type] ?? s.account_type}
          </button>
        ))}
      </div>

      {/* 날짜 드롭다운 */}
      {availableDates.length > 0 ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: '#374151', margin: 0, whiteSpace: 'nowrap' }}>조회 날짜</p>
          <select
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            style={{ flex: 1, padding: '10px 14px', fontSize: 14, fontWeight: 600, color: '#1E3A5F', backgroundColor: '#F9FAFB', border: '1.5px solid #E5E7EB', borderRadius: 10, cursor: 'pointer', outline: 'none' }}
          >
            {availableDates.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
      ) : (
        <div style={{ backgroundColor: '#F9FAFB', borderRadius: 12, padding: 24, textAlign: 'center', color: '#9CA3AF', fontSize: 14, border: '1px solid #E5E7EB' }}>
          해당 계좌의 스냅샷이 없습니다.
        </div>
      )}

      {reportLoading && (
        <div style={{ backgroundColor: '#F9FAFB', borderRadius: 12, padding: 32, textAlign: 'center', color: '#9CA3AF', fontSize: 14 }}>
          보고서 로딩 중...
        </div>
      )}

      {/* 보고서 내용 */}
      {report && !reportLoading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* 계좌 개요 카드 */}
          <div style={{ background: 'linear-gradient(135deg, #1E3A5F 0%, #2D5A9B 100%)', borderRadius: 16, padding: 24, color: '#fff' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
              <div>
                <p style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>{ACCOUNT_TYPE_LABELS[report.account_type] ?? report.account_type}</p>
                <p style={{ fontSize: 13, opacity: 0.8 }}>{report.account_number || currentAccount?.account_number || ''}</p>
              </div>
              <p style={{ fontSize: 12, opacity: 0.7 }}>{report.snapshot_date}</p>
            </div>
            <div style={{ marginBottom: 16 }}>
              <p style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>평가금액</p>
              <p style={{ fontSize: 28, fontWeight: 700, letterSpacing: -0.5 }}>
                {fmt(report.total_evaluation ?? 0)}<span style={{ fontSize: 14, fontWeight: 400, marginLeft: 4 }}>원</span>
              </p>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <div>
                <p style={{ fontSize: 11, opacity: 0.6, marginBottom: 4 }}>납입원금</p>
                <p style={{ fontSize: 14, fontWeight: 600 }}>{fmt(report.total_purchase ?? 0)}원</p>
              </div>
              <div>
                <p style={{ fontSize: 11, opacity: 0.6, marginBottom: 4 }}>평가손익</p>
                <p style={{ fontSize: 14, fontWeight: 600 }}>{(report.total_return ?? 0) >= 0 ? '+' : ''}{fmt(report.total_return ?? 0)}원</p>
              </div>
              <div>
                <p style={{ fontSize: 11, opacity: 0.6, marginBottom: 4 }}>총수익률</p>
                <p style={{ fontSize: 16, fontWeight: 700, color: (report.total_return_rate ?? 0) >= 0 ? '#6EE7B7' : '#FCA5A5' }}>
                  {(report.total_return_rate ?? 0) >= 0 ? '+' : ''}{(report.total_return_rate ?? 0).toFixed(2)}%
                </p>
              </div>
            </div>
          </div>

          {/* 포트폴리오 분석 표 - 상품명 고정 + 오른쪽 스크롤 */}
          <div style={{ backgroundColor: '#fff', borderRadius: 14, border: '1px solid #E5E7EB', overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #F3F4F6' }}>
              <p style={{ fontSize: 15, fontWeight: 700, color: '#111827' }}>포트폴리오 분석</p>
            </div>
            <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
              <table style={{ width: '100%', minWidth: 480, borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ backgroundColor: '#F9FAFB' }}>
                    {['상품명', '매입금액', '평가금액', '평가손익', '수익률'].map((h, i) => (
                      <th key={h} style={{
                        padding: '10px 12px', textAlign: i === 0 ? 'left' : 'right', fontSize: 12,
                        fontWeight: 600, color: '#6B7280', whiteSpace: 'nowrap', borderBottom: '1px solid #E5E7EB',
                        ...(i === 0 ? { position: 'sticky' as const, left: 0, backgroundColor: '#F9FAFB', zIndex: 1, minWidth: 120 } : {}),
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedHoldings.map((h, i) => {
                    const returnAmt = h.return_amount ?? ((h.evaluation_amount ?? 0) - (h.purchase_amount ?? 0));
                    // Calculate return_rate if null
                    const rr = h.return_rate ?? ((h.purchase_amount && h.purchase_amount > 0) ? ((h.evaluation_amount ?? 0) - h.purchase_amount) / h.purchase_amount * 100 : 0);
                    return (
                      <tr key={h.id} style={{ borderBottom: i < sortedHoldings.length - 1 ? '1px solid #F3F4F6' : 'none' }}>
                        <td style={{ padding: '10px 12px', color: '#111827', fontSize: 12, lineHeight: 1.4, position: 'sticky', left: 0, backgroundColor: '#fff', zIndex: 1, minWidth: 120 }}>
                          {h.product_name}
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', color: '#374151', whiteSpace: 'nowrap' }}>{fmt(h.purchase_amount ?? 0)}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', color: '#111827', fontWeight: 600, whiteSpace: 'nowrap' }}>{fmt(h.evaluation_amount ?? 0)}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', whiteSpace: 'nowrap', color: returnAmt >= 0 ? '#059669' : '#DC2626', fontWeight: 600 }}>
                          {returnAmt >= 0 ? '+' : ''}{fmt(returnAmt)}
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 700, color: rr >= 0 ? '#059669' : '#DC2626' }}>
                          {rr >= 0 ? '+' : ''}{rr.toFixed(2)}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* 차트 영역 */}
          <div style={{ backgroundColor: '#fff', borderRadius: 14, padding: 20, border: '1px solid #E5E7EB' }}>
            <PortfolioCharts
              accountId={selectedAccountId}
              snapshotId={report.snapshot_id}
              regionDistribution={regionDist}
              riskDistribution={riskDist}
              historyData={historyData}
              historyLoading={historyLoading}
              activePeriod={activePeriod}
              onActivePeriodChange={setActivePeriod}
            />
          </div>

          {/* AI 코멘트 */}
          {report.ai_comment && (
            <div style={{ backgroundColor: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 14, padding: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <span style={{ fontSize: 18 }}>🤖</span>
                <p style={{ fontSize: 14, fontWeight: 700, color: '#92400E' }}>AI 분석 코멘트</p>
              </div>
              {/<[a-z][\s\S]*>/i.test(report.ai_comment!) ? (
                <div style={{ fontSize: 14, color: '#78350F', lineHeight: 1.7 }} dangerouslySetInnerHTML={{ __html: report.ai_comment! }} />
              ) : (
                <p style={{ fontSize: 14, color: '#78350F', lineHeight: 1.7, margin: 0, whiteSpace: 'pre-wrap' }}>{report.ai_comment}</p>
              )}
            </div>
          )}

          <div style={{ padding: '8px 4px' }}>
            <p style={{ fontSize: 11, color: '#9CA3AF', lineHeight: 1.6, margin: 0 }}>
              ※ 본 자료는 참고용 정보이며, 투자에 대한 최종 판단과 책임은 고객 본인에게 있습니다.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default PortalReportView;
