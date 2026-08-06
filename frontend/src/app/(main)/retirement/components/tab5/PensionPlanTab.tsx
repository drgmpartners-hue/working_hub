'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { useRetirementStore } from '../../hooks/useRetirementStore';
// PDF export는 pensionPlanPdf.ts 사용
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
  backgroundColor: 'var(--bg-card)', border: '1px solid var(--border)',
  borderRadius: '12px', padding: '24px',
};
const sectionTitle: React.CSSProperties = {
  fontSize: '16px', fontWeight: 700, color: 'var(--blue-400)',
  marginBottom: '20px', marginTop: 0,
};
const subTitle: React.CSSProperties = {
  fontSize: '14px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '12px',
};
const inputStyle: React.CSSProperties = {
  width: '100%', height: '36px', padding: '0 40px 0 10px',
  fontSize: '13px', color: 'var(--text-primary)', backgroundColor: 'var(--bg-card)',
  border: '1px solid var(--border-strong)', borderRadius: '6px',
  outline: 'none', boxSizing: 'border-box', textAlign: 'right',
};
const unitSpan: React.CSSProperties = {
  position: 'absolute', right: '10px', top: '50%',
  transform: 'translateY(-50%)', fontSize: '11px', color: 'var(--text-muted)',
  pointerEvents: 'none',
};
const labelStyle: React.CSSProperties = {
  fontSize: '12px', fontWeight: 500, color: 'var(--text-secondary)', whiteSpace: 'nowrap',
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
  interestAnnual: number;      // 연 이자액 (재원 × 수익률)
  depletedAge: number | null;  // 잔액 소진 나이 (없으면 null)
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

/** 무한지급형: 잔액 = 전년 잔액 × (1+수익률) − 연금액 (기말 인출)
 *  연금액을 지정하지 않으면 이자액(재원×수익률)을 쓰므로 원금이 정확히 보존되고,
 *  연금액이 이자보다 적으면 잔액이 늘고 많으면 줄어든다 (수익률 변경이 그래프에 반영됨). */
function calcInfinite(pv: number, rate: number, periodYears: number, retireAge: number, annualPensionInput?: number): InfiniteResult {
  const interestAnnual = pv * rate;
  const annual = annualPensionInput && annualPensionInput > 0 ? annualPensionInput : interestAnnual;
  const chartYears = Math.max(0, 120 - retireAge); // 120세까지 차트 데이터 생성
  const chartData: ChartPoint[] = [];
  let balance = pv;
  let totalPaid = 0;
  let depletedAge: number | null = null;

  for (let yr = 1; yr <= chartYears; yr++) {
    const age = retireAge + yr;
    if (balance <= 0) {
      chartData.push({ age, balance: 0, pension: 0 });
      continue;
    }
    const grown = balance * (1 + rate);      // 1년 운용
    const paid = Math.min(annual, grown);     // 기말 인출 (잔액 한도)
    balance = grown - paid;
    totalPaid += paid;
    if (balance <= 0 && depletedAge === null) depletedAge = age;
    chartData.push({ age, balance: Math.max(0, Math.round(balance)), pension: Math.round(paid) });
  }

  // 총 연금액: 지정 기간(periodYears)까지의 실제 지급 합계
  const withinPeriod = chartData.slice(0, Math.max(0, periodYears));
  const totalWithinPeriod = withinPeriod.reduce((s, p) => s + p.pension, 0);

  return {
    annualPension: annual,
    monthlyPension: annual / 12,
    totalPension: totalWithinPeriod || totalPaid,
    inheritanceAmount: Math.max(0, balance),   // 120세 시점 잔액 = 상속재원
    chartData,
    interestAnnual,
    depletedAge,
  };
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

  const [lifetimeRate, setLifetimeRate] = useState('');
  const [fixedRate, setFixedRate] = useState('2');
  const [fixedPeriod, setFixedPeriod] = useState('30');
  const [infiniteRate, setInfiniteRate] = useState('5');
  const [infinitePeriod, setInfinitePeriod] = useState('40');
  // 무한지급형 월 연금액 (만원). 빈 값이면 이자액(재원×수익률) 자동 적용 → 원금 보존
  const [infinitePension, setInfinitePension] = useState('');

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
  // plan_v2(현재플랜/추천플랜 분리 저장)가 있으면 우선 사용 — A는 현재플랜, B는 추천플랜 값
  const cp = tab1?.calculation_params || {};
  const v2 = (cp.plan_v2 as Record<string, string | boolean> | undefined) ?? undefined;
  const v2Num = (k: string) => {
    const raw = v2?.[k];
    const n = typeof raw === 'string' ? parseFloat(raw.replace(/,/g, '')) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const basePenRate = (v2Num('cPenRIn') != null ? v2Num('cPenRIn')! / 100 : null)
    ?? (cp.base_pension_rate as number) ?? tab1?.retirement_pension_rate ?? 0.02;   // A고객
  const recPenRate = (v2Num('rPenRIn') != null ? v2Num('rPenRIn')! / 100 : null)
    ?? (cp.recommended_pension_rate as number) ?? null;                              // B고객

  // A고객 연금재원: 1번탭 목표 은퇴자금 (PV 계산값)
  const pensionFundA = (cp.target_fund_pv as number) ?? tab1?.target_retirement_fund ?? 0;
  // B고객 연금재원: 시뮬레이션 테이블 은퇴나이-1 평가금액 (수정 목표)
  const simData = tab1?.simulation_data ?? (cp.modified_plan as Record<string, unknown>[]) ?? [];
  const retireAge = tab1?.desired_retirement_age ?? 65;
  // A/B 은퇴나이는 각각 다르게 설정될 수 있으므로 분리
  const retireAgeA = v2Num('cRetAgeIn') ?? retireAge;
  const retireAgeB = v2Num('rRetAgeIn') ?? retireAge;
  const retireRow = simData.find(r => (r.age as number) === retireAge - 1);
  const pensionFundB = (retireRow?.evaluation as number) ?? tab1?.simulation_target_fund ?? 0;
  // 기본 연금재원 (하위 섹션 등에서 사용)
  const pensionFund = recPenRate ? pensionFundB : pensionFundA;

  const expectedRate = (cp.recommended_return_rate as number) ?? tab1?.expected_return_rate ?? 0.07;
  const pensionRate = recPenRate ?? basePenRate; // 추천 있으면 추천, 없으면 기존
  const savingYears = tab1?.savings_period_years ?? 5;
  const holdingYears = tab1?.holding_period_years ?? 15;

  // 연금전환 옵션 비교: A/B 고객 각자의 은퇴나이·수익률로 계산
  const lifetimeYearsA = 120 - retireAgeA + 1;
  const lifetimeYearsB = 120 - retireAgeB + 1;
  const lifetimeYears = lifetimeYearsA;   // 하위 섹션 호환
  // 확정형: A의 은퇴기간(100세까지)이 30년 이상이면 30년, 미만이면 그 기간에 맞춤
  const fixedCompareYears = Math.max(1, Math.min(30, 100 - retireAgeA));
  const fixedCompareYearsB = Math.max(1, Math.min(30, 100 - retireAgeB));
  const infiniteCompareRate = parseFloat(infiniteRate) / 100 || 0.05;

  // A고객 (현재플랜 연금수익률 + A연금재원) 월연금
  const compareLifetimeMonthlyA = useMemo(() => {
    if (pensionFundA <= 0) return 0;
    return excelPMT(basePenRate / 12, lifetimeYearsA * 12, -pensionFundA, 0, 1);
  }, [pensionFundA, basePenRate, lifetimeYearsA]);
  const compareFixedMonthlyA = useMemo(() => {
    if (pensionFundA <= 0) return 0;
    return excelPMT(basePenRate / 12, fixedCompareYears * 12, -pensionFundA, 0, 1);
  }, [pensionFundA, basePenRate, fixedCompareYears]);
  const compareInfiniteMonthlyA = pensionFundA * basePenRate / 12;

  // B고객 (추천 연금수익률 + B연금재원) 월연금
  const compareLifetimeMonthlyB = useMemo(() => {
    if (pensionFundB <= 0 || !recPenRate) return 0;
    return excelPMT(recPenRate / 12, lifetimeYearsB * 12, -pensionFundB, 0, 1);
  }, [pensionFundB, recPenRate, lifetimeYearsB]);
  const compareFixedMonthlyB = useMemo(() => {
    if (pensionFundB <= 0 || !recPenRate) return 0;
    return excelPMT(recPenRate / 12, fixedCompareYearsB * 12, -pensionFundB, 0, 1);
  }, [pensionFundB, recPenRate, fixedCompareYearsB]);
  const compareInfiniteMonthlyB = recPenRate ? pensionFundB * recPenRate / 12 : 0;

  // 이전 호환: 개별 섹션에서 사용
  const compareLifetimeMonthly = compareLifetimeMonthlyA;
  const compareFixedMonthly = compareFixedMonthlyA;
  const compareInfiniteMonthly = pensionFund * infiniteCompareRate / 12;

  // 상세 탭용 계산
  const lifetimeResult = useMemo(() => calcLifetime(pensionFund, parseFloat(lifetimeRate) / 100 || pensionRate, retireAge, 120), [pensionFund, lifetimeRate, retireAge, pensionRate]);
  const fixedResult = useMemo(() => calcFixed(pensionFund, parseFloat(fixedRate) / 100 || pensionRate, parseInt(fixedPeriod) || 30, retireAge), [pensionFund, fixedRate, fixedPeriod, retireAge, pensionRate]);
  const infiniteResult = useMemo(() => {
    const monthlyManwon = parseInt(infinitePension.replace(/\D/g, ''), 10) || 0;
    const annualInput = monthlyManwon > 0 ? monthlyManwon * 1e4 * 12 : undefined;
    return calcInfinite(pensionFund, parseFloat(infiniteRate) / 100 || 0.06, parseInt(infinitePeriod) || 40, retireAge, annualInput);
  }, [pensionFund, infiniteRate, infinitePeriod, retireAge, infinitePension]);

  // 1번탭 은퇴당시 수령액 (월, 원단위)
  const tab1MonthlyPension = tab1?.future_monthly_amount ?? tab1?.monthly_desired_amount ?? 0;

  if (!customerId) return <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--text-muted)' }}>고객을 먼저 선택해주세요.</div>;
  if (loading) return <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--text-muted)' }}>데이터 로딩 중...</div>;
  if (!tab1 || pensionFund <= 0) return <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--text-muted)' }}>1번탭(희망은퇴플랜)에서 목표 은퇴자금을 먼저 설정해주세요.</div>;

  const tabs = ['종신형', '확정형', '무한지급형'];
  const tabColors = ['#1E3A5F', '#3B82F6', '#16A34A'];

  return (
    // 폭 제한 없이 화면 컨테이너(1600px)를 그대로 사용 — 은퇴플랜 설계 탭과 동일
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

      {/* PDF 다운로드 버튼 */}
      <div className="no-print" style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          onClick={async () => {
            try {
              const { generatePensionPlanPdf } = await import('../../utils/pensionPlanPdf');
              type PData = import('../../utils/pensionPlanPdf').PensionPdfData;
              type CRow = import('../../utils/pensionPlanPdf').ComparisonRow;

              const customer = {
                name: selectedCustomer?.name ?? '',
                birthDate: selectedCustomer?.birthDate ?? '',
                targetFund: selectedCustomer?.targetFund && selectedCustomer.targetFund >= 1e8 ? `${(selectedCustomer.targetFund / 1e8).toFixed(1)}억원` : `${(selectedCustomer?.targetFund ?? 0).toLocaleString()}만원`,
                retireAge: String(selectedCustomer?.retirementAge ?? '-'),
              };

              // 비교 테이블 데이터 — 화면과 동일하게 A/B 각자의 수령기간을 표기
              // (type/inheritance가 빈 행은 PDF에서 위 행과 셀 병합됨)
              const compRows: CRow[] = [];
              const rateA = `연금수익률 (${(basePenRate * 100).toFixed(1)}%)`;
              const rateB = recPenRate ? `추천수익률 (${(recPenRate * 100).toFixed(1)}%)` : '';
              // 종신형
              compRows.push({ type: '종신형', customer: 'A고객', rate: rateA, period: `평생 (120세, ${lifetimeYearsA}년)`, monthly: `${fmt(Math.round(compareLifetimeMonthlyA / 1e4))}만원`, inheritance: '잔존연금' });
              if (recPenRate) compRows.push({ type: '', customer: 'B고객', rate: rateB, period: `평생 (120세, ${lifetimeYearsB}년)`, monthly: `${fmt(Math.round(compareLifetimeMonthlyB / 1e4))}만원`, inheritance: '' });
              // 확정형
              compRows.push({ type: '확정형', customer: 'A고객', rate: rateA, period: `확정 ${fixedCompareYears}년 (${retireAgeA}→${retireAgeA + fixedCompareYears}세)`, monthly: `${fmt(Math.round(compareFixedMonthlyA / 1e4))}만원`, inheritance: '잔존연금 또는 없음' });
              if (recPenRate) compRows.push({ type: '', customer: 'B고객', rate: rateB, period: `확정 ${fixedCompareYearsB}년 (${retireAgeB}→${retireAgeB + fixedCompareYearsB}세)`, monthly: `${fmt(Math.round(compareFixedMonthlyB / 1e4))}만원`, inheritance: '' });
              // 무한지급형
              compRows.push({ type: '무한지급형', customer: 'A고객', rate: rateA, period: '평생', monthly: `${fmt(Math.round(compareInfiniteMonthlyA / 1e4))}만원`, inheritance: '연금재원 상당' });
              if (recPenRate) compRows.push({ type: '', customer: 'B고객', rate: rateB, period: '평생', monthly: `${fmt(Math.round(compareInfiniteMonthlyB / 1e4))}만원`, inheritance: '' });

              const lr = lifetimeResult;
              const fr = fixedResult;
              const ir = infiniteResult;

              // 그래프는 화면 캡처 없이 PDF에서 직접 벡터로 그린다 (화면과 동일한 데이터 구성)
              type PChart = import('../../utils/pensionPlanPdf').PdfChartPoint;
              // 종신형: 화면과 동일한 '원금 vs 이자' 스택 구성 (balance=원금 수령분, pension=이자 수령분)
              const lifetimeChart: PChart[] = lifetimeResult.yearlyData.map(d => {
                const annPmt = d.yearPrincipal + d.yearInterest;
                const principal = Math.max(0, d.yearPrincipal);
                return { age: d.age, balance: Math.round(principal), pension: Math.round(annPmt - principal) };
              });
              // 확정형: 수령 종료 후에도 120세까지 축을 그려 '수령 기간이 짧다'는 점이 드러나게 한다
              const fixedChart: PChart[] = (() => {
                const rows: PChart[] = fixedResult.chartData.map(p => ({ age: p.age, balance: p.balance, pension: p.pension }));
                const lastAge = rows.length ? rows[rows.length - 1].age : retireAge;
                for (let a = lastAge + 1; a <= 120; a++) rows.push({ age: a, balance: 0, pension: 0 });
                return rows;
              })();
              const infiniteChart: PChart[] = infiniteResult.chartData.map(p => ({ age: p.age, balance: p.balance, pension: p.pension }));
              // 그래프 아래 첨언 (화면 Note와 동일 문구)
              const fixedP = parseInt(fixedPeriod) || 30;
              const infDiff = infiniteResult.interestAnnual - infiniteResult.annualPension;
              const infStatus: 'keep' | 'grow' | 'drain' =
                Math.abs(infDiff) < infiniteResult.interestAnnual * 0.005 ? 'keep' : infDiff > 0 ? 'grow' : 'drain';
              const infiniteNote =
                infStatus === 'keep'
                  ? `이자만 수령 (원금 보존): 잔액 = 전년 잔액 × (1 + ${infiniteRate || '5'}%) − 연금액. 연금액이 연 이자(${fmtW(infiniteResult.interestAnnual)})와 같아 원금 ${fmtW(pensionFund)}이 100% 유지되고, 사망 시 전액 상속됩니다.`
                  : infStatus === 'grow'
                  ? `이자 미만 수령 (원금 증가): 연 이자 ${fmtW(infiniteResult.interestAnnual)} 중 ${fmtW(infiniteResult.annualPension)}만 수령해 매년 ${fmtW(infDiff)}씩 잔액이 늘어 120세 상속재원이 ${fmtW(infiniteResult.inheritanceAmount)}이 됩니다.`
                  : `이자 초과 수령 (원금 감소): 연금액이 이자(${fmtW(infiniteResult.interestAnnual)})보다 연 ${fmtW(-infDiff)} 많아 원금이 줄어듭니다${infiniteResult.depletedAge ? ` — ${infiniteResult.depletedAge}세에 소진됩니다.` : ' (120세까지는 유지).'}`;

              const pdfData: PData = {
                customer,
                pensionFundA: fmtW(pensionFundA),
                pensionFundB: fmtW(pensionFundB),
                retireAge, retireAgeA, retireAgeB,
                comparisonRows: compRows,
                // 종신형
                lifetimeCards: [
                  { label: '연금재원', value: fmtW(pensionFund) },
                  { label: '연금수익률', value: `${lifetimeRate}%` },
                  { label: '연금수령기간', value: `${lifetimeYears}년 (${retireAge}세~120세)` },
                  { label: '연금액 (월)', value: `${fmt(Math.round(lr.monthlyPension / 1e4))}만원` },
                  { label: '연금액 (연)', value: fmtW(lr.annualPension) },
                ],
                lifetimeMilestones: [
                  { title: `10년차 (${retireAge + 10}세)`, items: [
                    { label: '수령한 원금', value: fmtW(lr.milestone10yr.cumPrincipal) },
                    { label: '수령한 이자', value: fmtW(lr.milestone10yr.cumInterest) },
                    { label: '총 수령연금', value: fmtW(lr.milestone10yr.totalReceived) },
                    { label: '남은 원금', value: fmtW(lr.milestone10yr.balance) },
                  ]},
                  { title: '100세', items: [
                    { label: '수령한 원금', value: fmtW(lr.milestone100age.cumPrincipal) },
                    { label: '수령한 이자', value: fmtW(lr.milestone100age.cumInterest) },
                    { label: '총 수령연금', value: fmtW(lr.milestone100age.totalReceived) },
                    { label: '남은 원금', value: fmtW(lr.milestone100age.balance) },
                  ]},
                ],
                // 확정형
                fixedCards: [
                  { label: '연금재원', value: fmtW(pensionFund) },
                  { label: '연금수익률', value: `${fixedRate}%` },
                  { label: '연금수령기간', value: `${fixedPeriod}년 (${retireAge}세~${retireAge + (parseInt(fixedPeriod) || 30)}세)` },
                  { label: '연금액 (월/연)', value: `${fmt(Math.round(fr.monthlyPension / 1e4))}만원 / ${fmtW(fr.annualPension)}` },
                  { label: '총 수령연금', value: fmtW(fr.totalReceived) },
                  { label: '총 수령이자', value: fmtW(fr.totalInterest) },
                ],
                // 무한지급형
                infiniteCards: [
                  { label: '연금재원', value: fmtW(pensionFund) },
                  { label: '연금수익률', value: `${infiniteRate}%` },
                  { label: '수령기간', value: '평생' },
                  { label: '연금액 (월/연)', value: `${fmt(Math.round(ir.monthlyPension / 1e4))}만원 / ${fmtW(ir.annualPension)}` },
                  { label: '총 연금액', value: fmtW(ir.totalPension) },
                  { label: '상속재원', value: fmtW(ir.inheritanceAmount) },
                ],
                // PDF에서 직접 그릴 그래프 데이터 + 첨언
                lifetimeChart,
                lifetimeNote: `원리금 균등상환 방식: 매월 동일한 ${fmtW(lr.monthlyPension)}을 수령합니다. 초기에는 이자 비중이 높고, 후반으로 갈수록 원금 비중이 증가합니다.`,
                fixedChart,
                fixedEndAge: retireAge + fixedP,
                fixedNote: `확정기간 수령: ${retireAge}세부터 ${retireAge + fixedP}세까지 ${fixedP}년간 확정 수령합니다. 수령 종료 후 연금재원은 소진되며, 중도 사망 시 잔존연금이 상속됩니다.`,
                infiniteChart,
                infiniteNote,
                // 목표달성 플랜 섹션 제거 — PDF에서도 생략
                goalInfo: [],
                goalRows: [],
              };

              await generatePensionPlanPdf(pdfData, `연금수령계획_${selectedCustomer?.name ?? ''}_${new Date().toISOString().slice(0, 10)}.pdf`);
            } catch (e: unknown) {
              const msg = e instanceof Error ? e.message : String(e);
              alert(`PDF 생성 실패: ${msg}`);
            }
          }}
          style={{ padding: '8px 16px', fontSize: '13px', fontWeight: 600, borderRadius: '8px', cursor: 'pointer', border: 'none', backgroundColor: 'var(--blue-600)', color: '#fff', display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          📄 PDF 다운로드
        </button>
      </div>

      {/* ===== 섹션1: 연금전환 옵션 비교 ===== */}
      <div id="pdf-tab3-compare" style={cardStyle}>
        <h3 style={sectionTitle}>연금전환 옵션 비교</h3>
        <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '12px' }}>
          연금재원 — A: <strong style={{ color: 'var(--blue-400)' }}>{fmtW(pensionFundA)}</strong>
          {recPenRate && pensionFundB > 0 && (<>{', '}B: <strong style={{ color: '#EA580C' }}>{fmtW(pensionFundB)}</strong></>)}
          {' · '}은퇴나이 — A: <strong style={{ color: 'var(--blue-400)' }}>{retireAgeA}세</strong>
          {recPenRate && (<>{', '}B: <strong style={{ color: '#EA580C' }}>{retireAgeB}세</strong></>)}
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr style={{ backgroundColor: 'var(--bg-surface)' }}>
              {['구분', '고객', '예상수익률', '연금수령기간', '월 연금액', '상속재원'].map(h => (
                <th key={h} style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 600, color: 'var(--blue-400)', borderBottom: '2px solid var(--blue-500)', fontSize: '12px' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* 종신형 */}
            <tr style={{ borderBottom: `1px solid var(--bg-surface)` }}>
              <td rowSpan={recPenRate ? 2 : 1} style={{ padding: '12px', fontWeight: 700, color: '#7CC0FF', verticalAlign: 'middle' }}>종신형</td>
              <td style={{ padding: '10px 12px', textAlign: 'center', fontSize: '12px', color: 'var(--text-muted)' }}>A고객</td>
              <td style={{ padding: '10px 12px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>연금수익률 ({(basePenRate * 100).toFixed(1)}%)</td>
              <td style={{ padding: '10px 12px', textAlign: 'center', color: 'var(--text-primary)' }}>평생 (120세, {lifetimeYearsA}년)</td>
              <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)' }}>{fmtW(compareLifetimeMonthlyA)}</td>
              <td rowSpan={recPenRate ? 2 : 1} style={{ padding: '10px 12px', textAlign: 'center', color: 'var(--text-muted)', borderBottom: `1px solid var(--bg-surface)`, verticalAlign: 'middle' }}>잔존연금</td>
            </tr>
            {recPenRate && (
              <tr style={{ borderBottom: `1px solid var(--bg-surface)`, backgroundColor: 'rgba(234,88,12,0.08)' }}>
                <td style={{ padding: '10px 12px', textAlign: 'center', fontSize: '12px', fontWeight: 600, color: '#FB923C' }}>B고객</td>
                <td style={{ padding: '10px 12px', textAlign: 'center', color: '#FB923C', fontSize: '12px', fontWeight: 500 }}>추천수익률 ({(recPenRate * 100).toFixed(1)}%)</td>
                <td style={{ padding: '10px 12px', textAlign: 'center', color: '#FB923C' }}>평생 (120세, {lifetimeYearsB}년)</td>
                <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: '#FB923C' }}>{fmtW(compareLifetimeMonthlyB)}</td>
              </tr>
            )}
            {/* 방식 구분: 별도 행으로 확실한 컬러 바 (borderCollapse에 묻히지 않음) */}
            <tr aria-hidden><td colSpan={6} style={{ padding: 0, height: '4px', backgroundColor: '#3B82F6' }} /></tr>
            {/* 확정형 */}
            <tr>
              <td rowSpan={recPenRate ? 2 : 1} style={{ padding: '12px', fontWeight: 700, color: '#7CC0FF', verticalAlign: 'middle' }}>확정형</td>
              <td style={{ padding: '10px 12px', textAlign: 'center', fontSize: '12px', color: 'var(--text-muted)' }}>A고객</td>
              <td style={{ padding: '10px 12px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>연금수익률 ({(basePenRate * 100).toFixed(1)}%)</td>
              <td style={{ padding: '10px 12px', textAlign: 'center', color: 'var(--text-primary)' }}>확정 {fixedCompareYears}년<br /><span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>({retireAgeA}→{retireAgeA + fixedCompareYears}세)</span></td>
              <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)' }}>{fmtW(compareFixedMonthlyA)}</td>
              <td rowSpan={recPenRate ? 2 : 1} style={{ padding: '10px 12px', textAlign: 'center', color: 'var(--text-muted)', borderBottom: `1px solid var(--bg-surface)`, verticalAlign: 'middle' }}>잔존연금 또는 없음</td>
            </tr>
            {recPenRate && (
              <tr style={{ borderBottom: `1px solid var(--bg-surface)`, backgroundColor: 'rgba(234,88,12,0.08)' }}>
                <td style={{ padding: '10px 12px', textAlign: 'center', fontSize: '12px', fontWeight: 600, color: '#FB923C' }}>B고객</td>
                <td style={{ padding: '10px 12px', textAlign: 'center', color: '#FB923C', fontSize: '12px', fontWeight: 500 }}>추천수익률 ({(recPenRate * 100).toFixed(1)}%)</td>
                <td style={{ padding: '10px 12px', textAlign: 'center', color: '#FB923C' }}>확정 {fixedCompareYearsB}년<br /><span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>({retireAgeB}→{retireAgeB + fixedCompareYearsB}세)</span></td>
                <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: '#FB923C' }}>{fmtW(compareFixedMonthlyB)}</td>
              </tr>
            )}
            {/* 방식 구분: 별도 행으로 확실한 컬러 바 */}
            <tr aria-hidden><td colSpan={6} style={{ padding: 0, height: '4px', backgroundColor: '#22C55E' }} /></tr>
            {/* 무한지급형 */}
            <tr>
              <td rowSpan={recPenRate ? 2 : 1} style={{ padding: '12px', fontWeight: 700, color: '#4ADE80', verticalAlign: 'middle' }}>무한지급형<br /><span style={{ fontSize: '11px', fontWeight: 400, color: 'var(--text-muted)' }}>(상속연금형)</span></td>
              <td style={{ padding: '10px 12px', textAlign: 'center', fontSize: '12px', color: 'var(--text-muted)' }}>A고객</td>
              <td style={{ padding: '10px 12px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>연금수익률 ({(basePenRate * 100).toFixed(1)}%)</td>
              <td rowSpan={recPenRate ? 2 : 1} style={{ padding: '10px 12px', textAlign: 'center', verticalAlign: 'middle', color: 'var(--text-primary)' }}>평생</td>
              <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)' }}>{fmtW(compareInfiniteMonthlyA)}</td>
              <td rowSpan={recPenRate ? 2 : 1} style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 600, color: 'var(--success)', verticalAlign: 'middle' }}>연금재원 상당</td>
            </tr>
            {recPenRate && (
              <tr style={{ backgroundColor: 'rgba(234,88,12,0.08)' }}>
                <td style={{ padding: '10px 12px', textAlign: 'center', fontSize: '12px', fontWeight: 600, color: '#FB923C' }}>B고객</td>
                <td style={{ padding: '10px 12px', textAlign: 'center', color: '#FB923C', fontSize: '12px', fontWeight: 500 }}>추천수익률 ({(recPenRate * 100).toFixed(1)}%)</td>
                <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: '#FB923C' }}>{fmtW(compareInfiniteMonthlyB)}</td>
              </tr>
            )}
          </tbody>
        </table>
        <div style={{ marginTop: '12px', padding: '10px 14px', backgroundColor: 'var(--bg-surface)', borderRadius: '6px', fontSize: '11px', color: 'var(--text-muted)', lineHeight: 1.6 }}>
          ※ 본 표는 고객의 이해를 돕기 위한 참고용 시뮬레이션이며, 실제 연금전환 조건 및 수령액은 보험사별로 상이할 수 있습니다. 정확한 상담은 담당 보험사를 통해 문의해 주세요.
        </div>
      </div>

      {/* ===== 섹션2: 연금전환 옵션 — 탭 없이 3종 모두 표시 (PDF에 전부 출력되도록) ===== */}
      <div style={cardStyle} id="pdf-tab3-option">
        <h3 style={sectionTitle}>연금전환 옵션</h3>

        {/* 종신형 */}
        <div id="pension-opt-lifetime" style={{ marginBottom: '48px', paddingBottom: '40px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px', paddingBottom: '8px', borderBottom: `2px solid ${tabColors[0]}` }}>
            <span style={{ width: 4, height: 16, backgroundColor: tabColors[0], borderRadius: 2 }} />
            <span style={{ fontSize: '15px', fontWeight: 700, color: '#7CC0FF' }}>{tabs[0]}</span>
          </div>
          <LifetimeSection pv={pensionFund} rate={lifetimeRate} setRate={setLifetimeRate} retireAge={retireAge} result={lifetimeResult} pensionRateFromTab1={pensionRate} />
        </div>

        {/* 확정형 */}
        <div id="pension-opt-fixed" style={{ marginBottom: '48px', paddingBottom: '40px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px', paddingBottom: '8px', borderBottom: `2px solid ${tabColors[1]}` }}>
            <span style={{ width: 4, height: 16, backgroundColor: tabColors[1], borderRadius: 2 }} />
            <span style={{ fontSize: '15px', fontWeight: 700, color: '#93C5FD' }}>{tabs[1]}</span>
          </div>
          <FixedSection pv={pensionFund} rate={fixedRate} setRate={setFixedRate} period={fixedPeriod} setPeriod={setFixedPeriod} retireAge={retireAge} result={fixedResult} />
        </div>

        {/* 무한지급형 */}
        <div id="pension-opt-infinite">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px', paddingBottom: '8px', borderBottom: `2px solid ${tabColors[2]}` }}>
            <span style={{ width: 4, height: 16, backgroundColor: tabColors[2], borderRadius: 2 }} />
            <span style={{ fontSize: '15px', fontWeight: 700, color: '#4ADE80' }}>{tabs[2]}</span>
          </div>
          <InfiniteSection pv={pensionFund} rate={infiniteRate} setRate={setInfiniteRate} period={infinitePeriod} setPeriod={setInfinitePeriod} retireAge={retireAge} result={infiniteResult} pension={infinitePension} setPension={setInfinitePension} />
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
        <ResultCard label="연금재원" value={fmtW(pv)} color="#60A5FA" />
        <ResultCard label="연금수익률" value={`${rateDisplay}%`} color="var(--success)" />
        <ResultCard label="연금수령기간" value={`${years}년 (${retireAge}세~120세)`} color="var(--text-primary)" />
        <ResultCard label="연금액 (월)" value={fmtW(result.monthlyPension)} color="#60A5FA" large />
        <ResultCard label="연금액 (연)" value={fmtW(result.annualPension)} color="#60A5FA" large />
      </div>

      {/* 그래프: 매년 연금의 원금/이자 구성 */}
      <div id="pension-chart-lifetime">
        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>연금 수령 구성 (원금 vs 이자)</div>
        <PensionOptionChart data={result.yearlyData.map(d => {
          // 연간연금 = 원금 + 이자 (일정). 원금이 음수면 이자가 연금액 초과 → 전액 이자 처리
          const annPmt = d.yearPrincipal + d.yearInterest;
          const principal = Math.max(0, d.yearPrincipal);
          const interest = annPmt - principal; // 원금이 0이면 이자=전액연금
          return { age: d.age, balance: Math.round(principal), pension: Math.round(interest) };
        })} type="lifetime" retireAge={retireAge} showBalance isComposition />
        <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', marginTop: '8px', fontSize: '11px' }}>
          <span><span style={{ display: 'inline-block', width: 12, height: 12, backgroundColor: 'var(--warning)', borderRadius: 2, marginRight: 4, verticalAlign: 'middle' }} />이자 수령분 (감소)</span>
          <span><span style={{ display: 'inline-block', width: 12, height: 12, backgroundColor: 'var(--blue-600)', borderRadius: 2, marginRight: 4, verticalAlign: 'middle' }} />원금 수령분 (증가)</span>
        </div>
      </div>

      {/* 10년차 vs 40년차 비교 */}
      <div>
        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '12px' }}>수령 현황 비교</div>
        <div style={{ display: 'flex', gap: '16px' }}>
          {/* 10년차 — 다크 배경 위 밝은 글씨로 대비 확보 */}
          <div style={{ ...msStyle, backgroundColor: 'var(--bg-surface)', borderColor: 'rgba(245,158,11,0.45)' }}>
            <div style={{ fontSize: '14px', fontWeight: 700, color: '#FBBF24', marginBottom: '10px' }}>10년차 ({retireAge + 10}세)</div>
            <div style={msRow}><span style={{ color: 'var(--text-muted)' }}>수령한 원금</span><span style={{ ...msVal, color: 'var(--text-primary)' }}>{fmtW(m10.cumPrincipal)}</span></div>
            <div style={msRow}><span style={{ color: 'var(--text-muted)' }}>수령한 이자</span><span style={{ ...msVal, color: 'var(--text-primary)' }}>{fmtW(m10.cumInterest)}</span></div>
            <div style={{ ...msRow, borderTop: '1px solid rgba(245,158,11,0.35)', marginTop: '6px', paddingTop: '6px' }}><span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>총 수령연금</span><span style={{ ...msVal, color: '#7CC0FF', fontSize: '14px' }}>{fmtW(m10.totalReceived)}</span></div>
            <div style={{ ...msRow, marginTop: '8px', padding: '6px 8px', backgroundColor: 'rgba(245,158,11,0.12)', borderRadius: '4px' }}><span style={{ color: '#FBBF24', fontWeight: 600 }}>남은 원금</span><span style={{ ...msVal, color: '#FBBF24', fontSize: '14px' }}>{fmtW(m10.balance)}</span></div>
          </div>
          {/* 100세 시점 */}
          <div style={{ ...msStyle, backgroundColor: 'var(--bg-surface)', borderColor: 'rgba(59,130,246,0.45)' }}>
            <div style={{ fontSize: '14px', fontWeight: 700, color: '#7CC0FF', marginBottom: '10px' }}>100세 ({100 - retireAge}년차)</div>
            <div style={msRow}><span style={{ color: 'var(--text-muted)' }}>수령한 원금</span><span style={{ ...msVal, color: 'var(--text-primary)' }}>{fmtW(m100.cumPrincipal)}</span></div>
            <div style={msRow}><span style={{ color: 'var(--text-muted)' }}>수령한 이자</span><span style={{ ...msVal, color: 'var(--text-primary)' }}>{fmtW(m100.cumInterest)}</span></div>
            <div style={{ ...msRow, borderTop: '1px solid rgba(59,130,246,0.35)', marginTop: '6px', paddingTop: '6px' }}><span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>총 수령연금</span><span style={{ ...msVal, color: '#7CC0FF', fontSize: '14px' }}>{fmtW(m100.totalReceived)}</span></div>
            <div style={{ ...msRow, marginTop: '8px', padding: '6px 8px', backgroundColor: 'rgba(59,130,246,0.14)', borderRadius: '4px' }}><span style={{ color: '#7CC0FF', fontWeight: 600 }}>남은 원금</span><span style={{ ...msVal, color: '#7CC0FF', fontSize: '14px' }}>{fmtW(m100.balance)}</span></div>
          </div>
        </div>
      </div>

      <Note bg="rgba(251,146,60,0.10)" border="rgba(251,146,60,0.35)" color="#FB923C">
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
        <ResultCard label="연금재원" value={fmtW(pv)} color="#60A5FA" />
        <ResultCard label="연금수익률" value={`${rateDisplay}%`} color="var(--success)" />
        <ResultCard label="연금수령기간" value={`${p}년 (${retireAge}세~${retireAge + p}세)`} color="var(--text-primary)" />
        <div style={{ padding: '12px 16px', backgroundColor: 'var(--bg-surface)', borderRadius: '8px', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>연금액 (월/연)</div>
          <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--blue-400)', fontVariantNumeric: 'tabular-nums' }}>{fmtW(result.monthlyPension)}</div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums', marginTop: '2px' }}>연 {fmtW(result.annualPension)}</div>
        </div>
        <ResultCard label="총 수령연금" value={fmtW(result.totalReceived)} color="var(--text-primary)" />
        <ResultCard label="총 수령이자" value={fmtW(result.totalInterest)} color="var(--success)" />
      </div>

      {/* 그래프: 120세까지, 수령기간만 바 표시 */}
      <div id="pension-chart-fixed">
        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>연금수령 그래프</div>
        <PensionOptionChart data={fullChartData} type="fixed" retireAge={retireAge} />
      </div>

      <Note bg="rgba(59,130,246,0.08)" border="rgba(59,130,246,0.30)" color="#93C5FD">
        <strong>확정기간 수령</strong>: {retireAge}세부터 {retireAge + p}세까지 {p}년간 확정 수령합니다. 수령 종료 후 연금재원은 소진되며, 중도 사망 시 잔존연금이 상속됩니다.
      </Note>
    </div>
  );
}

