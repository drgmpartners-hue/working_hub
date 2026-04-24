'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { useRetirementStore } from '../../hooks/useRetirementStore';
import { ExportButtons } from '../ExportButtons';
import { API_URL } from '@/lib/api-url';
import { authLib } from '@/lib/auth';

const PensionOptionChart = dynamic(() => import('./PensionOptionChart'), { ssr: false });

/* ------------------------------------------------------------------ */
/*  엑셀 재무 함수                                                      */
/* ------------------------------------------------------------------ */

function excelPMT(rate: number, nper: number, pv: number, fv = 0, type = 0): number {
  if (rate === 0) return -(pv + fv) / nper;
  const pvif = Math.pow(1 + rate, nper);
  return (-pv * pvif * rate - fv * rate) / ((pvif - 1) * (1 + rate * type));
}

function excelFV(rate: number, nper: number, pmt: number, pv: number, type = 0): number {
  if (rate === 0) return -(pv + pmt * nper);
  const pvif = Math.pow(1 + rate, nper);
  return -pv * pvif - pmt * (pvif - 1) / rate * (1 + rate * type);
}

/* ------------------------------------------------------------------ */
/*  포맷                                                               */
/* ------------------------------------------------------------------ */

function fmt(n: number): string { return n.toLocaleString('ko-KR'); }
function fmtW(n: number): string {
  if (Math.abs(n) >= 1e8) return `${(n / 1e8).toFixed(1)}억원`;
  if (Math.abs(n) >= 1e4) return `${fmt(Math.round(n / 1e4))}만원`;
  return `${fmt(Math.round(n))}원`;
}

/* ------------------------------------------------------------------ */
/*  스타일                                                              */
/* ------------------------------------------------------------------ */

const cardStyle: React.CSSProperties = {
  backgroundColor: '#ffffff', border: '1px solid #E5E7EB',
  borderRadius: '12px', padding: '24px',
};
const sectionTitle: React.CSSProperties = {
  fontSize: '16px', fontWeight: 700, color: '#1E3A5F',
  marginBottom: '20px', marginTop: 0,
};
const subTitle: React.CSSProperties = {
  fontSize: '14px', fontWeight: 600, color: '#374151', marginBottom: '12px',
};
const inputStyle: React.CSSProperties = {
  width: '100%', height: '36px', padding: '0 40px 0 10px',
  fontSize: '13px', color: '#1A1A2E', backgroundColor: '#fff',
  border: '1px solid #D1D5DB', borderRadius: '6px',
  outline: 'none', boxSizing: 'border-box', textAlign: 'right',
};
const unitSpan: React.CSSProperties = {
  position: 'absolute', right: '10px', top: '50%',
  transform: 'translateY(-50%)', fontSize: '11px', color: '#6B7280',
  pointerEvents: 'none',
};
const labelStyle: React.CSSProperties = {
  fontSize: '12px', fontWeight: 500, color: '#374151', whiteSpace: 'nowrap',
};

/* ------------------------------------------------------------------ */
/*  타입                                                               */
/* ------------------------------------------------------------------ */

interface Tab1Data {
  desired_retirement_age?: number | null;
  savings_period_years?: number | null;
  holding_period_years?: number | null;
  expected_return_rate?: number | null;
  simulation_target_fund?: number | null;
  target_retirement_fund?: number | null;
  retirement_pension_rate?: number | null;
  future_monthly_amount?: number | null;
  monthly_desired_amount?: number | null;
  calculation_params?: Record<string, unknown> | null;
  simulation_data?: Record<string, unknown>[] | null;
}

interface ChartPoint { age: number; balance: number; pension: number }

interface LifetimeYearData {
  age: number;
  yearPrincipal: number;   // 그 해 수령한 원금
  yearInterest: number;    // 그 해 수령한 이자
  cumPrincipal: number;    // 누적 수령 원금
  cumInterest: number;     // 누적 수령 이자
  totalReceived: number;   // 누적 총 수령연금
  balance: number;         // 남은 원금
}

interface MilestoneData {
  cumPrincipal: number;    // 수령한 원금
  cumInterest: number;     // 수령한 이자
  totalReceived: number;   // 총 수령연금
  balance: number;         // 남은 원금
}

interface LifetimeResult {
  annualPension: number; monthlyPension: number;
  milestone10yr: MilestoneData;   // 은퇴 후 10년차
  milestone100age: MilestoneData; // 100세 시점
  yearlyData: LifetimeYearData[];
  chartData: ChartPoint[];
}

interface FixedResult {
  annualPension: number; monthlyPension: number;
  totalReceived: number; totalInterest: number;
  chartData: ChartPoint[];
}

interface InfiniteResult {
  annualPension: number; monthlyPension: number;
  totalPension: number; inheritanceAmount: number;
  chartData: ChartPoint[];
}

interface GoalRow {
  lumpSum: number; annualSavings: number;
  monthlyPension: number; pensionRate: number; inheritance100: number;
}

/* ------------------------------------------------------------------ */
/*  계산 함수                                                           */
/* ------------------------------------------------------------------ */

