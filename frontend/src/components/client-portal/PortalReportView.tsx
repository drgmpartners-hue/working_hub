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
  risk_level: string;
  region: string;
  purchase_amount: number;
  current_amount: number;
  profit_loss: number;
  return_rate: number;
}

interface ReportData {
  account_id: string;
  account_type: string;
  account_number: string;
  snapshot_date: string;
  monthly_payment: number;
  deposit: number;
  principal: number;
  current_value: number;
  profit_loss: number;
  total_return_rate: number;
  holdings: HoldingItem[];
  region_distribution: DistributionItem[];
  risk_distribution: DistributionItem[];
  ai_comment: string | null;
  is_latest: boolean;
}

interface DrGmItem {
  id: string;
  product_name: string;
  product_code: string | null;
  product_type: string | null;
  region: string | null;
  current_price: number | null;
  weight_pension: number | null;
  weight_irp: number | null;
  memo: string | null;
  seq: number;
}

interface PortalReportViewProps {
  token: string;
  portalJwt: string;
  snapshots: AccountSnapshot[];
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

const fmt = (n: number) =>
  n.toLocaleString('ko-KR');

function ReturnBadge({ rate }: { rate: number }) {
  const positive = rate >= 0;
  return (
    <span
      style={{
        fontSize: 13,
        fontWeight: 700,
        color: positive ? '#059669' : '#DC2626',
      }}
    >
      {positive ? '+' : ''}{rate.toFixed(2)}%
    </span>
  );
}

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  IRP: 'IRP',
  연금저축: '연금저축',
  연금저축_거치: '연금저축 거치',
};

/* ------------------------------------------------------------------ */
/*  Main component                                                      */
/* ------------------------------------------------------------------ */

