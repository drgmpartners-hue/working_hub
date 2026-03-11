'use client';

import { useState } from 'react';
import { Modal } from '@/components/common/Modal';
import { Button } from '@/components/common/Button';
import { authLib } from '@/lib/auth';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export interface StockItem {
  id: number;
  stock_name: string;
  stock_code: string;
  theme: string;
  rank: number;
  return_1m: number;
  return_3m: number;
  return_6m: number;
  is_top5: boolean;
  analysis_report?: string;
  market_cap?: number;
  sector?: string;
}

interface StockAnalysisPopupProps {
  stock: StockItem | null;
  open: boolean;
  onClose: () => void;
}

export function StockAnalysisPopup({ stock, open, onClose }: StockAnalysisPopupProps) {
  const [addingPortfolio, setAddingPortfolio] = useState(false);
  const [addingPool, setAddingPool] = useState(false);
  const [portfolioSuccess, setPortfolioSuccess] = useState(false);
  const [poolSuccess, setPoolSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addToPortfolio() {
    if (!stock) return;
    setAddingPortfolio(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/v1/portfolios`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authLib.getAuthHeader(),
        },
        body: JSON.stringify({
          stock_code: stock.stock_code,
          stock_name: stock.stock_name,
          source: 'stock_recommend',
        }),
      });
      if (!res.ok) throw new Error('포트폴리오 추가에 실패했습니다.');
      setPortfolioSuccess(true);
      setTimeout(() => setPortfolioSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : '오류가 발생했습니다.');
    } finally {
      setAddingPortfolio(false);
    }
  }

  async function addToPool() {
    if (!stock) return;
    setAddingPool(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/v1/stocks/pool`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authLib.getAuthHeader(),
        },
        body: JSON.stringify({
          stock_code: stock.stock_code,
          stock_name: stock.stock_name,
          theme: stock.theme,
        }),
      });
      if (!res.ok) throw new Error('회사풀 추가에 실패했습니다.');
      setPoolSuccess(true);
      setTimeout(() => setPoolSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : '오류가 발생했습니다.');
    } finally {
      setAddingPool(false);
    }
  }

  const ReturnBadge = ({ value, label }: { value: number; label: string }) => (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '10px 16px',
        borderRadius: 8,
        backgroundColor: value > 0 ? '#ECFDF5' : value < 0 ? '#FEF2F2' : '#F5F7FA',
        flex: 1,
      }}
    >
      <span style={{ fontSize: '0.6875rem', color: '#6B7280', marginBottom: 4 }}>{label}</span>
      <span
        style={{
          fontSize: '1rem',
          fontWeight: 700,
          color: value > 0 ? '#059669' : value < 0 ? '#DC2626' : '#6B7280',
          fontFamily: 'monospace',
        }}
      >
        {value > 0 ? '+' : ''}{value.toFixed(2)}%
      </span>
    </div>
  );

  if (!stock) return null;

  return (
    <Modal open={open} onClose={onClose} title={`${stock.stock_name} (${stock.stock_code})`} maxWidth={600}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        {/* Header info */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span
            style={{
              padding: '3px 10px',
              borderRadius: 6,
              fontSize: '0.8125rem',
              backgroundColor: '#EBF5F5',
              color: '#2E8B8B',
              fontWeight: 600,
            }}
          >
            {stock.theme}
          </span>
          {stock.sector && (
            <span
              style={{
                padding: '3px 10px',
                borderRadius: 6,
                fontSize: '0.8125rem',
                backgroundColor: '#EEF2F7',
                color: '#1E3A5F',
                fontWeight: 500,
              }}
            >
              {stock.sector}
            </span>
          )}
          <span
            style={{
              marginLeft: 'auto',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: '0.8125rem',
              color: stock.is_top5 ? '#D97706' : '#6B7280',
            }}
          >
            {stock.is_top5 && (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="#D97706">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
            )}
            순위 #{stock.rank}
          </span>
        </div>

        {/* Returns */}
        <div>
          <p style={{ margin: '0 0 8px', fontSize: '0.8125rem', fontWeight: 600, color: '#6B7280' }}>
            수익률
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <ReturnBadge value={stock.return_1m} label="1개월" />
            <ReturnBadge value={stock.return_3m} label="3개월" />
            <ReturnBadge value={stock.return_6m} label="6개월" />
          </div>
        </div>

        {/* Market cap */}
        {stock.market_cap != null && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: '0.8125rem', color: '#6B7280' }}>시가총액</span>
            <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#1A1A2E', fontFamily: 'monospace' }}>
              {(stock.market_cap / 1e8).toFixed(0)}억원
            </span>
          </div>
        )}

        {/* Analysis report */}
        {stock.analysis_report && (
          <div>
            <p style={{ margin: '0 0 8px', fontSize: '0.8125rem', fontWeight: 600, color: '#6B7280' }}>
              AI 분석 리포트
            </p>
            <div
              style={{
                padding: '14px 16px',
                borderRadius: 8,
                backgroundColor: '#F5F7FA',
                border: '1px solid #E1E5EB',
              }}
            >
              <p
                style={{
                  margin: 0,
                  fontSize: '0.875rem',
                  color: '#374151',
                  lineHeight: 1.7,
                  whiteSpace: 'pre-wrap',
                }}
              >
                {stock.analysis_report}
              </p>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div
            style={{
              padding: '10px 14px',
              backgroundColor: '#FEF2F2',
              border: '1px solid #FECACA',
              borderRadius: 8,
              color: '#B91C1C',
              fontSize: '0.8125rem',
            }}
          >
            {error}
          </div>
        )}

        {/* Actions */}
        <div
          style={{
            display: 'flex',
            gap: 10,
            paddingTop: 4,
            borderTop: '1px solid #E1E5EB',
          }}
        >
          <Button
            variant="primary"
            size="md"
            loading={addingPortfolio}
            onClick={addToPortfolio}
            style={{ flex: 1 }}
          >
            {portfolioSuccess ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                포트폴리오 추가됨
              </span>
            ) : (
              '포트폴리오 담기'
            )}
          </Button>
          <Button
            variant="secondary"
            size="md"
            loading={addingPool}
            onClick={addToPool}
            style={{ flex: 1 }}
          >
            {poolSuccess ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                회사풀 추가됨
              </span>
            ) : (
              '회사풀 담기'
            )}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export default StockAnalysisPopup;