function calcLifetime(pv: number, rate: number, retireAge: number, maxAge = 120): LifetimeResult {
  const monthlyRate = rate / 12;
  const years = maxAge - retireAge + 1; // 120세 기준: 60→120 = 61년
  const nper = years * 12;
  const emptyMs: MilestoneData = { cumPrincipal: 0, cumInterest: 0, totalReceived: 0, balance: 0 };
  const empty: LifetimeResult = { annualPension: 0, monthlyPension: 0, milestone10yr: emptyMs, milestone100age: emptyMs, yearlyData: [], chartData: [] };
  if (nper <= 0 || pv <= 0) return empty;

  const monthlyPmt = excelPMT(monthlyRate, nper, -pv, 0, 1); // PV가 음수 → PMT 양수(수령)
  const annualPmt = monthlyPmt * 12;
  const yearlyData: LifetimeYearData[] = [];
  const chartData: ChartPoint[] = [];
  let balance = pv, cumPrincipal = 0, cumInterest = 0;
  const yr100 = 100 - retireAge; // 100세 = 은퇴 후 몇 년차
  let m10yr: MilestoneData = emptyMs, m100age: MilestoneData = emptyMs;

  for (let yr = 1; yr <= years; yr++) {
    let yrPrincipal = 0, yrInterest = 0;
    for (let m = 1; m <= 12; m++) {
      if ((yr - 1) * 12 + m > nper) break;
      const interest = balance * monthlyRate;
      const principal = monthlyPmt - interest;
      yrPrincipal += principal;
      yrInterest += interest;
      balance -= principal;
    }
    cumPrincipal += yrPrincipal;
    cumInterest += yrInterest;
    const bal = Math.max(0, balance);

    yearlyData.push({
      age: retireAge + yr, yearPrincipal: yrPrincipal, yearInterest: yrInterest,
      cumPrincipal, cumInterest, totalReceived: cumPrincipal + cumInterest, balance: bal,
    });
    chartData.push({ age: retireAge + yr, balance: Math.round(bal), pension: Math.round(annualPmt) });

    if (yr === 10) m10yr = { cumPrincipal, cumInterest, totalReceived: cumPrincipal + cumInterest, balance: bal };
    if (yr === yr100) m100age = { cumPrincipal, cumInterest, totalReceived: cumPrincipal + cumInterest, balance: bal };
  }
  return { annualPension: annualPmt, monthlyPension: monthlyPmt, milestone10yr: m10yr, milestone100age: m100age, yearlyData, chartData };
}

function calcFixed(pv: number, rate: number, periodYears: number, retireAge: number): FixedResult {
  const monthlyRate = rate / 12;
  const nper = periodYears * 12;
  if (nper <= 0 || pv <= 0) return { annualPension: 0, monthlyPension: 0, totalReceived: 0, totalInterest: 0, chartData: [] };

  const monthlyPmt = excelPMT(monthlyRate, nper, -pv, 0, 1);
  const annualPmt = monthlyPmt * 12;
  const totalReceived = monthlyPmt * nper;
  const chartData: ChartPoint[] = [];
  let balance = pv;
  for (let yr = 1; yr <= periodYears; yr++) {
    for (let m = 1; m <= 12; m++) {
      const interest = balance * monthlyRate;
      balance -= (monthlyPmt - interest);
    }
    chartData.push({ age: retireAge + yr, balance: Math.max(0, Math.round(balance)), pension: Math.round(annualPmt) });
  }
  return { annualPension: annualPmt, monthlyPension: monthlyPmt, totalReceived, totalInterest: totalReceived - pv, chartData };
}

function calcInfinite(pv: number, rate: number, periodYears: number, retireAge: number): InfiniteResult {
  const annual = pv * rate;
  const chartData: ChartPoint[] = [];
  for (let yr = 1; yr <= periodYears; yr++) {
    chartData.push({ age: retireAge + yr, balance: Math.round(pv), pension: Math.round(annual) });
  }
  return { annualPension: annual, monthlyPension: annual / 12, totalPension: annual * periodYears, inheritanceAmount: pv, chartData };
}

function calcGoalPlan(
  targetFund: number, expectedRate: number, savingYears: number, holdingYears: number,
  monthlyPension: number, lumpSums: number[], pensionRates: number[], retirePeriod: number,
): GoalRow[] {
  if (targetFund <= 0 || savingYears <= 0) return [];
  const totalYears = savingYears + holdingYears;
  return lumpSums.map((lumpSum, i) => {
    const pensionRate = pensionRates[i] ?? 0.02;
    const fvLump = excelFV(expectedRate, totalYears, 0, -lumpSum, 0);
    const fvAnnuity = excelFV(expectedRate, savingYears, -1, 0, 0);
    const denom = fvAnnuity * Math.pow(1 + expectedRate, holdingYears);
    const annualSavings = denom !== 0 ? (targetFund - fvLump) / denom : 0;
    const inheritance100 = excelFV(pensionRate, retirePeriod, monthlyPension * 12, -targetFund, 1);
    return { lumpSum, annualSavings: Math.max(0, annualSavings), monthlyPension, pensionRate, inheritance100 };
  });
}

/* ------------------------------------------------------------------ */
/*  토스트                                                              */
/* ------------------------------------------------------------------ */

function Toast({ message, type }: { message: string; type: 'success' | 'error' }) {
  return (
    <div style={{
      position: 'fixed', bottom: '32px', left: '50%', transform: 'translateX(-50%)',
      zIndex: 9999, padding: '12px 24px', borderRadius: '8px',
      backgroundColor: type === 'success' ? '#1E3A5F' : '#EF4444',
      color: '#fff', fontSize: '14px', fontWeight: 500,
      boxShadow: '0 4px 16px rgba(0,0,0,0.18)', pointerEvents: 'none',
    }}>{message}</div>
  );
}

/* ================================================================== */
/*  메인 컴포넌트                                                       */
/* ================================================================== */

