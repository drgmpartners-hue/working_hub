'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { formatCurrency } from '../../utils/formatCurrency';
import { API_URL } from '@/lib/api-url';
import { authLib } from '@/lib/auth';
import { useRetirementStore } from '../../hooks/useRetirementStore';

/* ------------------------------------------------------------------ */
/*  Recharts SSR 방지 (동적 import)                                     */
/* ------------------------------------------------------------------ */

const LifetimeFlowChart = dynamic(() => import('./LifetimeFlowChart'), { ssr: false });

/* ------------------------------------------------------------------ */
/*  타입 정의                                                           */
/* ------------------------------------------------------------------ */

interface LifetimeRetirementFlowProps {
  currentAge: number | null;
  desiredPlanData: DesiredPlanAPI | null;
  annualFlowData: AnnualFlowRowExternal[];
  appliedYears: Record<number, AppliedYearData>;
}

interface DesiredPlanAPI {
  desired_retirement_age?: number | null;
  savings_period_years?: number | null;
  holding_period_years?: number | null;
  annual_savings_amount?: number | null;
  simulation_monthly_savings?: number | null;
  simulation_annual_lump_sum?: number | null;
  simulation_total_lump_sum?: number | null;
  expected_return_rate?: number | null;
  inflation_rate?: number | null;
  retirement_pension_rate?: number | null;
  simulation_target_fund?: number | null;
  target_retirement_fund?: number | null;
  monthly_desired_amount?: number | null;
  future_monthly_amount?: number | null;
  simulation_data?: Record<string, unknown>[] | null;
}

interface AnnualFlowRowExternal {
  year: number;
  age: number | null;
  total_evaluation: number;
  lump_sum?: number;
  annual_savings?: number;
  total_contribution?: number;
}

interface AppliedYearData {
  net_asset?: number;
  total_evaluation?: number;
  year?: number;
  lump_sum?: number;
  annual_savings?: number;
  total_contribution?: number;
  annual_evaluation?: number;
  annual_return_rate?: number;
  net_asset_return_rate?: number;
  [key: string]: unknown;
}

/* ------------------------------------------------------------------ */
/*  오버라이드 타입                                                      */
/* ------------------------------------------------------------------ */

interface YearOverride {
  annualSavings?: number;  // 연적립금액 (만원)
  lumpSum?: number;        // 일시납금액 (만원)
  returnRate?: number;     // 예상수익률 (소수, 예: 0.06)
  pension?: number;        // 연금액 (만원)
}

/* ------------------------------------------------------------------ */
/*  계산 결과 행 타입                                                    */
/* ------------------------------------------------------------------ */

interface LifetimeRow {
  year: number;       // 연차 (1부터)
  calendarYear: number; // 달력 연도 (예: 2024)
  age: number;        // 나이
  phase: 'saving' | 'holding' | 'retirement'; // 구분
  cumulativePrincipal: number;   // 누적원금 (만원)
  totalEvaluation: number;       // 총 평가액 (만원)
  annualSavings: number;         // 연적립금액 (만원)
  lumpSum: number;               // 일시납금액 (만원)
  returnRate: number;            // 예상수익률 (소수, 예: 0.06)
  totalPayment: number;          // 총납입금액 (만원, 누적)
  adjustedEvaluation: number;    // 보정평가금액 (만원, 0이면 미보정)
  pension: number;               // 연금액 (만원)
  cumulativePension: number;     // 중도인출누적 (만원)
  adjustedNetAsset: number;      // 보정후순자산 (만원)
  netAssetReturnRate: number;    // 순자산수익률 (%, 예: 35.2)
  isAdjusted: boolean;           // 보정된 행 여부 (연간투자흐름표에서 불러온 행)
}

/* ------------------------------------------------------------------ */
/*  엑셀 FV 함수 (복리 계산)                                              */
/* ------------------------------------------------------------------ */
function excelFV(rate: number, nper: number, pmt: number, pv: number): number {
  if (rate === 0) return -(pv + pmt * nper);
  const f = Math.pow(1 + rate, nper);
  return -pv * f - pmt * (f - 1) / rate;
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

const sectionTitleStyle: React.CSSProperties = {
  fontSize: '15px',
  fontWeight: 600,
  color: '#1E3A5F',
  marginBottom: '20px',
  marginTop: 0,
};

const itemStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '8px 0',
  borderBottom: '1px solid #F3F4F6',
};

const lbl: React.CSSProperties = { fontSize: 13, color: '#6B7280' };
const val: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  color: '#111827',
  fontVariantNumeric: 'tabular-nums',
};
const accent: React.CSSProperties = { ...val, color: '#1E3A5F' };
const groupTitle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: '#1E3A5F',
  marginBottom: 8,
  paddingBottom: 6,
  borderBottom: '2px solid #1E3A5F',
  letterSpacing: '0.02em',
};