export function PortalReportView({ token, portalJwt, snapshots }: PortalReportViewProps) {
  const [selectedAccountId, setSelectedAccountId] = useState<string>(
    snapshots[0]?.account_id ?? ''
  );
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [report, setReport] = useState<ReportData | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState('');

  // 차트용 상태
  const [activePeriod, setActivePeriod] = useState<PeriodKey>('3m');
  const [historyData, setHistoryData] = useState<HistoryPoint[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Dr.GM 추천 포트폴리오
  const [drGmItems, setDrGmItems] = useState<DrGmItem[]>([]);
  const [drGmLoaded, setDrGmLoaded] = useState(false);

  // 계좌 선택 시 첫 날짜 자동 선택
  const currentAccount = snapshots.find((s) => s.account_id === selectedAccountId);
  const availableDates = currentAccount?.dates ?? [];

  useEffect(() => {
    if (availableDates.length > 0) {
      setSelectedDate(availableDates[0]);
    } else {
      setSelectedDate('');
      setReport(null);
    }
  }, [selectedAccountId]);

  // 날짜 선택 시 보고서 로드
  useEffect(() => {
    if (!selectedAccountId || !selectedDate) return;

    const fetchReport = async () => {
      setReportLoading(true);
      setReportError('');
      try {
        const params = new URLSearchParams({
          account_id: selectedAccountId,
          date: selectedDate,
        });
        const res = await fetch(
          `${API_URL}/api/v1/client-portal/${token}/report?${params}`,
          { headers: { Authorization: `Bearer ${portalJwt}` } }
        );
        if (res.ok) {
          const data = await res.json();
          setReport(data);
        } else {
          setReportError('보고서를 불러오지 못했습니다.');
        }
      } catch {
        setReportError('네트워크 오류가 발생했습니다.');
      } finally {
        setReportLoading(false);
      }
    };

    fetchReport();
  }, [selectedAccountId, selectedDate, token, portalJwt]);

  // Dr.GM 추천 포트폴리오 로드 (1회)
  useEffect(() => {
    if (drGmLoaded) return;
    const fetchDrGm = async () => {
      try {
        const res = await fetch(
          `${API_URL}/api/v1/client-portal/${token}/recommended-portfolio`,
          { headers: { Authorization: `Bearer ${portalJwt}` } }
        );
        if (res.ok) {
          const data = await res.json();
          setDrGmItems(data);
        }
      } catch { /* silent */ }
      finally { setDrGmLoaded(true); }
    };
    fetchDrGm();
  }, [token, portalJwt, drGmLoaded]);

  // 기간별 이력 로드
  useEffect(() => {
    if (!selectedAccountId) return;

    const fetchHistory = async () => {
      setHistoryLoading(true);
      try {
        const params = new URLSearchParams({
          account_id: selectedAccountId,
          period: activePeriod,
        });
        const res = await fetch(
          `${API_URL}/api/v1/snapshots/history?${params}`,
          { headers: { Authorization: `Bearer ${portalJwt}` } }
        );
        if (res.ok) {
          const data = await res.json();
          setHistoryData(data.history ?? data ?? []);
        }
      } catch {
        // 이력 로드 실패는 조용히 처리
      } finally {
        setHistoryLoading(false);
      }
    };

    fetchHistory();
  }, [selectedAccountId, activePeriod, portalJwt]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* 계좌 선택 탭 */}
      <div
        style={{
          backgroundColor: '#fff',
          borderRadius: 14,
          padding: 4,
          display: 'flex',
          gap: 4,
          border: '1px solid #E5E7EB',
        }}
      >
        {snapshots.map((s) => (
          <button
            key={s.account_id}
            onClick={() => setSelectedAccountId(s.account_id)}
            style={{
              flex: 1,
              padding: '10px 8px',
              fontSize: 14,
              fontWeight: selectedAccountId === s.account_id ? 700 : 500,
              color: selectedAccountId === s.account_id ? '#fff' : '#6B7280',
              backgroundColor: selectedAccountId === s.account_id ? '#1E3A5F' : 'transparent',
              border: 'none',
              borderRadius: 10,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              whiteSpace: 'nowrap',
            }}
          >
            {ACCOUNT_TYPE_LABELS[s.account_type] ?? s.account_type}
          </button>
        ))}
      </div>

      {/* 날짜 선택 */}
      {availableDates.length > 0 ? (
        <div>
          <p style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 10 }}>
            조회 날짜 선택
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {availableDates.map((d) => (
              <button
                key={d}
                onClick={() => setSelectedDate(d)}
                style={{
                  padding: '8px 14px',
                  fontSize: 13,
                  fontWeight: selectedDate === d ? 700 : 500,
                  color: selectedDate === d ? '#fff' : '#374151',
                  backgroundColor: selectedDate === d ? '#1E3A5F' : '#F9FAFB',
                  border: `1.5px solid ${selectedDate === d ? '#1E3A5F' : '#E5E7EB'}`,
                  borderRadius: 8,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                {d}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div
          style={{
            backgroundColor: '#F9FAFB',
            borderRadius: 12,
            padding: 24,
            textAlign: 'center',
            color: '#9CA3AF',
            fontSize: 14,
            border: '1px solid #E5E7EB',
          }}
        >
          해당 계좌의 스냅샷이 없습니다.
        </div>
      )}

      {/* 보고서 로딩 */}
      {reportLoading && (
        <div
          style={{
            backgroundColor: '#F9FAFB',
            borderRadius: 12,
            padding: 32,
            textAlign: 'center',
            color: '#9CA3AF',
            fontSize: 14,
          }}
        >
          보고서 로딩 중...
        </div>
      )}

      {/* 보고서 에러 */}
      {reportError && !reportLoading && (
        <div
          style={{
            backgroundColor: '#FEF2F2',
            borderRadius: 12,
            padding: 16,
            textAlign: 'center',
            color: '#DC2626',
            fontSize: 14,
            border: '1px solid #FECACA',
          }}
        >
          {reportError}
        </div>
      )}

      {/* 보고서 내용 */}
      {report && !reportLoading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* 계좌 개요 카드 */}
          <div
            style={{
              background: 'linear-gradient(135deg, #1E3A5F 0%, #2D5A9B 100%)',
              borderRadius: 16,
              padding: 24,
              color: '#fff',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
              <div>
                <p style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>
                  {ACCOUNT_TYPE_LABELS[report.account_type] ?? report.account_type}
                </p>
                <p style={{ fontSize: 13, opacity: 0.8 }}>{report.account_number}</p>
              </div>
              <p style={{ fontSize: 12, opacity: 0.7 }}>{report.snapshot_date}</p>
            </div>

            <div style={{ marginBottom: 16 }}>
              <p style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>평가금액</p>
              <p style={{ fontSize: 28, fontWeight: 700, letterSpacing: -0.5 }}>
                {fmt(report.current_value)}
                <span style={{ fontSize: 14, fontWeight: 400, marginLeft: 4 }}>원</span>
              </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <div>
                <p style={{ fontSize: 11, opacity: 0.6, marginBottom: 4 }}>납입원금</p>
                <p style={{ fontSize: 14, fontWeight: 600 }}>{fmt(report.principal)}원</p>
              </div>
              <div>
                <p style={{ fontSize: 11, opacity: 0.6, marginBottom: 4 }}>평가손익</p>
                <p style={{ fontSize: 14, fontWeight: 600 }}>
                  {report.profit_loss >= 0 ? '+' : ''}{fmt(report.profit_loss)}원
                </p>
              </div>
              <div>
                <p style={{ fontSize: 11, opacity: 0.6, marginBottom: 4 }}>총수익률</p>
                <p
                  style={{
                    fontSize: 16,
                    fontWeight: 700,
                    color: report.total_return_rate >= 0 ? '#6EE7B7' : '#FCA5A5',
                  }}
                >
                  {report.total_return_rate >= 0 ? '+' : ''}{report.total_return_rate.toFixed(2)}%
                </p>
              </div>
            </div>
          </div>

          {/* 포트폴리오 분석 표 */}
          <div
            style={{
              backgroundColor: '#fff',
              borderRadius: 14,
              border: '1px solid #E5E7EB',
              overflow: 'hidden',
            }}
          >
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #F3F4F6' }}>
              <p style={{ fontSize: 15, fontWeight: 700, color: '#111827' }}>포트폴리오 분석</p>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ backgroundColor: '#F9FAFB' }}>
                    {['상품명', '위험도', '지역', '평가금액', '수익률'].map((h) => (
                      <th
                        key={h}
                        style={{
                          padding: '10px 12px',
                          textAlign: 'left',
                          fontSize: 12,
                          fontWeight: 600,
                          color: '#6B7280',
                          whiteSpace: 'nowrap',
                          borderBottom: '1px solid #E5E7EB',
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.holdings.map((h, i) => (
                    <tr
                      key={h.id}
                      style={{
                        borderBottom: i < report.holdings.length - 1 ? '1px solid #F3F4F6' : 'none',
                      }}
                    >
                      <td
                        style={{
                          padding: '12px 12px',
                          color: '#111827',
                          maxWidth: 160,
                          fontSize: 12,
                          lineHeight: 1.4,
                        }}
                      >
                        {h.product_name}
                      </td>
                      <td style={{ padding: '12px 12px', whiteSpace: 'nowrap' }}>
                        <span
                          style={{
                            fontSize: 11,
                            padding: '2px 6px',
                            borderRadius: 4,
                            backgroundColor: '#EFF6FF',
                            color: '#1D4ED8',
                            fontWeight: 600,
                          }}
                        >
                          {h.risk_level || '-'}
                        </span>
                      </td>
                      <td style={{ padding: '12px 12px', color: '#374151', whiteSpace: 'nowrap', fontSize: 12 }}>
                        {h.region || '-'}
                      </td>
                      <td style={{ padding: '12px 12px', color: '#111827', whiteSpace: 'nowrap', fontWeight: 600 }}>
                        {fmt(h.current_amount)}
                      </td>
                      <td style={{ padding: '12px 12px', whiteSpace: 'nowrap' }}>
                        <ReturnBadge rate={h.return_rate} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 차트 영역 */}
          <div
            style={{
              backgroundColor: '#fff',
              borderRadius: 14,
              padding: 20,
              border: '1px solid #E5E7EB',
            }}
          >
            <PortfolioCharts
              accountId={selectedAccountId}
              snapshotId={null}
              regionDistribution={report.region_distribution}
              riskDistribution={report.risk_distribution}
              historyData={historyData}
              historyLoading={historyLoading}
              activePeriod={activePeriod}
              onActivePeriodChange={setActivePeriod}
            />
          </div>

          {/* AI 코멘트 (최신 날짜에만 표시) */}
          {report.is_latest && report.ai_comment && (
            <div
              style={{
                backgroundColor: '#FFFBEB',
                border: '1px solid #FDE68A',
                borderRadius: 14,
                padding: 20,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <span style={{ fontSize: 18 }}>🤖</span>
                <p style={{ fontSize: 14, fontWeight: 700, color: '#92400E' }}>AI 분석 코멘트</p>
              </div>
              <p style={{ fontSize: 14, color: '#78350F', lineHeight: 1.7, margin: 0 }}>
                {report.ai_comment}
              </p>
            </div>
          )}

          {/* Dr.GM 추천 포트폴리오 */}
          {drGmItems.length > 0 && (
            <div
              style={{
                backgroundColor: '#fff',
                borderRadius: 14,
                border: '1px solid #FCD34D',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  background: 'linear-gradient(135deg, #F59E0B 0%, #D97706 100%)',
                  padding: '16px 20px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 16 }}>⭐</span>
                  <span style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>
                    Dr.GM 추천 포트폴리오
                  </span>
                </div>
                <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.8)', margin: '4px 0 0' }}>
                  현재 시장 상황에 맞는 추천 포트폴리오입니다.
                </p>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ backgroundColor: '#FFFBEB' }}>
                      {(() => {
                        const isIrp = currentAccount?.account_type === 'IRP' || currentAccount?.account_type === 'irp';
                        const weightLabel = isIrp ? '비중(IRP)' : '비중(연금저축)';
                        return ['No.', '상품유형', '상품명', weightLabel].map((h) => (
                          <th
                            key={h}
                            style={{
                              padding: '10px 12px',
                              textAlign: h === 'No.' ? 'center' : 'left',
                              fontSize: 12,
                              fontWeight: 600,
                              color: '#92400E',
                              whiteSpace: 'nowrap',
                              borderBottom: '1px solid #FDE68A',
                            }}
                          >
                            {h}
                          </th>
                        ));
                      })()}
                    </tr>
                  </thead>
                  <tbody>
                    {drGmItems.map((item, idx) => {
                      const isIrp = currentAccount?.account_type === 'IRP' || currentAccount?.account_type === 'irp';
                      const weight = isIrp ? item.weight_irp : item.weight_pension;
                      return (
                        <tr key={item.id} style={{ borderBottom: idx < drGmItems.length - 1 ? '1px solid #FEF3C7' : 'none' }}>
                          <td style={{ padding: '10px 12px', textAlign: 'center', color: '#9CA3AF', fontSize: 12 }}>{idx + 1}</td>
                          <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                            <span style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, backgroundColor: '#FEF3C7', color: '#92400E', fontWeight: 600 }}>
                              {item.product_type || '-'}
                            </span>
                          </td>
                          <td style={{ padding: '10px 12px', color: '#111827', fontSize: 12, lineHeight: 1.4 }}>
                            <div>{item.product_name}</div>
                            {item.region && <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>{item.region}</div>}
                          </td>
                          <td style={{ padding: '10px 12px', fontWeight: 700, color: '#92400E', whiteSpace: 'nowrap' }}>
                            {weight != null ? `${(weight * 100).toFixed(1)}%` : '-'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {/* 투자 책임 주의사항 */}
              <div style={{ padding: '12px 20px 16px', backgroundColor: '#FEF9EE' }}>
                <p style={{ fontSize: 11, color: '#9CA3AF', lineHeight: 1.6, margin: 0 }}>
                  ※ 본 추천 포트폴리오는 참고용 정보이며, 투자에 대한 최종 판단과 책임은 고객 본인에게 있습니다.
                  당사는 고객의 투자판단에 도움이 될 수 있도록 참고자료만을 제공해 드릴 뿐이며, 투자 결과에 대해 어떠한 책임도 지지 않습니다.
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default PortalReportView;
