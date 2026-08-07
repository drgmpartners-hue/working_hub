'use client';

import { useState, useEffect, useCallback, useMemo, Fragment } from 'react';
import dynamic from 'next/dynamic';
import { useRetirementStore } from '../../hooks/useRetirementStore';
import { API_URL } from '@/lib/api-url';
import { authLib } from '@/lib/auth';

// PDF export: desiredPlanPdf.ts
const GrowthChart = dynamic(() => import('./GrowthChart'), { ssr: false });

/* ================================================================
   ECOS
   ================================================================ */
const ECOS_DEFAULT = 2.5;
async function fetchInflation(): Promise<number> {
  try {
    const r = await fetch(`${API_URL}/api/v1/retirement/inflation-rate`, { headers: authLib.getAuthHeader() });
    if (r.ok) { const d = await r.json(); return d.rate ?? ECOS_DEFAULT; }
  } catch { /* */ }
  return ECOS_DEFAULT;
}

/* ================================================================
   금융 함수
   ================================================================ */
function excelFV(rate: number, nper: number, pmt: number, pv = 0) {
  if (rate === 0) return -(pv + pmt * nper);
  const f = Math.pow(1 + rate, nper);
  return -pv * f - pmt * (f - 1) / rate;
}

/* ================================================================
   포맷
   ================================================================ */
function fmt(n: number) { return n.toLocaleString('ko-KR'); }
function fmtW(n: number) {
  if (Math.abs(n) >= 1e8) return `${(n / 1e8).toFixed(1)}억원`;
  if (Math.abs(n) >= 1e4) return `${fmt(Math.round(n / 1e4))}만원`;
  return `${fmt(Math.round(n))}원`;
}
function pn(s: string) { return parseInt(s.replace(/\D/g, ''), 10) || 0; }
function fi(s: string) { const n = pn(s); return n > 0 ? fmt(n) : ''; }
// 0을 명시적으로 입력·표시할 수 있는 포맷터 (적립 안 함 = 0 입력 허용)
function fi0(s: string) { const c = s.replace(/\D/g, ''); return c === '' ? '' : fmt(parseInt(c, 10)); }

/* ================================================================
   시뮬레이션 빌더
   ================================================================ */
interface SimRow {
  year: number; age: number; phase: 'saving' | 'holding' | 'retirement';
  monthly_payment: number; additional: number;
  evaluation: number; cumulative_principal: number; investment_return: number;
  pension: number;
}

function buildSim(p: {
  startAge: number; retAge: number; savP: number;
  annSav: number; holding: number; investR: number;
  penR: number; fmWon: number; infR: number; withInfl: boolean;
  annualComp?: boolean;   // true = 연복리(연 단위 기말 적립), 기본 월복리
  overrides?: Record<number, { monthly?: number; additional?: number; pension?: number }>;
}): SimRow[] {
  const invYrs = p.retAge - p.startAge;
  if (invYrs <= 0 || p.investR <= 0) return [];
  const mr = p.investR / 12;
  const rows: SimRow[] = [];
  let prev = 0, cumP = 0;

  for (let i = 0; i < invYrs; i++) {
    const yr = i + 1, age = p.startAge + i;
    const isSav = i < p.savP;
    const ov = p.overrides?.[yr];
    const mp = ov?.monthly !== undefined ? ov.monthly * 1e4 : (isSav ? p.annSav / 12 : 0);
    const ad = ov?.additional !== undefined ? ov.additional * 1e4 : (i === 0 ? p.holding : 0);
    // 중도인출: 해당 연도 기말에 차감한다고 가정 (운용 수익은 연중 그대로 발생)
    const midWd = ov?.pension !== undefined ? ov.pension * 1e4 : 0;
    const grown = p.annualComp
      ? (prev + ad) * (1 + p.investR) + mp * 12          // 연복리: 연 적립액 기말 납입
      : excelFV(mr, 12, -mp, -(prev + ad));              // 월복리: 월 적립
    const ev = Math.max(0, grown - midWd);
    cumP += mp * 12 + ad;
    rows.push({ year: yr, age, phase: isSav ? 'saving' : 'holding', monthly_payment: mp, additional: ad,
      evaluation: Math.round(ev), cumulative_principal: Math.round(cumP), investment_return: Math.round(ev + midWd - cumP), pension: Math.round(midWd) });
    prev = ev;
  }

  const annPen = p.fmWon * 12;
  let depleted = false;
  for (let age = p.retAge; age <= 130; age++) {
    const yrs = age - p.retAge;
    const yearNo = invYrs + yrs + 1;
    if (depleted) {
      rows.push({ year: yearNo, age, phase: 'retirement', monthly_payment: 0, additional: 0,
        evaluation: 0, cumulative_principal: Math.round(cumP), investment_return: Math.round(-cumP), pension: 0 });
    } else {
      const ovP = p.overrides?.[yearNo]?.pension;
      const pen = ovP !== undefined ? ovP * 1e4
        : (annPen > 0 ? (p.withInfl ? annPen * Math.pow(1 + p.infR, yrs) : annPen) : 0);
      // 기말 인출: 1년 운용 후 연말에 연금 지급 — 무한지급 공식(월연금×12÷수익률)과 정합
      // (원금×수익률 = 연간연금이면 잔액이 정확히 유지된다)
      const ev = Math.max(0, prev * (1 + p.penR) - pen);
      rows.push({ year: yearNo, age, phase: 'retirement', monthly_payment: 0, additional: 0,
        evaluation: Math.round(ev), cumulative_principal: Math.round(cumP), investment_return: Math.round(ev - cumP), pension: Math.round(pen) });
      prev = ev;
      if (ev <= 0) depleted = true;
    }
  }
  return rows;
}

/** 시뮬 결과 → 플랜분석 지표
 *  연금 관련 집계는 상속금액과 동일하게 **100세까지**로 기준을 통일한다
 *  (무한지급 플랜을 130세까지 합산하면 상속금액과 기준이 어긋나 비교가 왜곡됨) */
function analyzeSim(rows: SimRow[]) {
  if (!rows.length) return null;
  const acc = rows.filter(r => r.phase !== 'retirement');
  const ret = rows.filter(r => r.phase === 'retirement');
  const lastAcc = acc[acc.length - 1];
  const penRows = ret.filter(r => r.pension > 0 && r.age <= 100);
  return {
    invYears: acc.length,
    principal: lastAcc?.cumulative_principal ?? 0,
    retFund: lastAcc?.evaluation ?? 0,
    accProfit: (lastAcc?.evaluation ?? 0) - (lastAcc?.cumulative_principal ?? 0),
    penYears: penRows.length,
    totalPension: penRows.reduce((s, r) => s + r.pension, 0),
    inherit100: rows.find(r => r.age === 100)?.evaluation ?? 0,
  };
}

/* ================================================================
   스타일
   ================================================================ */
