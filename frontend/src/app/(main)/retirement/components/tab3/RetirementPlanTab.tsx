'use client';

import { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { Button } from '@/components/common/Button';
import { useRetirementStore } from '../../hooks/useRetirementStore';
import { formatCurrency, formatInputCurrency, parseCurrency } from '../../utils/formatCurrency';
import { API_URL } from '@/lib/api-url';
import { authLib } from '@/lib/auth';
import type {
  YearlyProjection,
  SimulationCalculateRequest,
  SimulationCalculateResponse,
  RetirementPlanData,
} from '../../types/retirement';

// Recharts SSR 방지
const RetirementGrowthChart = dynamic(() => import('./RetirementGrowthChart'), { ssr: false });

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
/*  스타일 상수                                                          */
/* ------------------------------------------------------------------ */

const cardStyle: React.CSSProperties = {
  backgroundColor: '#ffffff',
  border: '1px solid #E5E7EB',
  borderRadius: '12px',
  padding: '24px',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '13px',
  fontWeight: 500,
  color: '#374151',
  marginBottom: '6px',
};

const inputStyle: React.CSSProperties = {
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
  textAlign: 'right',
};

const unitStyle: React.CSSProperties = {
  position: 'absolute',
  right: '12px',
  top: '50%',
  transform: 'translateY(-50%)',
  fontSize: '12px',
  color: '#6B7280',
  pointerEvents: 'none',
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: '15px',
  fontWeight: 600,
  color: '#1E3A5F',
  marginBottom: '20px',
  marginTop: 0,
};

/* ------------------------------------------------------------------ */
/*  숫자 전용 Input 컴포넌트                                             */
/* ------------------------------------------------------------------ */

function NumericInput({
  id,
  label,
  value,
  onChange,
  unit,
  disabled,
  isCurrency = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (val: string) => void;
  unit: string;
  disabled?: boolean;
  isCurrency?: boolean;
}) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isCurrency) {
      onChange(formatInputCurrency(e.target.value));
    } else {
      onChange(e.target.value.replace(/[^\d.]/g, ''));
    }
  };

  return (
    <div>
      <label htmlFor={id} style={labelStyle}>
        {label}
      </label>
      <div style={{ position: 'relative' }}>
        <input
          id={id}
          aria-label={label}
          type="text"
          inputMode="numeric"
          value={value}
          onChange={handleChange}
          placeholder="0"
          disabled={disabled}
          style={inputStyle}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = '#1E3A5F';
            e.currentTarget.style.boxShadow = '0 0 0 3px rgba(30,58,95,0.12)';
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = '#D1D5DB';
            e.currentTarget.style.boxShadow = 'none';
          }}
        />
        <span style={unitStyle}>{unit}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  메인 컴포넌트                                                        */
/* ------------------------------------------------------------------ */