/* ------------------------------------------------------------------ */
/*  금액 포맷 헬퍼                                                      */
/* ------------------------------------------------------------------ */

function formatAmountDisplay(value: number | null | undefined): string {
  if (value == null || value === 0) return '-';
  const man = value / 10000;
  if (man >= 10000) return `${(man / 10000).toFixed(1)}억원`;
  return `${man.toLocaleString('ko-KR')}만원`;
}

function formatManwon(value: number | null | undefined): string {
  if (value == null || value === 0) return '-';
  const man = Math.round(value / 10000);
  return `${man.toLocaleString('ko-KR')}만원`;
}

/* ------------------------------------------------------------------ */
/*  기본정보 카드 (3번탭 BasicInfoCard와 동일 스타일)                    */
/* ------------------------------------------------------------------ */

function BasicInfoCard({
  data,
  currentAge,
  planStartYear,
}: {
  data: DesiredPlanAPI | null;
  currentAge: number | null;
  planStartYear: number;
}) {
  if (!data) {
    return (
      <div
        style={{
          padding: '24px',
          backgroundColor: '#F9FAFB',
          borderRadius: '8px',
          textAlign: 'center',
          color: '#9CA3AF',
          fontSize: '13px',
        }}
      >
        1번탭에서 희망은퇴플랜을 먼저 저장해주세요.
      </div>
    );
  }

  const retirementAge = data.desired_retirement_age ?? null;
  const savingsPeriod = data.savings_period_years ?? null;
  const holdingPeriod = data.holding_period_years ?? null;
  const monthlySavings = data.simulation_monthly_savings ?? null;
  const annualSavings =
    data.annual_savings_amount ?? (monthlySavings != null ? monthlySavings * 12 : null);
  const annualLumpSum = data.simulation_annual_lump_sum ?? null;
  const totalLumpSum = data.simulation_total_lump_sum ?? null;
  const expectedReturnRate =
    data.expected_return_rate != null
      ? (data.expected_return_rate * 100).toFixed(1) + '%'
      : '-';
  const targetFund =
    data.simulation_target_fund ?? data.target_retirement_fund ?? null;
  const monthlyPension =
    data.monthly_desired_amount ?? data.future_monthly_amount ?? null;
  const useInflationInput = !!(data as any).use_inflation_input;
  const useInflationCalc = !!(data as any).use_inflation_calc;
  const inflationRate =
    data.inflation_rate != null
      ? (data.inflation_rate * 100).toFixed(1) + '%'
      : '-';

  const totalPeriod =
    savingsPeriod != null && holdingPeriod != null ? savingsPeriod + holdingPeriod : null;
  const totalInvestment =
    annualSavings != null && savingsPeriod != null && totalLumpSum != null
      ? annualSavings * savingsPeriod + totalLumpSum
      : null;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 20 }}>
      {/* 그룹1: 기간 설정 */}
      <div
        style={{
          padding: '16px 20px',
          backgroundColor: '#FAFBFC',
          borderRadius: 10,
          border: '1px solid #E5E7EB',
        }}
      >
        <div style={groupTitle}>기간 설정</div>
        <div style={itemStyle}>
          <span style={lbl}>플랜 시작나이</span>
          <span style={accent}>{currentAge != null ? `${currentAge - (new Date().getFullYear() - planStartYear)}세` : '-'}</span>
        </div>
        <div style={itemStyle}>
          <span style={lbl}>희망 은퇴나이</span>
          <span style={accent}>{retirementAge != null ? `${retirementAge}세` : '-'}</span>
        </div>
        <div style={itemStyle}>
          <span style={lbl}>총 투자기간</span>
          <span style={val}>{totalPeriod != null ? `${totalPeriod}년` : '-'}</span>
        </div>
        <div style={{ ...itemStyle, borderBottom: 'none' }}>
          <span style={lbl}>구성</span>
          <span style={{ fontSize: 13, color: '#374151' }}>
            적립 {savingsPeriod ?? '-'}년 + 거치 {holdingPeriod ?? '-'}년
          </span>
        </div>
      </div>

      {/* 그룹2: 투자 계획 */}
      <div
        style={{
          padding: '16px 20px',
          backgroundColor: '#FAFBFC',
          borderRadius: 10,
          border: '1px solid #E5E7EB',
        }}
      >
        <div style={groupTitle}>투자 계획</div>
        <div style={itemStyle}>
          <span style={lbl}>연적립금액</span>
          <span style={val}>{formatManwon(annualSavings)}</span>
        </div>
        <div style={itemStyle}>
          <span style={lbl}>연거치금액</span>
          <span style={val}>{formatManwon(annualLumpSum)}</span>
        </div>
        <div style={itemStyle}>
          <span style={lbl}>총거치금액</span>
          <span style={val}>{formatAmountDisplay(totalLumpSum)}</span>
        </div>
        <div style={{ ...itemStyle, borderBottom: 'none' }}>
          <span style={lbl}>총투자금액</span>
          <span style={{ ...val, fontSize: 15 }}>{formatAmountDisplay(totalInvestment)}</span>
        </div>
      </div>

      {/* 그룹3: 목표 */}
      <div
        style={{
          padding: '16px 20px',
          backgroundColor: '#F0F4FA',
          borderRadius: 10,
          border: '1px solid #D0DAE8',
        }}
      >
        <div style={groupTitle}>목표</div>
        <div style={itemStyle}>
          <span style={lbl}>예상 수익률</span>
          <span style={{ ...val, color: '#16A34A' }}>{expectedReturnRate}</span>
        </div>
        <div style={itemStyle}>
          <span style={lbl}>은퇴연금(월)</span>
          <span style={{ ...val, color: '#DC2626' }}>
            {formatManwon(monthlyPension)}
            <span style={{ marginLeft: 6, fontSize: 10, padding: '1px 5px', borderRadius: 3, backgroundColor: useInflationInput ? '#DCFCE7' : '#FEF2F2', color: useInflationInput ? '#16A34A' : '#9CA3AF' }}>
              물가{useInflationInput ? 'O' : 'X'}
            </span>
          </span>
        </div>
        <div style={itemStyle}>
          <span style={lbl}>물가상승률</span>
          <span style={val}>{inflationRate}</span>
        </div>
        <div style={{ ...itemStyle, borderBottom: 'none', paddingTop: 12 }}>
          <span style={lbl}>희망 은퇴금액</span>
          <span
            style={{
              fontSize: 18,
              fontWeight: 800,
              color: '#1E3A5F',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {formatAmountDisplay(targetFund)}
            <span style={{ marginLeft: 6, fontSize: 10, padding: '1px 5px', borderRadius: 3, backgroundColor: useInflationCalc ? '#DCFCE7' : '#FEF2F2', color: useInflationCalc ? '#16A34A' : '#9CA3AF' }}>
              물가{useInflationCalc ? 'O' : 'X'}
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  100세 플로우 계산 함수                                              */
/* ------------------------------------------------------------------ */

function calcLifetimeRows(
  currentAge: number,
  data: DesiredPlanAPI,
  appliedYears: Record<number, AppliedYearData>,
  overrides: Record<number, YearOverride>,
  planStartYear: number
): LifetimeRow[] {
  const expectedReturnRateBase = data.expected_return_rate ?? 0.06;
  const retirementPensionRate = data.retirement_pension_rate ?? expectedReturnRateBase;

  // 1번탭 simulation_data를 그대로 사용 (연도, 연차, 나이, 구분, 누적원금, 총평가액 등 고정)
  const simData = (data.simulation_data ?? []) as Record<string, unknown>[];
  if (simData.length === 0) return [];

  const rows: LifetimeRow[] = [];
  let prevNetAsset = 0;
  let needsRecalc = false; // override나 보정이 발생하면 이후 행 전체 재계산
  let runningPayment = 0;  // override 반영된 누적 총납입금액
  let runningPension = 0;  // override 반영된 누적 중도인출
  const appliedYearKeys = Object.keys(appliedYears).map(Number).sort((a, b) => a - b);

  for (let i = 0; i < simData.length; i++) {
    const s = simData[i];
    const year = Number(s.year ?? i + 1);
    const age = Number(s.age ?? 0);
    const calendarYear = planStartYear + year - 1;
    const phase = (String(s.phase ?? 'saving')) as 'saving' | 'holding' | 'retirement';
    const origPrincipal = Number(s.cumulative_principal ?? 0) / 10000;
    const totalEvaluation = Number(s.evaluation ?? 0) / 10000;
    const origSavings = Number(s.monthly_payment ?? 0) * 12 / 10000;
    const origLumpSum = Number(s.additional ?? 0) / 10000;
    const origPension = Number(s.pension ?? 0) / 10000;
    const returnRate = phase === 'retirement'
      ? (retirementPensionRate > 0 ? retirementPensionRate : expectedReturnRateBase)
      : expectedReturnRateBase;

    // 오버라이드 (사용자 직접 수정)
    const ov = overrides[year] ?? {};
    const hasOverride = Object.keys(ov).length > 0;
    const yearReturnRate = ov.returnRate !== undefined ? ov.returnRate : returnRate;
    const ovSavings = ov.annualSavings !== undefined ? ov.annualSavings : origSavings;
    const ovLumpSum = ov.lumpSum !== undefined ? ov.lumpSum : origLumpSum;
    const ovPension = ov.pension !== undefined ? ov.pension : origPension;

    // 총납입금액: 항상 연적립+일시납을 누적 계산
    if (hasOverride) needsRecalc = true;
    runningPayment += ovSavings + ovLumpSum;
    // 중도인출 누적: override 반영
    runningPension += ovPension;

    // 보정: appliedYears에 달력연도 키가 있으면 연간투자흐름표 실적 적용
    const appliedKey = appliedYearKeys.find((k) => k === calendarYear);
    let adjustedEvaluation = 0;
    let isAdjusted = false;
    let appliedSavings = ovSavings;
    let appliedLumpSum = ovLumpSum;
    let appliedReturnRate = yearReturnRate;
    let appliedNetAssetReturnRate = 0;

    if (appliedKey !== undefined) {
      const d = appliedYears[appliedKey];
      // 연간투자흐름표에서 전달된 값 적용 (원 단위 → 만원 변환)
      if (d.lump_sum !== undefined) appliedLumpSum = d.lump_sum >= 100000 ? d.lump_sum / 10000 : d.lump_sum;
      if (d.annual_savings !== undefined) appliedSavings = d.annual_savings >= 100000 ? d.annual_savings / 10000 : d.annual_savings;
      if (d.annual_return_rate !== undefined) appliedReturnRate = d.annual_return_rate / 100; // % → 소수
      if (d.annual_evaluation !== undefined) {
        adjustedEvaluation = d.annual_evaluation >= 100000 ? d.annual_evaluation / 10000 : d.annual_evaluation;
      }
      if (d.net_asset_return_rate !== undefined) appliedNetAssetReturnRate = d.net_asset_return_rate;
      const netAssetVal = (d.net_asset ?? 0);
      if (netAssetVal > 0) {
        isAdjusted = true;
        needsRecalc = true;
      }
    }

    // 보정후순자산 계산
    let adjustedNetAsset: number;
    if (isAdjusted) {
      // 보정 행: 연간투자흐름표에서 적용된 값 그대로 사용
      const d = appliedYears[appliedKey!];
      const netAssetVal = (d.net_asset ?? 0);
      adjustedNetAsset = netAssetVal >= 100000 ? netAssetVal / 10000 : netAssetVal;
      // 총납입금액: 연간투자흐름표의 total_contribution 표시
      const appliedTotal = d.total_contribution ?? 0;
      runningPayment = appliedTotal >= 100000 ? appliedTotal / 10000 : appliedTotal;
    } else if (needsRecalc && i > 0) {
      // 보정 이후: FV(예상수익률/12, 12, -월적립, -(일시납 + 직전보정후순자산))
      const monthlyRate = appliedReturnRate / 12;
      const monthlyPmt = appliedSavings / 12; // 연적립 → 월적립 (만원)
      const pv = appliedLumpSum + prevNetAsset; // 일시납 + 직전 보정후순자산
      adjustedNetAsset = Math.max(0, excelFV(monthlyRate, 12, -monthlyPmt, -pv) - ovPension);
      // 총납입금액: 직전 총납입 + 당해 적립 + 일시납
      runningPayment += appliedSavings + appliedLumpSum;
    } else {
      adjustedNetAsset = totalEvaluation;
      runningPayment += appliedSavings + appliedLumpSum;
    }

    // 순자산수익률: 직전년도 대비 증감률
    const netAssetReturnRate = isAdjusted
      ? (appliedNetAssetReturnRate || 0)
      : (prevNetAsset > 0 ? ((adjustedNetAsset - prevNetAsset) / prevNetAsset * 100) : 0);

    rows.push({
      year,
      calendarYear,
      age,
      phase,
      cumulativePrincipal: origPrincipal,
      totalEvaluation,
      annualSavings: appliedSavings,
      lumpSum: appliedLumpSum,
      returnRate: appliedReturnRate,
      totalPayment: runningPayment,
      adjustedEvaluation,
      pension: ovPension,
      cumulativePension: runningPension,
      adjustedNetAsset,
      netAssetReturnRate,
      isAdjusted,
    });

    prevNetAsset = adjustedNetAsset;
  }

  return rows;
}

/* ------------------------------------------------------------------ */
/*  인라인 편집 셀 컴포넌트                                             */
/* ------------------------------------------------------------------ */

interface EditableCellProps {
  value: number;
  isEditable: boolean;
  isOverridden: boolean;
  displayText: string;      // 표시용 텍스트 (포맷된 문자열)
  inputValue: string;       // input 내부 값 (숫자 문자열)
  placeholder?: string;
  onCommit: (raw: string) => void;
  style?: React.CSSProperties;
}

function EditableCell({
  isEditable,
  isOverridden,
  displayText,
  inputValue,
  placeholder,
  onCommit,
  style,
}: EditableCellProps) {
  const [editing, setEditing] = useState(false);
  const [localVal, setLocalVal] = useState(inputValue);
  const inputRef = useRef<HTMLInputElement>(null);

  // 외부 inputValue 변경 시 로컬 상태 동기화 (편집 중이 아닐 때만)
  useEffect(() => {
    if (!editing) {
      setLocalVal(inputValue);
    }
  }, [inputValue, editing]);

  const handleClick = useCallback(() => {
    if (!isEditable) return;
    setLocalVal(inputValue);
    setEditing(true);
  }, [isEditable, inputValue]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const handleBlur = useCallback(() => {
    setEditing(false);
    onCommit(localVal);
  }, [localVal, onCommit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        setEditing(false);
        onCommit(localVal);
      } else if (e.key === 'Escape') {
        setEditing(false);
        setLocalVal(inputValue);
      }
    },
    [localVal, inputValue, onCommit]
  );

  if (!isEditable) {
    return <span style={style}>{displayText}</span>;
  }

  const cellStyle: React.CSSProperties = {
    cursor: 'pointer',
    borderRadius: 3,
    padding: '2px 4px',
    border: isOverridden ? '1.5px solid #3B82F6' : '1.5px solid transparent',
    backgroundColor: isOverridden ? '#EFF6FF' : 'transparent',
    minWidth: 60,
    display: 'inline-block',
    textAlign: 'right',
    ...style,
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="number"
        value={localVal}
        onChange={(e) => setLocalVal(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        style={{
          width: 80,
          textAlign: 'right',
          fontSize: 12,
          padding: '3px 4px',
          border: '1.5px solid #3B82F6',
          borderRadius: 3,
          outline: 'none',
          backgroundColor: '#EFF6FF',
          fontVariantNumeric: 'tabular-nums',
        }}
      />
    );
  }

  return (
    <span style={cellStyle} onClick={handleClick} title="클릭하여 편집">
      {displayText}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  테이블 컴포넌트                                                      */
/* ------------------------------------------------------------------ */

const PHASE_BG: Record<string, string> = {
  saving: '#EFF6FF',
  holding: '#FFFBEB',
  retirement: '#F0FDF4',
};

const PHASE_LABEL: Record<string, string> = {
  saving: '적립',
  holding: '거치',
  retirement: '은퇴후',
};

const PHASE_COLOR: Record<string, string> = {
  saving: '#2563EB',
  holding: '#D97706',
  retirement: '#16A34A',
};

function LifetimeTable({
  rows,
  retirementAge,
  overrides,
  onOverrideChange,
}: {
  rows: LifetimeRow[];
  retirementAge: number;
  overrides: Record<number, YearOverride>;
  onOverrideChange: (year: number, field: keyof YearOverride, value: number | undefined) => void;
}) {
  const thStyle: React.CSSProperties = {
    padding: '10px 10px',
    textAlign: 'right',
    fontSize: '11px',
    fontWeight: 600,
    color: '#6B7280',
    borderBottom: '2px solid #E5E7EB',
    whiteSpace: 'nowrap',
    backgroundColor: '#F9FAFB',
    position: 'sticky',
    top: 0,
    zIndex: 1,
  };
  const thCenter: React.CSSProperties = { ...thStyle, textAlign: 'center' };

  // 편집 가능 여부 판단
  const canEditSavings = (row: LifetimeRow) => !row.isAdjusted;
  const canEditLumpSum = (row: LifetimeRow) => !row.isAdjusted;
  const canEditReturnRate = (row: LifetimeRow) => !row.isAdjusted;
  const canEditPension = (row: LifetimeRow) => !row.isAdjusted;

  // 표시용 텍스트 포맷
  const fmtMoney = (v: number) => v > 0 ? formatCurrency(Math.round(v)) : '-';
  const fmtRate = (v: number) => `${(v * 100).toFixed(1)}%`;

  return (
    <div style={{ overflowX: 'auto', maxHeight: '520px', overflowY: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
        <thead>
          <tr>
            <th style={thCenter}>연도</th>
            <th style={thCenter}>연차</th>
            <th style={thCenter}>나이</th>
            <th style={thCenter}>구분</th>
            <th style={thStyle}>누적원금</th>
            <th style={thStyle}>총 평가액</th>
            <th style={{ ...thStyle, color: '#2563EB' }}>연적립금액 ✎</th>
            <th style={{ ...thStyle, color: '#2563EB' }}>일시납금액 ✎</th>
            <th style={{ ...thCenter, color: '#2563EB' }}>예상수익률 ✎</th>
            <th style={thStyle}>총납입금액</th>
            <th style={thStyle}>보정평가금액</th>
            <th style={{ ...thStyle, color: '#DC2626' }}>중도인출 ✎</th>
            <th style={{ ...thStyle, color: '#DC2626' }}>중도인출누적</th>
            <th style={{ ...thStyle, color: '#1E3A5F' }}>보정후순자산</th>
            <th style={thCenter}>순자산수익률</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isRetirementAge = row.age === retirementAge;
            const bg = row.isAdjusted
              ? '#FEF3C7'  // 보정 행: 연한 노란색 배경 (강조)
              : isRetirementAge
                ? 'rgba(30,58,95,0.08)'
                : PHASE_BG[row.phase] ?? '#ffffff';

            const tdBase: React.CSSProperties = {
              padding: '7px 10px',
              textAlign: 'right',
              whiteSpace: 'nowrap',
              backgroundColor: bg,
              borderBottom: '1px solid #F3F4F6',
              fontVariantNumeric: 'tabular-nums',
              fontWeight: row.isAdjusted ? 600 : undefined,
            };
            const tdCenter: React.CSSProperties = { ...tdBase, textAlign: 'center' };
            const tdFirst: React.CSSProperties = { ...tdCenter };

            const ov = overrides[row.year] ?? {};

            // 연적립금액 편집
            const savingsEditable = canEditSavings(row);
            const savingsOverridden = ov.annualSavings !== undefined;
            const savingsInputVal = savingsOverridden
              ? String(ov.annualSavings)
              : row.annualSavings > 0 ? String(Math.round(row.annualSavings)) : '';

            // 일시납금액 편집
            const lumpSumEditable = canEditLumpSum(row);
            const lumpSumOverridden = ov.lumpSum !== undefined;
            const lumpSumInputVal = lumpSumOverridden
              ? String(ov.lumpSum)
              : row.lumpSum > 0 ? String(Math.round(row.lumpSum)) : '';

            // 예상수익률 편집
            const rateEditable = canEditReturnRate(row);
            const rateOverridden = ov.returnRate !== undefined;
            // 수익률은 % 단위로 편집 (0.06 → "6")
            const rateInputVal = rateOverridden
              ? String((ov.returnRate! * 100).toFixed(2))
              : String((row.returnRate * 100).toFixed(2));

            // 연금액 편집
            const pensionEditable = canEditPension(row);
            const pensionOverridden = ov.pension !== undefined;
            const pensionInputVal = pensionOverridden
              ? String(ov.pension)
              : row.pension > 0 ? String(Math.round(row.pension)) : '';

            return (
              <tr key={row.age}>
                <td style={{ ...tdCenter, fontSize: 11, color: '#9CA3AF' }}>{row.calendarYear}</td>
                <td style={tdFirst}>{row.year}</td>
                <td style={{ ...tdCenter, fontWeight: isRetirementAge ? 700 : 400, color: isRetirementAge ? '#1E3A5F' : '#374151' }}>
                  {row.age}세
                  {isRetirementAge && (
                    <span style={{ marginLeft: 3, fontSize: 10, color: '#1E3A5F' }}>★</span>
                  )}
                </td>
                <td style={{ ...tdCenter, color: PHASE_COLOR[row.phase], fontWeight: 600 }}>
                  {PHASE_LABEL[row.phase]}
                </td>
                <td style={tdBase}>{formatCurrency(Math.round(row.cumulativePrincipal))}</td>
                <td style={tdBase}>{formatCurrency(Math.round(row.totalEvaluation))}</td>

                {/* 연적립금액 (편집 가능: 적립기간 + !isAdjusted) */}
                <td style={tdBase}>
                  <EditableCell
                    value={row.annualSavings}
                    isEditable={savingsEditable}
                    isOverridden={savingsOverridden}
                    displayText={fmtMoney(row.annualSavings)}
                    inputValue={savingsInputVal}
                    placeholder="만원"
                    onCommit={(raw) => {
                      const n = parseFloat(raw);
                      onOverrideChange(row.year, 'annualSavings', isNaN(n) ? undefined : n);
                    }}
                  />
                </td>

                {/* 일시납금액 (편집 가능: 적립기간 + !isAdjusted) */}
                <td style={tdBase}>
                  <EditableCell
                    value={row.lumpSum}
                    isEditable={lumpSumEditable}
                    isOverridden={lumpSumOverridden}
                    displayText={fmtMoney(row.lumpSum)}
                    inputValue={lumpSumInputVal}
                    placeholder="만원"
                    onCommit={(raw) => {
                      const n = parseFloat(raw);
                      onOverrideChange(row.year, 'lumpSum', isNaN(n) ? undefined : n);
                    }}
                  />
                </td>

                {/* 예상수익률 (편집 가능: !isAdjusted) */}
                <td style={tdCenter}>
                  <EditableCell
                    value={row.returnRate}
                    isEditable={rateEditable}
                    isOverridden={rateOverridden}
                    displayText={fmtRate(row.returnRate)}
                    inputValue={rateInputVal}
                    placeholder="%"
                    onCommit={(raw) => {
                      const n = parseFloat(raw);
                      // % 단위로 입력받아 소수로 변환
                      onOverrideChange(row.year, 'returnRate', isNaN(n) ? undefined : n / 100);
                    }}
                  />
                </td>

                <td style={{ ...tdBase, fontWeight: 600 }}>{formatCurrency(Math.round(row.totalPayment))}</td>
                <td style={{ ...tdBase, color: row.isAdjusted ? '#2563EB' : '#9CA3AF' }}>
                  {row.isAdjusted ? formatCurrency(Math.round(row.adjustedEvaluation)) : '-'}
                </td>

                {/* 연금액 (편집 가능: 은퇴후) */}
                <td style={{ ...tdBase, color: row.pension > 0 ? '#DC2626' : '#9CA3AF' }}>
                  <EditableCell
                    value={row.pension}
                    isEditable={pensionEditable}
                    isOverridden={pensionOverridden}
                    displayText={row.pension > 0 ? formatCurrency(Math.round(row.pension)) : '-'}
                    inputValue={pensionInputVal}
                    placeholder="만원"
                    onCommit={(raw) => {
                      const n = parseFloat(raw);
                      onOverrideChange(row.year, 'pension', isNaN(n) ? undefined : n);
                    }}
                    style={{ color: row.pension > 0 ? '#DC2626' : '#9CA3AF' }}
                  />
                </td>

                <td style={{ ...tdBase, color: row.cumulativePension > 0 ? '#DC2626' : '#9CA3AF' }}>
                  {row.cumulativePension > 0 ? formatCurrency(Math.round(row.cumulativePension)) : '-'}
                </td>
                <td style={{ ...tdBase, fontWeight: 700, color: row.adjustedNetAsset >= row.totalEvaluation ? '#2563EB' : '#DC2626' }}>
                  {formatCurrency(Math.round(row.adjustedNetAsset))}
                </td>
                <td style={{
                  ...tdCenter,
                  color: row.netAssetReturnRate >= 0 ? '#16A34A' : '#DC2626',
                  fontWeight: 600,
                }}>
                  {row.cumulativePrincipal > 0 ? `${row.netAssetReturnRate.toFixed(1)}%` : '-'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={{ textAlign: 'right', fontSize: 11, color: '#9CA3AF', marginTop: 4 }}>
        (단위: 만원) &nbsp;|&nbsp; ✎ 표시 열은 셀 클릭 시 직접 편집 가능 (연간투자흐름표 적용행 제외)
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  아코디언 섹션 컴포넌트                                              */
/* ------------------------------------------------------------------ */

function AccordionSection({
  title,
  defaultOpen = false,
  children,
  badge,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
  badge?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div
      style={{
        border: '1px solid #E5E7EB',
        borderRadius: '10px',
        overflow: 'hidden',
      }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 20px',
          backgroundColor: open ? '#F0F4FA' : '#F9FAFB',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
          transition: 'background-color 0.15s',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#1E3A5F' }}>{title}</span>
          {badge && (
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                padding: '2px 8px',
                borderRadius: 10,
                backgroundColor: '#DBEAFE',
                color: '#1D4ED8',
              }}
            >
              {badge}
            </span>
          )}
        </div>
        <span
          style={{
            fontSize: 18,
            color: '#6B7280',
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform 0.2s',
            display: 'inline-block',
          }}
        >
          ▾
        </span>
      </button>
      {open && (
        <div style={{ padding: '20px' }}>{children}</div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  메인 컴포넌트                                                        */
/* ------------------------------------------------------------------ */

export function LifetimeRetirementFlow({
  currentAge,
  desiredPlanData: propDesiredPlanData,
  annualFlowData,
  appliedYears,
}: LifetimeRetirementFlowProps) {
  void annualFlowData;
  const { selectedCustomerId } = useRetirementStore();

  // Props로 받은 데이터가 없으면 직접 로드
  const [localDesiredPlanData, setLocalDesiredPlanData] = useState<DesiredPlanAPI | null>(null);
  const [loading, setLoading] = useState(false);

  // 연차별 사용자 수정값
  const [overrides, setOverrides] = useState<Record<number, YearOverride>>({});

  useEffect(() => {
    if (propDesiredPlanData != null) {
      setLocalDesiredPlanData(propDesiredPlanData);
      return;
    }
    if (!selectedCustomerId) {
      setLocalDesiredPlanData(null);
      return;
    }
    setLoading(true);
    fetch(`${API_URL}/api/v1/retirement/desired-plans/${selectedCustomerId}`, {
      headers: authLib.getAuthHeader(),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setLocalDesiredPlanData(data ?? null))
      .catch(() => setLocalDesiredPlanData(null))
      .finally(() => setLoading(false));
  }, [propDesiredPlanData, selectedCustomerId]);

  const planData = propDesiredPlanData ?? localDesiredPlanData;

  // override 핸들러
  const handleOverrideChange = useCallback(
    (year: number, field: keyof YearOverride, value: number | undefined) => {
      setOverrides((prev) => {
        const prevYear = prev[year] ?? {};
        const updated = { ...prevYear };
        if (value === undefined) {
          delete updated[field];
        } else {
          updated[field] = value;
        }
        if (Object.keys(updated).length === 0) {
          const next = { ...prev };
          delete next[year];
          return next;
        }
        return { ...prev, [year]: updated };
      });
    },
    []
  );

  // 수정값 초기화 핸들러
  const handleResetOverrides = useCallback(() => {
    setOverrides({});
  }, []);

  // 플랜 시작연도
  const startYear = (planData as any)?.plan_start_year ?? new Date().getFullYear();

  // 100세 플로우 계산 (overrides 포함)
  const rows = useMemo<LifetimeRow[]>(() => {
    if (!planData || currentAge == null || currentAge <= 0) return [];
    return calcLifetimeRows(currentAge, planData, appliedYears, overrides, startYear);
  }, [planData, currentAge, appliedYears, overrides, startYear]);

  const retirementAge = planData?.desired_retirement_age ?? 65;

  // 수정된 셀 카운트
  const overrideCount = useMemo(
    () => Object.values(overrides).reduce((sum, ov) => sum + Object.keys(ov).length, 0),
    [overrides]
  );

  // 그래프용 데이터 (만원 단위)
  const chartData = useMemo(() => {
    return rows.map((r) => ({
      age: r.age,
      총납입금액: Math.round(r.totalPayment),
      총평가액: Math.round(r.totalEvaluation),
      보정후순자산: Math.round(r.adjustedNetAsset),
      phase: r.phase,
      isAdjusted: r.isAdjusted,
    }));
  }, [rows]);

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: '#9CA3AF', fontSize: 14 }}>
        데이터 로딩 중...
      </div>
    );
  }

  if (!planData) {
    return (
      <div
        style={{
          padding: '24px',
          backgroundColor: '#F9FAFB',
          borderRadius: '8px',
          textAlign: 'center',
          color: '#9CA3AF',
          fontSize: '14px',
        }}
      >
        1번탭에서 희망은퇴플랜을 먼저 저장해주세요.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* A. 기본정보 카드 */}
      <div style={cardStyle}>
        <h3 style={sectionTitleStyle}>기본정보</h3>
        <BasicInfoCard data={planData} currentAge={currentAge} planStartYear={startYear} />
      </div>

      {/* B. 100세 은퇴플로우 테이블 (아코디언) */}
      <AccordionSection
        title="100세 은퇴플로우 테이블"
        defaultOpen={true}
        badge={rows.length > 0 ? `${rows.length}행` : undefined}
      >
        {rows.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: '#9CA3AF', fontSize: 14 }}>
            현재나이 또는 은퇴플랜 데이터가 없습니다.
          </div>
        ) : (
          <>
            {/* 상단 툴바: 범례 + 초기화 버튼 */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
              {/* 범례 */}
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                {[
                  { color: '#EFF6FF', border: '#BFDBFE', label: '적립기간', textColor: '#2563EB' },
                  { color: '#FFFBEB', border: '#FDE68A', label: '거치기간', textColor: '#D97706' },
                  { color: '#F0FDF4', border: '#BBF7D0', label: '은퇴 후', textColor: '#16A34A' },
                  { color: '#DBEAFE', border: '#3B82F6', label: '보정된 행', textColor: '#1D4ED8', leftBar: true },
                ].map(({ color, border, label, textColor, leftBar }) => (
                  <div
                    key={label}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 12,
                      color: '#6B7280',
                    }}
                  >
                    <div
                      style={{
                        width: 16,
                        height: 14,
                        backgroundColor: color,
                        border: `1px solid ${border}`,
                        borderRadius: 3,
                        borderLeft: leftBar ? `3px solid ${border}` : undefined,
                      }}
                    />
                    <span style={{ color: textColor, fontWeight: 500 }}>{label}</span>
                  </div>
                ))}
              </div>

              {/* 수정값 초기화 버튼 */}
              <button
                onClick={handleResetOverrides}
                disabled={overrideCount === 0}
                style={{
                  padding: '6px 14px',
                  fontSize: 12,
                  fontWeight: 600,
                  borderRadius: 6,
                  border: '1px solid',
                  borderColor: overrideCount > 0 ? '#3B82F6' : '#D1D5DB',
                  backgroundColor: overrideCount > 0 ? '#EFF6FF' : '#F9FAFB',
                  color: overrideCount > 0 ? '#2563EB' : '#9CA3AF',
                  cursor: overrideCount > 0 ? 'pointer' : 'not-allowed',
                  whiteSpace: 'nowrap',
                  transition: 'all 0.15s',
                }}
              >
                수정값 초기화{overrideCount > 0 ? ` (${overrideCount}개)` : ''}
              </button>
            </div>

            <LifetimeTable
              rows={rows}
              retirementAge={retirementAge}
              overrides={overrides}
              onOverrideChange={handleOverrideChange}
            />
          </>
        )}
      </AccordionSection>

      {/* C. 그래프 (아코디언) */}
      <AccordionSection title="100세 은퇴플로우 그래프" defaultOpen={true}>
        {chartData.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: '#9CA3AF', fontSize: 14 }}>
            데이터가 없습니다.
          </div>
        ) : (
          <LifetimeFlowChart
            data={chartData}
            retirementAge={retirementAge}
          />
        )}
      </AccordionSection>
    </div>
  );
}

export default LifetimeRetirementFlow;