const SH: React.CSSProperties = {
  background: 'linear-gradient(135deg, var(--blue-600) 0%, #2D5A8E 100%)',
  color: '#fff', padding: '14px 20px', borderRadius: '12px 12px 0 0',
  display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontWeight: 700, fontSize: '15px',
};
const SB: React.CSSProperties = {
  border: '1px solid var(--border-strong)', borderTop: 'none', borderRadius: '0 0 12px 12px', padding: '20px', backgroundColor: 'var(--bg-surface)',
};
const CARD: React.CSSProperties = { backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-soft)', borderRadius: '8px', padding: '12px 14px' };
const CARD_G: React.CSSProperties = { background: 'linear-gradient(135deg, var(--success-bg) 0%, var(--success-bg) 100%)', border: '1px solid rgba(16,185,129,0.35)', borderRadius: '8px', padding: '12px 14px' };
const CL: React.CSSProperties = { fontSize: '11px', color: 'var(--text-muted)', marginBottom: '6px', fontWeight: 500 };
const CV: React.CSSProperties = { fontSize: '18px', fontWeight: 700, color: 'var(--blue-400)', fontFamily: 'Inter, monospace' };
const IS: React.CSSProperties = {
  width: '100%', height: '32px', padding: '0 52px 0 10px', fontSize: '14px', color: 'var(--text-primary)',
  backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-strong)', borderRadius: '6px', outline: 'none', boxSizing: 'border-box', textAlign: 'right',
};
const US: React.CSSProperties = { position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', fontSize: '11px', color: 'var(--text-muted)', pointerEvents: 'none' };
const TC: React.CSSProperties = { padding: '6px 8px', textAlign: 'center', fontSize: '13px', color: 'var(--text-primary)' };
const TRs: React.CSSProperties = { padding: '6px 8px', textAlign: 'right', fontFamily: 'Inter, monospace', fontSize: '13px', color: 'var(--text-primary)' };
const SEG: React.CSSProperties = { padding: '1px 6px', fontSize: '10px', fontWeight: 700, borderRadius: '4px', cursor: 'pointer', border: '1px solid var(--border-strong)' };

/* ================================================================
   메인 컴포넌트
   ================================================================ */
export function DesiredPlanTab() {
  const { selectedCustomer, setCustomer } = useRetirementStore();
  const cid = selectedCustomer?.id ?? null;
  const curAge = selectedCustomer?.currentAge ?? 0;
  const thisYear = new Date().getFullYear();

  // 생년월일 미등록 경고 팝업
  const [showBirthWarn, setShowBirthWarn] = useState(false);
  useEffect(() => {
    if (cid && curAge <= 0) setShowBirthWarn(true);
  }, [cid, curAge]);

  /* ---------- 공통: 물가 · 물가반영 토글 ---------- */
  const [infIn, setInfIn] = useState('2.5');
  const [tog1, setTog1] = useState(false);   // 연금액 물가반영: 현재가치 연금액 → 은퇴당시 월 연금액
  const [tog2, setTog2] = useState(false);   // 목표 물가반영: 은퇴금액 산정·연금 인출 증액에 물가 반영
  const [ecos, setEcos] = useState(ECOS_DEFAULT);

  /* ---------- 현재플랜 입력 ---------- */
  const [pSYIn, setPSYIn] = useState(String(thisYear));
  const [cRetAgeIn, setCRetAgeIn] = useState('');
  const [cAmtIn, setCAmtIn] = useState('');            // 적립액 (만)
  // 적립 주기 토글: '월' 선택 = 월 적립·월복리 / '연' 선택 = 연 적립·연복리 (복리 방식 자동 연동, 기본 '연')
  const [cFreq, setCFreq] = useState<'월' | '연'>('연');
  const [cHoldIn, setCHoldIn] = useState('');          // 거치금액 (만)
  const [cSavPIn, setCSavPIn] = useState('');          // 적립기간 (년)
  const [cInvRIn, setCInvRIn] = useState('');          // 투자수익률 (%) — 모으는 과정(적립·거치)에 적용
  const [cPenMIn, setCPenMIn] = useState('');          // 현재가치 기대 연금액 (만/월)
  const [cPenRIn, setCPenRIn] = useState('');          // 연금수익률 (%) — 연금 받는 과정에 적용

  /* ---------- 추천플랜 입력 ---------- */
  const [rRetAgeIn, setRRetAgeIn] = useState('');
  const [rPenMIn, setRPenMIn] = useState('');          // 현재가치 연금액 (만/월)
  const [rPenRIn, setRPenRIn] = useState('');          // 기대 연금수익률 (%)
  const [rInvRIn, setRInvRIn] = useState('');          // 기대 투자수익률 (%)
  const [rSavPIn, setRSavPIn] = useState('');          // 적립기간 (년)
  const [rAmtIn, setRAmtIn] = useState('');            // 적립액 (만)
  const [rFreq, setRFreq] = useState<'월' | '연'>('연');    // 적립 주기 — 월=월복리, 연=연복리 자동 (기본 '연')
  const [rHoldIn, setRHoldIn] = useState('');          // 거치금액 (만)

  /* ---------- 시스템 ---------- */
  const [showCurPlan, setShowCurPlan] = useState(true);    // 현재플랜 아코디언 (기본 펼침)
  const [showRecPlan, setShowRecPlan] = useState(false);   // 추천플랜 아코디언 (기본 접힘)
  const [saving, setSaving] = useState(false);
  const [showTbl, setShowTbl] = useState(false);
  const [tblData, setTblData] = useState<SimRow[]>([]);
  const [overrides, setOv] = useState<Record<number, { monthly?: number; additional?: number; pension?: number }>>({});
  const [toast, setToast] = useState<{ m: string; t: 'success' | 'error' } | null>(null);
  const show = (m: string, t: 'success' | 'error') => { setToast({ m, t }); setTimeout(() => setToast(null), 3000); };

  /* ---------- 파싱 ---------- */
  const infRate = parseFloat(infIn) || ecos;

  // 현재플랜
  const pSY = parseInt(pSYIn) || thisYear;
  const cRetAge = parseInt(cRetAgeIn) || 0;
  const cAmt = pn(cAmtIn);
  const cHold = pn(cHoldIn);
  const cSavP = parseInt(cSavPIn) || 0;
  const cPenM = pn(cPenMIn);
  const cInvR = parseFloat(cInvRIn) || 0;
  const cPenR = parseFloat(cPenRIn) || 0;
  const cStartAge = curAge > 0 ? curAge - (thisYear - pSY) : 0;
  const cInvYrs = cStartAge > 0 && cRetAge > cStartAge ? cRetAge - cStartAge : 0;
  const cHoldYrs = cInvYrs > cSavP ? cInvYrs - cSavP : 0;
  // 연 환산 적립액 (원) · 복리 방식은 적립 주기에 자동 연동 (월→월복리, 연→연복리)
  const cAnnSavWon = (cFreq === '월' ? cAmt * 12 : cAmt) * 1e4;
  const cCompLabel = cFreq === '월' ? '월복리' : '연복리';
  const hasCur = cInvYrs > 0 && cInvR > 0 && (cAmt > 0 || cHold > 0);

  // 추천플랜
  const rRetAge = parseInt(rRetAgeIn) || 0;
  const rPenM = pn(rPenMIn);
  const rPenR = parseFloat(rPenRIn) || 0;
  const rInvR = parseFloat(rInvRIn) || 0;
  const rSavP = parseInt(rSavPIn) || 0;
  const rAmt = pn(rAmtIn);
  const rHold = pn(rHoldIn);   // 적립액·거치금액 동시 입력 가능 (모으기 '팩트' 입력)
  const rAnnSavWon = (rFreq === '월' ? rAmt * 12 : rAmt) * 1e4;
  const rCompLabel = rFreq === '월' ? '월복리' : '연복리';

  // 추천플랜 시작연도: 현재플랜이 있으면 동일, 없으면 현재년도부터 (규칙 6)
  const rStartYear = hasCur ? pSY : thisYear;
  const rStartAge = curAge > 0 ? curAge - (thisYear - rStartYear) : 0;
  const rInvYrs = rStartAge > 0 && rRetAge > rStartAge ? rRetAge - rStartAge : 0;
  const rHoldYrs = rInvYrs > rSavP ? rInvYrs - rSavP : 0;

  /* ---------- 현재플랜 계산 ---------- */
  // 월 연금액(은퇴당시) = 현재가치 기대 연금액 × 물가 반영(tog1)
  const cYrsToRet = curAge > 0 && cRetAge > curAge ? cRetAge - curAge : 0;
  const curPenM = cPenM > 0
    ? (tog1 && cYrsToRet > 0 ? Math.round(cPenM * Math.pow(1 + infRate / 100, cYrsToRet)) : cPenM)
    : 0;

  const simCur = useMemo(() => {
    if (!hasCur) return [];
    return buildSim({
      startAge: cStartAge, retAge: cRetAge, savP: cSavP,
      annSav: cAnnSavWon, holding: cHold * 1e4,
      investR: cInvR / 100, penR: cPenR / 100,
      fmWon: curPenM * 1e4, infR: infRate / 100, withInfl: tog2,
      annualComp: cFreq === '연',
    });
  }, [hasCur, cStartAge, cRetAge, cSavP, cAnnSavWon, cHold, cInvR, cPenR, curPenM, infRate, tog2, cFreq]);

  const curStat = useMemo(() => analyzeSim(simCur), [simCur]);
  const curAccFund = curStat?.retFund ?? 0;   // 은퇴시점 평가금액 (적립+거치 축적 결과)

  // 필요 은퇴금액 (플랜분석용) — 추천플랜과 동일한 무한지급식: 월연금 × 12 ÷ 수익률(물가반영 시 −물가)
  const curNeedFund = useMemo(() => {
    if (curPenM <= 0 || cPenR <= 0) return 0;
    const rate = tog2 ? (cPenR - infRate) / 100 : cPenR / 100;
    if (rate <= 0) return 0;
    return curPenM * 1e4 * 12 / rate;
  }, [curPenM, cPenR, infRate, tog2]);

  /* ---------- 추천플랜 계산 ---------- */
  // 월 연금액(은퇴당시)
  const rYrsToRet = curAge > 0 && rRetAge > curAge ? rRetAge - curAge : 0;
  const recPenM = rPenM > 0
    ? (tog1 && rYrsToRet > 0 ? Math.round(rPenM * Math.pow(1 + infRate / 100, rYrsToRet)) : rPenM)
    : 0;

  // 모으기 우선 로직: 팩트(투자수익률·적립기간·월적립액·거치금액)로 은퇴금액을 만들고,
  // 그 금액이 은퇴 시점에 홀드된 뒤 연금수익률·인출 방식에 따라 이후 그래프가 달라진다.
  const hasRec = rInvYrs > 0 && rInvR > 0 && (rAmt > 0 || rHold > 0);

  const simRec = useMemo(() => {
    if (!hasRec) return [];
    return buildSim({
      startAge: rStartAge, retAge: rRetAge, savP: rSavP,
      annSav: rAnnSavWon, holding: rHold * 1e4,
      investR: rInvR / 100, penR: rPenR / 100,
      fmWon: recPenM * 1e4, infR: infRate / 100, withInfl: tog2,
      annualComp: rFreq === '연',
    });
  }, [hasRec, rStartAge, rRetAge, rSavP, rAnnSavWon, rHold, rInvR, rPenR, recPenM, infRate, tog2, rFreq]);

  const recStat = useMemo(() => analyzeSim(simRec), [simRec]);
  // 희망 은퇴금액 = 팩트로 만들어지는 은퇴 시점 축적액 (연금 재원으로 홀드됨)
  const recRetFund = recStat?.retFund ?? 0;

  // 필요 은퇴금액 (플랜분석 참고용) — 무한지급식: 월연금 × 12 ÷ 수익률(물가반영 시 −물가)
  const recNeedFund = useMemo(() => {
    if (recPenM <= 0 || rPenR <= 0) return 0;
    const rate = tog2 ? (rPenR - infRate) / 100 : rPenR / 100;
    if (rate <= 0) return 0;
    return recPenM * 1e4 * 12 / rate;
  }, [recPenM, rPenR, infRate, tog2]);

  /* ---------- 그래프 데이터 (즉시 반영) ---------- */
  const gData = useMemo(() => {
    const findEnd = (rows: SimRow[]) => {
      for (const r of rows) if (r.phase === 'retirement' && r.evaluation <= 0) return r.age;
      return 999;
    };
    const curEnd = findEnd(simCur);
    const recEnd = findEnd(simRec);
    const maxAge = 100;
    const m: Record<number, { original?: number; modified?: number; principal?: number }> = {};
    for (const r of simCur) {
      if (r.age > maxAge || r.age > curEnd) break;
      m[r.age] = { original: Math.round(r.evaluation / 1e4) };
    }
    for (const r of simRec) {
      if (r.age > maxAge || r.age > recEnd) break;
      if (!m[r.age]) m[r.age] = {};
      m[r.age].modified = Math.round(r.evaluation / 1e4);
    }
    const pSrc = simRec.length ? simRec : simCur;
    for (const r of pSrc) {
      if (r.age > maxAge) break;
      if (!m[r.age]) m[r.age] = {};
      m[r.age].principal = Math.round(r.cumulative_principal / 1e4);
    }
    const axisStart = simCur.length ? simCur[0].age : (simRec.length ? simRec[0].age : 0);
    if (axisStart > 0) for (let age = axisStart; age <= maxAge; age++) { if (!m[age]) m[age] = {}; }
    return Object.entries(m).map(([a, d]) => ({ age: parseInt(a), ...d })).sort((a, b) => a.age - b.age);
  }, [simCur, simRec]);

  /* ---------- ECOS & Load ---------- */
  useEffect(() => { fetchInflation().then(r => { setEcos(r); setInfIn(prev => (prev === '2.5' ? r.toFixed(1) : prev)); }); }, []);

  const load = useCallback(async () => {
    if (!cid) return;
    try {
      const r = await fetch(`${API_URL}/api/v1/retirement/desired-plans/${cid}`, { headers: authLib.getAuthHeader() });
      if (r.ok) {
        const d = await r.json(); const p = d.calculation_params || {};
        const v2 = p.plan_v2;
        if (v2) {
          // 새 구조 복원
          if (v2.infIn) setInfIn(v2.infIn);
          if (v2.tog1 !== undefined) setTog1(!!v2.tog1);
          if (v2.tog2 !== undefined) setTog2(!!v2.tog2);
          if (v2.pSYIn) setPSYIn(v2.pSYIn);
          if (v2.cRetAgeIn !== undefined) setCRetAgeIn(v2.cRetAgeIn);
          if (v2.cAmtIn !== undefined) setCAmtIn(v2.cAmtIn);
          if (v2.cFreq) setCFreq(v2.cFreq);
          if (v2.cHoldIn !== undefined) setCHoldIn(v2.cHoldIn);
          if (v2.cSavPIn !== undefined) setCSavPIn(v2.cSavPIn);
          if (v2.cPenMIn !== undefined) setCPenMIn(v2.cPenMIn);
          if (v2.cInvRIn !== undefined) setCInvRIn(v2.cInvRIn);
          if (v2.cPenRIn !== undefined) setCPenRIn(v2.cPenRIn);
          if (v2.rRetAgeIn !== undefined) setRRetAgeIn(v2.rRetAgeIn);
          if (v2.rPenMIn !== undefined) setRPenMIn(v2.rPenMIn);
          if (v2.rPenRIn !== undefined) setRPenRIn(v2.rPenRIn);
          if (v2.rInvRIn !== undefined) setRInvRIn(v2.rInvRIn);
          if (v2.rSavPIn !== undefined) setRSavPIn(v2.rSavPIn);
          if (v2.rAmtIn !== undefined) setRAmtIn(v2.rAmtIn);
          if (v2.rFreq) setRFreq(v2.rFreq);
          if (v2.rHoldIn !== undefined) setRHoldIn(v2.rHoldIn);
        } else {
          // 구버전 데이터 → 추천플랜으로 최대한 매핑
          const cvm = d.current_value_monthly ?? d.monthly_desired_amount;
          if (cvm) setRPenMIn(fmt(Math.round(cvm / 1e4)));
          if (p.retirement_age) setRRetAgeIn(String(p.retirement_age));
          if (p.inflation_rate) setInfIn(((p.inflation_rate * 100) as number).toFixed(1));
          if (p.pension_return_rate) setRPenRIn(((p.pension_return_rate * 100) as number).toFixed(1));
          if (p.recommended_return_rate) setRInvRIn(((p.recommended_return_rate * 100) as number).toFixed(1));
          else if (p.existing_return_rate) setRInvRIn(((p.existing_return_rate * 100) as number).toFixed(1));
          if (p.savings_period) setRSavPIn(String(p.savings_period));
          if (p.annual_savings) setRAmtIn(fmt(Math.round(p.annual_savings / 12 / 1e4)));
          if (d.use_inflation_input !== undefined) setTog1(!!d.use_inflation_input);
          if (d.use_inflation_calc !== undefined) setTog2(!!d.use_inflation_calc);
          if (d.plan_start_year) setPSYIn(String(d.plan_start_year));
        }
        const saved = d.simulation_data ?? p.modified_plan;
        if (saved?.length) { setTblData(saved); setShowTbl(true); }
      }
    } catch { /* */ }
  }, [cid]);
  useEffect(() => { load(); }, [load]);

  /* ---------- 계산 버튼 (추천플랜 기준 편집 테이블) ---------- */
  const canCalc = hasRec;
  function handleCalc() {
    const sim = buildSim({
      startAge: rStartAge, retAge: rRetAge, savP: rSavP,
      annSav: rAnnSavWon, holding: rHold * 1e4,
      investR: rInvR / 100, penR: rPenR / 100,
      fmWon: recPenM * 1e4, infR: infRate / 100, withInfl: tog2,
      annualComp: rFreq === '연', overrides,
    });
    setTblData(sim); setShowTbl(true); setOv({});
  }

  const dispTbl = useMemo(() => {
    if (!tblData.length) return [];
    if (!Object.keys(overrides).length) return tblData;
    return buildSim({
      startAge: rStartAge, retAge: rRetAge, savP: rSavP,
      annSav: rAnnSavWon, holding: rHold * 1e4,
      investR: rInvR / 100, penR: rPenR / 100,
      fmWon: recPenM * 1e4, infR: infRate / 100, withInfl: tog2,
      annualComp: rFreq === '연', overrides,
    });
  }, [tblData, overrides, rStartAge, rRetAge, rSavP, rAnnSavWon, rHold, rInvR, rPenR, recPenM, infRate, tog2, rFreq]);

  function setOvF(yr: number, field: 'monthly' | 'additional' | 'pension', val: string) {
    setOv(prev => ({ ...prev, [yr]: { ...prev[yr], [field]: pn(val) } }));
  }

  /* ---------- 저장 ---------- */
  async function ensureProfile() {
    if (!cid) return false;
    try {
      const c = await fetch(`${API_URL}/api/v1/retirement/profiles/${cid}`, { headers: authLib.getAuthHeader() });
      if (c.ok || c.status === 403) return true;
      if (c.status === 404) {
        const cr = await fetch(`${API_URL}/api/v1/retirement/profiles`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
          body: JSON.stringify({ customer_id: cid, current_age: curAge || 35, age_at_design: curAge || 35, desired_retirement_age: rRetAge || cRetAge || 60 }),
        });
        return cr.ok || cr.status === 409;
      }
    } catch { /* */ }
    return false;
  }

  async function handleSave() {
    if (!cid) { show('고객을 먼저 선택하세요.', 'error'); return; }
    if (rPenM <= 0 && cPenM <= 0) { show('현재가치 연금액을 입력해주세요.', 'error'); return; }
    setSaving(true);
    try {
      if (!(await ensureProfile())) { show('프로필 생성 실패', 'error'); setSaving(false); return; }
      const simRows = dispTbl.length > 0 ? dispTbl : (simRec.length ? simRec : simCur);
      const body = {
        // 하위 호환 필수 필드 (추천플랜 기준, 없으면 현재플랜)
        monthly_desired_amount: (recPenM || curPenM) * 1e4,
        retirement_age: rRetAge || cRetAge || 60,
        current_age: curAge,
        retirement_period_years: 99,   // 무한지급(이자식) — 하위 호환용 명목값
        savings_period: rSavP || cSavP,
        annual_savings: rAmt * 12 * 1e4 || cAnnSavWon,
        plan_start_age: rStartAge > 0 ? rStartAge : curAge,
        inflation_rate: infRate / 100,
        pension_return_rate: (rPenR || cPenR) / 100,
        expected_return_rate: (rInvR || cInvR) / 100,
        with_inflation: tog2,
        current_value_monthly: (rPenM || cPenM) * 1e4,
        future_monthly_amount: (recPenM || curPenM) * 1e4,
        use_inflation_input: tog1, use_inflation_calc: tog2,
        desired_retirement_age: rRetAge || cRetAge || 60,
        savings_period_years: rSavP, holding_period_years: rHoldYrs,
        annual_savings_amount: rAmt * 12 * 1e4,
        plan_start_year: pSY,
        simulation_data: simRows,
        simulation_target_fund: Math.round(recRetFund),
        target_fund_pv: Math.round(recRetFund),
        existing_return_rate: cInvR / 100,
        recommended_return_rate: rInvR > 0 ? rInvR / 100 : undefined,
        recommended_pension_rate: rPenR > 0 ? rPenR / 100 : undefined,
        available_holding: rHold * 1e4,
        base_pension_rate: cPenR / 100,   // A고객(현재플랜) 연금수익률 — 추천값으로 덮지 않음
        original_plan: simCur, modified_plan: simRec.length ? simRec : undefined,
        // 새 구조 전체 저장 (재진입 시 복원)
        calculation_params: {
          plan_v2: {
            infIn, tog1, tog2,
            pSYIn, cRetAgeIn, cAmtIn, cFreq, cHoldIn, cSavPIn, cInvRIn, cPenMIn, cPenRIn,
            rRetAgeIn, rPenMIn, rPenRIn, rInvRIn, rSavPIn, rAmtIn, rFreq, rHoldIn,
          },
        },
      };
      const r = await fetch(`${API_URL}/api/v1/retirement/desired-plans/${cid}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
        body: JSON.stringify(body),
      });
      if (r.ok) {
        if (selectedCustomer) setCustomer({ ...selectedCustomer, retirementAge: rRetAge || cRetAge, targetFund: Math.round(recRetFund / 1e4) });
        show('저장이 완료되었습니다.', 'success');
      } else { const e = await r.json().catch(() => ({})); show(String((e as Record<string, unknown>).detail || '저장 실패'), 'error'); }
    } catch { show('네트워크 오류', 'error'); } finally { setSaving(false); }
  }

  /* ---------- 플랜분석 행 ---------- */
  const analysisRows = useMemo(() => {
    type Cell = string;
    type Row = { group: string; label: string; cur: Cell; rec: Cell; diff?: Cell; diffColor?: string; curColor?: string; recColor?: string };
    const rows: Row[] = [];
    const num = (v: number) => fmtW(v);
    const push = (group: string, label: string, curV: number | null, recV: number | null, formatter: (v: number) => string = num, unit = '') => {
      const diff = curV != null && recV != null ? recV - curV : null;
      rows.push({
        group,
        label,
        cur: curV != null ? formatter(curV) + unit : '-',
        rec: recV != null ? formatter(recV) + unit : '-',
        diff: diff != null ? `${diff > 0 ? '+' : ''}${formatter(diff)}${unit}` : undefined,
        diffColor: diff != null ? (diff > 0 ? '#34D399' : diff < 0 ? '#F87171' : 'var(--text-muted)') : undefined,
      });
    };
    const plain = (v: number) => fmt(Math.round(v));

    /* ── 플랜 — 설계 조건 ── */
    push('플랜', '은퇴나이', hasCur ? cRetAge : null, hasRec ? rRetAge : null, plain, '세');
    push('플랜', '투자기간 (적립+거치)', curStat ? curStat.invYears : null, recStat ? recStat.invYears : null, plain, '년');
    rows.push({
      group: '플랜',
      label: '수익률 가정 (투자/연금)',
      cur: hasCur ? `${cInvR}% / ${cPenR}%` : '-',
      rec: hasRec ? `${rInvR}% / ${rPenR}%` : '-',
    });

    /* ── 투자 — 모으는 과정 ── */
    push('투자', '투자원금', curStat ? curStat.principal : null, recStat ? recStat.principal : null);
    push('투자', '총 수익 (모으는 기간)', curStat ? curStat.accProfit : null, recStat ? recStat.accProfit : null);
    // 은퇴금액 = 각 플랜 카드의 '기존/희망 은퇴금액'과 동일한 축적액
    push('투자', '은퇴금액 (모은 돈)', curStat ? curAccFund : null, recStat ? recStat.retFund : null);

    /* ── 연금 — 쓰는 과정 ── */
    push('연금', '월 연금액 (은퇴당시)', hasCur && curPenM > 0 ? curPenM * 1e4 : null, hasRec && recPenM > 0 ? recPenM * 1e4 : null);
    // 무한지급 필요액 — 적을수록 유리한 참고 지표라 단순 차이 비교는 오해를 부르므로 생략
    rows.push({
      group: '연금',
      label: '무한지급 필요액 (참고)',
      cur: curNeedFund > 0 ? num(curNeedFund) : '-',
      rec: recNeedFund > 0 ? num(recNeedFund) : '-',
    });
    // 여력 = 모은 돈 − 무한지급 필요액 → 원금 유지 가능 여부를 한 줄로 판정
    const surplus = (fund: number | null, need: number) =>
      fund != null && need > 0 ? fund - need : null;
    const curSur = surplus(curStat ? curAccFund : null, curNeedFund);
    const recSur = surplus(recStat ? recStat.retFund : null, recNeedFund);
    const surCell = (v: number | null) => (v == null ? '-' : `${v >= 0 ? '충분 +' : '부족 '}${num(v)}`);
    const surColor = (v: number | null) => (v == null ? undefined : v >= 0 ? '#34D399' : '#F87171');
    rows.push({
      group: '연금',
      label: '무한지급 여력',
      cur: surCell(curSur), rec: surCell(recSur),
      curColor: surColor(curSur), recColor: surColor(recSur),
    });
    rows.push({
      group: '연금',
      label: '연금수령기간',
      cur: curStat ? `${fmt(curStat.penYears)}년` : '-',
      rec: hasRec ? (recSur != null && recSur >= 0 ? '무한 (이자 지급식)' : `${fmt(recStat?.penYears ?? 0)}년`) : '-',
    });
    // 총 수령 연금액 — 100세 기준 통일(상속금액과 동일), 각 플랜의 실제 수령 연수 병기
    const penCell = (st: { totalPension: number; penYears: number } | null) =>
      st ? `${num(st.totalPension)} (${st.penYears}년)` : '-';
    const penDiff = curStat && recStat ? recStat.totalPension - curStat.totalPension : null;
    rows.push({
      group: '연금',
      label: '총 수령 연금액 (100세까지)',
      cur: penCell(curStat), rec: penCell(recStat),
      diff: penDiff != null ? `${penDiff > 0 ? '+' : ''}${num(penDiff)}` : undefined,
      diffColor: penDiff != null ? (penDiff > 0 ? '#34D399' : penDiff < 0 ? '#F87171' : 'var(--text-muted)') : undefined,
    });

    /* ── 상속 — 남는 자산 ── */
    push('상속', '상속금액 (100세)', curStat ? curStat.inherit100 : null, recStat ? recStat.inherit100 : null);
    return rows;
  }, [hasCur, hasRec, cRetAge, rRetAge, curStat, recStat, curNeedFund, curAccFund, recNeedFund, curPenM, recPenM, cInvR, cPenR, rInvR, rPenR]);

  /* ================================================================
     RENDER
     ================================================================ */
  const customerInfo = selectedCustomer ? {
    name: selectedCustomer.name,
    birthDate: selectedCustomer.birthDate ?? '-',
    targetFund: selectedCustomer.targetFund > 0
      ? (selectedCustomer.targetFund >= 1e8
          ? `${(selectedCustomer.targetFund / 1e8).toFixed(1)}억원`
          : `${selectedCustomer.targetFund.toLocaleString()}만원`)
      : '-',
    retireAge: selectedCustomer.retirementAge > 0 ? String(selectedCustomer.retirementAge) : '-',
  } : undefined;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

      {/* ==================== PDF 다운로드 버튼 ==================== */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
        <button
          onClick={async () => {
            try {
              const { generateDesiredPlanPdf } = await import('../../utils/desiredPlanPdf');
              type PData = import('../../utils/desiredPlanPdf').DesiredPlanPdfData;
              type CI = import('../../utils/desiredPlanPdf').CardItem;

              // 화면 카드 배치와 동일한 순서 (1행 4개 · 2행 4개), 결과는 별도 강조 라인
              const targetFundCards: CI[] = [
                { label: '플랜 시작연도', value: `${pSY}년` },
                { label: '희망 은퇴나이', value: cRetAge > 0 ? `${cRetAge}세 (총 ${cInvYrs}년)` : '-' },
                { label: `적립액 (${cFreq}·${cCompLabel})`, value: cAmt > 0 ? `${fmt(cAmt)}만원/${cFreq}` : '-' },
                { label: '거치금액', value: cHold > 0 ? `${fmt(cHold)}만원` : '-' },
                { label: '적립기간', value: cInvYrs > 0 ? `${cSavP}년 (거치 ${cHoldYrs}년)` : '-' },
                { label: '투자수익률', value: cInvR > 0 ? `${cInvR}%` : '-' },
                { label: '현재가치 기대 연금액', value: cPenM > 0 ? `${fmt(cPenM)}만원/월` : '-' },
                { label: '연금수익률', value: cPenR > 0 ? `${cPenR}%` : '-' },
              ];
              const targetFundResults: CI[] = [
                { label: '기존 은퇴금액', value: curAccFund > 0 ? fmtW(curAccFund) : '-' },
                { label: '월 연금액 (은퇴당시)', value: curPenM > 0 ? `${fmt(curPenM)}만원/월` : '-' },
              ];
              // 기존 은퇴금액·월 연금액이 모두 산출되지 않았다면 현재플랜은 '없음'으로 처리
              const curPlanEmpty = curAccFund <= 0 && curPenM <= 0;
              const investCards: CI[] = [
                { label: '희망 은퇴나이', value: rRetAge > 0 ? `${rRetAge}세 (총 ${rInvYrs}년)` : '-' },
                { label: '적립기간', value: rInvYrs > 0 ? `${rSavP}년 (거치 ${rHoldYrs}년)` : '-' },
                { label: `적립액 (${rFreq}·${rCompLabel})`, value: rAmt > 0 ? `${fmt(rAmt)}만원/${rFreq}` : '-' },
                { label: '거치금액', value: rHold > 0 ? `${fmt(rHold)}만원` : '-' },
                { label: '기대 투자수익률', value: rInvR > 0 ? `${rInvR}%` : '-' },
                { label: '현재가치 연금액', value: rPenM > 0 ? `${fmt(rPenM)}만원/월` : '-' },
                { label: '기대 연금수익률', value: rPenR > 0 ? `${rPenR}%` : '-' },
                { label: '물가', value: `${infRate}%` },
              ];
              const investResults: CI[] = [
                { label: '희망 은퇴금액', value: recRetFund > 0 ? fmtW(recRetFund) : '-' },
                { label: '월 연금액 (은퇴당시)', value: recPenM > 0 ? `${fmt(recPenM)}만원/월` : '-' },
              ];
              // 플랜분석은 화면과 동일한 비교 테이블로 PDF 2페이지에 렌더링
              type ARow = import('../../utils/desiredPlanPdf').AnalysisRow;
              const pdfAnalysisRows: ARow[] = analysisRows.map(r => ({
                group: r.group, label: r.label, cur: r.cur, rec: r.rec, diff: r.diff,
              }));
              const goalPlanCards: CI[] = [];   // (사용 안 함 — 하위 호환)

              type SRow = import('../../utils/desiredPlanPdf').SimRow;
              let runCumPen = 0;
              const simRows: SRow[] = (dispTbl.length ? dispTbl : simRec).map(r => {
                const pen = r.pension ?? 0;
                runCumPen += pen;
                const phase = r.phase === 'saving' ? '적립' : r.phase === 'holding' ? '거치' : '은퇴후';
                return {
                  calYear: rStartYear + (r.year ?? 0) - 1,
                  year: r.year ?? 0, age: r.age ?? 0, phase,
                  monthlyPayment: (r.monthly_payment ?? 0) * 12,
                  additional: r.additional ?? 0,
                  cumulativePrincipal: r.cumulative_principal ?? 0,
                  investmentReturn: r.investment_return ?? 0,
                  pension: pen, cumPension: runCumPen,
                  evaluation: r.evaluation ?? 0,
                };
              });

              const pdfData: PData = {
                customer: customerInfo ?? { name: '', birthDate: '', targetFund: '-', retireAge: '-' },
                // 현재플랜 결과값이 모두 없으면 카드 대신 '진행한 플랜이 없습니다.'만 출력
                targetFundCards: curPlanEmpty ? [] : targetFundCards,
                targetFundResults: curPlanEmpty ? [] : targetFundResults,
                investCards, investResults, goalPlanCards, simRows,
                analysisRows: pdfAnalysisRows, hasCur, hasRec,
                retirementAge: rRetAge || cRetAge,
                graphId: 'pdf-tab1-graph',
              };
              await generateDesiredPlanPdf(pdfData, `은퇴플랜설계_${selectedCustomer?.name ?? ''}_${new Date().toISOString().slice(0, 10)}.pdf`);
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

      {/* ==================== 현재플랜 (아코디언) ==================== */}
      <div id="pdf-tab1-target">
        <div style={showCurPlan ? SH : { ...SH, borderRadius: '12px' }}>
          <span>현재플랜</span>
          <div style={{ display: 'flex', gap: '14px', alignItems: 'center' }}>
            <Tog label="연금액 물가반영" c={tog1} f={() => setTog1(!tog1)} />
            <Tog label="목표 물가반영" c={tog2} f={() => setTog2(!tog2)} />
            <button type="button"
              onClick={() => {
                if (!window.confirm('현재플랜 입력값을 모두 지울까요?')) return;
                setPSYIn(String(thisYear)); setCRetAgeIn(''); setCAmtIn(''); setCHoldIn(''); setCSavPIn(''); setCPenMIn(''); setCPenRIn('');
              }}
              style={{ padding: '4px 10px', fontSize: '11px', fontWeight: 700, borderRadius: '6px', border: '1px solid rgba(255,255,255,0.4)',
                backgroundColor: 'rgba(255,255,255,0.12)', color: '#fff', cursor: 'pointer' }}>
              ↺ 초기화
            </button>
            <button type="button" onClick={() => setShowCurPlan(v => !v)}
              title={showCurPlan ? '접기' : '펼치기'}
              style={{ width: 26, height: 26, padding: 0, borderRadius: '6px', border: '1px solid rgba(255,255,255,0.4)',
                backgroundColor: 'rgba(255,255,255,0.12)', color: '#fff', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>
              {showCurPlan ? '▲' : '▼'}
            </button>
          </div>
        </div>
        {showCurPlan && (
        <div style={SB}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
            <InC label="플랜 시작연도" u="년" v={pSYIn} f={v => setPSYIn(v.replace(/\D/g, ''))} />
            <InC label="희망 은퇴나이" u="세" v={cRetAgeIn} f={v => setCRetAgeIn(v.replace(/\D/g, ''))}
              sub={cInvYrs > 0 ? `총 투자기간: ${cInvYrs}년` : ''} />
            {/* 적립액: 월/연 토글 하나 — 월 = 월복리, 연 = 연복리 자동 적용 */}
            <SavAmtCard label="적립액" v={cAmtIn} f={v => setCAmtIn(fi0(v))}
              freq={cFreq} setFreq={setCFreq} amt={cAmt} annSavWon={cAnnSavWon} />
            <InC label="거치금액" u="만원" v={cHoldIn} f={v => setCHoldIn(fi(v))} cur />

            <SavPCard label="적립기간" v={cSavPIn} f={v => setCSavPIn(v.replace(/\D/g, ''))}
              invYrs={cInvYrs} holdYrs={cHoldYrs} />
            <InC label="투자수익률" u="%" v={cInvRIn} f={v => setCInvRIn(v.replace(/[^\d.]/g, ''))}
              sub="모으는 과정(적립·거치)에 적용" />
            <InC label="현재가치 기대 연금액" u="만원/월" v={cPenMIn} f={v => setCPenMIn(fi(v))} cur />
            <InC label="연금수익률" u="%" v={cPenRIn} f={v => setCPenRIn(v.replace(/[^\d.]/g, ''))}
              sub="연금 받는 과정에 적용" />

            <div style={{ gridColumn: 'span 2' }}>
              <IfC label="기존 은퇴금액" v={curAccFund > 0 ? fmtW(curAccFund) : '-'}
                sub={curAccFund > 0
                  ? `${cRetAge}세 시점 모이는 금액 (${cCompLabel}) — 그래프의 현재플랜 정점과 동일`
                  : '적립액·수익률·기간을 입력하세요'} g hl />
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <IfC label="월 연금액 (은퇴당시)" v={curPenM > 0 ? `${fmt(curPenM)}만원/월` : '-'}
                sub={tog1 ? `현재가치 ${fmt(cPenM)}만원 × 물가 ${infRate}% × ${cYrsToRet}년` : '물가 미반영 (연금액 물가반영 꺼짐)'} g hl />
            </div>
          </div>
        </div>
        )}
      </div>

      {/* ==================== 추천플랜 (아코디언 · 기본 접힘) ==================== */}
      <div id="pdf-tab1-invest">
        <div style={showRecPlan ? SH : { ...SH, borderRadius: '12px' }}>
          <span>추천플랜</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <span style={{ fontSize: '11px', fontWeight: 500, color: 'rgba(255,255,255,0.75)' }}>
              시작연도 {rStartYear}년 {hasCur ? '(현재플랜과 동일)' : '(현재플랜 미입력 → 올해부터)'}
            </span>
            <button type="button"
              onClick={() => {
                if (!window.confirm('추천플랜 입력값을 모두 지울까요?')) return;
                setRRetAgeIn(''); setRPenMIn(''); setRPenRIn(''); setRInvRIn(''); setRSavPIn(''); setRAmtIn(''); setRHoldIn('');
              }}
              style={{ padding: '4px 10px', fontSize: '11px', fontWeight: 700, borderRadius: '6px', border: '1px solid rgba(255,255,255,0.4)',
                backgroundColor: 'rgba(255,255,255,0.12)', color: '#fff', cursor: 'pointer' }}>
              ↺ 초기화
            </button>
            <button type="button" onClick={() => setShowRecPlan(v => !v)}
              title={showRecPlan ? '접기' : '펼치기'}
              style={{ width: 26, height: 26, padding: 0, borderRadius: '6px', border: '1px solid rgba(255,255,255,0.4)',
                backgroundColor: 'rgba(255,255,255,0.12)', color: '#fff', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>
              {showRecPlan ? '▲' : '▼'}
            </button>
          </div>
        </div>
        {showRecPlan && (
        <div style={SB}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
            {/* 1행: 은퇴 시점과 모으기 조건 — 이 값들로 은퇴금액이 만들어진다 */}
            <InC label="희망 은퇴나이" u="세" v={rRetAgeIn} f={v => setRRetAgeIn(v.replace(/\D/g, ''))}
              sub={rInvYrs > 0 ? `총 투자기간: ${rInvYrs}년` : ''} />
            <SavPCard label="적립기간" v={rSavPIn} f={v => setRSavPIn(v.replace(/\D/g, ''))}
              invYrs={rInvYrs} holdYrs={rHoldYrs} />
            <SavAmtCard label="적립액" v={rAmtIn} f={v => setRAmtIn(fi0(v))}
              freq={rFreq} setFreq={setRFreq} amt={rAmt} annSavWon={rAnnSavWon} />
            <InC label="거치금액" u="만원" v={rHoldIn} f={v => setRHoldIn(fi0(v))} cur />

            {/* 2행: 수익률과 쓰기 로직 — 모은 은퇴금액을 어떻게 받을지 */}
            <InC label="기대 투자수익률" u="%" v={rInvRIn} f={v => setRInvRIn(v.replace(/[^\d.]/g, ''))}
              sub="모으는 과정(적립·거치)에 적용" />
            <InC label="현재가치 연금액" u="만원/월" v={rPenMIn} f={v => setRPenMIn(fi(v))} cur />
            <InC label="기대 연금수익률" u="%" v={rPenRIn} f={v => setRPenRIn(v.replace(/[^\d.]/g, ''))}
              sub="은퇴 후 재원 운용 수익률" />
            {/* 물가: 현재플랜과 공용 값 — 어느 쪽에서 수정해도 동일 적용 */}
            <InC label="물가" u="%" v={infIn} f={v => setInfIn(v.replace(/[^\d.]/g, ''))}
              sub={`두 플랜 공용 적용 · 한국은행 기준 ${ecos.toFixed(1)}%`} />

            {/* 3행: 결과 */}
            <div style={{ gridColumn: 'span 2' }}>
              <IfC label="희망 은퇴금액" v={recRetFund > 0 ? fmtW(recRetFund) : '-'}
                sub={recRetFund > 0
                  ? `${rRetAge}세 시점 축적액 — 이 금액이 홀드되어 연금 재원이 됩니다`
                  : '투자수익률·적립/거치·기간 입력 시 계산'} g hl />
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <IfC label="월 연금액 (은퇴당시)" v={recPenM > 0 ? `${fmt(recPenM)}만원/월` : '-'}
                sub={tog1 ? `현재가치 ${fmt(rPenM)}만원 × 물가 ${infRate}% × ${rYrsToRet}년` : '물가 미반영 (연금액 물가반영 꺼짐)'} g hl />
            </div>
          </div>
        </div>
        )}
      </div>

      {/* ==================== 시뮬레이션 그래프 (즉시 반영) ==================== */}
      {gData.length > 0 && (simCur.length > 0 || simRec.length > 0) && (
        <div id="pdf-tab1-graph" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-soft)', borderRadius: '12px', padding: '20px' }}>
          <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--blue-400)', margin: '0 0 12px' }}>시뮬레이션 그래프</h3>
          <div style={{ display: 'flex', gap: '20px', marginBottom: '12px', fontSize: '12px' }}>
            {simCur.length > 0 && <LG color="#1E3A5F" label="현재플랜" />}
            {simRec.length > 0 && <LG color="#E85D04" label="추천플랜" />}
            <LG color="#9CA3AF" label="투자원금" dash />
          </div>
          <GrowthChart data={gData} retirementAge={rRetAge || cRetAge} showModified={simRec.length > 0}
            savingsEndAge={(simRec.length ? rStartAge + rSavP : cStartAge + cSavP)} />
        </div>
      )}

      {/* ==================== 플랜분석 ==================== */}
      {(hasCur || hasRec) && (
        <div id="pdf-tab1-plan">
          <div style={SH}><span>플랜분석</span>
            <span style={{ fontSize: '11px', fontWeight: 500, color: 'rgba(255,255,255,0.75)' }}>
              {hasCur && hasRec ? '현재플랜 vs 추천플랜' : hasRec ? '추천플랜' : '현재플랜'}
            </span>
          </div>
          <div style={SB}>
            {/* 가로폭을 좁혀 한눈에 비교 — 중앙 정렬 카드형 */}
            <table style={{ width: '100%', maxWidth: 760, margin: '0 auto', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ backgroundColor: 'var(--bg-card)' }}>
                  <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600, color: 'var(--text-muted)', borderBottom: '2px solid var(--border)', fontSize: '12px' }}>항목</th>
                  {hasCur && <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700, color: '#60A5FA', borderBottom: '2px solid var(--border)', fontSize: '12px', whiteSpace: 'nowrap' }}>현재플랜</th>}
                  {hasRec && <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700, color: '#E85D04', borderBottom: '2px solid var(--border)', fontSize: '12px', whiteSpace: 'nowrap' }}>추천플랜</th>}
                  {hasCur && hasRec && <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600, color: 'var(--text-muted)', borderBottom: '2px solid var(--border)', fontSize: '12px', whiteSpace: 'nowrap' }}>차이 (추천-현재)</th>}
                </tr>
              </thead>
              <tbody>
                {analysisRows.map((r, i) => {
                  // 분류(플랜·투자·연금·상속)가 바뀌는 지점마다 구분 헤더 삽입
                  const isNewGroup = i === 0 || analysisRows[i - 1].group !== r.group;
                  const colCount = 1 + (hasCur ? 1 : 0) + (hasRec ? 1 : 0) + (hasCur && hasRec ? 1 : 0);
                  const groupColor = r.group === '플랜' ? '#9CA3AF'
                    : r.group === '투자' ? '#60A5FA'
                    : r.group === '연금' ? '#34D399' : '#E0B44E';
                  return (
                    <Fragment key={r.label}>
                      {isNewGroup && (
                        <tr>
                          <td colSpan={colCount} style={{
                            padding: i === 0 ? '6px 10px 5px' : '14px 10px 5px',
                            fontSize: '11px', fontWeight: 800, letterSpacing: '0.04em',
                            color: groupColor, borderBottom: `1px solid ${groupColor}44`,
                          }}>
                            {r.group}
                          </td>
                        </tr>
                      )}
                      <tr style={{ borderBottom: '1px solid var(--bg-card)' }}>
                        <td style={{ padding: '8px 12px 8px 18px', color: 'var(--text-secondary)', fontWeight: 500 }}>{r.label}</td>
                        {hasCur && <td style={{ ...TRs, fontWeight: 600, ...(r.curColor ? { color: r.curColor, fontWeight: 700 } : {}) }}>{r.cur}</td>}
                        {hasRec && <td style={{ ...TRs, fontWeight: 600, ...(r.recColor ? { color: r.recColor, fontWeight: 700 } : {}) }}>{r.rec}</td>}
                        {hasCur && hasRec && (
                          <td style={{ ...TRs, fontWeight: 700, color: r.diffColor ?? 'var(--text-muted)' }}>{r.diff ?? '-'}</td>
                        )}
                      </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ==================== 계산 버튼 (추천플랜 상세 시뮬레이션) ==================== */}
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <button onClick={handleCalc} disabled={!canCalc}
          title={canCalc ? '' : '추천플랜 입력(은퇴나이·수령기간·연금액·수익률·월적립 또는 거치)을 완성하세요'}
          style={{ padding: '12px 0', width: '30%', fontSize: '14px', fontWeight: 700, borderRadius: '8px',
            cursor: canCalc ? 'pointer' : 'not-allowed', backgroundColor: canCalc ? '#1E3A5F' : '#9CA3AF',
            color: '#fff', border: 'none', boxShadow: canCalc ? '0 2px 8px rgba(30,58,95,0.3)' : 'none' }}>
          계산
        </button>
      </div>

      {/* ==================== 은퇴플랜 시뮬레이션 (추천플랜 기준 · 편집 가능) ==================== */}
      {showTbl && dispTbl.length > 0 && (
        <div id="pdf-tab1-sim" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-soft)', borderRadius: '12px', padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
            <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--blue-400)', margin: 0 }}>은퇴플랜 시뮬레이션 (추천플랜)</h3>
            <button onClick={() => setOv({})}
              style={{ padding: '5px 14px', fontSize: '12px', fontWeight: 600, color: 'var(--danger)', backgroundColor: 'var(--danger-bg)',
                border: '1px solid rgba(239,68,68,0.35)', borderRadius: '6px', cursor: 'pointer' }}>수정 초기화</button>
          </div>
          <div style={{ overflowX: 'auto', maxHeight: '500px', overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ backgroundColor: 'var(--bg-surface)', position: 'sticky', top: 0, zIndex: 1 }}>
                  {['연도','연차','나이','구분','월적립(만)','거치(만)','연금인출','누적원금(만)','평가금액(만)'].map(h => (
                    <th key={h} style={{ padding: '8px', borderBottom: '2px solid var(--border)',
                      textAlign: ['연도','연차','나이','구분'].includes(h) ? 'center' : 'right',
                      fontWeight: 600, color: h === '연금인출' ? '#F87171' : 'var(--text-muted)', whiteSpace: 'nowrap',
                      backgroundColor: 'var(--bg-surface)', fontSize: '12px' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dispTbl.map(r => {
                  const ov = overrides[r.year];
                  const mpM = Math.round(r.monthly_payment / 1e4);
                  const adM = Math.round(r.additional / 1e4);
                  const isRA = r.age === (rRetAge || cRetAge);
                  const is100 = r.age === 100;
                  const isHL = isRA || is100;
                  const pc = r.phase === 'saving' ? '#60A5FA' : r.phase === 'holding' ? '#E0B44E' : '#34D399';
                  const pl = r.phase === 'saving' ? '적립' : r.phase === 'holding' ? '거치' : '은퇴후';
                  const bg = isRA ? 'rgba(96,165,250,0.14)' : is100 ? 'rgba(248,113,113,0.12)' : r.phase === 'saving' ? 'transparent' : r.phase === 'holding' ? 'rgba(224,180,78,0.08)' : 'rgba(52,211,153,0.08)';
                  return (
                    <tr key={r.year} style={{ borderBottom: isHL ? '2px solid' : '1px solid var(--bg-surface)', borderBottomColor: isRA ? '#60A5FA' : is100 ? '#F87171' : undefined, backgroundColor: bg }}>
                      <td style={{ ...TC, fontSize: 11, color: 'var(--text-muted)' }}>{rStartYear + r.year - 1}</td>
                      <td style={TC}>{r.year}</td>
                      <td style={{ ...TC, fontWeight: isHL ? 700 : 400, color: isRA ? '#60A5FA' : is100 ? '#F87171' : 'var(--text-primary)' }}>{r.age}세{isRA && ' ★'}{is100 && ' ★'}</td>
                      <td style={{ ...TC, color: pc, fontWeight: 600 }}>{pl}</td>
                      <td style={TRs}>
                        {r.phase !== 'retirement' ? (
                          <input type="text" inputMode="numeric"
                            value={ov?.monthly !== undefined ? fi(String(ov.monthly)) : (mpM > 0 ? fmt(mpM) : '-')}
                            onChange={e => setOvF(r.year, 'monthly', e.target.value)}
                            style={{ ...IS, width: '90px', height: '28px', fontSize: '12px', padding: '0 6px', backgroundColor: 'var(--bg-base)',
                              border: ov?.monthly !== undefined ? '2px solid #3B82F6' : '1px solid var(--border-strong)' }} />
                        ) : '-'}
                      </td>
                      <td style={TRs}>
                        {r.phase !== 'retirement' ? (
                          <input type="text" inputMode="numeric"
                            value={ov?.additional !== undefined ? fi(String(ov.additional)) : (adM > 0 ? fmt(adM) : '')}
                            onChange={e => setOvF(r.year, 'additional', e.target.value)}
                            style={{ ...IS, width: '90px', height: '28px', fontSize: '12px', padding: '0 6px', backgroundColor: 'var(--bg-base)',
                              border: ov?.additional !== undefined ? '2px solid #3B82F6' : '1px solid var(--border-strong)' }} />
                        ) : '-'}
                      </td>
                      {/* 연금인출: 직접 수정 가능 — 은퇴 전 구간 입력 시 중도인출(해당 연도 기말 차감) */}
                      <td style={TRs}>
                        <input type="text" inputMode="numeric"
                          value={ov?.pension !== undefined ? fi0(String(ov.pension)) : (r.pension > 0 ? fmt(Math.round(r.pension / 1e4)) : '')}
                          onChange={e => setOvF(r.year, 'pension', e.target.value)}
                          placeholder="-"
                          style={{ ...IS, width: '90px', height: '28px', fontSize: '12px', padding: '0 6px', backgroundColor: 'var(--bg-base)',
                            color: (ov?.pension !== undefined || r.pension > 0) ? '#F87171' : 'var(--text-muted)',
                            border: ov?.pension !== undefined ? '2px solid #F87171' : '1px solid var(--border-strong)' }} />
                      </td>
                      <td style={TRs}>{fmt(Math.round(r.cumulative_principal / 1e4))}</td>
                      <td style={{ ...TRs, fontWeight: 700, color: isRA ? '#60A5FA' : is100 ? '#F87171' : 'var(--text-primary)', fontSize: isHL ? '14px' : '13px' }}>{fmt(Math.round(r.evaluation / 1e4))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div style={{ textAlign: 'right', fontSize: '10px', color: 'var(--text-muted)', marginTop: '4px' }}>
              (단위: 만원) 파란 테두리 = 수정된 값 · 빨간 테두리 = 인출 수정 (은퇴 전 입력 = 중도인출, 해당 연도 기말 차감)
            </div>
          </div>
        </div>
      )}

      {/* ==================== 저장 버튼 ==================== */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', alignItems: 'center' }}>
        <button onClick={handleSave} disabled={!cid || saving}
          style={{ padding: '12px 0', width: '30%', fontSize: '14px', fontWeight: 700, borderRadius: '8px',
            cursor: cid && !saving ? 'pointer' : 'not-allowed',
            backgroundColor: cid && !saving ? '#059669' : '#9CA3AF', color: '#fff', border: 'none',
            boxShadow: cid && !saving ? '0 2px 8px rgba(5,150,105,0.3)' : 'none' }}>
          {saving ? '저장 중...' : '은퇴플랜 저장'}
        </button>
      </div>

      {toast && <div style={{ position: 'fixed', bottom: 32, left: '50%', transform: 'translateX(-50%)', zIndex: 9999,
        padding: '12px 24px', borderRadius: 8, backgroundColor: toast.t === 'success' ? '#1E3A5F' : '#EF4444',
        color: '#fff', fontSize: 14, fontWeight: 500, boxShadow: '0 4px 16px rgba(0,0,0,0.18)' }}>{toast.m}</div>}

      {/* ==================== 생년월일 미등록 경고 팝업 ==================== */}
      {showBirthWarn && (
        <div
          onClick={() => setShowBirthWarn(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 10000, backgroundColor: 'rgba(0,0,0,0.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ width: '100%', maxWidth: 420, backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-strong)',
              borderRadius: 12, padding: '24px', boxShadow: '0 12px 40px rgba(0,0,0,0.35)' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <span style={{ fontSize: 22 }}>⚠️</span>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>생년월일이 등록되지 않았습니다</h3>
            </div>
            <p style={{ margin: '0 0 6px', fontSize: 13.5, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
              {selectedCustomer?.name ? <strong>{selectedCustomer.name}</strong> : '선택한 고객'} 님의 <strong>생년월일</strong>이 없어 현재 나이를 계산할 수 없습니다.
            </p>
            <p style={{ margin: '0 0 20px', fontSize: 13.5, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
              현재 나이가 없으면 <strong>시뮬레이션 그래프가 생성되지 않습니다.</strong> 고객 정보에서 생년월일을 먼저 등록해주세요.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowBirthWarn(false)}
                style={{ padding: '9px 20px', fontSize: 13, fontWeight: 600, borderRadius: 8, border: 'none',
                  backgroundColor: 'var(--blue-600)', color: '#fff', cursor: 'pointer' }}
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ================================================================
   서브 컴포넌트
   ================================================================ */
function InC({ label, u, v, f, cur, sub, subC, ph, hl, dim }: {
  label: string; u: string; v: string; f: (v: string) => void;
  cur?: boolean; sub?: string; subC?: string; ph?: string; hl?: boolean; dim?: boolean;
}) {
  const cardStyle: React.CSSProperties = hl
    ? { ...CARD, border: '1.5px solid var(--blue-400)', boxShadow: '0 0 0 1px var(--blue-400), 0 0 10px rgba(59,130,246,0.22)' }
    : dim
    ? { ...CARD, opacity: 0.4 }
    : CARD;
  return (
    <div style={cardStyle}>
      <div style={CL}>{label}</div>
      <div style={{ position: 'relative' }}>
        <input type="text" inputMode={cur ? 'numeric' : undefined} value={v} onChange={e => f(e.target.value)}
          placeholder={ph} disabled={dim} style={{ ...IS, ...(dim ? { cursor: 'not-allowed' } : {}) }} />
        <span style={US}>{u}</span>
      </div>
      {sub && <div style={{ fontSize: '10px', color: subC || '#9CA3AF', marginTop: '4px' }}>{sub}</div>}
    </div>
  );
}

/** 적립액 카드 — 월/연 토글 하나로 적립 주기·복리 방식 자동 연동 (현재·추천플랜 공용) */
function SavAmtCard({ label, v, f, freq, setFreq, amt, annSavWon }: {
  label: string; v: string; f: (v: string) => void;
  freq: '월' | '연'; setFreq: (f: '월' | '연') => void;
  amt: number; annSavWon: number;
}) {
  const compLabel = freq === '월' ? '월복리' : '연복리';
  return (
    <div style={CARD}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
        <div style={{ ...CL, marginBottom: 0 }}>{label}</div>
        <div style={{ display: 'flex', gap: '3px' }}>
          {(['월', '연'] as const).map(fq => (
            <button key={fq} type="button" onClick={() => setFreq(fq)}
              title={fq === '월' ? '월 적립 · 월복리 계산' : '연 적립 · 연복리 계산'}
              style={{ ...SEG, backgroundColor: freq === fq ? 'rgba(59,130,246,0.18)' : 'var(--bg-surface)', color: freq === fq ? '#60A5FA' : 'var(--text-muted)', borderColor: freq === fq ? 'var(--blue-400)' : 'var(--border-strong)' }}>{fq}</button>
          ))}
        </div>
      </div>
      <div style={{ position: 'relative' }}>
        <input type="text" inputMode="numeric" value={v} onChange={e => f(e.target.value)} style={IS} />
        <span style={US}>만원/{freq}</span>
      </div>
      <div style={{ fontSize: '10px', color: '#9CA3AF', marginTop: '4px' }}>
        {compLabel} 자동 적용{amt > 0 ? ` · 연 환산 ${fmt(Math.round(annSavWon / 1e4))}만원` : ''}
      </div>
    </div>
  );
}

/** 적립기간 카드 — 시작~은퇴 총 기간에서 적립기간을 뺀 '거치기간'을 표시 */
function SavPCard({ label, v, f, invYrs, holdYrs }: {
  label: string; v: string; f: (v: string) => void;
  invYrs: number; holdYrs: number;
}) {
  return (
    <div style={CARD}>
      <div style={CL}>{label}</div>
      <div style={{ position: 'relative' }}>
        <input type="text" inputMode="numeric" value={v} onChange={e => f(e.target.value)} style={IS} />
        <span style={US}>년</span>
      </div>
      {/* 거치기간은 항상 표시 — 계산 불가 시 이유를 명시 (조용히 숨기지 않음) */}
      {invYrs > 0 ? (
        <div style={{ marginTop: '4px', fontSize: '11px', fontWeight: 700, color: '#E0B44E' }}>
          거치기간 : {holdYrs}년
        </div>
      ) : (
        <div style={{ marginTop: '4px', fontSize: '11px', fontWeight: 700, color: '#F87171' }}>
          거치기간 : 계산 불가 (고객 생년월일·은퇴나이 확인)
        </div>
      )}
    </div>
  );
}

function IfC({ label, v, sub, g, hl }: {
  label: string; v: string; sub?: string; g?: boolean; hl?: boolean;
}) {
  return (
    <div style={g ? CARD_G : { ...CARD, backgroundColor: 'var(--bg-surface)' }}>
      <div style={CL}>{label}</div>
      <div style={{ ...CV, ...(hl ? { color: 'var(--success)' } : {}), fontSize: v.length > 12 ? '14px' : v.length > 8 ? '16px' : '18px' }}>{v}</div>
      {sub && <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '4px' }}>{sub}</div>}
    </div>
  );
}

function Tog({ label, c, f }: { label: string; c: boolean; f: () => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'rgba(255,255,255,0.85)', cursor: 'pointer' }}>
      <span>{label}</span>
      <button type="button" onClick={f} style={{ width: 36, height: 20, borderRadius: 10, border: 'none',
        backgroundColor: c ? '#10B981' : 'rgba(255,255,255,0.3)', cursor: 'pointer', position: 'relative', transition: 'background-color 0.2s' }}>
        <span style={{ position: 'absolute', top: 2, left: c ? 18 : 2, width: 16, height: 16, borderRadius: '50%',
          backgroundColor: 'var(--bg-card)', transition: 'left 0.2s', boxShadow: '0 1px 2px rgba(0,0,0,0.2)' }} />
      </button>
    </label>
  );
}

function LG({ color, label, dash }: { color: string; label: string; dash?: boolean }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
      <span style={{ width: 20, height: dash ? 0 : 3, borderTop: dash ? `2px dashed ${color}` : 'none', backgroundColor: dash ? 'transparent' : color, display: 'inline-block' }} />
      {label}
    </span>
  );
}

export default DesiredPlanTab;
