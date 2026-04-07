'use client';

import { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { Button } from '@/components/common/Button';
import { useRetirementStore } from '../../hooks/useRetirementStore';
import { formatCurrency, formatInputCurrency, parseCurrency } from '../../utils/formatCurrency';
import { API_URL } from '@/lib/api-url';
import { authLib } from '@/lib/auth';
import type { DesiredPlanResponse } from '../../types/retirement';

// Recharts SSR 방지
const GrowthChart = dynamic(() => import('./GrowthChart'), { ssr: false });

/* ------------------------------------------------------------------ */
/*  복리 성장 데이터 계산 (프론트엔드 미리보기용)                        */
/* ------------------------------------------------------------------ */

interface GrowthDataPoint {
  age: number;
  amount: number;
}

function calcGrowthData(
  annualSavings: number,
  years: number,
  rate: number = 0.07,
  startAge: number = 35
): GrowthDataPoint[] {
  const data: GrowthDataPoint[] = [];
  let accumulated = 0;
  for (let i = 0; i <= years; i++) {
    data.push({ age: startAge + i, amount: Math.round(accumulated / 10000) });
    accumulated = (accumulated + annualSavings * 10000) * (1 + rate);
  }
  return data;
}

/* ------------------------------------------------------------------ */
/*  계산 결과 타입                                                       */
/* ------------------------------------------------------------------ */

interface CalcResult {
  targetFund: number;
  requiredLumpSum: number;
  requiredAnnualSavings: number;
  returnRate: number;
}

function calcPreview(monthly: number, years: number): CalcResult {
  const rate = 0.07;
  const targetFund = monthly * 12 * years;
  const requiredLumpSum = targetFund / Math.pow(1 + rate, years);
  const annuityFactor = (Math.pow(1 + rate, years) - 1) / rate;
  const requiredAnnualSavings = annuityFactor > 0 ? targetFund / annuityFactor : 0;
  return {
    targetFund,
    requiredLumpSum: Math.round(requiredLumpSum),
    requiredAnnualSavings: Math.round(requiredAnnualSavings),
    returnRate: rate * 100,
  };
}

/* ------------------------------------------------------------------ */
/*  토스트 컴포넌트                                                      */
/* ------------------------------------------------------------------ */

function Toast({ message, type }: { message: string; type: 'success' | 'error' }) {
  return (
    <div
      style={{
        position: 'fixed',
        bottom: '32px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9999,
        padding: '12px 24px',
        borderRadius: '8px',
        backgroundColor: type === 'success' ? '#1E3A5F' : '#EF4444',
        color: '#ffffff',
        fontSize: '14px',
        fontWeight: 500,
        boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
        pointerEvents: 'none',
      }}
    >
      {message}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  메인 컴포넌트                                                        */
/* ------------------------------------------------------------------ */

export function DesiredPlanTab() {
  const { selectedCustomer } = useRetirementStore();
  const customerId = selectedCustomer?.id ?? null;

  const [monthlyInput, setMonthlyInput] = useState('');
  const [yearsInput, setYearsInput] = useState('');
  const [apiResult, setApiResult] = useState<DesiredPlanResponse | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const monthly = parseCurrency(monthlyInput);
  const years = parseInt(yearsInput, 10) || 0;

  const preview = monthly > 0 && years > 0 ? calcPreview(monthly, years) : null;

  const calcResult: CalcResult | null = apiResult
    ? {
        targetFund: apiResult.target_total_fund,
        requiredLumpSum: apiResult.required_lump_sum,
        requiredAnnualSavings: apiResult.required_annual_savings,
        // 백엔드가 0.07 형태면 *100, 7 형태면 그대로
        returnRate: (() => {
          const r = apiResult.assumed_return_rate ?? 0.07;
          return r < 1 ? r * 100 : r;
        })(),
      }
    : preview;

  const growthData =
    calcResult && years > 0
      ? calcGrowthData(calcResult.requiredAnnualSavings, years, calcResult.returnRate / 100)
      : [];

  const loadData = useCallback(async () => {
    if (!customerId) return;
    setIsLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/retirement/desired-plans/${customerId}`, {
        headers: authLib.getAuthHeader(),
      });
      if (res.ok) {
        const data: DesiredPlanResponse = await res.json();
        setMonthlyInput(formatInputCurrency(String(data.monthly_desired_amount)));
        setYearsInput(String(data.retirement_period_years));
        setApiResult(data);
      } else if (res.status === 404) {
        setMonthlyInput('');
        setYearsInput('');
        setApiResult(null);
      }
    } catch {
      // 네트워크 에러 무시
    } finally {
      setIsLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleMonthlyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setApiResult(null);
    setMonthlyInput(formatInputCurrency(e.target.value));
  };

  const handleYearsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setApiResult(null);
    const val = e.target.value.replace(/[^\d]/g, '');
    setYearsInput(val);
  };

  const handleSave = async () => {
    if (!customerId) {
      showToast('고객을 먼저 선택하세요.', 'error');
      return;
    }
    if (!monthly || !years) {
      showToast('매월 수령액과 은퇴 기간을 입력하세요.', 'error');
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/retirement/desired-plans/${customerId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...authLib.getAuthHeader(),
        },
        body: JSON.stringify({
          monthly_desired_amount: monthly,
          retirement_period_years: years,
        }),
      });
      if (res.ok) {
        const data: DesiredPlanResponse = await res.json();
        setApiResult(data);
        showToast('희망 은퇴플랜이 저장되었습니다.', 'success');
      } else {
        const err = await res.json().catch(() => ({}));
        showToast((err as { detail?: string }).detail || '저장에 실패했습니다.', 'error');
      }
    } catch {
      showToast('네트워크 오류가 발생했습니다.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '24px',
        maxWidth: '960px',
        margin: '0 auto',
      }}
    >
      {/* 상단: 입력 폼 + 계산 결과 표 */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '24px',
          alignItems: 'start',
        }}
      >
        {/* 입력 폼 */}
        <div
          style={{
            backgroundColor: '#ffffff',
            border: '1px solid #E5E7EB',
            borderRadius: '12px',
            padding: '24px',
          }}
        >
          <h3
            style={{
              fontSize: '15px',
              fontWeight: 600,
              color: '#1E3A5F',
              marginBottom: '20px',
              marginTop: 0,
            }}
          >
            희망 은퇴 조건 입력
          </h3>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* 매월 희망 수령액 */}
            <div>
              <label
                htmlFor="monthly-amount"
                style={{
                  display: 'block',
                  fontSize: '13px',
                  fontWeight: 500,
                  color: '#374151',
                  marginBottom: '6px',
                }}
              >
                매월 희망 수령액
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  id="monthly-amount"
                  aria-label="매월 희망 수령액"
                  type="text"
                  inputMode="numeric"
                  value={monthlyInput}
                  onChange={handleMonthlyChange}
                  placeholder="0"
                  disabled={isLoading}
                  style={{
                    width: '100%',
                    height: '40px',
                    padding: '0 48px 0 12px',
                    fontSize: '14px',
                    color: '#1A1A2E',
                    backgroundColor: '#ffffff',
                    border: '1px solid #D1D5DB',
                    borderRadius: '8px',
                    outline: 'none',
                    boxSizing: 'border-box',
                    fontFamily: 'Inter, sans-serif',
                    textAlign: 'right',
                  }}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = '#1E3A5F';
                    e.currentTarget.style.boxShadow = '0 0 0 3px rgba(30,58,95,0.12)';
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = '#D1D5DB';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                />
                <span
                  style={{
                    position: 'absolute',
                    right: '12px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    fontSize: '12px',
                    color: '#6B7280',
                    pointerEvents: 'none',
                  }}
                >
                  만원
                </span>
              </div>
            </div>

            {/* 은퇴 기간 */}
            <div>
              <label
                htmlFor="retirement-years"
                style={{
                  display: 'block',
                  fontSize: '13px',
                  fontWeight: 500,
                  color: '#374151',
                  marginBottom: '6px',
                }}
              >
                은퇴 기간
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  id="retirement-years"
                  aria-label="은퇴 기간"
                  type="text"
                  inputMode="numeric"
                  value={yearsInput}
                  onChange={handleYearsChange}
                  placeholder="0"
                  disabled={isLoading}
                  style={{
                    width: '100%',
                    height: '40px',
                    padding: '0 40px 0 12px',
                    fontSize: '14px',
                    color: '#1A1A2E',
                    backgroundColor: '#ffffff',
                    border: '1px solid #D1D5DB',
                    borderRadius: '8px',
                    outline: 'none',
                    boxSizing: 'border-box',
                    fontFamily: 'Inter, sans-serif',
                    textAlign: 'right',
                  }}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = '#1E3A5F';
                    e.currentTarget.style.boxShadow = '0 0 0 3px rgba(30,58,95,0.12)';
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = '#D1D5DB';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                />
                <span
                  style={{
                    position: 'absolute',
                    right: '12px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    fontSize: '12px',
                    color: '#6B7280',
                    pointerEvents: 'none',
                  }}
                >
                  년
                </span>
              </div>
            </div>
          </div>

          {/* 저장 버튼 */}
          <div style={{ marginTop: '20px' }}>
            <Button
              variant="primary"
              size="md"
              fullWidth
              loading={isSaving}
              onClick={handleSave}
              disabled={!customerId || !monthly || !years}
            >
              저장
            </Button>
            {!customerId && (
              <p
                style={{
                  marginTop: '8px',
                  fontSize: '12px',
                  color: '#9CA3AF',
                  textAlign: 'center',
                }}
              >
                상단에서 고객을 선택하면 저장할 수 있습니다.
              </p>
            )}
          </div>
        </div>

        {/* 계산 결과 표 */}
        <div
          style={{
            backgroundColor: '#ffffff',
            border: '1px solid #E5E7EB',
            borderRadius: '12px',
            padding: '24px',
          }}
        >
          <h3
            style={{
              fontSize: '15px',
              fontWeight: 600,
              color: '#1E3A5F',
              marginBottom: '20px',
              marginTop: 0,
            }}
          >
            계산 결과
          </h3>

          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th
                  style={{
                    padding: '10px 12px',
                    textAlign: 'left',
                    fontSize: '12px',
                    fontWeight: 600,
                    color: '#6B7280',
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    borderBottom: '1px solid #E5E7EB',
                    backgroundColor: '#F9FAFB',
                  }}
                >
                  항목
                </th>
                <th
                  style={{
                    padding: '10px 12px',
                    textAlign: 'right',
                    fontSize: '12px',
                    fontWeight: 600,
                    color: '#6B7280',
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    borderBottom: '1px solid #E5E7EB',
                    backgroundColor: '#F9FAFB',
                  }}
                >
                  금액
                </th>
              </tr>
            </thead>
            <tbody>
              <ResultRow
                label="목표 은퇴자금"
                value={calcResult ? `${formatCurrency(calcResult.targetFund)} 만원` : '-'}
                highlight
              />
              <ResultRow
                label="필요 일시납"
                value={calcResult ? `${formatCurrency(calcResult.requiredLumpSum)} 만원` : '-'}
              />
              <ResultRow
                label="필요 연적립"
                value={calcResult ? `${formatCurrency(calcResult.requiredAnnualSavings)} 만원` : '-'}
              />
              <ResultRow
                label="예상 수익률"
                value={calcResult ? `${calcResult.returnRate}%` : '7%'}
                isRate
              />
            </tbody>
          </table>

          {!calcResult && (
            <p
              style={{
                marginTop: '16px',
                fontSize: '12px',
                color: '#9CA3AF',
                textAlign: 'center',
              }}
            >
              매월 수령액과 은퇴 기간을 입력하면 결과가 표시됩니다.
            </p>
          )}
        </div>
      </div>

      {/* 하단: 복리 성장 그래프 */}
      <div
        style={{
          backgroundColor: '#ffffff',
          border: '1px solid #E5E7EB',
          borderRadius: '12px',
          padding: '24px',
        }}
      >
        <h3
          style={{
            fontSize: '15px',
            fontWeight: 600,
            color: '#1E3A5F',
            marginBottom: '20px',
            marginTop: 0,
          }}
        >
          복리 성장 시뮬레이션
        </h3>

        {growthData.length > 0 ? (
          <GrowthChart data={growthData} />
        ) : (
          <div
            style={{
              height: '200px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#9CA3AF',
              fontSize: '13px',
              backgroundColor: '#F9FAFB',
              borderRadius: '8px',
            }}
          >
            입력값을 입력하면 그래프가 표시됩니다.
          </div>
        )}
      </div>

      {/* 토스트 */}
      {toast && <Toast message={toast.message} type={toast.type} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  테이블 행 컴포넌트                                                   */
/* ------------------------------------------------------------------ */

function ResultRow({
  label,
  value,
  highlight = false,
  isRate = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  isRate?: boolean;
}) {
  return (
    <tr style={{ borderBottom: '1px solid #F3F4F6' }}>
      <td
        style={{
          padding: '12px 12px',
          fontSize: '13px',
          color: '#374151',
          fontWeight: highlight ? 600 : 400,
        }}
      >
        {label}
      </td>
      <td
        style={{
          padding: '12px 12px',
          fontSize: '14px',
          color: highlight ? '#1E3A5F' : isRate ? '#059669' : '#1A1A2E',
          fontWeight: highlight ? 700 : 500,
          textAlign: 'right',
          fontFamily: 'Inter, monospace',
        }}
      >
        {value}
      </td>
    </tr>
  );
}

export default DesiredPlanTab;