export function PensionPlanTab() {
  const { selectedCustomer } = useRetirementStore();
  const customerId = selectedCustomer?.id ?? null;

  const [tab1, setTab1] = useState<Tab1Data | null>(null);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [optionTab, setOptionTab] = useState(0);

  const [lifetimeRate, setLifetimeRate] = useState('');
  const [fixedRate, setFixedRate] = useState('2');
  const [fixedPeriod, setFixedPeriod] = useState('30');
  const [infiniteRate, setInfiniteRate] = useState('5');
  const [infinitePeriod, setInfinitePeriod] = useState('40');
  const [baseLumpSum, setBaseLumpSum] = useState('10000');

  const showToast = (msg: string, t: 'success' | 'error') => {
    setToast({ message: msg, type: t }); setTimeout(() => setToast(null), 3000);
  };

  const loadTab1 = useCallback(async (cid: string) => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/retirement/desired-plans/${cid}`, { headers: authLib.getAuthHeader() });
      if (res.ok) setTab1(await res.json()); else setTab1(null);
    } catch { setTab1(null); } finally { setLoading(false); }
  }, []);

  useEffect(() => { if (customerId) loadTab1(customerId); else setTab1(null); }, [customerId, loadTab1]);

  // tab1 로드 시 은퇴연금 수익률로 초기화 (추천 연금수익률 우선, 없으면 기존 연금수익률)
  useEffect(() => {
    const cp = tab1?.calculation_params || {};
    const recRate = cp.recommended_pension_rate as number | undefined;
    const baseRate = tab1?.retirement_pension_rate;
    const rateToUse = recRate ?? baseRate;
    if (rateToUse) {
      const rateStr = String(rateToUse * 100);
      setLifetimeRate(rateStr);
      setFixedRate(rateStr);
      setInfiniteRate(rateStr);
    }
  }, [tab1]);

  // 1번탭 calculation_params에서 추천/기존 수익률 추출
  const cp = tab1?.calculation_params || {};
  const basePenRate = (cp.base_pension_rate as number) ?? tab1?.retirement_pension_rate ?? 0.02; // A고객: 연금수익률
  const recPenRate = (cp.recommended_pension_rate as number) ?? null; // B고객: 추천 연금수익률

  // A고객 연금재원: 1번탭 목표 은퇴자금 (PV 계산값)
  const pensionFundA = (cp.target_fund_pv as number) ?? tab1?.target_retirement_fund ?? 0;
  // B고객 연금재원: 시뮬레이션 테이블 은퇴나이-1 평가금액 (수정 목표)
  const simData = tab1?.simulation_data ?? (cp.modified_plan as Record<string, unknown>[]) ?? [];
  const retireAge = tab1?.desired_retirement_age ?? 65;
  const retireRow = simData.find(r => (r.age as number) === retireAge - 1);
  const pensionFundB = (retireRow?.evaluation as number) ?? tab1?.simulation_target_fund ?? 0;
  // 기본 연금재원 (하위 섹션 등에서 사용)
  const pensionFund = recPenRate ? pensionFundB : pensionFundA;

  const expectedRate = (cp.recommended_return_rate as number) ?? tab1?.expected_return_rate ?? 0.07;
  const pensionRate = recPenRate ?? basePenRate; // 추천 있으면 추천, 없으면 기존
  const savingYears = tab1?.savings_period_years ?? 5;
  const holdingYears = tab1?.holding_period_years ?? 15;

  // 연금전환 옵션 비교: A/B 고객 수익률
  const lifetimeYears = 120 - retireAge + 1;
  const fixedCompareYears = 30;
  const infiniteCompareRate = parseFloat(infiniteRate) / 100 || 0.05;

  // A고객 (은퇴연금 수익률 + A연금재원) 월연금
  const compareLifetimeMonthlyA = useMemo(() => {
    if (pensionFundA <= 0) return 0;
    return excelPMT(basePenRate / 12, lifetimeYears * 12, -pensionFundA, 0, 1);
  }, [pensionFundA, basePenRate, lifetimeYears]);
  const compareFixedMonthlyA = useMemo(() => {
    if (pensionFundA <= 0) return 0;
    return excelPMT(basePenRate / 12, fixedCompareYears * 12, -pensionFundA, 0, 1);
  }, [pensionFundA, basePenRate]);
  const compareInfiniteMonthlyA = pensionFundA * basePenRate / 12;

  // B고객 (추천 연금수익률 + B연금재원) 월연금
  const compareLifetimeMonthlyB = useMemo(() => {
    if (pensionFundB <= 0 || !recPenRate) return 0;
    return excelPMT(recPenRate / 12, lifetimeYears * 12, -pensionFundB, 0, 1);
  }, [pensionFundB, recPenRate, lifetimeYears]);
  const compareFixedMonthlyB = useMemo(() => {
    if (pensionFundB <= 0 || !recPenRate) return 0;
    return excelPMT(recPenRate / 12, fixedCompareYears * 12, -pensionFundB, 0, 1);
  }, [pensionFundB, recPenRate]);
  const compareInfiniteMonthlyB = recPenRate ? pensionFundB * recPenRate / 12 : 0;

  // 이전 호환: 개별 섹션에서 사용
  const compareLifetimeMonthly = compareLifetimeMonthlyA;
  const compareFixedMonthly = compareFixedMonthlyA;
  const compareInfiniteMonthly = pensionFund * infiniteCompareRate / 12;

  // 상세 탭용 계산
  const lifetimeResult = useMemo(() => calcLifetime(pensionFund, parseFloat(lifetimeRate) / 100 || pensionRate, retireAge, 120), [pensionFund, lifetimeRate, retireAge, pensionRate]);
  const fixedResult = useMemo(() => calcFixed(pensionFund, parseFloat(fixedRate) / 100 || pensionRate, parseInt(fixedPeriod) || 30, retireAge), [pensionFund, fixedRate, fixedPeriod, retireAge, pensionRate]);
  const infiniteResult = useMemo(() => calcInfinite(pensionFund, parseFloat(infiniteRate) / 100 || 0.06, parseInt(infinitePeriod) || 40, retireAge), [pensionFund, infiniteRate, infinitePeriod, retireAge]);

  // 1번탭 은퇴당시 수령액 (월, 원단위)
  const tab1MonthlyPension = tab1?.future_monthly_amount ?? tab1?.monthly_desired_amount ?? 0;

  const baseLumpVal = (parseInt(baseLumpSum.replace(/\D/g, ''), 10) || 10000) * 10000;
  const lumpSums = [0, 1, 2, 3, 4].map(i => baseLumpVal + i * 100000000);
  const pensionRates = [0.02, 0.03, 0.04, 0.05, 0.06];
  const retirePeriod = 100 - retireAge;

  const goalRows = useMemo(() => calcGoalPlan(
    pensionFund, expectedRate, savingYears, holdingYears,
    tab1MonthlyPension, lumpSums, pensionRates, retirePeriod > 0 ? retirePeriod : 40
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [pensionFund, expectedRate, savingYears, holdingYears, tab1MonthlyPension, baseLumpSum, retirePeriod]);

  if (!customerId) return <div style={{ padding: '60px 0', textAlign: 'center', color: '#9CA3AF' }}>고객을 먼저 선택해주세요.</div>;
  if (loading) return <div style={{ padding: '60px 0', textAlign: 'center', color: '#9CA3AF' }}>데이터 로딩 중...</div>;
  if (!tab1 || pensionFund <= 0) return <div style={{ padding: '60px 0', textAlign: 'center', color: '#9CA3AF' }}>1번탭(희망은퇴플랜)에서 목표 은퇴자금을 먼저 설정해주세요.</div>;

  const tabs = ['종신형', '확정형', '무한지급형'];
  const tabColors = ['#1E3A5F', '#3B82F6', '#16A34A'];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', maxWidth: '1100px', margin: '0 auto' }}>

      {/* 내보내기 버튼 */}
      <div className="no-print" style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <ExportButtons
          sectionGroups={[
            ['pdf-tab3-compare'],
            ['pdf-tab3-option'],
            ['pdf-tab3-goal'],
          ]}
          filename={`연금수령계획_${selectedCustomer?.name ?? ''}.pdf`}
          activeTab="연금수령 계획"
          customerInfo={selectedCustomer ? {
            name: selectedCustomer.name,
            birthDate: selectedCustomer.birthDate ?? '-',
            targetFund: selectedCustomer.targetFund > 0
              ? (selectedCustomer.targetFund >= 1e8
                  ? `${(selectedCustomer.targetFund / 1e8).toFixed(1)}억원`
                  : `${selectedCustomer.targetFund.toLocaleString()}만원`)
              : '-',
            retireAge: selectedCustomer.retirementAge > 0 ? String(selectedCustomer.retirementAge) : '-',
          } : undefined}
        />
      </div>

      {/* ===== 섹션1: 연금전환 옵션 비교 ===== */}
      <div id="pdf-tab3-compare" style={cardStyle}>
        <h3 style={sectionTitle}>연금전환 옵션 비교</h3>
        <div style={{ fontSize: '12px', color: '#6B7280', marginBottom: '12px' }}>
          연금재원 — A: <strong style={{ color: '#1E3A5F' }}>{fmtW(pensionFundA)}</strong>
          {recPenRate && pensionFundB > 0 && (<>{', '}B: <strong style={{ color: '#EA580C' }}>{fmtW(pensionFundB)}</strong></>)}
          {' · '}은퇴나이: <strong>{retireAge}세</strong>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr style={{ backgroundColor: '#F0F4FA' }}>
              {['구분', '고객', '예상수익률', '연금수령기간', '월 연금액', '상속재원'].map(h => (
                <th key={h} style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 600, color: '#1E3A5F', borderBottom: '2px solid #1E3A5F', fontSize: '12px' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* 종신형 */}
            <tr style={{ borderBottom: '1px solid #F3F4F6', backgroundColor: '#FAFBFC' }}>
              <td rowSpan={recPenRate ? 2 : 1} style={{ padding: '12px', fontWeight: 600, color: '#1E3A5F', borderBottom: '1px solid #E5E7EB', verticalAlign: 'middle' }}>종신형</td>
              <td style={{ padding: '10px 12px', textAlign: 'center', fontSize: '12px', color: '#6B7280' }}>A고객</td>
              <td style={{ padding: '10px 12px', textAlign: 'center', color: '#6B7280', fontSize: '12px' }}>연금수익률 ({(basePenRate * 100).toFixed(1)}%)</td>
              <td rowSpan={recPenRate ? 2 : 1} style={{ padding: '10px 12px', textAlign: 'center', borderBottom: '1px solid #E5E7EB', verticalAlign: 'middle' }}>평생 (경험생명표 120세, {lifetimeYears}년)</td>
              <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtW(compareLifetimeMonthlyA)}</td>
              <td rowSpan={recPenRate ? 2 : 1} style={{ padding: '10px 12px', textAlign: 'center', color: '#6B7280', borderBottom: '1px solid #E5E7EB', verticalAlign: 'middle' }}>잔존연금</td>
            </tr>
            {recPenRate && (
              <tr style={{ borderBottom: '1px solid #E5E7EB', backgroundColor: '#FFF7ED' }}>
                <td style={{ padding: '10px 12px', textAlign: 'center', fontSize: '12px', fontWeight: 600, color: '#EA580C' }}>B고객</td>
                <td style={{ padding: '10px 12px', textAlign: 'center', color: '#EA580C', fontSize: '12px', fontWeight: 500 }}>추천수익률 ({(recPenRate * 100).toFixed(1)}%)</td>
                <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: '#EA580C' }}>{fmtW(compareLifetimeMonthlyB)}</td>
              </tr>
            )}
            {/* 확정형 */}
            <tr style={{ borderBottom: '1px solid #F3F4F6', backgroundColor: '#FAFBFC' }}>
              <td rowSpan={recPenRate ? 2 : 1} style={{ padding: '12px', fontWeight: 600, color: '#3B82F6', borderBottom: '1px solid #E5E7EB', verticalAlign: 'middle' }}>확정형</td>
              <td style={{ padding: '10px 12px', textAlign: 'center', fontSize: '12px', color: '#6B7280' }}>A고객</td>
              <td style={{ padding: '10px 12px', textAlign: 'center', color: '#6B7280', fontSize: '12px' }}>연금수익률 ({(basePenRate * 100).toFixed(1)}%)</td>
              <td rowSpan={recPenRate ? 2 : 1} style={{ padding: '10px 12px', textAlign: 'center', borderBottom: '1px solid #E5E7EB', verticalAlign: 'middle' }}>확정 {fixedCompareYears}년</td>
              <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtW(compareFixedMonthlyA)}</td>
              <td rowSpan={recPenRate ? 2 : 1} style={{ padding: '10px 12px', textAlign: 'center', color: '#6B7280', borderBottom: '1px solid #E5E7EB', verticalAlign: 'middle' }}>잔존연금 또는 없음</td>
            </tr>
            {recPenRate && (
              <tr style={{ borderBottom: '1px solid #E5E7EB', backgroundColor: '#FFF7ED' }}>
                <td style={{ padding: '10px 12px', textAlign: 'center', fontSize: '12px', fontWeight: 600, color: '#EA580C' }}>B고객</td>
                <td style={{ padding: '10px 12px', textAlign: 'center', color: '#EA580C', fontSize: '12px', fontWeight: 500 }}>추천수익률 ({(recPenRate * 100).toFixed(1)}%)</td>
                <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: '#EA580C' }}>{fmtW(compareFixedMonthlyB)}</td>
              </tr>
            )}
            {/* 무한지급형 */}
            <tr style={{ backgroundColor: '#FAFBFC' }}>
              <td rowSpan={recPenRate ? 2 : 1} style={{ padding: '12px', fontWeight: 600, color: '#16A34A', verticalAlign: 'middle' }}>무한지급형<br /><span style={{ fontSize: '11px', fontWeight: 400, color: '#9CA3AF' }}>(상속연금형)</span></td>
              <td style={{ padding: '10px 12px', textAlign: 'center', fontSize: '12px', color: '#6B7280' }}>A고객</td>
              <td style={{ padding: '10px 12px', textAlign: 'center', color: '#6B7280', fontSize: '12px' }}>연금수익률 ({(basePenRate * 100).toFixed(1)}%)</td>
              <td rowSpan={recPenRate ? 2 : 1} style={{ padding: '10px 12px', textAlign: 'center', verticalAlign: 'middle' }}>평생</td>
              <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtW(compareInfiniteMonthlyA)}</td>
              <td rowSpan={recPenRate ? 2 : 1} style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 600, color: '#16A34A', verticalAlign: 'middle' }}>연금재원 상당</td>
            </tr>
            {recPenRate && (
              <tr style={{ backgroundColor: '#FFF7ED' }}>
                <td style={{ padding: '10px 12px', textAlign: 'center', fontSize: '12px', fontWeight: 600, color: '#EA580C' }}>B고객</td>
                <td style={{ padding: '10px 12px', textAlign: 'center', color: '#EA580C', fontSize: '12px', fontWeight: 500 }}>추천수익률 ({(recPenRate * 100).toFixed(1)}%)</td>
                <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: '#EA580C' }}>{fmtW(compareInfiniteMonthlyB)}</td>
              </tr>
            )}
          </tbody>
        </table>
        <div style={{ marginTop: '12px', padding: '10px 14px', backgroundColor: '#F9FAFB', borderRadius: '6px', fontSize: '11px', color: '#9CA3AF', lineHeight: 1.6 }}>
          ※ 본 표는 고객의 이해를 돕기 위한 참고용 시뮬레이션이며, 실제 연금전환 조건 및 수령액은 보험사별로 상이할 수 있습니다. 정확한 상담은 담당 보험사를 통해 문의해 주세요.
        </div>
      </div>

      {/* ===== 섹션2: 연금전환 옵션 (탭) ===== */}
      <div style={cardStyle}>
        <h3 style={sectionTitle}>연금전환 옵션</h3>
        <div className="no-print" style={{ display: 'flex', marginBottom: '24px', borderBottom: '2px solid #E5E7EB' }}>
          {tabs.map((label, i) => (
            <button key={label} onClick={() => setOptionTab(i)} style={{
              flex: 1, padding: '12px 16px', fontSize: '14px',
              fontWeight: optionTab === i ? 700 : 500,
              color: optionTab === i ? tabColors[i] : '#9CA3AF',
              backgroundColor: 'transparent', border: 'none',
              borderBottom: optionTab === i ? `3px solid ${tabColors[i]}` : '3px solid transparent',
              cursor: 'pointer', marginBottom: '-2px',
            }}>{label}</button>
          ))}
        </div>

        <div id="pdf-tab3-option">
          {optionTab === 0 && <LifetimeSection pv={pensionFund} rate={lifetimeRate} setRate={setLifetimeRate} retireAge={retireAge} result={lifetimeResult} pensionRateFromTab1={pensionRate} />}
          {optionTab === 1 && <FixedSection pv={pensionFund} rate={fixedRate} setRate={setFixedRate} period={fixedPeriod} setPeriod={setFixedPeriod} retireAge={retireAge} result={fixedResult} />}
          {optionTab === 2 && <InfiniteSection pv={pensionFund} rate={infiniteRate} setRate={setInfiniteRate} period={infinitePeriod} setPeriod={setInfinitePeriod} retireAge={retireAge} result={infiniteResult} />}
        </div>
      </div>

      {/* ===== 섹션3: 목표달성 플랜 ===== */}
      <div id="pdf-tab3-goal" style={cardStyle}>
        <h3 style={sectionTitle}>목표달성 플랜</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '20px', padding: '16px', backgroundColor: '#F9FAFB', borderRadius: '8px' }}>
          <InfoCell label="목표금액" value={fmtW(pensionFund)} color="#1E3A5F" />
          <InfoCell label="은퇴나이" value={`${retireAge}세 (${savingYears + holdingYears}년)`} />
          <InfoCell label="예상 수익률" value={`${(expectedRate * 100).toFixed(1)}%`} color="#16A34A" />
          <InfoCell label="투자기간" value={`적립 ${savingYears}년 + 거치 ${holdingYears}년`} />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
          <span style={labelStyle}>거치금액 시작값</span>
          <div style={{ position: 'relative', width: '180px' }}>
            <input type="text"
              value={baseLumpSum.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
              onChange={(e) => setBaseLumpSum(e.target.value.replace(/\D/g, ''))}
              style={inputStyle}
              onFocus={(e) => { e.currentTarget.style.borderColor = '#1E3A5F'; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = '#D1D5DB'; }}
            />
            <span style={unitSpan}>만원</span>
          </div>
          <span style={{ fontSize: '11px', color: '#9CA3AF' }}>이후 행은 +1억씩 자동 증가</span>
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr>
              {['거치금액', '적립금액(연)', '은퇴연금 수익률', '은퇴연금액', '100세 상속금액'].map((h, hi) => (
                <th key={h} style={{
                  padding: '10px 16px', textAlign: 'center', fontWeight: 600, color: '#1E3A5F',
                  borderBottom: '2px solid #1E3A5F', fontSize: '12px', width: '20%',
                  backgroundColor: hi < 2 ? '#DBEAFE' : '#F0F4FA',
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {goalRows.map((row, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #E5E7EB' }}>
                <td style={{ padding: '10px 16px', textAlign: 'center', fontVariantNumeric: 'tabular-nums', backgroundColor: i % 2 === 0 ? '#EFF6FF' : '#DBEAFE' }}>{fmtW(row.lumpSum)}</td>
                <td style={{ padding: '10px 16px', textAlign: 'center', fontWeight: 600, color: '#1E3A5F', fontVariantNumeric: 'tabular-nums', backgroundColor: i % 2 === 0 ? '#EFF6FF' : '#DBEAFE' }}>{fmtW(row.annualSavings)}</td>
                <td style={{ padding: '10px 16px', textAlign: 'center', color: '#6B7280', backgroundColor: i % 2 === 0 ? '#fff' : '#FAFAFA' }}>{(row.pensionRate * 100).toFixed(0)}%</td>
                <td style={{ padding: '10px 16px', textAlign: 'center', fontVariantNumeric: 'tabular-nums', backgroundColor: i % 2 === 0 ? '#fff' : '#FAFAFA' }}>{fmtW(row.monthlyPension)}/월</td>
                <td style={{ padding: '10px 16px', textAlign: 'center', fontWeight: 600, fontVariantNumeric: 'tabular-nums', backgroundColor: i % 2 === 0 ? '#fff' : '#FAFAFA', color: row.inheritance100 >= 0 ? '#16A34A' : '#DC2626' }}>
                  {row.inheritance100 >= 0 ? fmtW(row.inheritance100) : `-${fmtW(Math.abs(row.inheritance100))}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ marginTop: '8px', fontSize: '11px', color: '#9CA3AF' }}>
          * 은퇴연금액은 무한지급형(이자수령) 기준입니다. 100세 상속금액이 음수면 100세 전 자금 소진됩니다.
        </div>
      </div>

      {toast && <Toast message={toast.message} type={toast.type} />}
    </div>
  );
}