/* ================================================================== */
/*  무한지급형 섹션                                                      */
/* ================================================================== */

function InfiniteSection({ pv, rate, setRate, retireAge, result, pension, setPension }: {
  pv: number; rate: string; setRate: (v: string) => void; period: string; setPeriod: (v: string) => void;
  retireAge: number; result: InfiniteResult; pension: string; setPension: (v: string) => void;
}) {
  const rateDisplay = rate || '5';
  // 연금액이 이자보다 적으면 잔액 증가, 많으면 감소 — 그래프가 그대로 반영
  const diff = result.interestAnnual - result.annualPension;
  const status: 'keep' | 'grow' | 'drain' =
    Math.abs(diff) < result.interestAnnual * 0.005 ? 'keep' : diff > 0 ? 'grow' : 'drain';
  const statusColor = status === 'drain' ? '#F87171' : '#4ADE80';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* 가로 카드 6개 - 가로 꽉 채움 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1.2fr 1fr 1fr', gap: '10px' }}>
        <ResultCard label="연금재원" value={fmtW(pv)} color="#60A5FA" />
        <div style={{ padding: '12px 16px', backgroundColor: 'var(--bg-surface)', borderRadius: '8px', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>연금수익률</div>
          <div style={{ position: 'relative' }}>
            <input type="text" value={rateDisplay}
              onChange={(e) => setRate(e.target.value.replace(/[^\d.]/g, ''))}
              style={{ ...inputStyle, backgroundColor: 'var(--bg-base)', fontSize: '16px', fontWeight: 700, color: 'var(--success)', height: '32px', padding: '0 30px 0 8px' }}
              onFocus={(e) => { e.currentTarget.style.borderColor = '#3B82F6'; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border-strong)'; }}
            />
            <span style={{ ...unitSpan, fontSize: '13px' }}>%</span>
          </div>
          <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '3px' }}>연 이자 {fmtW(result.interestAnnual)}</div>
        </div>
        <ResultCard label="수령기간"
          value={result.depletedAge ? `${result.depletedAge}세 소진` : '평생'}
          color={result.depletedAge ? '#F87171' : 'var(--text-primary)'} />
        {/* 연금액: 직접 입력 가능 — 비우면 이자액 자동(원금 보존) */}
        <div style={{ padding: '12px 16px', backgroundColor: 'var(--bg-surface)', borderRadius: '8px', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>연금액 (월)</div>
          <div style={{ position: 'relative' }}>
            <input type="text" inputMode="numeric"
              value={pension || String(Math.round(result.monthlyPension / 1e4).toLocaleString('ko-KR'))}
              onChange={(e) => setPension(e.target.value.replace(/\D/g, ''))}
              style={{ ...inputStyle, backgroundColor: 'var(--bg-base)', fontSize: '16px', fontWeight: 700, color: 'var(--success)', height: '32px', padding: '0 42px 0 8px', textAlign: 'right' }}
              onFocus={(e) => { e.currentTarget.style.borderColor = '#3B82F6'; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border-strong)'; }}
            />
            <span style={{ ...unitSpan, fontSize: '11px' }}>만원</span>
          </div>
          <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '3px' }}>
            연 {fmtW(result.annualPension)}{pension ? '' : ' · 이자액 자동'}
          </div>
        </div>
        <ResultCard label="총 연금액" value={fmtW(result.totalPension)} color="var(--text-primary)" />
        <ResultCard label="상속재원 (120세)" value={fmtW(result.inheritanceAmount)} color="#F59E0B" />
      </div>

      {/* 그래프: 실제 잔액 추이 (연금액 vs 이자에 따라 유지/증가/감소) */}
      <div id="pension-chart-infinite">
        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>연금수령 그래프</div>
        <PensionOptionChart data={result.chartData} type="infinite" retireAge={retireAge} showBalance />
      </div>

      <Note bg={status === 'drain' ? 'rgba(248,113,113,0.08)' : 'rgba(34,197,94,0.08)'}
        border={status === 'drain' ? 'rgba(248,113,113,0.30)' : 'rgba(34,197,94,0.30)'} color={statusColor}>
        {status === 'keep' && (<>
          <strong>이자만 수령 (원금 보존)</strong>: 잔액 = 전년 잔액 × (1 + {rateDisplay}%) − 연금액.
          연금액이 연 이자({fmtW(result.interestAnnual)})와 같아 원금 {fmtW(pv)}이 100% 유지되고, 사망 시 전액 상속됩니다.
        </>)}
        {status === 'grow' && (<>
          <strong>이자 미만 수령 (원금 증가)</strong>: 잔액 = 전년 잔액 × (1 + {rateDisplay}%) − 연금액.
          연 이자 {fmtW(result.interestAnnual)} 중 {fmtW(result.annualPension)}만 수령해 매년 {fmtW(diff)}씩 잔액이 늘어
          120세 상속재원이 {fmtW(result.inheritanceAmount)}이 됩니다.
        </>)}
        {status === 'drain' && (<>
          <strong>이자 초과 수령 (원금 감소)</strong>: 잔액 = 전년 잔액 × (1 + {rateDisplay}%) − 연금액.
          연금액이 이자({fmtW(result.interestAnnual)})보다 연 {fmtW(-diff)} 많아 원금이 줄어듭니다
          {result.depletedAge ? ` — ${result.depletedAge}세에 소진됩니다.` : ' (120세까지는 유지).'}
        </>)}
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
          style={{ ...inputStyle, backgroundColor: disabled ? 'var(--bg-surface)' : 'var(--bg-base)', color: disabled ? 'var(--text-muted)' : 'var(--text-primary)', textAlign: disabled ? 'left' : 'right', paddingRight: unit ? '40px' : '10px' }}
          onFocus={(e) => { if (!disabled) e.currentTarget.style.borderColor = '#3B82F6'; }}
          onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border-strong)'; }}
        />
        {unit && <span style={unitSpan}>{unit}</span>}
      </div>
    </div>
  );
}

function ResultCard({ label, value, color, large }: { label: string; value: string; color: string; large?: boolean }) {
  return (
    <div style={{ padding: large ? '16px 20px' : '12px 16px', backgroundColor: 'var(--bg-surface)', borderRadius: '8px', border: '1px solid var(--border)' }}>
      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>{label}</div>
      <div style={{ fontSize: large ? '18px' : '14px', fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  );
}

function InfoCell({ label, value, color }: { label: string; value: string; color?: string }) {
  return (<div><div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>{label}</div><div style={{ fontSize: '15px', fontWeight: 700, color: color ?? 'var(--text-primary)' }}>{value}</div></div>);
}

function Row({ label, value, c }: { label: string; value: string; c: string }) {
  return (<div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}><span style={{ color: c }}>{label}</span><span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{value}</span></div>);
}

function Note({ bg, border, color, children }: { bg: string; border: string; color: string; children: React.ReactNode }) {
  return (<div style={{ padding: '12px 16px', backgroundColor: bg, borderRadius: '8px', border: `1px solid ${border}`, fontSize: '12px', color }}>{children}</div>);
}

export default PensionPlanTab;
