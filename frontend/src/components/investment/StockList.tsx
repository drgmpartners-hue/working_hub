'use client';

import { useState, useEffect } from 'react';
import { authLib } from '@/lib/auth';
import { StockAnalysisPopup } from './StockAnalysisPopup';
import type { StockItem } from './StockAnalysisPopup';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

interface StockListProps {
  recommendationId: number;
}

export function StockList({ recommendationId }: StockListProps) {
  const [stocks, setStocks] = useState<StockItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedStock, setSelectedStock] = useState<StockItem | null>(null);
  const [popupOpen, setPopupOpen] = useState(false);

  useEffect(() => {
    if (!recommendationId) return;
    fetchStocks();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recommendationId]);

  async function fetchStocks() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_URL}/api/v1/stocks/recommendations/${recommendationId}/stocks`,
        { headers: { ...authLib.getAuthHeader() } }
      );
      if (!res.ok) throw new Error('추천 종목을 불러오는 데 실패했습니다.');
      const data = await res.json();
      setStocks(Array.isArray(data) ? data : data.stocks ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : '알 수 없는 오류');
    } finally {
      setLoading(false);
    }
  }

  function openPopup(stock: StockItem) {
    setSelectedStock(stock);
    setPopupOpen(true);
  }

  const ReturnCell = ({ value }: { value: number }) => (
    <span
      style={{
        fontFamily: 'monospace',
        fontSize: '0.8125rem',
        fontWeight: 600,
        color: value > 0 ? '#059669' : value < 0 ? '#DC2626' : '#6B7280',
      }}
    >
      {value > 0 ? '+' : ''}{value.toFixed(2)}%
    </span>
  );

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
      </div>
    );
  }

  if (stocks.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '48px 0', color: '#6B7280', fontSize: '0.875rem' }}>
        추천 종목이 없습니다.
      </div>
    );
  }

  return (
    <>
      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
        <p style={{ margin: 0, fontSize: '0.875rem', color: '#6B7280' }}>
          총 <strong style={{ color: '#1A1A2E' }}>{stocks.length}</strong>개 종목
        </p>
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            fontSize: '0.8125rem',
            color: '#D97706',
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="#D97706">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
          TOP 5 강조 표시
        </span>
        <span style={{ fontSize: '0.8125rem', color: '#6B7280', marginLeft: 'auto' }}>
          * 종목 클릭 시 상세 분석 보기
        </span>
      </div>

      <div style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid #E1E5EB' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
          <thead>
            <tr style={{ backgroundColor: '#F5F7FA' }}>
              {['순위', '종목명', '코드', '테마', '1개월', '3개월', '6개월', ''].map((h) => (
                <th
                  key={h}
                  style={{
                    padding: '10px 14px',
                    textAlign: h === '순위' || h === '' ? 'center' : 'left',
                    fontWeight: 600,
                    fontSize: '0.75rem',
                    color: '#6B7280',
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                    borderBottom: '1px solid #E1E5EB',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {stocks.map((stock) => (
              <tr
                key={stock.id}
                onClick={() => openPopup(stock)}
                style={{
                  borderBottom: '1px solid #E1E5EB',
                  cursor: 'pointer',
                  backgroundColor: stock.is_top5
                    ? 'rgba(217,119,6,0.03)'
                    : 'transparent',
                  transition: 'background-color 0.12s ease',
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLTableRowElement).style.backgroundColor = stock.is_top5
                    ? 'rgba(217,119,6,0.07)'
                    : 'rgba(74,144,217,0.04)';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLTableRowElement).style.backgroundColor = stock.is_top5
                    ? 'rgba(217,119,6,0.03)'
                    : 'transparent';
                }}
              >
                {/* rank */}
                <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                    {stock.is_top5 && (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="#D97706">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                      </svg>
                    )}
                    <span
                      style={{
                        fontWeight: stock.is_top5 ? 700 : 400,
                        color: stock.is_top5 ? '#D97706' : '#6B7280',
                      }}
                    >
                      {stock.rank}
                    </span>
                  </div>
                </td>

                {/* stock_name */}
                <td style={{ padding: '10px 14px' }}>
                  <span style={{ fontWeight: 600, color: '#1A1A2E' }}>{stock.stock_name}</span>
                </td>

                {/* stock_code */}
                <td style={{ padding: '10px 14px' }}>
                  <span
                    style={{
                      fontFamily: 'monospace',
                      fontSize: '0.8125rem',
                      color: '#6B7280',
                      backgroundColor: '#F5F7FA',
                      padding: '2px 6px',
                      borderRadius: 4,
                    }}
                  >
                    {stock.stock_code}
                  </span>
                </td>

                {/* theme */}
                <td style={{ padding: '10px 14px' }}>
                  <span
                    style={{
                      padding: '2px 8px',
                      borderRadius: 4,
                      fontSize: '0.75rem',
                      backgroundColor: '#EBF5F5',
                      color: '#2E8B8B',
                      fontWeight: 500,
                    }}
                  >
                    {stock.theme}
                  </span>
                </td>

                {/* returns */}
                <td style={{ padding: '10px 14px' }}><ReturnCell value={stock.return_1m} /></td>
                <td style={{ padding: '10px 14px' }}><ReturnCell value={stock.return_3m} /></td>
                <td style={{ padding: '10px 14px' }}><ReturnCell value={stock.return_6m} /></td>

                {/* detail arrow */}
                <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2" strokeLinecap="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <StockAnalysisPopup
        stock={selectedStock}
        open={popupOpen}
        onClose={() => {
          setPopupOpen(false);
          setSelectedStock(null);
        }}
      />
    </>
  );
}

export default StockList;