export function RetirementPlanTab() {
  const { selectedCustomer } = useRetirementStore();
  const customerId = selectedCustomer?.id ?? null;

  // 폼 상태
  const [currentAge, setCurrentAge] = useState('');
  const [lumpSum, setLumpSum] = useState('');
  const [annualSavings, setAnnualSavings] = useState('');
  const [savingPeriod, setSavingPeriod] = useState('');
  const [inheritanceConsideration, setInheritanceConsideration] = useState(false);
  const [annualReturnRate, setAnnualReturnRate] = useState('7');
  const [targetFund, setTargetFund] = useState('');
  const [targetPension, setTargetPension] = useState('');
  const [desiredRetirementAge, setDesiredRetirementAge] = useState('');
  const [possibleRetirementAge, setPossibleRetirementAge] = useState('');

  // UI 상태
  const [isLoading, setIsLoading] = useState(false);
  const [isCalculating, setIsCalculating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [planId, setPlanId] = useState<number | null>(null);

  // 결과 상태
  const [projections, setProjections] = useState<YearlyProjection[] | null>(null);

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  /* 1번탭 데이터 사전 세팅 */
  const loadDesiredPlan = useCallback(
    async (cid: string) => {
      try {
        const res = await fetch(`${API_URL}/api/v1/retirement/desired-plans/${cid}`, {
          headers: authLib.getAuthHeader(),
        });
        if (res.ok) {
          const data = await res.json();
          // 1번탭에서 연관 필드 사전 세팅
          if (data.monthly_desired_amount) {
            setTargetPension(formatInputCurrency(String(data.monthly_desired_amount)));
          }
          if (data.target_total_fund) {
            setTargetFund(formatInputCurrency(String(data.target_total_fund)));
          }
        }
      } catch {
        // 무시
      }
    },
    []
  );

  /* 3번탭 저장 데이터 로드 */
  const loadPlan = useCallback(
    async (cid: string) => {
      setIsLoading(true);
      try {
        const res = await fetch(`${API_URL}/api/v1/retirement/plans/${cid}`, {
          headers: authLib.getAuthHeader(),
        });
        if (res.ok) {
          const data: RetirementPlanData = await res.json();
          setPlanId(data.id ?? null);
          setCurrentAge(String(data.current_age));
          setLumpSum(formatInputCurrency(String(data.lump_sum_amount)));
          setAnnualSavings(formatInputCurrency(String(data.annual_savings)));
          setSavingPeriod(String(data.saving_period_years));
          setInheritanceConsideration(data.inheritance_consideration);
          setAnnualReturnRate(String(data.annual_return_rate));
          setTargetFund(formatInputCurrency(String(data.target_retirement_fund)));
          setTargetPension(formatInputCurrency(String(data.target_pension_amount)));
          setDesiredRetirementAge(String(data.desired_retirement_age));
          setPossibleRetirementAge(String(data.possible_retirement_age));

          // 저장된 데이터가 있으면 자동 시뮬레이션
          await runSimulation(data);
        } else if (res.status === 404) {
          // 저장 데이터 없으면 1번탭에서 사전 세팅 시도
          await loadDesiredPlan(cid);
        }
      } catch {
        // 네트워크 에러 무시
      } finally {
        setIsLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loadDesiredPlan]
  );

  useEffect(() => {
    if (customerId) {
      loadPlan(customerId);
    } else {
      // 고객 초기화
      setCurrentAge('');
      setLumpSum('');
      setAnnualSavings('');
      setSavingPeriod('');
      setInheritanceConsideration(false);
      setAnnualReturnRate('7');
      setTargetFund('');
      setTargetPension('');
      setDesiredRetirementAge('');
      setPossibleRetirementAge('');
      setPlanId(null);
      setProjections(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  /* 시뮬레이션 실행 */
  const runSimulation = async (params: SimulationCalculateRequest | RetirementPlanData) => {
    const body: SimulationCalculateRequest = {
      current_age: 'current_age' in params ? params.current_age : Number(currentAge) || 0,
      lump_sum_amount:
        'lump_sum_amount' in params
          ? params.lump_sum_amount
          : parseCurrency(lumpSum),
      annual_savings:
        'annual_savings' in params
          ? params.annual_savings
          : parseCurrency(annualSavings),
      saving_period_years:
        'saving_period_years' in params
          ? params.saving_period_years
          : Number(savingPeriod) || 0,
      inflation_rate:
        'inflation_rate' in params ? params.inflation_rate : 0,
      annual_return_rate:
        'annual_return_rate' in params
          ? params.annual_return_rate
          : Number(annualReturnRate) || 7,
      target_retirement_fund:
        'target_retirement_fund' in params
          ? params.target_retirement_fund
          : parseCurrency(targetFund),
      target_pension_amount:
        'target_pension_amount' in params
          ? params.target_pension_amount
          : parseCurrency(targetPension),
      desired_retirement_age:
        'desired_retirement_age' in params
          ? params.desired_retirement_age
          : Number(desiredRetirementAge) || 65,
      possible_retirement_age:
        'possible_retirement_age' in params
          ? params.possible_retirement_age
          : Number(possibleRetirementAge) || 65,
      inheritance_consideration:
        'inheritance_consideration' in params
          ? params.inheritance_consideration
          : inheritanceConsideration,
    };

    const res = await fetch(`${API_URL}/api/v1/retirement/simulation/calculate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authLib.getAuthHeader(),
      },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const data: SimulationCalculateResponse = await res.json();
      setProjections(data.yearly_projections);
    }
  };

  /* 계산 버튼 핸들러 */
  const handleCalculate = async () => {
    const age = Number(currentAge);
    if (!age || age < 1 || age > 100) {
      showToast('현재 나이를 올바르게 입력하세요.', 'error');
      return;
    }
    setIsCalculating(true);
    try {
      await runSimulation({
        current_age: age,
        lump_sum_amount: parseCurrency(lumpSum),
        annual_savings: parseCurrency(annualSavings),
        saving_period_years: Number(savingPeriod) || 0,
        inflation_rate: 0,
        annual_return_rate: Number(annualReturnRate) || 7,
        target_retirement_fund: parseCurrency(targetFund),
        target_pension_amount: parseCurrency(targetPension),
        desired_retirement_age: Number(desiredRetirementAge) || 65,
        possible_retirement_age: Number(possibleRetirementAge) || 65,
        inheritance_consideration: inheritanceConsideration,
      });
    } catch {
      showToast('계산 중 오류가 발생했습니다.', 'error');
    } finally {
      setIsCalculating(false);
    }
  };

  /* 저장 버튼 핸들러 */
  const handleSave = async () => {
    if (!customerId) {
      showToast('고객을 먼저 선택하세요.', 'error');
      return;
    }
    const age = Number(currentAge);
    if (!age) {
      showToast('현재 나이를 입력하세요.', 'error');
      return;
    }
    setIsSaving(true);
    try {
      const body = {
        customer_id: Number(customerId),
        current_age: age,
        lump_sum_amount: parseCurrency(lumpSum),
        annual_savings: parseCurrency(annualSavings),
        saving_period_years: Number(savingPeriod) || 0,
        inflation_rate: 0,
        annual_return_rate: Number(annualReturnRate) || 7,
        target_retirement_fund: parseCurrency(targetFund),
        target_pension_amount: parseCurrency(targetPension),
        desired_retirement_age: Number(desiredRetirementAge) || 65,
        possible_retirement_age: Number(possibleRetirementAge) || 65,
        inheritance_consideration: inheritanceConsideration,
      };

      const url = planId
        ? `${API_URL}/api/v1/retirement/plans/${planId}`
        : `${API_URL}/api/v1/retirement/plans`;
      const method = planId ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...authLib.getAuthHeader(),
        },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        const data: RetirementPlanData = await res.json();
        setPlanId(data.id ?? null);
        showToast('은퇴플랜이 저장되었습니다.', 'success');
        // 저장 후 자동 재계산
        await runSimulation(data);
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

  // 그래프 데이터 변환
  const chartData =
    projections?.map((p) => ({
      age: p.age,
      amount: Math.round(p.evaluation),
    })) ?? [];

  const desiredRetirementAgeNum = Number(desiredRetirementAge) || undefined;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '24px',
        maxWidth: '1100px',
        margin: '0 auto',
      }}
    >
      {/* 상단: 기본정보 입력 폼 */}
      <div style={cardStyle}>
        <h3 style={sectionTitleStyle}>기본정보 입력</h3>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(5, 1fr)',
            gap: '16px',
          }}
        >
          <NumericInput
            id="current-age"
            label="현재 나이"
            value={currentAge}
            onChange={setCurrentAge}
            unit="세"
            disabled={isLoading}
          />
          <NumericInput
            id="lump-sum-amount"
            label="일시납입금액"
            value={lumpSum}
            onChange={setLumpSum}
            unit="만원"
            disabled={isLoading}
            isCurrency
          />
          <NumericInput
            id="annual-savings"
            label="연적립금액"
            value={annualSavings}
            onChange={setAnnualSavings}
            unit="만원"
            disabled={isLoading}
            isCurrency
          />
          <NumericInput
            id="saving-period"
            label="납입기간"
            value={savingPeriod}
            onChange={setSavingPeriod}
            unit="년"
            disabled={isLoading}
          />
          <NumericInput
            id="annual-return-rate"
            label="연수익률"
            value={annualReturnRate}
            onChange={setAnnualReturnRate}
            unit="%"
            disabled={isLoading}
          />
          <NumericInput
            id="target-retirement-fund"
            label="목표은퇴자금"
            value={targetFund}
            onChange={setTargetFund}
            unit="만원"
            disabled={isLoading}
            isCurrency
          />
          <NumericInput
            id="target-pension-amount"
            label="목표 연금액"
            value={targetPension}
            onChange={setTargetPension}
            unit="만원/월"
            disabled={isLoading}
            isCurrency
          />
          <NumericInput
            id="desired-retirement-age"
            label="희망 은퇴나이"
            value={desiredRetirementAge}
            onChange={setDesiredRetirementAge}
            unit="세"
            disabled={isLoading}
          />
          <NumericInput
            id="possible-retirement-age"
            label="가능 은퇴나이"
            value={possibleRetirementAge}
            onChange={setPossibleRetirementAge}
            unit="세"
            disabled={isLoading}
          />

          {/* 물가상승률 & 상속재원 고려 토글 */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'flex-end',
              paddingBottom: '4px',
            }}
          >
            <label
              htmlFor="inheritance-consideration"
              style={{ ...labelStyle, marginBottom: '10px' }}
            >
              물가상승률 & 상속재원 고려
            </label>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                cursor: 'pointer',
              }}
            >
              <div
                onClick={() => setInheritanceConsideration((v) => !v)}
                role="switch"
                aria-checked={inheritanceConsideration}
                aria-label="물가상승률 & 상속재원 고려"
                style={{
                  width: '44px',
                  height: '24px',
                  borderRadius: '12px',
                  backgroundColor: inheritanceConsideration ? '#1E3A5F' : '#D1D5DB',
                  position: 'relative',
                  cursor: 'pointer',
                  transition: 'background-color 0.2s',
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    top: '2px',
                    left: inheritanceConsideration ? '22px' : '2px',
                    width: '20px',
                    height: '20px',
                    borderRadius: '50%',
                    backgroundColor: '#ffffff',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.18)',
                    transition: 'left 0.2s',
                  }}
                />
              </div>
              <span style={{ fontSize: '13px', color: '#374151' }}>
                {inheritanceConsideration ? '적용' : '미적용'}
              </span>
            </label>
          </div>
        </div>

        {/* 계산 버튼 */}
        <div style={{ marginTop: '20px', display: 'flex', gap: '12px' }}>
          <Button
            variant="primary"
            size="md"
            loading={isCalculating}
            onClick={handleCalculate}
            disabled={!currentAge}
          >
            계산
          </Button>
          <Button
            variant="secondary"
            size="md"
            loading={isSaving}
            onClick={handleSave}
            disabled={!customerId || !currentAge}
          >
            저장
          </Button>
          {!customerId && (
            <span style={{ fontSize: '12px', color: '#9CA3AF', alignSelf: 'center' }}>
              상단에서 고객을 선택하면 저장할 수 있습니다.
            </span>
          )}
        </div>
      </div>

      {/* 중단: 연도별 예상 평가금액 테이블 */}
      <div style={cardStyle}>
        <h3 style={sectionTitleStyle}>연도별 예상 평가금액</h3>

        {projections && projections.length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: '13px',
              }}
            >
              <thead>
                <tr style={{ backgroundColor: '#F9FAFB' }}>
                  {['연도', '연차', '나이', '일시납', '연적립', '총납입', '예상수익', '예상평가액'].map(
                    (col) => (
                      <th
                        key={col}
                        style={{
                          padding: '10px 12px',
                          textAlign: col === '연도' || col === '연차' || col === '나이' ? 'center' : 'right',
                          fontSize: '12px',
                          fontWeight: 600,
                          color: '#6B7280',
                          borderBottom: '1px solid #E5E7EB',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {col}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {projections.map((row, idx) => {
                  const isRetirementAge =
                    desiredRetirementAgeNum != null && row.age === desiredRetirementAgeNum;
                  return (
                    <tr
                      key={row.year}
                      style={{
                        backgroundColor: isRetirementAge
                          ? 'rgba(30,58,95,0.06)'
                          : idx % 2 === 0
                          ? '#ffffff'
                          : '#FAFAFA',
                        borderBottom: '1px solid #F3F4F6',
                      }}
                    >
                      <td style={{ padding: '8px 12px', textAlign: 'center', color: '#374151' }}>
                        {row.year}
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'center', color: '#374151' }}>
                        {row.year_num}
                      </td>
                      <td
                        style={{
                          padding: '8px 12px',
                          textAlign: 'center',
                          color: isRetirementAge ? '#1E3A5F' : '#374151',
                          fontWeight: isRetirementAge ? 700 : 400,
                        }}
                      >
                        {row.age}세
                        {isRetirementAge && (
                          <span
                            style={{
                              marginLeft: '4px',
                              fontSize: '10px',
                              color: '#1E3A5F',
                              fontWeight: 600,
                            }}
                          >
                            ★희망
                          </span>
                        )}
                      </td>
                      <AmountCell value={row.lump_sum} />
                      <AmountCell value={row.annual_savings} />
                      <AmountCell value={row.total_contribution} highlight={isRetirementAge} />
                      <AmountCell value={row.annual_return} />
                      <AmountCell value={row.evaluation} highlight={isRetirementAge} bold />
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div
            style={{
              height: '120px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#9CA3AF',
              fontSize: '13px',
              backgroundColor: '#F9FAFB',
              borderRadius: '8px',
            }}
          >
            기본정보를 입력하고 [계산] 버튼을 클릭하면 연도별 예상 평가금액이 표시됩니다.
          </div>
        )}
      </div>

      {/* 하단: 성장 그래프 */}
      <div style={cardStyle}>
        <h3 style={sectionTitleStyle}>성장 그래프</h3>

        {chartData.length > 0 ? (
          <RetirementGrowthChart
            data={chartData}
            retirementAge={desiredRetirementAgeNum}
          />
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
            계산 결과가 있으면 그래프가 표시됩니다.
          </div>
        )}
      </div>

      {/* 토스트 */}
      {toast && <Toast message={toast.message} type={toast.type} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  금액 셀 컴포넌트                                                     */
/* ------------------------------------------------------------------ */

function AmountCell({
  value,
  highlight = false,
  bold = false,
}: {
  value: number;
  highlight?: boolean;
  bold?: boolean;
}) {
  return (
    <td
      style={{
        padding: '8px 12px',
        textAlign: 'right',
        color: highlight ? '#1E3A5F' : '#1A1A2E',
        fontWeight: bold || highlight ? 600 : 400,
        fontVariantNumeric: 'tabular-nums',
        whiteSpace: 'nowrap',
      }}
    >
      {formatCurrency(value)}
    </td>
  );
}

export default RetirementPlanTab;