/* ================================================================== */
/*  종신형 섹션                                                         */
/* ================================================================== */

function LifetimeSection({ pv, rate, setRate, retireAge, result, pensionRateFromTab1 }: {
  pv: number; rate: string; setRate: (v: string) => void; retireAge: number; result: LifetimeResult; pensionRateFromTab1: number;
}) {
  const years = 120 - retireAge + 1;
  const rateDisplay = rate || String(pensionRateFromTab1 * 100);
  const m10 = result.milestone10yr;
  const m100 = result.milestone100age;

  const msStyle: React.CSSProperties = { padding: '16px', borderRadius: '10px', border: '1px solid', flex: 1 };
  const msRow: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', fontSize: '12px', padding: '3px 0' };
  const msVal: React.CSSProperties = { fontWeight: 600, fontVariantNumeric: 'tabular-nums' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* 가로 카드 5개 - 가로 꽉 채움 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.3fr 1fr 1fr', gap: '10px' }}>
        <ResultCard label="연금재원" value={fmtW(pv)} color="#1E3A5F" />
        <ResultCard label="연금수익률" value={`${rateDisplay}%`} color="#16A34A" />
        <ResultCard label="연금수령기간" value={`${years}년 (${retireAge}세~120세)`} color="#374151" />
        <ResultCard label="연금액 (월)" value={fmtW(result.monthlyPension)} color="#1E3A5F" large />
        <ResultCard label="연금액 (연)" value={fmtW(result.annualPension)} color="#1E3A5F" large />
      </div>

      {/* 그래프: 매년 연금의 원금/이자 구성 */}
      <div>
        <div style={{ fontSize: '13px', fontWeight: 600, color: '#374151', marginBottom: '8px' }}>연금 수령 구성 (원금 vs 이자)</div>
        <PensionOptionChart data={result.yearlyData.map(d => ({
          age: d.age,
          balance: Math.round(d.yearPrincipal),
          pension: Math.round(d.yearInterest),
        }))} type="lifetime" retireAge={retireAge} showBalance isComposition />
        <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', marginTop: '8px', fontSize: '11px' }}>
          <span><span style={{ display: 'inline-block', width: 12, height: 12, backgroundColor: 'rgba(30,58,95,0.15)', border: '1px solid #1E3A5F', borderRadius: 2, marginRight: 4, verticalAlign: 'middle' }} />원금 수령분</span>
          <span><span style={{ display: 'inline-block', width: 12, height: 12, backgroundColor: '#F59E0B', borderRadius: 2, marginRight: 4, verticalAlign: 'middle' }} />이자 수령분</span>
        </div>
      </div>

      {/* 10년차 vs 40년차 비교 */}
      <div>
        <div style={{ fontSize: '13px', fontWeight: 600, color: '#374151', marginBottom: '12px' }}>수령 현황 비교</div>
        <div style={{ display: 'flex', gap: '16px' }}>
          {/* 10년차 */}
          <div style={{ ...msStyle, backgroundColor: '#FFFBEB', borderColor: '#F59E0B' }}>
            <div style={{ fontSize: '14px', fontWeight: 700, color: '#92400E', marginBottom: '10px' }}>10년차 ({retireAge + 10}세)</div>
            <div style={msRow}><span style={{ color: '#92400E' }}>수령한 원금</span><span style={msVal}>{fmtW(m10.cumPrincipal)}</span></div>
            <div style={msRow}><span style={{ color: '#92400E' }}>수령한 이자</span><span style={msVal}>{fmtW(m10.cumInterest)}</span></div>
            <div style={{ ...msRow, borderTop: '1px solid #F59E0B', marginTop: '6px', paddingTop: '6px' }}><span style={{ color: '#92400E', fontWeight: 600 }}>총 수령연금</span><span style={{ ...msVal, color: '#1E3A5F', fontSize: '14px' }}>{fmtW(m10.totalReceived)}</span></div>
            <div style={{ ...msRow, marginTop: '8px', padding: '6px 0', backgroundColor: '#FEF3C7', borderRadius: '4px', paddingLeft: '8px', paddingRight: '8px' }}><span style={{ color: '#92400E', fontWeight: 600 }}>남은 원금</span><span style={{ ...msVal, color: '#B45309', fontSize: '14px' }}>{fmtW(m10.balance)}</span></div>
          </div>
          {/* 100세 시점 */}
          <div style={{ ...msStyle, backgroundColor: '#EFF6FF', borderColor: '#3B82F6' }}>
            <div style={{ fontSize: '14px', fontWeight: 700, color: '#1D4ED8', marginBottom: '10px' }}>100세 ({100 - retireAge}년차)</div>
            <div style={msRow}><span style={{ color: '#1D4ED8' }}>수령한 원금</span><span style={msVal}>{fmtW(m100.cumPrincipal)}</span></div>
            <div style={msRow}><span style={{ color: '#1D4ED8' }}>수령한 이자</span><span style={msVal}>{fmtW(m100.cumInterest)}</span></div>
            <div style={{ ...msRow, borderTop: '1px solid #3B82F6', marginTop: '6px', paddingTop: '6px' }}><span style={{ color: '#1D4ED8', fontWeight: 600 }}>총 수령연금</span><span style={{ ...msVal, color: '#1E3A5F', fontSize: '14px' }}>{fmtW(m100.totalReceived)}</span></div>
            <div style={{ ...msRow, marginTop: '8px', padding: '6px 0', backgroundColor: '#DBEAFE', borderRadius: '4px', paddingLeft: '8px', paddingRight: '8px' }}><span style={{ color: '#1D4ED8', fontWeight: 600 }}>남은 원금</span><span style={{ ...msVal, color: '#1E40AF', fontSize: '14px' }}>{fmtW(m100.balance)}</span></div>
          </div>
        </div>
      </div>

      <Note bg="#FFF7ED" border="#FDBA74" color="#9A3412">
        <strong>원리금 균등상환 방식</strong>: 매월 동일한 {fmtW(result.monthlyPension)}을 수령합니다. 초기에는 이자 비중이 높고, 후반으로 갈수록 원금 비중이 증가합니다.
      </Note>
    </div>
  );
}

/* ================================================================== */
/*  확정형 섹션                                                         */
/* ================================================================== */

function FixedSection({ pv, rate, setRate, period, setPeriod, retireAge, result }: {
  pv: number; rate: string; setRate: (v: string) => void; period: string; setPeriod: (v: string) => void; retireAge: number; result: FixedResult;
}) {
  const p = parseInt(period) || 30;
  const rateDisplay = rate || '4.5';
  const maxAge = 120;
  const totalYears = maxAge - retireAge + 1;

  // 그래프: 수령기간은 연금 바, 이후는 0으로 120세까지
  const fullChartData: ChartPoint[] = [];
  for (let yr = 1; yr <= totalYears; yr++) {
    const age = retireAge + yr;
    const matched = result.chartData.find(d => d.age === age);
    fullChartData.push({
      age,
      balance: matched ? matched.balance : 0,
      pension: yr <= p ? Math.round(result.annualPension) : 0,
    });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* 가로 카드 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.3fr 1.2fr 1fr 1fr', gap: '10px' }}>
        <ResultCard label="연금재원" value={fmtW(pv)} color="#1E3A5F" />
        <ResultCard label="연금수익률" value={`${rateDisplay}%`} color="#16A34A" />
        <ResultCard label="연금수령기간" value={`${p}년 (${retireAge}세~${retireAge + p}세)`} color="#374151" />
        <div style={{ padding: '12px 16px', backgroundColor: '#FAFBFC', borderRadius: '8px', border: '1px solid #E5E7EB' }}>
          <div style={{ fontSize: '11px', color: '#9CA3AF', marginBottom: '4px' }}>연금액 (월/연)</div>
          <div style={{ fontSize: '16px', fontWeight: 700, color: '#3B82F6', fontVariantNumeric: 'tabular-nums' }}>{fmtW(result.monthlyPension)}</div>
          <div style={{ fontSize: '12px', color: '#6B7280', fontVariantNumeric: 'tabular-nums', marginTop: '2px' }}>연 {fmtW(result.annualPension)}</div>
        </div>
        <ResultCard label="총 수령연금" value={fmtW(result.totalReceived)} color="#374151" />
        <ResultCard label="총 수령이자" value={fmtW(result.totalInterest)} color="#16A34A" />
      </div>

      {/* 그래프: 120세까지, 수령기간만 바 표시 */}
      <div>
        <div style={{ fontSize: '13px', fontWeight: 600, color: '#374151', marginBottom: '8px' }}>연금수령 그래프</div>
        <PensionOptionChart data={fullChartData} type="fixed" retireAge={retireAge} />
      </div>

      <Note bg="#EFF6FF" border="#93C5FD" color="#1E40AF">
        <strong>확정기간 수령</strong>: {retireAge}세부터 {retireAge + p}세까지 {p}년간 확정 수령합니다. 수령 종료 후 연금재원은 소진되며, 중도 사망 시 잔존연금이 상속됩니다.
      </Note>
    </div>
  );
}

/* ================================================================== */
/*  무한지급형 섹션                                                      */
/* ================================================================== */

function InfiniteSection({ pv, rate, setRate, period, setPeriod, retireAge, result }: {
  pv: number; rate: string; setRate: (v: string) => void; period: string; setPeriod: (v: string) => void; retireAge: number; result: InfiniteResult;
}) {
  const rateDisplay = rate || '5';
  const totalYears = 120 - retireAge + 1;
  const fullChartData: ChartPoint[] = [];
  for (let yr = 1; yr <= totalYears; yr++) {
    fullChartData.push({ age: retireAge + yr, balance: Math.round(pv), pension: Math.round(result.annualPension) });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* 가로 카드 6개 - 가로 꽉 채움 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1.2fr 1fr 1fr', gap: '10px' }}>
        <ResultCard label="연금재원" value={fmtW(pv)} color="#1E3A5F" />
        <div style={{ padding: '12px 16px', backgroundColor: '#FAFBFC', borderRadius: '8px', border: '1px solid #E5E7EB' }}>
          <div style={{ fontSize: '11px', color: '#9CA3AF', marginBottom: '4px' }}>연금수익률</div>
          <div style={{ position: 'relative' }}>
            <input type="text" value={rateDisplay}
              onChange={(e) => setRate(e.target.value.replace(/[^\d.]/g, ''))}
              style={{ ...inputStyle, fontSize: '16px', fontWeight: 700, color: '#16A34A', height: '32px', padding: '0 30px 0 8px' }}
              onFocus={(e) => { e.currentTarget.style.borderColor = '#16A34A'; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = '#D1D5DB'; }}
            />
            <span style={{ ...unitSpan, fontSize: '13px' }}>%</span>
          </div>
        </div>
        <ResultCard label="수령기간" value="평생" color="#374151" />
        <div style={{ padding: '12px 16px', backgroundColor: '#FAFBFC', borderRadius: '8px', border: '1px solid #E5E7EB' }}>
          <div style={{ fontSize: '11px', color: '#9CA3AF', marginBottom: '4px' }}>연금액 (월/연)</div>
          <div style={{ fontSize: '16px', fontWeight: 700, color: '#16A34A', fontVariantNumeric: 'tabular-nums' }}>{fmtW(result.monthlyPension)}</div>
          <div style={{ fontSize: '12px', color: '#6B7280', fontVariantNumeric: 'tabular-nums', marginTop: '2px' }}>연 {fmtW(result.annualPension)}</div>
        </div>
        <ResultCard label="총 연금액" value={fmtW(result.totalPension)} color="#374151" />
        <ResultCard label="상속재원" value={fmtW(result.inheritanceAmount)} color="#D97706" />
      </div>

      {/* 그래프: 120세까지 */}
      <div>
        <div style={{ fontSize: '13px', fontWeight: 600, color: '#374151', marginBottom: '8px' }}>연금수령 그래프</div>
        <PensionOptionChart data={fullChartData} type="infinite" retireAge={retireAge} showBalance />
      </div>

      <Note bg="#F0FDF4" border="#86EFAC" color="#166534">
        <strong>이자만 수령 (원금 보존)</strong>: 연금재원의 이자({rateDisplay}%)만 수령하여 원금 {fmtW(pv)}이 100% 보존됩니다. 사망 시 연금재원 전액이 상속됩니다.
      </Note>
    </div>
  );
}

/* ================================================================== */
/*  공통 서브 컴포넌트                                                   */
/* ================================================================== */

function InputField({ label, value, onChange, unit, disabled }: {
  label: string; value: string; onChange?: (v: string) => void; unit?: string; disabled?: boolean;
}) {
  return (
    <div>
      <div style={labelStyle}>{label}</div>
      <div style={{ position: 'relative', marginTop: '4px' }}>
        <input type="text" value={value}
          onChange={onChange ? (e) => onChange(e.target.value.replace(/[^\d.]/g, '')) : undefined}
          disabled={disabled}
          style={{ ...inputStyle, backgroundColor: disabled ? '#F3F4F6' : '#fff', color: disabled ? '#6B7280' : '#1A1A2E', textAlign: disabled ? 'left' : 'right', paddingRight: unit ? '40px' : '10px' }}
          onFocus={(e) => { if (!disabled) e.currentTarget.style.borderColor = '#1E3A5F'; }}
          onBlur={(e) => { e.currentTarget.style.borderColor = '#D1D5DB'; }}
        />
        {unit && <span style={unitSpan}>{unit}</span>}
      </div>
    </div>
  );
}

function ResultCard({ label, value, color, large }: { label: string; value: string; color: string; large?: boolean }) {
  return (
    <div style={{ padding: large ? '16px 20px' : '12px 16px', backgroundColor: '#FAFBFC', borderRadius: '8px', border: '1px solid #E5E7EB' }}>
      <div style={{ fontSize: '11px', color: '#9CA3AF', marginBottom: '4px' }}>{label}</div>
      <div style={{ fontSize: large ? '18px' : '14px', fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  );
}

function InfoCell({ label, value, color }: { label: string; value: string; color?: string }) {
  return (<div><div style={{ fontSize: '11px', color: '#9CA3AF', marginBottom: '4px' }}>{label}</div><div style={{ fontSize: '15px', fontWeight: 700, color: color ?? '#374151' }}>{value}</div></div>);
}

function Row({ label, value, c }: { label: string; value: string; c: string }) {
  return (<div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}><span style={{ color: c }}>{label}</span><span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{value}</span></div>);
}

function Note({ bg, border, color, children }: { bg: string; border: string; color: string; children: React.ReactNode }) {
  return (<div style={{ padding: '12px 16px', backgroundColor: bg, borderRadius: '8px', border: `1px solid ${border}`, fontSize: '12px', color }}>{children}</div>);
}

export default PensionPlanTab;
