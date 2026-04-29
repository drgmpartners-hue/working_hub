'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { Modal } from '@/components/common/Modal';
import { useRetirementStore } from '../../hooks/useRetirementStore';
import { formatCurrency, formatInputCurrency, parseCurrency } from '../../utils/formatCurrency';
import { API_URL } from '@/lib/api-url';
import { authLib } from '@/lib/auth';

const AnnualFlowChart = dynamic(() => import('./AnnualFlowChart').then(m => m.AnnualFlowChart), { ssr: false });
const NetAssetChart = dynamic(() => import('./AnnualFlowChart').then(m => m.NetAssetChart), { ssr: false });
const LifetimeRetirementFlow = dynamic(() => import('./LifetimeRetirementFlow').then(m => m.LifetimeRetirementFlow), { ssr: false });

/* ------------------------------------------------------------------ */
/*  타입 정의                                                           */
/* ------------------------------------------------------------------ */

interface InvestmentRecord {
  id: number;
  profile_id: string;
  wrap_account_id: number | null;
  deposit_account_id: number | null;
  record_type: 'investment' | 'additional_savings' | 'withdrawal';
  product_name: string | null;
  investment_amount: number;
  evaluation_amount: number | null;
  return_rate: number | null;
  status: 'ing' | 'exit' | 'deposit';
  start_date: string;
  end_date: string | null;
  join_date?: string | null;
  expected_maturity_date?: string | null;
  actual_maturity_date?: string | null;
  original_maturity_date?: string | null;
  predecessor_id: number | null;
  successor_id: number | null;
  interim_evaluations: Record<string, number> | null;
  memo: string | null;
}

interface AnnualFlowRow {
  year: number;
  age: number | null;
  order_in_year: number | null;
  lump_sum: number;
  annual_savings: number;
  total_contribution: number;
  annual_return: number;
  annual_evaluation: number;
  annual_return_rate: number;
  deposit_in: number;
  cumulative_deposit_in: number;
  withdrawal: number;
  cumulative_withdrawal: number;
  total_evaluation: number;
}

interface WrapAccount {
  id: number;
  product_name: string;
  securities_company: string;
  is_active: boolean;
}

type StatusFilter = 'all' | 'ing' | 'exit' | 'deposit';

/* ---- 예수금 계좌 타입 ---- */
interface DepositAccount {
  id: number;
  customer_id: string;
  securities_company: string;
  account_number: string | null;
  nickname: string | null;
  current_balance: number;
  is_active: boolean;
  created_at: string;
}

type TransactionType = 'investment' | 'termination' | 'deposit' | 'withdrawal' | 'interest' | 'savings' | 'other';

interface DepositTransaction {
  id: number;
  account_id: number;
  transaction_date: string;
  transaction_type: TransactionType;
  related_product: string | null;
  investment_record_id: number | null;
  credit_amount: number;
  debit_amount: number;
  balance: number;
  memo: string | null;
}

const TRANSACTION_TYPE_LABELS: Record<TransactionType, string> = {
  investment: '투자',
  termination: '종료',
  deposit: '입금',
  withdrawal: '출금',
  interest: '이자',
  savings: '적립',
  other: '기타',
};

const TRANSACTION_TYPE_COLORS: Record<TransactionType, string> = {
  investment: '#3B82F6',
  termination: '#10B981',
  deposit: '#1E3A5F',
  withdrawal: '#EF4444',
  interest: '#D4A847',
  savings: '#8B5CF6',
  other: '#6B7280',
};

const STATUS_LABELS: Record<string, string> = {
  ing: '운용중',
  exit: '종결',
  deposit: '적립',
};

const STATUS_STYLES: Record<string, { bg: string; text: string; dot: string }> = {
  ing: { bg: '#EFF6FF', text: '#2563EB', dot: '#3B82F6' },
  exit: { bg: '#F0FDF4', text: '#16A34A', dot: '#22C55E' },
  deposit: { bg: '#FFFBEB', text: '#D97706', dot: '#F59E0B' },
};

const RECORD_TYPE_LABELS: Record<string, string> = {
  investment: '신규투자',
  additional_savings: '추가적립',
  withdrawal: '인출',
};

/* ------------------------------------------------------------------ */
/*  인라인 편집 스타일                                                   */
/* ------------------------------------------------------------------ */

const inlineInput: React.CSSProperties = {
  height: 30,
  fontSize: 12,
  border: '1.5px solid #3B82F6',
  borderRadius: 5,
  padding: '0 6px',
  outline: 'none',
  boxSizing: 'border-box',
  backgroundColor: '#fff',
  width: '100%',
};

const inlineSelect: React.CSSProperties = {
  height: 30,
  fontSize: 12,
  border: '1.5px solid #3B82F6',
  borderRadius: 5,
  padding: '0 4px',
  outline: 'none',
  boxSizing: 'border-box',
  backgroundColor: '#fff',
  width: '100%',
  cursor: 'pointer',
};

const inlineSaveBtn: React.CSSProperties = {
  padding: '3px 8px',
  fontSize: 11,
  fontWeight: 600,
  borderRadius: 4,
  border: 'none',
  backgroundColor: '#1E3A5F',
  color: '#fff',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const inlineCancelBtn: React.CSSProperties = {
  padding: '3px 8px',
  fontSize: 11,
  fontWeight: 500,
  borderRadius: 4,
  border: '1px solid #D1D5DB',
  backgroundColor: '#fff',
  color: '#6B7280',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

/* ------------------------------------------------------------------ */
/*  상태 변경 모달                                                       */
/* ------------------------------------------------------------------ */

interface StatusChangeModalProps {
  record: InvestmentRecord;
  onClose: () => void;
  onSave: (endDate: string, evalAmount: number) => Promise<void>;
}

function StatusChangeModal({ record, onClose, onSave }: StatusChangeModalProps) {
  const [endDate, setEndDate] = useState('');
  const [evalAmountStr, setEvalAmountStr] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const evalAmount = parseCurrency(evalAmountStr);
  const returnRate =
    record.investment_amount > 0
      ? (((evalAmount - record.investment_amount) / record.investment_amount) * 100).toFixed(2)
      : null;

  const handleSave = async () => {
    if (!endDate) { setError('종료일을 입력해주세요.'); return; }
    if (!evalAmountStr) { setError('평가금액을 입력해주세요.'); return; }
    setSaving(true);
    try {
      await onSave(endDate, evalAmount);
      onClose();
    } catch {
      setError('저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="종결 처리" maxWidth={440}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ padding: '12px 14px', backgroundColor: '#F9FAFB', borderRadius: 8, fontSize: 13, color: '#374151' }}>
          <div style={{ marginBottom: 8 }}><strong>{record.product_name || '(상품명)'}</strong> 를 종결 처리합니다.</div>
          <div style={{ display: 'flex', gap: 16, fontSize: 12, color: '#6B7280' }}>
            <span>투자금액: <strong style={{ color: '#111827' }}>{record.investment_amount?.toLocaleString() ?? '-'}원</strong></span>
            <span>가입일: <strong style={{ color: '#111827' }}>{record.start_date || record.join_date || '-'}</strong></span>
          </div>
        </div>

        <div>
          <label style={labelStyle}>종료일 <span style={{ color: '#EF4444' }}>*</span></label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            style={inputStyle}
          />
        </div>

        <div>
          <label style={labelStyle}>평가금액 (만원) <span style={{ color: '#EF4444' }}>*</span></label>
          <input
            type="text"
            inputMode="numeric"
            value={evalAmountStr}
            onChange={(e) => setEvalAmountStr(formatInputCurrency(e.target.value))}
            placeholder="0"
            style={{ ...inputStyle, textAlign: 'right' }}
          />
        </div>

        {evalAmountStr && returnRate !== null && (
          <div style={{
            padding: '8px 14px',
            backgroundColor: parseFloat(returnRate) >= 0 ? '#F0FDF4' : '#FFF1F2',
            borderRadius: 8,
            fontSize: 13,
            color: parseFloat(returnRate) >= 0 ? '#16A34A' : '#DC2626',
          }}>
            수익률: {returnRate}%
          </div>
        )}

        {error && <p style={{ color: '#DC2626', fontSize: 13, margin: 0 }}>{error}</p>}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={cancelBtnStyle}>취소</button>
          <button onClick={handleSave} disabled={saving} style={saveBtnStyle}>
            {saving ? '저장 중...' : '종결 처리'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/*  예수금 계좌 추가 모달                                               */
/* ------------------------------------------------------------------ */

interface AddDepositAccountModalProps {
  customerId: string;
  onClose: () => void;
  onSaved: () => void;
}

function AddDepositAccountModal({ customerId, onClose, onSaved }: AddDepositAccountModalProps) {
  const [securitiesCompany, setSecuritiesCompany] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [nickname, setNickname] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    if (!securitiesCompany.trim()) { setError('증권사를 입력해주세요.'); return; }
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}/api/v1/retirement/deposit-accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
        body: JSON.stringify({
          customer_id: customerId,
          securities_company: securitiesCompany.trim(),
          account_number: accountNumber.trim() || null,
          nickname: nickname.trim() || null,
        }),
      });
      if (!res.ok) throw new Error('저장 실패');
      onSaved();
      onClose();
    } catch {
      setError('저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="예수금 계좌 추가" maxWidth={440}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <label style={labelStyle}>증권사 <span style={{ color: '#EF4444' }}>*</span></label>
          <input
            type="text"
            value={securitiesCompany}
            onChange={(e) => setSecuritiesCompany(e.target.value)}
            placeholder="예: NH투자증권"
            style={inputStyle}
          />
        </div>
        <div>
          <label style={labelStyle}>계좌번호</label>
          <input
            type="text"
            value={accountNumber}
            onChange={(e) => setAccountNumber(e.target.value)}
            placeholder="예: 123-456-789"
            style={inputStyle}
          />
        </div>
        <div>
          <label style={labelStyle}>별명</label>
          <input
            type="text"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="예: 메인계좌"
            style={inputStyle}
          />
        </div>
        {error && <p style={{ color: '#DC2626', fontSize: 13, margin: 0 }}>{error}</p>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={cancelBtnStyle}>취소</button>
          <button onClick={handleSave} disabled={saving} style={saveBtnStyle}>
            {saving ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/*  메인 컴포넌트                                                        */
/* ------------------------------------------------------------------ */

export function InvestmentFlowTab() {
  const { selectedCustomerId, selectedCustomer } = useRetirementStore();

  // 연간 투자흐름표 상태
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [annualFlowData, setAnnualFlowData] = useState<AnnualFlowRow[]>([]);
  const [annualFlowLoading, setAnnualFlowLoading] = useState(false);
  const [showFlowChart, setShowFlowChart] = useState(false);
  const [chartVisibility, setChartVisibility] = useState({ contribution: true, annualReturn: true, depositIn: true, returnRate: true });
  const [showNetAssetChart, setShowNetAssetChart] = useState(false);
  const [netAssetVisibility, setNetAssetVisibility] = useState({ netAsset: true, cumulativeDeposit: true, cumulativeProfit: true, netAssetReturnRate: true });
  const [showLifetimeFlow, setShowLifetimeFlow] = useState(false);
  const [lifetimeRowsForPdf, setLifetimeRowsForPdf] = useState<any[]>([]);
  const lifetimeRowsRef = useRef<any[]>([]);
  const [isPrinting, setIsPrinting] = useState(false);
  const [desiredPlanData, setDesiredPlanData] = useState<any>(null);
  const [appliedYears, setAppliedYears] = useState<Record<number, any>>({});
  const [flowAccountFilter, setFlowAccountFilter] = useState<'all' | number>('all');
  const [evalDetailYear, setEvalDetailYear] = useState<number | null>(null);

  // 투자기록 상태
  const [records, setRecords] = useState<InvestmentRecord[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [accountFilter, setAccountFilter] = useState<number | 'all'>('all');

  // 연결상품 하이라이트
  const [highlightedId, setHighlightedId] = useState<number | null>(null);
  const rowRefs = useRef<Map<number, HTMLTableRowElement>>(new Map());

  // 상태 변경 모달
  const [statusChangeRecord, setStatusChangeRecord] = useState<InvestmentRecord | null>(null);

  // 중간평가 모달
  const [interimRecord, setInterimRecord] = useState<InvestmentRecord | null>(null);
  const [interimYear, setInterimYear] = useState('');
  const [interimAmount, setInterimAmount] = useState('');
  const [interimSaving, setInterimSaving] = useState(false);

  const saveInterimEval = async () => {
    if (!interimRecord || !interimYear || !interimAmount) return;
    setInterimSaving(true);
    try {
      const existing = interimRecord.interim_evaluations || {};
      const updated = { ...existing, [interimYear]: parseInt(interimAmount.replace(/\D/g, ''), 10) || 0 };
      const res = await fetch(`${API_URL}/api/v1/retirement/investment-records/${interimRecord.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
        body: JSON.stringify({ interim_evaluations: updated }),
      });
      if (!res.ok) throw new Error();
      setInterimRecord(null);
      setInterimYear('');
      setInterimAmount('');
      fetchRecords();
      fetchAnnualFlow();
    } catch { alert('저장 실패'); }
    finally { setInterimSaving(false); }
  };

  const deleteInterimEval = async (record: InvestmentRecord, year: string) => {
    const existing = record.interim_evaluations || {};
    const updated = { ...existing };
    delete updated[year];
    try {
      await fetch(`${API_URL}/api/v1/retirement/investment-records/${record.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
        body: JSON.stringify({ interim_evaluations: Object.keys(updated).length > 0 ? updated : null }),
      });
      fetchRecords();
      fetchAnnualFlow();
    } catch { alert('삭제 실패'); }
  };

  // Wrap 계좌 목록
  const [wrapAccounts, setWrapAccounts] = useState<WrapAccount[]>([]);

  // 예수금 계좌 상태
  const [depositAccounts, setDepositAccounts] = useState<DepositAccount[]>([]);
  const [depositAccountsLoading, setDepositAccountsLoading] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [expandedAccountIds, setExpandedAccountIds] = useState<Set<number>>(new Set());
  const [accountTransactions, setAccountTransactions] = useState<Record<number, DepositTransaction[]>>({});
  const [transactionsLoading, setTransactionsLoading] = useState<Record<number, boolean>>({});
  const [showAddDepositAccountModal, setShowAddDepositAccountModal] = useState(false);
  const [editingAccount, setEditingAccount] = useState<DepositAccount | null>(null);
  const [showAddProductModal, setShowAddProductModal] = useState(false);

  /* ---- 예수금 거래 인라인 편집 상태 ---- */
  const [newTxAccountId, setNewTxAccountId] = useState<number | null>(null);
  const [editingTxId, setEditingTxId] = useState<number | null>(null);
  const [txEditDate, setTxEditDate] = useState('');
  const [txEditType, setTxEditType] = useState<TransactionType>('deposit');
  const [txEditCredit, setTxEditCredit] = useState('');
  const [txEditDebit, setTxEditDebit] = useState('');
  const [txEditMemo, setTxEditMemo] = useState('');
  const [txEditProduct, setTxEditProduct] = useState('');
  const [txSaving, setTxSaving] = useState(false);

  /* ---- 투자기록 인라인 편집 상태 ---- */
  const [addingRecord, setAddingRecord] = useState(false);
  const [editingRecordId, setEditingRecordId] = useState<number | null>(null);
  const [recEditProduct, setRecEditProduct] = useState<number | ''>('');
  const [recEditAccount, setRecEditAccount] = useState<number | ''>('');
  const [recEditAmount, setRecEditAmount] = useState('');
  const [recEditEval, setRecEditEval] = useState('');
  const [recEditJoinDate, setRecEditJoinDate] = useState('');
  const [recEditExpMaturity, setRecEditExpMaturity] = useState('');
  const [recEditActMaturity, setRecEditActMaturity] = useState('');
  const [recEditOrigMaturity, setRecEditOrigMaturity] = useState('');
  const [recEditMemo, setRecEditMemo] = useState('');
  const [recSaving, setRecSaving] = useState(false);

  /* ---- 연도 목록 ---- */
  // 예수금 계좌 거래 기록에 있는 연도만 추출 + 현재 연도 포함
  const years = useMemo(() => {
    const yearSet = new Set<number>([currentYear]);
    for (const txs of Object.values(accountTransactions)) {
      for (const tx of txs) {
        if (tx.transaction_date) {
          const y = parseInt(tx.transaction_date.substring(0, 4), 10);
          if (!isNaN(y)) yearSet.add(y);
        }
      }
    }
    return Array.from(yearSet).sort((a, b) => a - b);
  }, [accountTransactions, currentYear]);

  // 거래 로드 후 가장 빠른 연도로 자동 선택
  useEffect(() => {
    if (years.length > 0 && !years.includes(selectedYear)) {
      setSelectedYear(years[0]);
    } else if (years.length > 1 && selectedYear === currentYear && years[0] < currentYear) {
      setSelectedYear(years[0]);
    }
  }, [years, selectedYear, currentYear]);

  /* ---- API: 연간 투자흐름 (선택 연도 ~ 현재 연도) ---- */
  const fetchAnnualFlow = useCallback(async () => {
    if (!selectedCustomerId) return;
    setAnnualFlowLoading(true);
    try {
      const years: number[] = [];
      for (let y = selectedYear; y <= currentYear; y++) years.push(y);

      const results = await Promise.all(
        years.map(async (year) => {
          try {
            const res = await fetch(
              `${API_URL}/api/v1/retirement/investment-records/annual-flow/${selectedCustomerId}/${year}${flowAccountFilter !== 'all' ? `?deposit_account_id=${flowAccountFilter}` : ''}`,
              { headers: authLib.getAuthHeader() }
            );
            if (!res.ok) return null;
            const data = await res.json();
            return {
              year,
              age: data.age ?? null,
              order_in_year: data.order_in_year ?? null,
              lump_sum: data.lump_sum_amount ?? 0,
              annual_savings: data.annual_savings_amount ?? 0,
              total_contribution: data.total_payment ?? 0,
              annual_return: data.annual_total_profit ?? 0,
              annual_evaluation: data.annual_evaluation_amount ?? 0,
              annual_return_rate: data.annual_return_rate ?? 0,
              deposit_in: data.deposit_in_amount ?? 0,
              cumulative_deposit_in: 0, // 아래에서 누적 계산
              withdrawal: data.withdrawal_amount ?? 0,
              cumulative_withdrawal: 0, // 아래에서 누적 계산
              total_evaluation: data.net_asset ?? data.annual_evaluation_amount ?? 0,
            } as AnnualFlowRow;
          } catch {
            return null;
          }
        })
      );

      const rows = results
        .filter((r): r is AnnualFlowRow => r !== null)
        .sort((a, b) => a.year - b.year);

      // 누적값 계산
      let cumDeposit = 0;
      let cumWithdrawal = 0;
      for (const row of rows) {
        cumDeposit += row.deposit_in;
        cumWithdrawal += row.withdrawal;
        row.cumulative_deposit_in = cumDeposit;
        row.cumulative_withdrawal = cumWithdrawal;
      }

      setAnnualFlowData(rows);
    } catch {
      setAnnualFlowData([]);
    } finally {
      setAnnualFlowLoading(false);
    }
  }, [selectedCustomerId, selectedYear, currentYear, flowAccountFilter]);

  /* ---- API: 투자기록 목록 ---- */
  const fetchRecords = useCallback(async () => {
    if (!selectedCustomerId) return;
    setRecordsLoading(true);
    try {
      const params = new URLSearchParams({ customer_id: selectedCustomerId });
      if (statusFilter !== 'all') params.set('status', statusFilter);
      const res = await fetch(
        `${API_URL}/api/v1/retirement/investment-records?${params}`,
        { headers: authLib.getAuthHeader() }
      );
      if (!res.ok) { setRecords([]); return; }
      const data = await res.json();
      setRecords(Array.isArray(data) ? data : []);
    } catch {
      setRecords([]);
    } finally {
      setRecordsLoading(false);
    }
  }, [selectedCustomerId, statusFilter]);

  /* ---- API: Wrap 계좌 목록 ---- */
  const fetchWrapAccounts = useCallback(async () => {
    try {
      const res = await fetch(
        `${API_URL}/api/v1/retirement/wrap-accounts?is_active=true`,
        { headers: authLib.getAuthHeader() }
      );
      if (!res.ok) return;
      const data = await res.json();
      setWrapAccounts(Array.isArray(data) ? data : []);
    } catch {
      // ignore
    }
  }, []);

  /* ---- API: 예수금 계좌 목록 ---- */
  const fetchDepositAccounts = useCallback(async () => {
    if (!selectedCustomerId) return;
    setDepositAccountsLoading(true);
    try {
      const url = showHidden
        ? `${API_URL}/api/v1/retirement/deposit-accounts?customer_id=${selectedCustomerId}&include_hidden=true`
        : `${API_URL}/api/v1/retirement/deposit-accounts?customer_id=${selectedCustomerId}`;
      const res = await fetch(url, { headers: authLib.getAuthHeader() });
      if (!res.ok) { setDepositAccounts([]); return; }
      const data = await res.json();
      setDepositAccounts(Array.isArray(data) ? data : []);
    } catch {
      setDepositAccounts([]);
    } finally {
      setDepositAccountsLoading(false);
    }
  }, [selectedCustomerId, showHidden]);

  /* ---- API: 예수금 거래내역 ---- */
  const fetchTransactions = useCallback(async (accountId: number) => {
    setTransactionsLoading((prev) => ({ ...prev, [accountId]: true }));
    try {
      const res = await fetch(
        `${API_URL}/api/v1/retirement/deposit-accounts/${accountId}/transactions`,
        { headers: authLib.getAuthHeader() }
      );
      if (!res.ok) { setAccountTransactions((prev) => ({ ...prev, [accountId]: [] })); return; }
      const data = await res.json();
      setAccountTransactions((prev) => ({ ...prev, [accountId]: Array.isArray(data) ? data : [] }));
    } catch {
      setAccountTransactions((prev) => ({ ...prev, [accountId]: [] }));
    } finally {
      setTransactionsLoading((prev) => ({ ...prev, [accountId]: false }));
    }
  }, []);

  /* ---- 예수금 계좌 아코디언 토글 ---- */
  const toggleAccountExpand = (accountId: number) => {
    setExpandedAccountIds((prev) => {
      const next = new Set(prev);
      if (next.has(accountId)) {
        next.delete(accountId);
      } else {
        next.add(accountId);
        if (!accountTransactions[accountId]) {
          fetchTransactions(accountId);
        }
      }
      return next;
    });
  };

  useEffect(() => { fetchAnnualFlow(); }, [fetchAnnualFlow]);
  useEffect(() => { fetchRecords(); }, [fetchRecords]);
  useEffect(() => { fetchWrapAccounts(); }, [fetchWrapAccounts]);
  useEffect(() => { fetchDepositAccounts(); }, [fetchDepositAccounts]);

  // 1번탭 데이터 로드 (100세 은퇴플로우용) + applied_years 복원
  useEffect(() => {
    if (!selectedCustomerId) return;
    const load = async () => {
      try {
        const token = authLib.getToken();
        const res = await fetch(`${API_URL}/api/v1/retirement/desired-plans/${selectedCustomerId}`, { headers: { Authorization: `Bearer ${token}` } });
        if (res.ok) {
          const data = await res.json();
          setDesiredPlanData(data);
          // applied_years 복원 (calculation_params에 저장됨)
          const saved = data?.calculation_params?.applied_years;
          if (saved && typeof saved === 'object') {
            // 키를 number로 변환
            const restored: Record<number, any> = {};
            for (const [k, v] of Object.entries(saved)) {
              restored[Number(k)] = v;
            }
            setAppliedYears(restored);
          }
        }
      } catch { /* ignore */ }
    };
    load();
  }, [selectedCustomerId]);

  // applied_years 자동 저장 (적용/취소 시)
  const saveAppliedYears = useCallback(async (newApplied: Record<number, any>) => {
    if (!selectedCustomerId) return;
    try {
      const token = authLib.getToken();
      // 기존 calculation_params 가져와서 applied_years만 업데이트
      const params = desiredPlanData?.calculation_params || {};
      const updated = { ...params, applied_years: newApplied };
      await fetch(`${API_URL}/api/v1/retirement/desired-plans/${selectedCustomerId}/params`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ calculation_params: updated }),
      });
    } catch { /* ignore */ }
  }, [selectedCustomerId, desiredPlanData]);

  /* ---- 연결상품 클릭 → 스크롤 + 하이라이트 ---- */
  const handleLinkClick = (targetId: number) => {
    setHighlightedId(targetId);
    const row = rowRefs.current.get(targetId);
    if (row) {
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    setTimeout(() => setHighlightedId(null), 2000);
  };

  /* ---- 상태 변경 저장 ---- */
  const handleStatusChangeSave = async (endDate: string, evalAmount: number) => {
    if (!statusChangeRecord) return;

    const res = await fetch(
      `${API_URL}/api/v1/retirement/investment-records/${statusChangeRecord.id}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...authLib.getAuthHeader(),
        },
        body: JSON.stringify({
          actual_maturity_date: endDate,
          evaluation_amount: evalAmount,
        }),
      }
    );
    if (!res.ok) throw new Error('업데이트 실패');
    await fetchRecords();
    fetchDepositAccounts();
    expandedAccountIds.forEach(id => fetchTransactions(id));
  };

  /* ---- 예수금 거래 인라인: 거래 추가 시작 ---- */
  const startNewTx = (accountId: number) => {
    setNewTxAccountId(accountId);
    setEditingTxId(null);
    setTxEditDate('');
    setTxEditType('deposit');
    setTxEditCredit('');
    setTxEditDebit('');
    setTxEditMemo('');
    setTimeout(() => { txScrollRefs.current[accountId]?.scrollTo({ top: 0, behavior: 'smooth' }); }, 50);
    setTxEditProduct('');
  };

  /* ---- 예수금 거래 인라인: 수정 시작 ---- */
  const startEditTx = (tx: DepositTransaction) => {
    setEditingTxId(tx.id);
    setNewTxAccountId(null);
    setTxEditDate(tx.transaction_date);
    setTxEditType(tx.transaction_type);
    setTxEditCredit(tx.credit_amount > 0 ? tx.credit_amount.toLocaleString() : '');
    setTxEditDebit(tx.debit_amount > 0 ? tx.debit_amount.toLocaleString() : '');
    setTxEditMemo(tx.memo || '');
    setTxEditProduct(tx.related_product || '');
  };

  /* ---- 예수금 거래 인라인: 취소 ---- */
  const cancelTxEdit = () => {
    setNewTxAccountId(null);
    setEditingTxId(null);
  };

  /* ---- 예수금 거래 인라인: 저장 (신규) ---- */
  const saveTxNew = async (accountId: number) => {
    if (!txEditDate) return;
    setTxSaving(true);
    try {
      const res = await fetch(
        `${API_URL}/api/v1/retirement/deposit-accounts/${accountId}/transactions`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
          body: JSON.stringify({
            transaction_date: txEditDate,
            transaction_type: txEditType,
            related_product: txEditProduct.trim() || null,
            credit_amount: txEditCredit ? parseInt(txEditCredit.replace(/\D/g, ''), 10) : 0,
            debit_amount: txEditDebit ? parseInt(txEditDebit.replace(/\D/g, ''), 10) : 0,
            memo: txEditMemo.trim() || null,
          }),
        }
      );
      if (!res.ok) throw new Error();
      cancelTxEdit();
      fetchTransactions(accountId);
      fetchDepositAccounts();
    } catch {
      // silent
    } finally {
      setTxSaving(false);
    }
  };

  /* ---- 예수금 거래 인라인: 저장 (수정) ---- */
  const saveTxEdit = async (txId: number, accountId: number) => {
    if (!txEditDate) return;
    setTxSaving(true);
    try {
      const res = await fetch(
        `${API_URL}/api/v1/retirement/deposit-transactions/${txId}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
          body: JSON.stringify({
            transaction_date: txEditDate,
            transaction_type: txEditType,
            related_product: txEditProduct.trim() || null,
            credit_amount: txEditCredit ? parseInt(txEditCredit.replace(/\D/g, ''), 10) : 0,
            debit_amount: txEditDebit ? parseInt(txEditDebit.replace(/\D/g, ''), 10) : 0,
            memo: txEditMemo.trim() || null,
          }),
        }
      );
      if (!res.ok) throw new Error();
      cancelTxEdit();
      fetchTransactions(accountId);
      fetchDepositAccounts();
    } catch {
      // silent
    } finally {
      setTxSaving(false);
    }
  };

  /* ---- 투자기록 인라인: 추가 시작 ---- */
  const startNewRecord = () => {
    setAddingRecord(true);
    setEditingRecordId(null);
    setRecEditProduct('');
    setRecEditAccount('');
    setRecEditAmount('');
    setRecEditEval('');
    setRecEditJoinDate('');
    setTimeout(() => { recScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' }); }, 50);
    setRecEditExpMaturity('');
    setRecEditActMaturity('');
    setRecEditOrigMaturity('');
    setRecEditMemo('');
  };

  /* ---- 투자기록 인라인: 수정 시작 ---- */
  const startEditRecord = (record: InvestmentRecord) => {
    setEditingRecordId(record.id);
    setAddingRecord(false);
    setRecEditProduct(record.wrap_account_id ?? '');
    setRecEditAccount(record.deposit_account_id ?? '');
    setRecEditAmount(record.investment_amount > 0 ? record.investment_amount.toLocaleString() : '');
    setRecEditEval(record.evaluation_amount != null ? record.evaluation_amount.toLocaleString() : '');
    setRecEditJoinDate(record.join_date || record.start_date || '');
    setRecEditExpMaturity(record.expected_maturity_date || '');
    setRecEditActMaturity(record.actual_maturity_date || '');
    setRecEditOrigMaturity(record.original_maturity_date || '');
    setRecEditMemo(record.memo || '');
  };

  /* ---- 투자기록 인라인: 취소 ---- */
  const cancelRecordEdit = () => {
    setAddingRecord(false);
    setEditingRecordId(null);
  };

  /* ---- 투자기록 인라인: 저장 (신규) ---- */
  const saveRecordNew = async () => {
    if (!recEditJoinDate || !recEditAmount) return;
    setRecSaving(true);
    try {
      const body: Record<string, unknown> = {
        profile_id: selectedCustomerId,
        record_type: 'investment',
        wrap_account_id: recEditProduct || null,
        deposit_account_id: recEditAccount || null,
        investment_amount: parseInt(recEditAmount.replace(/\D/g, ''), 10) || 0,
        status: 'ing',
        start_date: recEditJoinDate,
        join_date: recEditJoinDate,
        expected_maturity_date: recEditExpMaturity || null,
        memo: recEditMemo.trim() || null,
      };
      const res = await fetch(`${API_URL}/api/v1/retirement/investment-records`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
      cancelRecordEdit();
      fetchRecords();
      fetchAnnualFlow();
      fetchDepositAccounts();
      expandedAccountIds.forEach(id => fetchTransactions(id));
    } catch {
      // silent
    } finally {
      setRecSaving(false);
    }
  };

  /* ---- 투자기록 인라인: 저장 (수정) ---- */
  const saveRecordEdit = async (recordId: number) => {
    setRecSaving(true);
    try {
      const body: Record<string, unknown> = {
        wrap_account_id: recEditProduct || null,
        deposit_account_id: recEditAccount || null,
        investment_amount: parseInt(recEditAmount.replace(/\D/g, ''), 10) || 0,
        start_date: recEditJoinDate,
        join_date: recEditJoinDate || null,
        expected_maturity_date: recEditExpMaturity || null,
        actual_maturity_date: recEditActMaturity || null,
        original_maturity_date: recEditOrigMaturity || null,
        memo: recEditMemo.trim() || null,
      };
      if (recEditEval) body.evaluation_amount = parseInt(recEditEval.replace(/\D/g, ''), 10);
      else body.evaluation_amount = null;
      const res = await fetch(`${API_URL}/api/v1/retirement/investment-records/${recordId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
      cancelRecordEdit();
      fetchRecords();
      fetchAnnualFlow();
      fetchDepositAccounts();
      expandedAccountIds.forEach(id => fetchTransactions(id));
    } catch {
      // silent
    } finally {
      setRecSaving(false);
    }
  };

  /* ---- 스크롤 ref ---- */
  const txScrollRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const recScrollRef = useRef<HTMLDivElement | null>(null);

  /* ---- 예수금 거래 년도 필터 ---- */
  const [txYearFilter, setTxYearFilter] = useState<string>('all');

  /* ---- 예수금 거래 정렬 (localStorage 영속화) ---- */
  const [txSortKey, setTxSortKey] = useState<string>(() => {
    if (typeof window !== 'undefined') return localStorage.getItem('tx_sort_key') || 'id';
    return 'id';
  });
  const [txSortDir, setTxSortDir] = useState<'asc' | 'desc'>(() => {
    if (typeof window !== 'undefined') return (localStorage.getItem('tx_sort_dir') as 'asc' | 'desc') || 'asc';
    return 'asc';
  });
  useEffect(() => { localStorage.setItem('tx_sort_key', txSortKey); }, [txSortKey]);
  useEffect(() => { localStorage.setItem('tx_sort_dir', txSortDir); }, [txSortDir]);
  const toggleTxSort = (key: string) => {
    if (txSortKey === key) setTxSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setTxSortKey(key); setTxSortDir('asc'); }
  };
  const sortTransactions = (txns: DepositTransaction[]) => {
    return [...txns].sort((a, b) => {
      let va: string | number | null = null, vb: string | number | null = null;
      switch (txSortKey) {
        case 'id': va = a.id; vb = b.id; break;
        case 'transaction_date': va = a.transaction_date; vb = b.transaction_date; break;
        case 'transaction_type': va = a.transaction_type; vb = b.transaction_type; break;
        case 'related_product': va = a.related_product || ''; vb = b.related_product || ''; break;
        case 'credit_amount': va = a.credit_amount; vb = b.credit_amount; break;
        case 'debit_amount': va = a.debit_amount; vb = b.debit_amount; break;
        case 'balance': va = a.balance; vb = b.balance; break;
        default: return 0;
      }
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb));
      return txSortDir === 'asc' ? cmp : -cmp;
    });
  };

  /* ---- 상품명 조회 (wrapAccounts에서 매칭) ---- */
  const getProductName = (record: InvestmentRecord): string => {
    if (record.product_name) return record.product_name;
    if (record.wrap_account_id) {
      const account = wrapAccounts.find((a) => a.id === record.wrap_account_id);
      if (account) return account.product_name;
    }
    return '-';
  };

  /* ---- 투자기록 정렬 (localStorage 영속화) ---- */
  const [recSortKey, setRecSortKey] = useState<string>(() => {
    if (typeof window !== 'undefined') return localStorage.getItem('rec_sort_key') || 'id';
    return 'id';
  });
  const [recSortDir, setRecSortDir] = useState<'asc' | 'desc'>(() => {
    if (typeof window !== 'undefined') return (localStorage.getItem('rec_sort_dir') as 'asc' | 'desc') || 'asc';
    return 'asc';
  });
  useEffect(() => { localStorage.setItem('rec_sort_key', recSortKey); }, [recSortKey]);
  useEffect(() => { localStorage.setItem('rec_sort_dir', recSortDir); }, [recSortDir]);
  const toggleRecSort = (key: string) => {
    if (recSortKey === key) setRecSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setRecSortKey(key); setRecSortDir('asc'); }
  };

  /* ---- 필터링된 기록 ---- */
  const filteredRecords = (() => {
    const base = accountFilter === 'all' ? records : records.filter((r) => r.deposit_account_id === accountFilter);
    return [...base].sort((a, b) => {
      let va: string | number | null = null, vb: string | number | null = null;
      switch (recSortKey) {
        case 'id': va = a.id; vb = b.id; break;
        case 'product_name': va = getProductName(a); vb = getProductName(b); break;
        case 'investment_amount': va = a.investment_amount; vb = b.investment_amount; break;
        case 'evaluation_amount': va = a.evaluation_amount ?? 0; vb = b.evaluation_amount ?? 0; break;
        case 'return_rate': va = a.return_rate ?? -9999; vb = b.return_rate ?? -9999; break;
        case 'status': va = a.status; vb = b.status; break;
        case 'join_date': va = a.join_date || a.start_date || ''; vb = b.join_date || b.start_date || ''; break;
        case 'expected_maturity_date': va = a.expected_maturity_date ?? ''; vb = b.expected_maturity_date ?? ''; break;
        case 'actual_maturity_date': va = a.actual_maturity_date ?? ''; vb = b.actual_maturity_date ?? ''; break;
        default: return 0;
      }
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb));
      return recSortDir === 'asc' ? cmp : -cmp;
    });
  })();

  /* ---- 고객 미선택 ---- */
  if (!selectedCustomerId) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 320,
        color: '#9CA3AF',
        fontSize: 14,
      }}>
        고객을 먼저 선택해주세요.
      </div>
    );
  }

  const handlePrint = async () => {
    setIsPrinting(true);

    // 그래프 펼치기
    setShowFlowChart(true);
    setShowNetAssetChart(true);
    setShowLifetimeFlow(true);

    // 예수금 거래내역 로드
    const allAccIds = new Set(depositAccounts.map(a => a.id));
    setExpandedAccountIds(allAccIds);
    for (const a of depositAccounts) {
      if (!accountTransactions[a.id]) await fetchTransactions(a.id);
    }

    // 차트 렌더링 대기
    await new Promise(r => setTimeout(r, 1500));
    window.dispatchEvent(new Event('resize'));
    await new Promise(r => setTimeout(r, 500));

    try {
      const { generateInvestmentFlowPdf } = await import('../../utils/investmentFlowPdf');
      type PdfDataType = import('../../utils/investmentFlowPdf').PdfData;
      type DepositTxType = import('../../utils/investmentFlowPdf').DepositTx;
      type InvestRecordType = import('../../utils/investmentFlowPdf').InvestRecord;

      // 예수금 거래 데이터 조립 (발생일 기준 정렬)
      const allTxs: DepositTxType[] = [];
      const firstAcc = depositAccounts[0];
      const txList = firstAcc ? [...(accountTransactions[firstAcc.id] || [])].sort((a: any, b: any) =>
        (a.transaction_date || '').localeCompare(b.transaction_date || '')
      ) : [];
      txList.forEach((tx: any, idx: number) => {
        allTxs.push({
          no: tx.original_no ?? (idx + 1),
          date: tx.transaction_date || '-',
          type: tx.transaction_type || '-',
          product: tx.related_product || '-',
          credit: tx.credit_amount || 0,
          debit: tx.debit_amount || 0,
          balance: tx.balance || 0,
          memo: tx.memo || '',
        });
      });

      // 투자기록 데이터 조립
      const investRecs: InvestRecordType[] = records
        .filter((r: any) => r.record_type === 'investment')
        .sort((a: any, b: any) => (a.start_date || a.join_date || '').localeCompare(b.start_date || b.join_date || ''))
        .map((r: any, idx: number) => {
          // 상품명: getProductName 함수 사용 (wrapAccounts 조회 포함)
          let prodName = getProductName(r);
          // 계좌명: deposit_account_nickname → depositAccounts 조회
          let accName = r.deposit_account_nickname || '';
          if (!accName && r.deposit_account_id && depositAccounts) {
            const acc = depositAccounts.find((a: any) => a.id === r.deposit_account_id);
            if (acc) accName = acc.nickname || `${acc.securities_company} ${acc.account_number || ''}`;
          }
          return {
          no: idx + 1,
          product: prodName || '-',
          account: accName || '-',
          investment: r.investment_amount || 0,
          evaluation: r.evaluation_amount || 0,
          returnRate: r.investment_amount > 0 ? `${((r.evaluation_amount - r.investment_amount) / r.investment_amount * 100).toFixed(2)}%` : '-',
          status: r.status === 'exit' ? '종결' : '운용중',
          startDate: r.start_date || r.join_date || '-',
          expectedEnd: r.expected_maturity_date || '',
          actualEnd: r.actual_maturity_date || '',
          memo: r.memo || '',
        };});

      // 100세 플로우 기본정보 (화면 BasicInfoCard 동일 로직)
      const cp = desiredPlanData?.calculation_params as any || {};
      const lifetimeInfo: { [k: string]: string } = {};
      if (desiredPlanData) {
        const d = desiredPlanData;
        const savYrs = d.savings_period_years ?? 0;
        const holdYrs = d.holding_period_years ?? 0;
        const planStartYear = d.plan_start_year ?? new Date().getFullYear();
        const curYear = new Date().getFullYear();
        const curAge = selectedCustomer?.birthDate ? (curYear - new Date(selectedCustomer.birthDate).getFullYear()) : 0;
        const planStartAge = curAge - (curYear - planStartYear);
        const retAge = d.desired_retirement_age ?? 60;
        const retYear = planStartAge > 0 ? planStartYear + (retAge - planStartAge) : planStartYear + savYrs + holdYrs;
        const simData = d.simulation_data || [];

        // 테이블에서 실제 적립/거치 집계
        let totalSavings = 0, totalHolding = 0, savingsCount = 0;
        for (const row of simData) {
          const mp = (row.monthly_payment as number) ?? 0;
          const ad = (row.additional as number) ?? 0;
          if (mp > 0) { totalSavings += mp * 12; savingsCount++; }
          if (ad > 0) totalHolding += ad;
        }
        const avgAnnualSavings = savingsCount > 0 ? totalSavings / savingsCount : 0;
        const totalInvestment = totalSavings + totalHolding;
        const retireRow = simData.find((r: any) => (r.age as number) === retAge - 1);
        const age100Row = simData.find((r: any) => (r.age as number) === 100);
        const retireFund = (retireRow?.evaluation as number) ?? 0;
        const inheritFund = (age100Row?.evaluation as number) ?? 0;

        const invRate = ((cp.recommended_return_rate ?? cp.existing_return_rate ?? d.expected_return_rate ?? 0) * 100).toFixed(1);
        const penRate = ((cp.recommended_pension_rate ?? cp.base_pension_rate ?? d.retirement_pension_rate ?? 0) * 100).toFixed(1);
        const futureMonthly = d.future_monthly_amount ?? 0;
        const useInflInput = !!d.use_inflation_input;
        const useInflCalc = !!d.use_inflation_calc;
        const fmtOk2 = (v: number) => v >= 1e8 ? `${(v / 1e8).toFixed(1)}억원` : v >= 1e4 ? `${Math.round(v / 1e4).toLocaleString()}만원` : `${v.toLocaleString()}원`;

        // 기간 설정
        lifetimeInfo['플랜 시작'] = planStartAge > 0 ? `${planStartYear}년 (${planStartAge}세)` : `${planStartYear}년`;
        lifetimeInfo['희망 은퇴'] = `${retYear}년 (${retAge}세)`;
        lifetimeInfo['총 투자기간'] = `${savYrs + holdYrs}년`;
        lifetimeInfo['구성'] = `적립 ${savYrs}년 + 거치 ${holdYrs}년`;
        // 투자 계획
        lifetimeInfo['연적립금액(평균)'] = avgAnnualSavings > 0 ? fmtOk2(avgAnnualSavings) : '-';
        lifetimeInfo['총거치금액'] = totalHolding > 0 ? fmtOk2(totalHolding) : '-';
        lifetimeInfo['총투자금액'] = totalInvestment > 0 ? fmtOk2(totalInvestment) : '-';
        // 목표
        lifetimeInfo['예상 투자수익률'] = `${invRate}%`;
        lifetimeInfo['예상 연금수익률'] = `${penRate}%`;
        lifetimeInfo['은퇴당시 연금액'] = futureMonthly > 0 ? `${Math.round(futureMonthly / 1e4).toLocaleString()}만원/월 (물가${useInflInput ? 'O' : 'X'})` : '-';
        lifetimeInfo['은퇴자금'] = retireFund > 0 ? `${fmtOk2(retireFund)} (물가${useInflCalc ? 'O' : 'X'})` : '-';
        lifetimeInfo['상속자금'] = inheritFund > 0 ? `${fmtOk2(inheritFund)} (100세)` : '0원';
      }

      const targetFundStr = selectedCustomer?.targetFund
        ? (selectedCustomer.targetFund >= 1e8
          ? `${(selectedCustomer.targetFund / 1e8).toFixed(1)}억원`
          : `${selectedCustomer.targetFund.toLocaleString()}만원`)
        : '-';

      const pdfData: PdfDataType = {
        customer: {
          name: selectedCustomer?.name ?? '',
          birthDate: selectedCustomer?.birthDate ?? '',
          targetFund: targetFundStr,
          retireAge: String(selectedCustomer?.retirementAge ?? '-'),
        },
        flowRows: annualFlowData,
        planStartYear: desiredPlanData?.plan_start_year ?? new Date().getFullYear(),
        retirementAge: desiredPlanData?.desired_retirement_age ?? 65,
        lifetimeRows: lifetimeRowsRef.current.map((r: any) => ({
          year: r.year,
          calendarYear: r.calendarYear,
          age: r.age,
          phase: r.phase ?? '-',
          cumulativePrincipal: r.cumulativePrincipal ?? 0,
          evaluation: r.totalEvaluation ?? 0,
          annualSavings: r.annualSavings ?? 0,
          lumpSum: r.lumpSum ?? 0,
          expectedRate: r.returnRate ?? 0,
          adjustedEval: r.adjustedEvaluation ?? 0,
          depositIn: r.depositIn ?? 0,
          pensionWithdraw: r.pension ?? 0,
          cumulativeWithdraw: r.cumulativePension ?? 0,
          netAsset: r.adjustedNetAsset ?? 0,
          netAssetReturn: r.netAssetReturnRate ?? 0,
        })),
        lifetimeInfo,
        depositTxs: allTxs,
        depositAccountInfo: firstAcc ? `${firstAcc.securities_company} ${firstAcc.account_number || ''} "${firstAcc.nickname || ''}" 잔액: ${allTxs.length > 0 ? allTxs[allTxs.length - 1].balance.toLocaleString('ko-KR') : '-'}원` : '',
        investRecords: investRecs,
        chartIds: ['print-chart-flow', 'print-chart-netasset', 'print-chart-lifetime'],
      };

      await generateInvestmentFlowPdf(pdfData, `투자흐름_${selectedCustomer?.name ?? '보고서'}_${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (e: any) {
      console.error('PDF 생성 실패:', e);
      alert(`PDF 생성 실패: ${e?.message || e}`);
    }
    setIsPrinting(false);
  };

  return (
    <div className="investment-flow-container" style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      {/* 프린트 스타일 */}
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 12mm 10mm; }

          nav, header, .no-print, [data-no-print] { display: none !important; }

          body, html {
            background: #fff !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
            font-size: 8px !important;
          }

          .investment-flow-container { gap: 0 !important; padding: 0 !important; }

          /* 각 섹션 페이지 분리 */
          .print-section-flow { page-break-after: always; }
          .print-section-graphs { page-break-after: always; }
          .print-section-lifetime { page-break-after: always; }
          .print-section-deposit { page-break-after: always; }
          .print-section-records { page-break-before: auto; }

          /* 예수금 계좌별 분리 */
          .print-deposit-account { page-break-after: always; }
          .print-deposit-account:last-child { page-break-after: auto; }

          /* 아코디언 강제 펼침 */
          .print-section-deposit [style*="display: none"] { display: block !important; }

          /* 오버플로우 해제 (스크롤 영역 전체 보이기) */
          div[style*="overflow"] { overflow: visible !important; max-height: none !important; }

          /* 테이블 기본 */
          table { width: 100% !important; min-width: 0 !important; }
          th, td { padding: 3px 5px !important; white-space: nowrap !important; }
          thead { position: static !important; }

          /* 연간 투자흐름표 - 컴팩트 유지 */
          .print-section-flow table { font-size: 5.5px !important; }
          .print-section-flow th { font-size: 5px !important; padding: 1px 2px !important; }
          .print-section-flow td { font-size: 5.5px !important; padding: 1px 2px !important; }

          /* 100세 플로우 테이블 */
          .print-section-lifetime table { font-size: 7px !important; }
          .print-section-lifetime th { font-size: 6.5px !important; padding: 2px 3px !important; }
          .print-section-lifetime td { font-size: 7px !important; padding: 2px 3px !important; }

          /* 예수금, 투자기록 */
          .print-section-deposit table, .print-section-records table { font-size: 8px !important; }
          .print-section-deposit th, .print-section-records th { font-size: 7.5px !important; padding: 3px 4px !important; }
          .print-section-deposit td, .print-section-records td { font-size: 8px !important; padding: 3px 4px !important; }

          /* 버튼, 필터, 컨트롤 숨김 */
          button, select, input, .no-print-btn { display: none !important; }

          /* 인쇄용 헤더/제목 표시 */
          .print-header { display: flex !important; }
          .print-section-title { display: block !important; }

          /* 그래프 */
          .print-chart-wrap { display: block !important; page-break-inside: avoid !important; }
          .recharts-legend-wrapper { font-size: 8px !important; }
          canvas { max-width: 100% !important; }

          /* 테이블 헤더 페이지마다 반복 */
          table thead { display: table-header-group !important; position: static !important; }
          table tbody { display: table-row-group !important; }
          table tr { page-break-inside: avoid !important; }
        }

        @media not print {
          .print-header { display: none !important; }
          .print-section-title { display: none !important; }
        }
      `}</style>

      {/* 프린트 버튼 */}
      <div className="no-print" style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          onClick={handlePrint}
          style={{
            padding: '6px 16px',
            fontSize: 13,
            border: '1px solid #1E3A5F',
            borderRadius: 6,
            backgroundColor: '#1E3A5F',
            color: '#fff',
            cursor: 'pointer',
            fontWeight: 500,
          }}
        >
          {isPrinting ? 'PDF 생성 중...' : 'PDF 다운로드'}
        </button>
      </div>

      {/* 인쇄용 헤더 (화면에서는 숨김) */}
      <div className="print-header" style={{ display: 'none', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', marginBottom: 12, borderBottom: '3px solid #1E3A5F' }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#1E3A5F', letterSpacing: '-0.5px' }}>
            Wrap 은퇴설계
          </div>
          <div style={{ fontSize: 10, color: '#6B7280', marginTop: 2, fontWeight: 500 }}>
            투자흐름 보고서
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#111827' }}>
            {selectedCustomer?.name}
          </div>
          <div style={{ fontSize: 9, color: '#6B7280', marginTop: 2 }}>
            {selectedCustomer?.birthDate} | 출력일: {new Date().toLocaleDateString('ko-KR')}
          </div>
        </div>
      </div>

      {/* ===== 섹터1: 연간 투자흐름표 ===== */}
      <section id="print-sec-flow" className="print-section-flow">
        <div className="print-section-title" style={{ fontSize: 13, fontWeight: 700, color: '#1E3A5F', marginBottom: 8, paddingBottom: 4, borderBottom: '2px solid #1E3A5F' }}>1. 연간 투자흐름표</div>
        <div className="no-print" style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: '#1E3A5F' }}>
            연간 투자흐름표
            <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 400, color: '#9CA3AF' }}>
              (단위: 원)
            </span>
          </h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* 계좌 필터 */}
            <select
              value={flowAccountFilter}
              onChange={(e) => setFlowAccountFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}
              style={{ ...selectStyle, width: 'auto', padding: '6px 10px', fontSize: 12 }}
            >
              <option value="all">전체 계좌</option>
              {depositAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nickname || a.account_number || a.securities_company}
                </option>
              ))}
            </select>
            {/* 재계산 버튼 */}
            <button
              onClick={fetchAnnualFlow}
              style={{
                padding: '5px 12px',
                fontSize: 12,
                border: '1px solid #D1D5DB',
                borderRadius: 6,
                backgroundColor: '#fff',
                cursor: 'pointer',
                color: '#374151',
              }}
            >
              재계산
            </button>
            {/* 연도 선택 */}
            <select
              data-testid="year-select"
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              style={{ ...selectStyle, width: 'auto', padding: '6px 10px', fontSize: 13 }}
            >
              {years.map((y) => (
                <option key={y} value={y}>{y}년</option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 750, position: 'relative' }}>
          <table style={{ width: '100%', minWidth: 900, borderCollapse: 'collapse', fontSize: 13, whiteSpace: 'nowrap' }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 2 }}>
              <tr style={{ backgroundColor: '#F9FAFB' }}>
                {[
                  { label: '연도', align: 'center', tip: '투자 활동이 발생한 연도' },
                  { label: '연차', align: 'center', tip: '최초 투자 연도를 1차로 산정' },
                  { label: '나이', align: 'center', tip: '해당 연도 기준 고객 나이 (만 나이)' },
                  { label: '일시납금액', align: 'right', tip: '예수금 입금(거치) 금액 합계 (투자 제외)' },
                  { label: '연적립금액', align: 'right', tip: '예수금 계좌의 "적립" 구분 입금액 합계' },
                  { label: '총납입금액', align: 'right', tip: '당해 투자금액 + 모든 미종결 투자금액' },
                  { label: '연간평가금액', align: 'right', tip: '당해 종결 평가금액 + 모든 미종결 투자금액' },
                  { label: '연간총수익', align: 'right', tip: '연간평가금액 - 총납입금액' },
                  { label: '연수익률', align: 'right', tip: '연간총수익 / 총납입금액 × 100' },
                  { label: '입금액', align: 'right', tip: '예수금 계좌 "입금" 구분 합계' },
                  { label: '누적입금액', align: 'right', tip: '시작 연도부터 해당 연도까지 입금액 누적 합계' },
                  { label: '인출금액', align: 'right', tip: '투자기록 인출 + 예수금 "출금" 합계' },
                  { label: '누적인출액', align: 'right', tip: '시작 연도부터 해당 연도까지 인출금액 누적 합계' },
                  { label: '순자산', align: 'right', tip: '연도말 예수금 잔액 + 미종결 투자금액 + 이자수익' },
                  { label: '순자산증가율', align: 'right', tip: '(현재 순자산 - 직전 순자산) / 직전 순자산 × 100' },
                  { label: '순이익', align: 'right', tip: '순자산 - (누적입금액 - 누적인출액)' },
                  { label: '순자산수익률', align: 'right', tip: '순이익 / (누적입금액 - 누적인출액) × 100' },
                  { label: '100세플로우', align: 'center', tip: '100세 은퇴플로우에 해당 연도 순자산을 적용/취소' },
                ].map(({ label, align, tip }) => (
                  <th
                    key={label}
                    title={tip}
                    style={{
                      padding: '8px 12px',
                      textAlign: align as 'center' | 'right',
                      fontWeight: 600,
                      color: '#6B7280',
                      borderBottom: '1px solid #E5E7EB',
                      fontSize: 12,
                      cursor: 'help',
                      position: 'relative',
                    }}
                  >
                    <span style={{ borderBottom: '1px dashed #9CA3AF' }}>{label}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {annualFlowLoading ? (
                <tr>
                  <td colSpan={17} style={{ textAlign: 'center', padding: 24, color: '#9CA3AF', fontSize: 13 }}>
                    불러오는 중...
                  </td>
                </tr>
              ) : (() => {
                // 선택 연도 ~ 현재 연도 전체를 표시
                const allYears: number[] = [];
                for (let y = selectedYear; y <= currentYear; y++) allYears.push(y);
                const dataMap = new Map(annualFlowData.map(r => [r.year, r]));
                return allYears.map((year, idx) => {
                  const row = dataMap.get(year);
                  if (!row) {
                    return (
                      <tr key={year} style={{ borderBottom: '1px solid #F3F4F6', backgroundColor: idx % 2 === 0 ? '#fff' : '#FAFAFA' }}>
                        <td style={tdCenter}>{year}</td>
                        {Array.from({ length: 16 }).map((_, i) => (
                          <td key={i} style={{ padding: '9px 12px', textAlign: 'center', color: '#D1D5DB', fontSize: 13 }}>-</td>
                        ))}
                      </tr>
                    );
                  }
                  const rateColor = Number(row.annual_return_rate) > 0
                    ? '#16A34A'
                    : Number(row.annual_return_rate) < 0
                    ? '#DC2626'
                    : '#374151';
                  return (
                    <React.Fragment key={year}>
                    <tr
                      style={{
                        borderBottom: '1px solid #F3F4F6',
                        backgroundColor: idx % 2 === 0 ? '#fff' : '#FAFAFA',
                        ...(year === currentYear ? { backgroundColor: '#FFFFF0' } : {}),
                      }}
                    >
                      <td style={tdCenter}>{row.year}</td>
                      <td style={tdCenter}>{row.order_in_year ?? '-'}</td>
                      <td style={tdCenter}>{row.age ?? '-'}</td>
                      <td style={tdRight}>{formatCurrency(row.lump_sum)}</td>
                      <td style={tdRight}>{formatCurrency(row.annual_savings)}</td>
                      <td style={{ ...tdRight, fontWeight: 700 }}>{formatCurrency(row.total_contribution)}</td>
                      <td
                        onClick={() => setEvalDetailYear(evalDetailYear === row.year ? null : row.year)}
                        style={{ ...tdRight, fontWeight: 700, cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted' as const, textUnderlineOffset: '3px' }}
                        title="클릭하면 평가 상세 보기"
                      >{formatCurrency(row.annual_evaluation)} {evalDetailYear === row.year ? '▲' : '▼'}</td>
                      <td style={{ ...tdRight, color: row.annual_return >= 0 ? '#16A34A' : '#DC2626' }}>
                        {formatCurrency(row.annual_return)}
                      </td>
                      <td style={{ ...tdRight, color: rateColor, fontWeight: 700 }}>
                        {row.annual_return_rate != null ? `${Number(row.annual_return_rate).toFixed(2)}%` : '-'}
                      </td>
                      <td style={tdRight}>{formatCurrency(row.deposit_in)}</td>
                      <td style={tdRight}>{formatCurrency(row.cumulative_deposit_in)}</td>
                      <td style={tdRight}>{formatCurrency(row.withdrawal)}</td>
                      <td style={tdRight}>{formatCurrency(row.cumulative_withdrawal)}</td>
                      <td style={{ ...tdRight, fontWeight: 700, color: '#1E3A5F' }}>
                        {formatCurrency(row.total_evaluation)}
                      </td>
                      {/* 순자산증가율 */}
                      {(() => {
                        const prevRow = dataMap.get(year - 1);
                        const prevAsset = prevRow?.total_evaluation ?? 0;
                        if (!prevAsset || prevAsset === 0) return <td style={{ ...tdRight, color: '#9CA3AF' }}>-</td>;
                        const rate = ((row.total_evaluation - prevAsset) / prevAsset * 100);
                        const color = rate > 0 ? '#16A34A' : rate < 0 ? '#DC2626' : '#374151';
                        return <td style={{ ...tdRight, fontWeight: 700, color }}>{rate.toFixed(2)}%</td>;
                      })()}
                      {/* 순이익: 순자산 - (누적입금액 - 누적인출액) */}
                      {(() => {
                        const netInvestment = row.cumulative_deposit_in - row.cumulative_withdrawal;
                        const netProfit = row.total_evaluation - netInvestment;
                        const color = netProfit > 0 ? '#16A34A' : netProfit < 0 ? '#DC2626' : '#374151';
                        return <td style={{ ...tdRight, fontWeight: 700, color }}>{formatCurrency(netProfit)}</td>;
                      })()}
                      {/* 순자산수익률: 순이익 / (누적입금액 - 누적인출액) × 100 */}
                      {(() => {
                        const netInvestment = row.cumulative_deposit_in - row.cumulative_withdrawal;
                        if (!netInvestment || netInvestment === 0) return <td style={{ ...tdRight, color: '#9CA3AF' }}>-</td>;
                        const netProfit = row.total_evaluation - netInvestment;
                        const rate = (netProfit / netInvestment * 100);
                        const color = rate > 0 ? '#16A34A' : rate < 0 ? '#DC2626' : '#374151';
                        return <td style={{ ...tdRight, fontWeight: 700, color }}>{rate.toFixed(2)}%</td>;
                      })()}
                      {/* 100세 플로우 적용/취소 - 당해연도는 버튼 없음 */}
                      <td style={{ padding: '6px 8px', textAlign: 'center', whiteSpace: 'nowrap', borderBottom: '1px solid #F3F4F6' }}>
                        {row.year === new Date().getFullYear() ? (
                          <span style={{ fontSize: 10, color: '#9CA3AF' }}>당해</span>
                        ) : appliedYears[row.year] ? (
                          <button
                            className="no-print-btn"
                            onClick={() => {
                              const next = { ...appliedYears }; delete next[row.year];
                              setAppliedYears(next);
                              saveAppliedYears(next);
                            }}
                            style={{ padding: '3px 10px', fontSize: 11, border: '1px solid #DC2626', borderRadius: 4, backgroundColor: '#FEF2F2', color: '#DC2626', cursor: 'pointer', fontWeight: 500 }}
                          >
                            취소
                          </button>
                        ) : (
                          <button
                            className="no-print-btn"
                            onClick={() => {
                              const netInvestment = row.cumulative_deposit_in - row.cumulative_withdrawal;
                              const netProfit = netInvestment > 0 ? (row.total_evaluation - netInvestment) / netInvestment * 100 : 0;
                              const newEntry = {
                                lump_sum: row.lump_sum,
                                annual_savings: row.annual_savings,
                                total_contribution: row.total_contribution,
                                deposit_in_amount: row.deposit_in,
                                annual_evaluation: row.annual_evaluation,
                                annual_return_rate: row.annual_return_rate,
                                net_asset: row.total_evaluation,
                                net_asset_return_rate: netProfit,
                              };
                              const next = { ...appliedYears, [row.year]: newEntry };
                              setAppliedYears(next);
                              saveAppliedYears(next);
                            }}
                            style={{ padding: '3px 10px', fontSize: 11, border: '1px solid #1E3A5F', borderRadius: 4, backgroundColor: '#EFF6FF', color: '#1E3A5F', cursor: 'pointer', fontWeight: 500 }}
                          >
                            적용
                          </button>
                        )}
                      </td>
                    </tr>
                    {/* 평가상세 펼침 행 */}
                    {evalDetailYear === row.year && (
                      <tr>
                        <td colSpan={20} style={{ padding: 0, backgroundColor: '#fff', borderBottom: '1px solid #E5E7EB' }}>
                          <div style={{ display: 'flex', justifyContent: 'flex-start', paddingLeft: 'calc(4 * 80px + 4 * 12px)', paddingTop: 8, paddingBottom: 12, paddingRight: 16 }}>
                            <div style={{ width: '100%', maxWidth: 700 }}>
                              <div style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', marginBottom: 6 }}>
                                {row.year}년 평가 상세 — 총납입: {formatCurrency(row.total_contribution)} / 연간평가: {formatCurrency(row.annual_evaluation)}
                              </div>
                              <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse', borderRadius: 6, overflow: 'hidden', border: '1px solid #E5E7EB' }}>
                                <thead>
                                  <tr style={{ backgroundColor: '#F1F5F9' }}>
                                    <th style={{ padding: '5px 8px', textAlign: 'left', fontWeight: 600, color: '#475569', borderBottom: '1px solid #E2E8F0' }}>상품</th>
                                    <th style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 600, color: '#475569', borderBottom: '1px solid #E2E8F0' }}>투자금액</th>
                                    <th style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 600, color: '#D97706', borderBottom: '1px solid #E2E8F0' }}>중간평가</th>
                                    <th style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 600, color: '#059669', borderBottom: '1px solid #E2E8F0' }}>투자종료</th>
                                    <th style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 600, color: '#1E3A5F', borderBottom: '1px solid #E2E8F0' }}>평가금액</th>
                                    <th style={{ padding: '5px 8px', textAlign: 'center', fontWeight: 600, color: '#475569', borderBottom: '1px solid #E2E8F0' }}>상태</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {records.filter(r => {
                                    const sy = r.start_date ? parseInt(r.start_date.slice(0, 4)) : 9999;
                                    const ey = r.end_date ? parseInt(r.end_date.slice(0, 4)) : 9999;
                                    return sy <= row.year && ey >= row.year && r.record_type === 'investment';
                                  }).map((r, rIdx) => {
                                    const interim = r.interim_evaluations?.[String(row.year)];
                                    const isExit = r.status === 'exit' && r.end_date && parseInt(r.end_date.slice(0, 4)) === row.year;
                                    const exitVal = isExit ? (r.evaluation_amount ?? null) : null;
                                    const evalVal = exitVal ?? interim ?? r.investment_amount;
                                    const bg = rIdx % 2 === 0 ? '#FAFBFC' : '#fff';
                                    return (
                                      <tr key={r.id} style={{ backgroundColor: bg, borderBottom: '1px solid #F1F5F9' }}>
                                        <td style={{ padding: '4px 8px', color: '#374151' }}>{getProductName(r)}</td>
                                        <td style={{ padding: '4px 8px', textAlign: 'right', color: '#6B7280' }}>{r.investment_amount.toLocaleString()}</td>
                                        <td style={{ padding: '4px 8px', textAlign: 'right', color: interim != null ? '#D97706' : '#D1D5DB', fontWeight: interim != null ? 700 : 400 }}>{interim != null ? interim.toLocaleString() : '-'}</td>
                                        <td style={{ padding: '4px 8px', textAlign: 'right', color: exitVal != null ? '#059669' : '#D1D5DB', fontWeight: exitVal != null ? 700 : 400 }}>{exitVal != null ? exitVal.toLocaleString() : '-'}</td>
                                        <td style={{ padding: '4px 8px', textAlign: 'right', fontWeight: 700, color: '#1E3A5F' }}>{evalVal.toLocaleString()}</td>
                                        <td style={{ padding: '4px 8px', textAlign: 'center' }}>
                                          <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, backgroundColor: isExit ? '#DCFCE7' : '#DBEAFE', color: isExit ? '#166534' : '#1E40AF', fontWeight: 600 }}>{isExit ? '종결' : '운용중'}</span>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                    </React.Fragment>
                  );
                });
              })()}
            </tbody>
          </table>
        </div>

      </section>

        {/* 그래프 버튼 행 - 우측 정렬 */}
        {annualFlowData.length > 0 && (
          <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button
              onClick={() => setShowFlowChart(!showFlowChart)}
              className="no-print-btn"
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', border: '1px solid #E5E7EB', borderRadius: 8, backgroundColor: showFlowChart ? '#EFF6FF' : '#F9FAFB', cursor: 'pointer', fontSize: 13, color: '#374151', fontWeight: 500 }}
            >
              {showFlowChart ? '\u25BC' : '\u25B6'} 투자흐름 그래프
            </button>
            <button
              onClick={() => setShowNetAssetChart(!showNetAssetChart)}
              className="no-print-btn"
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', border: '1px solid #E5E7EB', borderRadius: 8, backgroundColor: showNetAssetChart ? '#EFF6FF' : '#F9FAFB', cursor: 'pointer', fontSize: 13, color: '#374151', fontWeight: 500 }}
            >
              {showNetAssetChart ? '\u25BC' : '\u25B6'} 순자산 그래프
            </button>
            <button
              onClick={() => setShowLifetimeFlow(!showLifetimeFlow)}
              className="no-print-btn"
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', border: '1px solid #1E3A5F', borderRadius: 8, backgroundColor: showLifetimeFlow ? '#1E3A5F' : '#F9FAFB', color: showLifetimeFlow ? '#fff' : '#1E3A5F', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
            >
              {showLifetimeFlow ? '\u25BC' : '\u25B6'} 100세 은퇴플로우
            </button>
          </div>
        )}

        {/* 투자흐름 그래프 + 순자산 그래프 */}
        <section id="print-sec-graphs" className="print-section-graphs">
          <div className="print-section-title" style={{ fontSize: 13, fontWeight: 700, color: '#1E3A5F', marginBottom: 8, paddingBottom: 4, borderBottom: '2px solid #1E3A5F' }}>2. 투자흐름 분석 그래프</div>
          {showFlowChart && annualFlowData.length > 0 && (
            <div style={{ marginTop: 12, padding: 16, border: '1px solid #E5E7EB', borderRadius: 8, backgroundColor: '#fff' }}>
              <div style={{ display: 'flex', gap: 12, marginBottom: 12, fontSize: 12, flexWrap: 'wrap' }} className="no-print">
                {([
                  { key: 'depositIn' as const, label: '입금액', color: '#8B5CF6' },
                  { key: 'contribution' as const, label: '총납입금액', color: '#4A90D9' },
                  { key: 'annualReturn' as const, label: '연간총수익', color: '#10B981' },
                  { key: 'returnRate' as const, label: '연수익률(%)', color: '#F59E0B' },
                ] as const).map(({ key, label, color }) => (
                  <button key={key} onClick={() => setChartVisibility(prev => ({ ...prev, [key]: !prev[key] }))}
                    style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', border: '1px solid #E5E7EB', borderRadius: 6, backgroundColor: chartVisibility[key] ? '#fff' : '#F3F4F6', cursor: 'pointer', opacity: chartVisibility[key] ? 1 : 0.4, fontSize: 12, color: '#374151' }}>
                    <span style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: color, display: 'inline-block' }} />
                    {label}
                  </button>
                ))}
              </div>
              <div id="print-chart-flow" className="print-chart-wrap">
                <div className="print-section-title" style={{ fontSize: 11, fontWeight: 600, color: '#374151', marginBottom: 4 }}>투자흐름 그래프</div>
                <AnnualFlowChart data={annualFlowData} visibility={chartVisibility} noAnimation={isPrinting} />
              </div>
            </div>
          )}

          {showNetAssetChart && annualFlowData.length > 0 && (
            <div style={{ marginTop: 12, padding: 16, border: '1px solid #E5E7EB', borderRadius: 8, backgroundColor: '#fff' }}>
              <div style={{ display: 'flex', gap: 12, marginBottom: 12, fontSize: 12, flexWrap: 'wrap' }} className="no-print">
                {([
                  { key: 'cumulativeDeposit' as const, label: '누적입금액', color: '#4A90D9' },
                  { key: 'netAsset' as const, label: '순자산', color: '#1E3A5F' },
                  { key: 'cumulativeProfit' as const, label: '순이익', color: '#10B981' },
                  { key: 'netAssetReturnRate' as const, label: '순자산수익률(%)', color: '#F59E0B' },
                ] as const).map(({ key, label, color }) => (
                  <button key={key} onClick={() => setNetAssetVisibility(prev => ({ ...prev, [key]: !prev[key] }))}
                    style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', border: '1px solid #E5E7EB', borderRadius: 6, backgroundColor: netAssetVisibility[key] ? '#fff' : '#F3F4F6', cursor: 'pointer', opacity: netAssetVisibility[key] ? 1 : 0.4, fontSize: 12, color: '#374151' }}>
                    <span style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: color, display: 'inline-block' }} />
                    {label}
                  </button>
                ))}
              </div>
              <div id="print-chart-netasset" className="print-chart-wrap">
                <div className="print-section-title" style={{ fontSize: 11, fontWeight: 600, color: '#374151', marginBottom: 4 }}>순자산 그래프</div>
                <NetAssetChart data={annualFlowData} visibility={netAssetVisibility} noAnimation={isPrinting} />
              </div>
            </div>
          )}
        </section>

        {/* 100세 은퇴플로우 */}
        {showLifetimeFlow && (
          <section id="print-sec-lifetime" className="print-section-lifetime" style={{ marginTop: 12 }}>
            <div className="print-section-title" style={{ fontSize: 13, fontWeight: 700, color: '#1E3A5F', marginBottom: 8, paddingBottom: 4, borderBottom: '2px solid #1E3A5F' }}>3. 100세 은퇴플로우</div>
            <LifetimeRetirementFlow
              currentAge={(() => {
                if (!selectedCustomer?.birthDate) return null;
                const bd = new Date(selectedCustomer.birthDate);
                const today = new Date();
                let age = today.getFullYear() - bd.getFullYear();
                if (today < new Date(today.getFullYear(), bd.getMonth(), bd.getDate())) age--;
                return age;
              })()}
              desiredPlanData={desiredPlanData}
              annualFlowData={annualFlowData}
              appliedYears={appliedYears}
              onRowsChange={(rows: any[]) => { setLifetimeRowsForPdf(rows); lifetimeRowsRef.current = rows; }}
            />
          </section>
        )}

      {/* ===== 섹터2: 예수금 계좌 기록 ===== */}
      <section id="print-sec-deposit" className="print-section-deposit">
        <div className="print-section-title" style={{ fontSize: 13, fontWeight: 700, color: '#1E3A5F', marginBottom: 8, paddingBottom: 4, borderBottom: '2px solid #1E3A5F' }}>4. 예수금 계좌 기록</div>
        <div className="no-print" style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: '#1E3A5F' }}>
            예수금 계좌 기록
          </h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginLeft: 'auto' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#6B7280', cursor: 'pointer' }}>
              <input type="checkbox" checked={showHidden} onChange={() => setShowHidden(!showHidden)} style={{ cursor: 'pointer' }} />
              숨긴 계좌 보기
            </label>
            <button
              onClick={() => setShowAddDepositAccountModal(true)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '7px 14px',
                fontSize: 13,
                fontWeight: 600,
                borderRadius: 7,
                border: 'none',
                backgroundColor: '#1E3A5F',
                color: '#fff',
                cursor: 'pointer',
              }}
            >
              + 예수금 계좌 추가
            </button>
          </div>
        </div>

        {depositAccountsLoading ? (
          <div style={{ textAlign: 'center', padding: 24, color: '#9CA3AF', fontSize: 13 }}>
            불러오는 중...
          </div>
        ) : depositAccounts.length === 0 ? (
          <div style={{
            textAlign: 'center',
            padding: 24,
            color: '#9CA3AF',
            fontSize: 13,
            border: '1px dashed #E5E7EB',
            borderRadius: 8,
          }}>
            등록된 예수금 계좌가 없습니다.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {depositAccounts.map((account) => {
              const isExpanded = expandedAccountIds.has(account.id);
              const rawTransactions = accountTransactions[account.id] ?? [];
              const txOrigIndex = new Map(rawTransactions.map((t, i) => [t.id, i + 1]));
              const sortedTransactions = sortTransactions(rawTransactions);
              const transactions = txYearFilter === 'all' ? sortedTransactions : sortedTransactions.filter(t => t.transaction_date?.startsWith(txYearFilter));
              const txYears = [...new Set(rawTransactions.map(t => t.transaction_date?.slice(0, 4)).filter(Boolean))].sort();
              const txLoading = transactionsLoading[account.id] ?? false;
              const isAddingNewTx = newTxAccountId === account.id;

              return (
                <div
                  key={account.id}
                  className="print-deposit-account"
                  style={{
                    border: '1px solid #E5E7EB',
                    borderRadius: 8,
                    overflow: 'hidden',
                  }}
                >
                  {/* 계좌 헤더 */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 16px',
                      backgroundColor: '#F8FAFC',
                      borderLeft: `3px solid ${account.is_active ? '#1E3A5F' : '#D1D5DB'}`,
                      opacity: account.is_active ? 1 : 0.6,
                      cursor: 'pointer',
                      userSelect: 'none',
                    }}
                    onClick={() => toggleAccountExpand(account.id)}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 14, color: '#374151' }}>📁</span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#1E3A5F' }}>
                        {account.securities_company}
                        {account.account_number && (
                          <span style={{ fontWeight: 400, color: '#6B7280', marginLeft: 6 }}>
                            {account.account_number}
                          </span>
                        )}
                        {account.nickname && (
                          <span style={{ fontWeight: 400, color: '#9CA3AF', marginLeft: 6 }}>
                            &quot;{account.nickname}&quot;
                          </span>
                        )}
                        {!account.is_active && (
                          <span style={{ fontSize: 11, color: '#EF4444', fontWeight: 600, marginLeft: 8, backgroundColor: '#FEF2F2', padding: '1px 6px', borderRadius: 4 }}>숨김</span>
                        )}
                      </span>
                      <span style={{ fontSize: 13, color: '#374151' }}>
                        잔액:{' '}
                        <strong style={{ color: '#1E3A5F' }}>
                          {(account.current_balance ?? 0).toLocaleString()}원
                        </strong>
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {isExpanded && (
                        <>
                          <button
                            onClick={(e) => { e.stopPropagation(); setEditingAccount(account); }}
                            style={{ padding: '4px 10px', fontSize: 12, fontWeight: 500, borderRadius: 6, border: '1px solid #D1D5DB', backgroundColor: '#fff', color: '#374151', cursor: 'pointer' }}
                          >
                            수정
                          </button>
                          <button
                            onClick={async (e) => {
                              e.stopPropagation();
                              try {
                                const res = await fetch(`${API_URL}/api/v1/retirement/deposit-accounts/${account.id}/recalculate`, {
                                  method: 'POST', headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
                                });
                                if (!res.ok) throw new Error();
                                const result = await res.json();
                                alert(`${result.updated_count}건 동기화 완료`);
                                fetchDepositAccounts();
                                fetchTransactions(account.id);
                              } catch { alert('재계산 실패'); }
                            }}
                            title="투자기록 기반으로 자동생성된 거래(날짜/금액/상품명)를 일괄 재동기화하고 잔액을 재계산합니다."
                            style={{ padding: '4px 10px', fontSize: 12, fontWeight: 500, borderRadius: 6, border: '1px solid #F59E0B', backgroundColor: '#FFFBEB', color: '#B45309', cursor: 'pointer' }}
                          >
                            🔄 재계산
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              startNewTx(account.id);
                              // 아코디언이 닫혀있으면 펼치기
                              if (!expandedAccountIds.has(account.id)) {
                                toggleAccountExpand(account.id);
                              }
                            }}
                            style={{
                              padding: '4px 10px',
                              fontSize: 12,
                              fontWeight: 600,
                              borderRadius: 6,
                              border: '1px solid #1E3A5F',
                              backgroundColor: '#fff',
                              color: '#1E3A5F',
                              cursor: 'pointer',
                            }}
                          >
                            + 거래 추가
                          </button>
                          {account.is_active ? (
                            <button
                              onClick={async (e) => {
                                e.stopPropagation();
                                if (!confirm(`"${account.nickname || account.securities_company}" 계좌를 숨기시겠습니까?`)) return;
                                try {
                                  await fetch(`${API_URL}/api/v1/retirement/deposit-accounts/${account.id}`, {
                                    method: 'DELETE', headers: authLib.getAuthHeader(),
                                  });
                                  fetchDepositAccounts();
                                } catch { /* silent */ }
                              }}
                              style={{ padding: '4px 10px', fontSize: 12, fontWeight: 500, borderRadius: 6, border: '1px solid #E5E7EB', backgroundColor: '#fff', color: '#EF4444', cursor: 'pointer' }}
                            >
                              숨김
                            </button>
                          ) : (
                            <button
                              onClick={async (e) => {
                                e.stopPropagation();
                                try {
                                  await fetch(`${API_URL}/api/v1/retirement/deposit-accounts/${account.id}`, {
                                    method: 'PUT',
                                    headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
                                    body: JSON.stringify({ is_active: true }),
                                  });
                                  fetchDepositAccounts();
                                } catch { /* silent */ }
                              }}
                              style={{ padding: '4px 10px', fontSize: 12, fontWeight: 600, borderRadius: 6, border: '1px solid #10B981', backgroundColor: '#ECFDF5', color: '#10B981', cursor: 'pointer' }}
                            >
                              활성화
                            </button>
                          )}
                        </>
                      )}
                      <span style={{ fontSize: 13, color: '#9CA3AF' }}>{isExpanded ? '▲' : '▼'}</span>
                    </div>
                  </div>

                  {/* 거래내역 테이블 (아코디언) */}
                  {isExpanded && (
                    <div>
                      {/* 년도 필터 + 건수 */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', backgroundColor: '#F9FAFB', borderBottom: '1px solid #E5E7EB' }}>
                        <span style={{ fontSize: 11, color: '#6B7280' }}>년도:</span>
                        <select
                          value={txYearFilter}
                          onChange={e => setTxYearFilter(e.target.value)}
                          style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, border: '1px solid #D1D5DB' }}
                        >
                          <option value="all">전체</option>
                          {txYears.map(y => <option key={y} value={y}>{y}년</option>)}
                        </select>
                        <span style={{ fontSize: 11, color: '#9CA3AF' }}>({transactions.length}건{txYearFilter !== 'all' ? ` / 총 ${rawTransactions.length}건` : ''})</span>
                        <button
                          onClick={() => {
                            if (transactions.length === 0) return;
                            const TRANSACTION_TYPE_KR: Record<string, string> = { deposit: '입금', savings: '적립', investment: '투자', termination: '종료', withdrawal: '출금', interest: '이자' };
                            const header = ['No', '발생일', '구분', '상품명', '입금액', '출금액', '잔액', '메모'];
                            const rows = transactions.map((tx, i) => [
                              txOrigIndex.get(tx.id) ?? (i + 1),
                              tx.transaction_date,
                              TRANSACTION_TYPE_KR[tx.transaction_type] ?? tx.transaction_type,
                              tx.related_product || '',
                              tx.credit_amount || 0,
                              tx.debit_amount || 0,
                              tx.balance,
                              tx.memo || '',
                            ]);
                            const BOM = '\uFEFF';
                            const csv = BOM + [header, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
                            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            const acctName = account.nickname || account.securities_company || '계좌';
                            a.href = url;
                            a.download = `${acctName}_거래내역${txYearFilter !== 'all' ? `_${txYearFilter}` : ''}.csv`;
                            a.click();
                            URL.revokeObjectURL(url);
                          }}
                          style={{ marginLeft: 'auto', padding: '2px 8px', fontSize: 11, fontWeight: 500, borderRadius: 4, border: '1px solid #D1D5DB', backgroundColor: '#fff', color: '#374151', cursor: 'pointer' }}
                        >
                          📥 엑셀 다운
                        </button>
                      </div>
                    <div ref={el => { txScrollRefs.current[account.id] = el; }} style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 480 }}>
                      <table style={{ minWidth: 780, borderCollapse: 'collapse', fontSize: 13, whiteSpace: 'nowrap', width: '100%' }}>
                        <thead style={{ position: 'sticky', top: 0, zIndex: 2 }}>
                          <tr style={{ backgroundColor: '#F9FAFB' }}>
                            {[
                              { label: 'No', align: 'center', width: 36, sortKey: 'id' },
                              { label: '발생일', align: 'center', width: 90, sortKey: 'transaction_date' },
                              { label: '구분', align: 'center', width: 52, sortKey: 'transaction_type' },
                              { label: '상품명', align: 'left', width: 120, sortKey: 'related_product' },
                              { label: '입금액', align: 'right', width: 110, sortKey: 'credit_amount' },
                              { label: '출금액', align: 'right', width: 110, sortKey: 'debit_amount' },
                              { label: '잔액', align: 'right', width: 110, sortKey: 'balance' },
                              { label: '메모', align: 'left', width: 200, sortKey: '' },
                              { label: '액션', align: 'center', width: 70, sortKey: '' },
                            ].map(({ label, align, width, sortKey }) => (
                              <th
                                key={label}
                                onClick={sortKey ? () => toggleTxSort(sortKey) : undefined}
                                style={{
                                  padding: '8px 12px',
                                  textAlign: align as 'center' | 'left' | 'right',
                                  fontWeight: 600,
                                  color: '#6B7280',
                                  borderBottom: '1px solid #E5E7EB',
                                  fontSize: 12,
                                  backgroundColor: '#F9FAFB',
                                  width: width ? `${width}px` : undefined,
                                  cursor: sortKey ? 'pointer' : undefined,
                                  userSelect: sortKey ? 'none' : undefined,
                                }}
                              >
                                {label}{sortKey && txSortKey === sortKey ? (txSortDir === 'asc' ? ' ▲' : ' ▼') : sortKey ? ' ⇅' : ''}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {/* 신규 거래 입력 행 */}
                          {isAddingNewTx && (
                            <tr style={{ backgroundColor: '#FFFFF0', borderBottom: '1px solid #FDE68A' }}>
                              <td style={{ ...txTdCenter, color: '#9CA3AF' }}>-</td>
                              <td style={{ padding: '6px 8px' }}>
                                <input
                                  type="date"
                                  value={txEditDate}
                                  onChange={e => setTxEditDate(e.target.value)}
                                  style={inlineInput}
                                />
                              </td>
                              <td style={{ padding: '6px 8px' }}>
                                <select
                                  value={txEditType}
                                  onChange={e => setTxEditType(e.target.value as TransactionType)}
                                  style={inlineSelect}
                                >
                                  {(Object.entries(TRANSACTION_TYPE_LABELS) as [TransactionType, string][]).map(([val, lbl]) => (
                                    <option key={val} value={val}>{lbl}</option>
                                  ))}
                                </select>
                              </td>
                              <td style={{ padding: '6px 8px' }}>
                                <input
                                  type="text"
                                  value={txEditProduct || ''}
                                  onChange={e => setTxEditProduct(e.target.value)}
                                  placeholder="상품명"
                                  style={inlineInput}
                                />
                              </td>
                              <td style={{ padding: '6px 8px' }}>
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  value={txEditCredit}
                                  onChange={e => setTxEditCredit(formatInputCurrency(e.target.value))}
                                  placeholder="0"
                                  style={{ ...inlineInput, textAlign: 'right' }}
                                />
                              </td>
                              <td style={{ padding: '6px 8px' }}>
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  value={txEditDebit}
                                  onChange={e => setTxEditDebit(formatInputCurrency(e.target.value))}
                                  placeholder="0"
                                  style={{ ...inlineInput, textAlign: 'right' }}
                                />
                              </td>
                              <td style={{ ...txTdRight, color: '#9CA3AF' }}>-</td>
                              <td style={{ padding: '6px 8px' }}>
                                <input
                                  type="text"
                                  value={txEditMemo}
                                  onChange={e => setTxEditMemo(e.target.value)}
                                  placeholder="메모"
                                  style={inlineInput}
                                />
                              </td>
                              <td style={{ padding: '6px 8px', whiteSpace: 'nowrap', textAlign: 'center' }}>
                                <button
                                  onClick={() => saveTxNew(account.id)}
                                  disabled={txSaving || !txEditDate}
                                  style={{ ...inlineSaveBtn, marginRight: 3, opacity: (!txEditDate || txSaving) ? 0.5 : 1 }}
                                >
                                  {txSaving ? '...' : '저장'}
                                </button>
                                <button onClick={cancelTxEdit} style={inlineCancelBtn}>취소</button>
                              </td>
                            </tr>
                          )}

                          {txLoading ? (
                            <tr>
                              <td colSpan={9} style={{ textAlign: 'center', padding: 20, color: '#9CA3AF', fontSize: 13 }}>
                                불러오는 중...
                              </td>
                            </tr>
                          ) : transactions.length === 0 && !isAddingNewTx ? (
                            <tr>
                              <td colSpan={9} style={{ textAlign: 'center', padding: 20, color: '#9CA3AF', fontSize: 13 }}>
                                거래내역이 없습니다.
                              </td>
                            </tr>
                          ) : (
                            transactions.map((tx, idx) => {
                              const badgeColor = TRANSACTION_TYPE_COLORS[tx.transaction_type] ?? '#6B7280';
                              const isEditingThis = editingTxId === tx.id;

                              if (isEditingThis) {
                                return (
                                  <tr key={tx.id} style={{ backgroundColor: '#FFFFF0', borderBottom: '1px solid #FDE68A' }}>
                                    <td style={{ ...txTdCenter, color: '#9CA3AF' }}>{txOrigIndex.get(tx.id) ?? (idx + 1)}</td>
                                    <td style={{ padding: '6px 8px' }}>
                                      <input
                                        type="date"
                                        value={txEditDate}
                                        onChange={e => setTxEditDate(e.target.value)}
                                        style={inlineInput}
                                      />
                                    </td>
                                    <td style={{ padding: '6px 8px' }}>
                                      <select
                                        value={txEditType}
                                        onChange={e => setTxEditType(e.target.value as TransactionType)}
                                        style={inlineSelect}
                                      >
                                        {(Object.entries(TRANSACTION_TYPE_LABELS) as [TransactionType, string][]).map(([val, lbl]) => (
                                          <option key={val} value={val}>{lbl}</option>
                                        ))}
                                      </select>
                                    </td>
                                    <td style={{ padding: '6px 8px' }}>
                                      <input
                                        type="text"
                                        value={txEditProduct}
                                        onChange={e => setTxEditProduct(e.target.value)}
                                        placeholder="상품명"
                                        style={inlineInput}
                                      />
                                    </td>
                                    <td style={{ padding: '6px 8px' }}>
                                      <input
                                        type="text"
                                        inputMode="numeric"
                                        value={txEditCredit}
                                        onChange={e => setTxEditCredit(formatInputCurrency(e.target.value))}
                                        placeholder="0"
                                        style={{ ...inlineInput, textAlign: 'right' }}
                                      />
                                    </td>
                                    <td style={{ padding: '6px 8px' }}>
                                      <input
                                        type="text"
                                        inputMode="numeric"
                                        value={txEditDebit}
                                        onChange={e => setTxEditDebit(formatInputCurrency(e.target.value))}
                                        placeholder="0"
                                        style={{ ...inlineInput, textAlign: 'right' }}
                                      />
                                    </td>
                                    <td style={{ ...txTdRight, fontWeight: 700, color: '#1E3A5F' }}>
                                      {tx.balance.toLocaleString()}
                                    </td>
                                    <td style={{ padding: '6px 8px' }}>
                                      <input
                                        type="text"
                                        value={txEditMemo}
                                        onChange={e => setTxEditMemo(e.target.value)}
                                        placeholder="메모"
                                        style={inlineInput}
                                      />
                                    </td>
                                    <td style={{ padding: '6px 8px', whiteSpace: 'nowrap', textAlign: 'center' }}>
                                      <button
                                        onClick={() => saveTxEdit(tx.id, account.id)}
                                        disabled={txSaving || !txEditDate}
                                        style={{ ...inlineSaveBtn, marginRight: 3, opacity: (!txEditDate || txSaving) ? 0.5 : 1 }}
                                      >
                                        {txSaving ? '...' : '저장'}
                                      </button>
                                      <button onClick={cancelTxEdit} style={inlineCancelBtn}>취소</button>
                                    </td>
                                  </tr>
                                );
                              }

                              return (
                                <tr
                                  key={tx.id}
                                  style={{
                                    borderBottom: '1px solid #F3F4F6',
                                    backgroundColor: idx % 2 === 0 ? '#fff' : '#FAFAFA',
                                  }}
                                >
                                  <td style={{ ...txTdCenter }}>{txOrigIndex.get(tx.id) ?? (idx + 1)}</td>
                                  <td style={{ ...txTdBase, color: '#6B7280' }}>{tx.transaction_date}</td>
                                  <td style={{ ...txTdCenter }}>
                                    <span style={{
                                      display: 'inline-block',
                                      padding: '2px 8px',
                                      borderRadius: 10,
                                      fontSize: 11,
                                      fontWeight: 600,
                                      backgroundColor: `${badgeColor}18`,
                                      color: badgeColor,
                                    }}>
                                      {TRANSACTION_TYPE_LABELS[tx.transaction_type]}
                                    </span>
                                  </td>
                                  <td style={{ ...txTdBase, color: '#374151', fontSize: 12 }}>
                                    {tx.related_product || <span style={{ color: '#D1D5DB' }}>-</span>}
                                  </td>
                                  <td style={{ ...txTdRight, color: tx.credit_amount > 0 ? '#1E3A5F' : '#9CA3AF' }}>
                                    {tx.credit_amount > 0 ? tx.credit_amount.toLocaleString() : '-'}
                                  </td>
                                  <td style={{ ...txTdRight, color: tx.debit_amount > 0 ? '#EF4444' : '#9CA3AF' }}>
                                    {tx.debit_amount > 0 ? tx.debit_amount.toLocaleString() : '-'}
                                  </td>
                                  <td style={{ ...txTdRight, fontWeight: 700, color: '#1E3A5F' }}>
                                    {tx.balance.toLocaleString()}
                                  </td>
                                  <td style={{ ...txTdBase, color: '#6B7280', maxWidth: 200, fontSize: 11, lineHeight: '1.4', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const, wordBreak: 'break-word' }} title={tx.memo || ''}>
                                    {tx.memo || <span style={{ color: '#D1D5DB' }}>-</span>}
                                  </td>
                                  <td style={{ ...txTdCenter, whiteSpace: 'nowrap' }}>
                                    {tx.investment_record_id ? (
                                      <span style={{ fontSize: 11, color: '#9CA3AF' }}>자동</span>
                                    ) : (
                                      <>
                                        <button
                                          onClick={() => startEditTx(tx)}
                                          style={{ padding: '2px 6px', fontSize: 11, borderRadius: 4, border: '1px solid #D1D5DB', backgroundColor: '#fff', color: '#374151', cursor: 'pointer', marginRight: 3 }}
                                        >수정</button>
                                        <button
                                          onClick={async () => {
                                            if (!confirm('이 거래내역을 삭제하시겠습니까?')) return;
                                            try {
                                              await fetch(`${API_URL}/api/v1/retirement/deposit-transactions/${tx.id}`, {
                                                method: 'DELETE', headers: authLib.getAuthHeader(),
                                              });
                                              fetchTransactions(account.id);
                                              fetchDepositAccounts();
                                            } catch { /* silent */ }
                                          }}
                                          style={{ padding: '2px 6px', fontSize: 11, borderRadius: 4, border: '1px solid #FECACA', backgroundColor: '#FEF2F2', color: '#EF4444', cursor: 'pointer' }}
                                        >삭제</button>
                                      </>
                                    )}
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ===== 섹터3: 투자기록 테이블 ===== */}
      <section id="print-sec-records" className="print-section-records">
        <div className="print-section-title" style={{ fontSize: 13, fontWeight: 700, color: '#1E3A5F', marginBottom: 8, paddingBottom: 4, borderBottom: '2px solid #1E3A5F' }}>5. 투자기록</div>
        <div className="no-print" style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: '#1E3A5F' }}>
              투자기록
            </h3>

            {/* 상태 필터 버튼 그룹 */}
            <div style={{ display: 'flex', gap: 4 }}>
              {([
                { value: 'all' as StatusFilter, label: '전체' },
                { value: 'ing' as StatusFilter, label: '운용중' },
                { value: 'exit' as StatusFilter, label: '종결' },
                { value: 'deposit' as StatusFilter, label: '적립' },
              ]).map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => setStatusFilter(value)}
                  style={{
                    padding: '4px 10px',
                    fontSize: 12,
                    fontWeight: statusFilter === value ? 600 : 400,
                    borderRadius: 6,
                    border: statusFilter === value ? '1.5px solid #1E3A5F' : '1px solid #E5E7EB',
                    backgroundColor: statusFilter === value ? '#1E3A5F' : '#fff',
                    color: statusFilter === value ? '#fff' : '#6B7280',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {label}
                </button>
              ))}

              {/* 계좌별명 필터 */}
              <select
                value={accountFilter}
                onChange={(e) => setAccountFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                style={{
                  padding: '4px 8px', fontSize: 12, borderRadius: 6,
                  border: '1px solid #E5E7EB', color: '#374151', cursor: 'pointer',
                  backgroundColor: accountFilter !== 'all' ? '#EFF6FF' : '#fff',
                }}
              >
                <option value="all">전체 계좌</option>
                {depositAccounts.filter(a => a.is_active).map(a => (
                  <option key={a.id} value={a.id}>
                    {a.nickname || `${a.securities_company} ${a.account_number || ''}`}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={startNewRecord}
              style={{
                display: 'flex', alignItems: 'center', gap: 4, padding: '7px 14px',
                fontSize: 13, fontWeight: 600, borderRadius: 7, border: 'none',
                backgroundColor: '#1E3A5F', color: '#fff', cursor: 'pointer',
              }}
            >
              + 투자기록 추가
            </button>
            <button
              onClick={() => setShowAddProductModal(true)}
              style={{
                display: 'flex', alignItems: 'center', gap: 4, padding: '7px 14px',
                fontSize: 13, fontWeight: 600, borderRadius: 7, border: '1px solid #1E3A5F',
                backgroundColor: '#fff', color: '#1E3A5F', cursor: 'pointer',
              }}
            >
              + 상품 추가
            </button>
          </div>
        </div>

        <div ref={recScrollRef} style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 520 }}>
          <table style={{ minWidth: 1300, borderCollapse: 'collapse', fontSize: 13, whiteSpace: 'nowrap' }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 2 }}>
              <tr style={{ backgroundColor: '#F9FAFB' }}>
                {[
                  { label: '#', align: 'left', sortKey: 'id' },
                  { label: '상품명', align: 'left', sortKey: 'product_name' },
                  { label: '계좌별명', align: 'left', sortKey: '' },
                  { label: '투자금액', align: 'right', sortKey: 'investment_amount' },
                  { label: '평가금액', align: 'right', sortKey: 'evaluation_amount' },
                  { label: '수익률', align: 'right', sortKey: 'return_rate' },
                  { label: '상태', align: 'left', sortKey: 'status' },
                  { label: '가입일', align: 'left', highlight: true, sortKey: 'join_date' },
                  { label: '예상만기일', align: 'left', highlight: true, sortKey: 'expected_maturity_date' },
                  { label: '실제만기일', align: 'left', highlight: true, sortKey: 'actual_maturity_date' },
                  { label: '원만기일', align: 'left', highlight: true, sortKey: '' },
                  { label: '메모', align: 'left', sortKey: '' },
                  { label: '액션', align: 'center', sortKey: '' },
                ].map(({ label, align, highlight, sortKey }) => (
                  <th
                    key={label}
                    onClick={sortKey ? () => toggleRecSort(sortKey) : undefined}
                    style={{
                      padding: '9px 12px',
                      textAlign: align as 'left' | 'right',
                      fontWeight: 600,
                      color: '#6B7280',
                      borderBottom: '1px solid #E5E7EB',
                      fontSize: 11,
                      whiteSpace: 'nowrap',
                      backgroundColor: highlight ? '#EEF2F7' : '#F9FAFB',
                      cursor: sortKey ? 'pointer' : undefined,
                      userSelect: sortKey ? 'none' : undefined,
                    }}
                  >
                    {label}{sortKey && recSortKey === sortKey ? (recSortDir === 'asc' ? ' ▲' : ' ▼') : sortKey ? ' ⇅' : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* 신규 투자기록 입력 행 */}
              {addingRecord && (
                <tr style={{ backgroundColor: '#FFFFF0', borderBottom: '1px solid #FDE68A' }}>
                  <td style={{ ...tdBase, color: '#9CA3AF' }}>-</td>
                  {/* 상품 */}
                  <td style={{ padding: '6px 8px', minWidth: 160 }}>
                    <select
                      value={recEditProduct}
                      onChange={e => setRecEditProduct(e.target.value ? Number(e.target.value) : '')}
                      style={inlineSelect}
                    >
                      <option value="">선택 안함</option>
                      {wrapAccounts.map(a => (
                        <option key={a.id} value={a.id}>{a.product_name} ({a.securities_company})</option>
                      ))}
                    </select>
                  </td>
                  {/* 계좌별명 */}
                  <td style={{ padding: '6px 8px', minWidth: 130 }}>
                    <select
                      value={recEditAccount}
                      onChange={e => setRecEditAccount(e.target.value ? Number(e.target.value) : '')}
                      style={inlineSelect}
                    >
                      <option value="">선택 안함</option>
                      {depositAccounts.filter(a => a.is_active).map(a => (
                        <option key={a.id} value={a.id}>
                          {a.nickname || `${a.securities_company} ${a.account_number || ''}`}
                        </option>
                      ))}
                    </select>
                  </td>
                  {/* 투자금액 */}
                  <td style={{ padding: '6px 8px', minWidth: 110 }}>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={recEditAmount}
                      onChange={e => setRecEditAmount(formatInputCurrency(e.target.value))}
                      placeholder="0"
                      style={{ ...inlineInput, textAlign: 'right' }}
                    />
                  </td>
                  {/* 평가금액 - 신규 시 비활성 */}
                  <td style={{ ...tdRight, color: '#D1D5DB', fontSize: 12 }}>-</td>
                  {/* 수익률 */}
                  <td style={{ ...tdRight, color: '#D1D5DB', fontSize: 12 }}>-</td>
                  {/* 상태 */}
                  <td style={{ ...tdBase, color: '#9CA3AF', fontSize: 12 }}>운용중</td>
                  {/* 가입일 */}
                  <td style={{ padding: '6px 8px', minWidth: 120 }}>
                    <input
                      type="date"
                      value={recEditJoinDate}
                      onChange={e => setRecEditJoinDate(e.target.value)}
                      style={inlineInput}
                    />
                  </td>
                  {/* 예상만기일 */}
                  <td style={{ padding: '6px 8px', minWidth: 120 }}>
                    <input
                      type="date"
                      value={recEditExpMaturity}
                      onChange={e => setRecEditExpMaturity(e.target.value)}
                      style={inlineInput}
                    />
                  </td>
                  {/* 실제만기일 - 신규 시 비활성 */}
                  <td style={{ ...tdBase, color: '#D1D5DB', fontSize: 12 }}>-</td>
                  {/* 원만기일 - 신규 시 비활성 */}
                  <td style={{ ...tdBase, color: '#D1D5DB', fontSize: 12 }}>-</td>
                  {/* 메모 */}
                  <td style={{ padding: '6px 8px', minWidth: 120 }}>
                    <input
                      type="text"
                      value={recEditMemo}
                      onChange={e => setRecEditMemo(e.target.value)}
                      placeholder="메모"
                      style={inlineInput}
                    />
                  </td>
                  {/* 액션 */}
                  <td style={{ padding: '6px 8px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                    <button
                      onClick={saveRecordNew}
                      disabled={recSaving || !recEditJoinDate || !recEditAmount}
                      style={{ ...inlineSaveBtn, marginRight: 3, opacity: (!recEditJoinDate || !recEditAmount || recSaving) ? 0.5 : 1 }}
                    >
                      {recSaving ? '...' : '저장'}
                    </button>
                    <button onClick={cancelRecordEdit} style={inlineCancelBtn}>취소</button>
                  </td>
                </tr>
              )}

              {recordsLoading ? (
                <tr>
                  <td colSpan={17} style={{ textAlign: 'center', padding: 24, color: '#9CA3AF', fontSize: 13 }}>
                    불러오는 중...
                  </td>
                </tr>
              ) : filteredRecords.length === 0 && !addingRecord ? (
                <tr>
                  <td colSpan={17} style={{ textAlign: 'center', padding: 24, color: '#9CA3AF', fontSize: 13 }}>
                    투자기록이 없습니다.
                  </td>
                </tr>
              ) : (
                filteredRecords.map((record, idx) => {
                  const isEditingThis = editingRecordId === record.id;
                  const isHighlighted = highlightedId === record.id;
                  const statusStyle = STATUS_STYLES[record.status] ?? STATUS_STYLES.ing;
                  const returnColor =
                    record.return_rate != null
                      ? record.return_rate > 0
                        ? '#16A34A'
                        : record.return_rate < 0
                        ? '#DC2626'
                        : '#374151'
                      : '#9CA3AF';

                  if (isEditingThis) {
                    return (
                      <tr
                        key={record.id}
                        ref={(el) => {
                          if (el) rowRefs.current.set(record.id, el);
                          else rowRefs.current.delete(record.id);
                        }}
                        style={{ backgroundColor: '#FFFFF0', borderBottom: '1px solid #FDE68A' }}
                      >
                        <td style={{ ...tdBase, color: '#9CA3AF' }}>{idx + 1}</td>
                        {/* 상품 */}
                        <td style={{ padding: '6px 8px', minWidth: 160 }}>
                          <select
                            value={recEditProduct}
                            onChange={e => setRecEditProduct(e.target.value ? Number(e.target.value) : '')}
                            style={inlineSelect}
                          >
                            <option value="">선택 안함</option>
                            {wrapAccounts.map(a => (
                              <option key={a.id} value={a.id}>{a.product_name} ({a.securities_company})</option>
                            ))}
                          </select>
                        </td>
                        {/* 계좌별명 */}
                        <td style={{ padding: '6px 8px', minWidth: 130 }}>
                          <select
                            value={recEditAccount}
                            onChange={e => setRecEditAccount(e.target.value ? Number(e.target.value) : '')}
                            style={inlineSelect}
                          >
                            <option value="">선택 안함</option>
                            {depositAccounts.filter(a => a.is_active).map(a => (
                              <option key={a.id} value={a.id}>
                                {a.nickname || `${a.securities_company} ${a.account_number || ''}`}
                              </option>
                            ))}
                          </select>
                        </td>
                        {/* 투자금액 */}
                        <td style={{ padding: '6px 8px', minWidth: 110 }}>
                          <input
                            type="text"
                            inputMode="numeric"
                            value={recEditAmount}
                            onChange={e => setRecEditAmount(formatInputCurrency(e.target.value))}
                            placeholder="0"
                            style={{ ...inlineInput, textAlign: 'right' }}
                          />
                        </td>
                        {/* 평가금액 */}
                        <td style={{ padding: '6px 8px', minWidth: 110 }}>
                          <input
                            type="text"
                            inputMode="numeric"
                            value={recEditEval}
                            onChange={e => setRecEditEval(formatInputCurrency(e.target.value))}
                            placeholder="종결 시 입력"
                            style={{ ...inlineInput, textAlign: 'right' }}
                          />
                        </td>
                        {/* 수익률 - 자동계산 표시 */}
                        <td style={{ ...tdRight, color: '#9CA3AF', fontSize: 12 }}>
                          {recEditEval && recEditAmount
                            ? (() => {
                                const inv = parseInt(recEditAmount, 10);
                                const ev = parseInt(recEditEval, 10);
                                if (inv > 0) {
                                  const rate = ((ev - inv) / inv * 100).toFixed(2);
                                  return <span style={{ color: parseFloat(rate) >= 0 ? '#16A34A' : '#DC2626' }}>{rate}%</span>;
                                }
                                return '-';
                              })()
                            : '-'}
                        </td>
                        {/* 상태 */}
                        <td style={{ ...tdBase, color: '#9CA3AF', fontSize: 12 }}>
                          {recEditActMaturity ? '종결' : STATUS_LABELS[record.status]}
                        </td>
                        {/* 가입일 */}
                        <td style={{ padding: '6px 8px', minWidth: 120 }}>
                          <input
                            type="date"
                            value={recEditJoinDate}
                            onChange={e => setRecEditJoinDate(e.target.value)}
                            style={inlineInput}
                          />
                        </td>
                        {/* 예상만기일 */}
                        <td style={{ padding: '6px 8px', minWidth: 120 }}>
                          <input
                            type="date"
                            value={recEditExpMaturity}
                            onChange={e => setRecEditExpMaturity(e.target.value)}
                            style={inlineInput}
                          />
                        </td>
                        {/* 실제만기일 */}
                        <td style={{ padding: '6px 8px', minWidth: 120 }}>
                          <input
                            type="date"
                            value={recEditActMaturity}
                            onChange={e => setRecEditActMaturity(e.target.value)}
                            style={inlineInput}
                          />
                        </td>
                        {/* 원만기일 */}
                        <td style={{ padding: '6px 8px', minWidth: 120 }}>
                          <input
                            type="date"
                            value={recEditOrigMaturity}
                            onChange={e => setRecEditOrigMaturity(e.target.value)}
                            style={inlineInput}
                          />
                        </td>
                        {/* 메모 */}
                        <td style={{ padding: '6px 8px', minWidth: 120 }}>
                          <input
                            type="text"
                            value={recEditMemo}
                            onChange={e => setRecEditMemo(e.target.value)}
                            placeholder="메모"
                            style={inlineInput}
                          />
                        </td>
                        {/* 액션 */}
                        <td style={{ padding: '6px 8px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                          <button
                            onClick={() => saveRecordEdit(record.id)}
                            disabled={recSaving}
                            style={{ ...inlineSaveBtn, marginRight: 3, opacity: recSaving ? 0.5 : 1 }}
                          >
                            {recSaving ? '...' : '저장'}
                          </button>
                          <button onClick={cancelRecordEdit} style={inlineCancelBtn}>취소</button>
                        </td>
                      </tr>
                    );
                  }

                  // 일반 표시 행
                  const predecessor = record.predecessor_id
                    ? records.find((r) => r.id === record.predecessor_id)
                    : null;
                  void predecessor; // suppress unused warning

                  return (
                    <tr
                      key={record.id}
                      ref={(el) => {
                        if (el) rowRefs.current.set(record.id, el);
                        else rowRefs.current.delete(record.id);
                      }}
                      style={{
                        borderBottom: '1px solid #F3F4F6',
                        backgroundColor: isHighlighted ? '#FEF9C3' : idx % 2 === 0 ? '#fff' : '#FAFAFA',
                        transition: 'background-color 0.4s ease',
                      }}
                    >
                      <td style={{ ...tdBase, color: '#9CA3AF', width: 36 }}>{idx + 1}</td>
                      <td style={tdBase}>{getProductName(record)}</td>
                      {/* 계좌별명 */}
                      <td style={tdBase}>
                        {(() => {
                          const acct = depositAccounts.find(a => a.id === record.deposit_account_id);
                          return acct ? (
                            <span style={{ color: '#1E3A5F', fontWeight: 500 }}>
                              {acct.nickname || `${acct.securities_company} ${acct.account_number || ''}`}
                            </span>
                          ) : <span style={{ color: '#D1D5DB' }}>-</span>;
                        })()}
                      </td>
                      <td style={{ ...tdRight }}>{formatCurrency(record.investment_amount)}</td>
                      <td style={{ ...tdRight }}>
                        {record.evaluation_amount != null ? formatCurrency(record.evaluation_amount) : '-'}
                      </td>
                      <td style={{ ...tdRight, color: returnColor, fontWeight: 600 }}>
                        {record.return_rate != null ? `${Number(record.return_rate).toFixed(2)}%` : '-'}
                      </td>

                      {/* 상태 배지 */}
                      <td style={tdBase}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            padding: '2px 8px',
                            borderRadius: 12,
                            fontSize: 11,
                            fontWeight: 600,
                            backgroundColor: statusStyle.bg,
                            color: statusStyle.text,
                            whiteSpace: 'nowrap',
                          }}>
                            <span style={{
                              width: 6,
                              height: 6,
                              borderRadius: '50%',
                              backgroundColor: statusStyle.dot,
                              flexShrink: 0,
                            }} />
                            {STATUS_LABELS[record.status]}
                          </span>

                          {/* ing → exit 전환 버튼 */}
                          {record.status === 'ing' && (<>
                            <button
                              onClick={() => setStatusChangeRecord({ ...record, product_name: getProductName(record) })}
                              title="종결 처리"
                              style={{ padding: '2px 6px', fontSize: 10, borderRadius: 4, border: '1px solid #E5E7EB', backgroundColor: '#fff', color: '#6B7280', cursor: 'pointer' }}
                            >종결</button>
                            <button
                              onClick={() => { setInterimRecord(record); setInterimYear(String(new Date().getFullYear())); setInterimAmount(''); }}
                              title="중간평가 입력"
                              style={{ padding: '2px 6px', fontSize: 10, borderRadius: 4, border: '1px solid #F59E0B', backgroundColor: '#FFFBEB', color: '#B45309', cursor: 'pointer' }}
                            >중간</button>
                          </>)}
                          {/* 중간평가 뱃지 */}
                          {record.interim_evaluations && Object.keys(record.interim_evaluations).length > 0 && (
                            <span
                              title={`중간평가: ${Object.entries(record.interim_evaluations).map(([y, v]) => `${y}년 ${(v as number).toLocaleString()}원`).join(', ')}`}
                              style={{ fontSize: 9, padding: '1px 4px', borderRadius: 3, backgroundColor: '#FEF3C7', color: '#92400E', fontWeight: 600 }}
                            >평가 {Object.keys(record.interim_evaluations).length}건</span>
                          )}
                        </div>
                      </td>

                      {/* 가입일 (start_date를 fallback으로 사용) */}
                      <td style={{ ...tdBase, backgroundColor: idx % 2 === 0 ? '#F8F9FC' : '#F2F4F9', color: '#6B7280' }}>
                        {record.join_date || record.start_date || '-'}
                      </td>
                      <td style={{ ...tdBase, backgroundColor: idx % 2 === 0 ? '#F8F9FC' : '#F2F4F9', color: '#6B7280' }}>
                        {record.expected_maturity_date ?? '-'}
                      </td>
                      <td style={{ ...tdBase, backgroundColor: idx % 2 === 0 ? '#F8F9FC' : '#F2F4F9', color: '#6B7280' }}>
                        {record.actual_maturity_date ?? '-'}
                      </td>
                      <td style={{ ...tdBase, backgroundColor: idx % 2 === 0 ? '#F8F9FC' : '#F2F4F9', color: '#6B7280' }}>
                        {record.original_maturity_date ?? '-'}
                      </td>
                      <td style={{ ...tdBase, color: '#6B7280', maxWidth: 180, fontSize: 11, lineHeight: '1.4', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const, wordBreak: 'break-word' }} title={record.memo || ''}>
                        {record.memo || '-'}
                      </td>

                      {/* 액션 */}
                      <td style={{ ...tdBase, textAlign: 'center', whiteSpace: 'nowrap' }}>
                        <button
                          onClick={() => startEditRecord(record)}
                          style={{ padding: '3px 8px', fontSize: 11, fontWeight: 500, borderRadius: 4, border: '1px solid #D1D5DB', backgroundColor: '#fff', color: '#374151', cursor: 'pointer', marginRight: 4 }}
                        >
                          수정
                        </button>
                        <button
                          onClick={async () => {
                            if (!confirm('이 투자기록을 삭제하시겠습니까?')) return;
                            try {
                              await fetch(`${API_URL}/api/v1/retirement/investment-records/${record.id}`, {
                                method: 'DELETE', headers: authLib.getAuthHeader(),
                              });
                              fetchRecords();
                              fetchDepositAccounts();
                              expandedAccountIds.forEach(aid => fetchTransactions(aid));
                            } catch { /* silent */ }
                          }}
                          style={{ padding: '3px 8px', fontSize: 11, fontWeight: 500, borderRadius: 4, border: '1px solid #FECACA', backgroundColor: '#FEF2F2', color: '#EF4444', cursor: 'pointer' }}
                        >
                          삭제
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ===== 중간평가 모달 ===== */}
      {interimRecord && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ backgroundColor: '#fff', borderRadius: 12, padding: 24, width: 400, boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700 }}>중간평가 입력</h3>
              <button onClick={() => setInterimRecord(null)} style={{ border: 'none', background: 'none', fontSize: 18, cursor: 'pointer' }}>×</button>
            </div>
            {/* 상품 정보 */}
            <div style={{ backgroundColor: '#F9FAFB', borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 13 }}>
              <div><span style={{ color: '#6B7280' }}>상품명:</span> <strong>{getProductName(interimRecord)}</strong></div>
              <div><span style={{ color: '#6B7280' }}>가입일:</span> {interimRecord.join_date || interimRecord.start_date}</div>
              <div><span style={{ color: '#6B7280' }}>투자금액:</span> {interimRecord.investment_amount.toLocaleString()}원</div>
            </div>
            {/* 기존 중간평가 목록 */}
            {interimRecord.interim_evaluations && Object.keys(interimRecord.interim_evaluations).length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#6B7280', marginBottom: 6 }}>기존 중간평가</div>
                {Object.entries(interimRecord.interim_evaluations).sort(([a], [b]) => Number(a) - Number(b)).map(([y, v]) => (
                  <div key={y} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 8px', fontSize: 12, backgroundColor: '#FFFBEB', borderRadius: 4, marginBottom: 2 }}>
                    <span>{y}년: <strong>{(v as number).toLocaleString()}원</strong></span>
                    <button onClick={() => { deleteInterimEval(interimRecord, y); setInterimRecord({ ...interimRecord, interim_evaluations: (() => { const u = { ...interimRecord.interim_evaluations }; delete u[y]; return u; })() }); }} style={{ border: 'none', background: 'none', color: '#EF4444', cursor: 'pointer', fontSize: 11 }}>삭제</button>
                  </div>
                ))}
              </div>
            )}
            {/* 신규 입력 */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>연도</label>
                <input type="number" value={interimYear} onChange={e => setInterimYear(e.target.value)} style={{ width: '100%', padding: '8px 10px', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 13 }} />
              </div>
              <div style={{ flex: 2 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>평가금액 (원)</label>
                <input type="text" value={interimAmount ? Number(interimAmount).toLocaleString() : ''} onChange={e => setInterimAmount(e.target.value.replace(/[^\d]/g, ''))} placeholder="예: 150,000,000" style={{ width: '100%', padding: '8px 10px', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 13 }} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setInterimRecord(null)} style={{ padding: '8px 16px', fontSize: 13, borderRadius: 6, border: '1px solid #D1D5DB', backgroundColor: '#fff', cursor: 'pointer' }}>취소</button>
              <button onClick={saveInterimEval} disabled={interimSaving || !interimYear || !interimAmount} style={{ padding: '8px 16px', fontSize: 13, fontWeight: 600, borderRadius: 6, border: 'none', backgroundColor: '#F59E0B', color: '#fff', cursor: 'pointer', opacity: interimSaving ? 0.6 : 1 }}>{interimSaving ? '저장 중...' : '저장'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ===== 모달들 ===== */}
      {statusChangeRecord && (
        <StatusChangeModal
          record={statusChangeRecord}
          onClose={() => setStatusChangeRecord(null)}
          onSave={handleStatusChangeSave}
        />
      )}

      {showAddDepositAccountModal && (
        <AddDepositAccountModal
          customerId={selectedCustomerId}
          onClose={() => setShowAddDepositAccountModal(false)}
          onSaved={() => {
            fetchDepositAccounts();
          }}
        />
      )}

      {/* 상품 추가 모달 */}
      {showAddProductModal && (
        <AddWrapProductModal
          onClose={() => setShowAddProductModal(false)}
          onSaved={() => { fetchWrapAccounts(); setShowAddProductModal(false); }}
        />
      )}

      {editingAccount && (
        <EditDepositAccountModal
          account={editingAccount}
          onClose={() => setEditingAccount(null)}
          onSaved={() => { fetchDepositAccounts(); setEditingAccount(null); }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Wrap 상품 추가 모달                                                  */
/* ------------------------------------------------------------------ */

const NOTION_PRODUCT_KEY = 'notion_product_config';
function saveNotionProductConfig(dbId: string, dbTitle: string, mapping: Record<string, string>) {
  try { localStorage.setItem(NOTION_PRODUCT_KEY, JSON.stringify({ dbId, dbTitle, mapping })); } catch { /* ignore */ }
}
function loadNotionProductConfig(): { dbId: string; dbTitle: string; mapping: Record<string, string> } | null {
  try { const r = localStorage.getItem(NOTION_PRODUCT_KEY); return r ? JSON.parse(r) : null; } catch { return null; }
}
function clearNotionProductConfig() {
  try { localStorage.removeItem(NOTION_PRODUCT_KEY); } catch { /* ignore */ }
}

function AddWrapProductModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [productName, setProductName] = useState('');
  const [company, setCompany] = useState('');
  const [investmentTarget, setInvestmentTarget] = useState('');
  const [targetReturn, setTargetReturn] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Notion — 마운트 시 저장된 설정 자동 로드
  const [nStep, setNStep] = useState<'idle' | 'selectDb' | 'mapping'>('idle');
  const [nAutoLoaded, setNAutoLoaded] = useState(false);
  const [nDbs, setNDbs] = useState<{ id: string; title: string; icon: string | null }[]>([]);
  const [nRows, setNRows] = useState<{ id: string; properties: Record<string, string> }[]>([]);
  const [nCols, setNCols] = useState<string[]>([]);
  const [nMap, setNMap] = useState<Record<string, string>>({ product_name: '', company: '', target: '', return_rate: '', desc: '' });
  const [nLoading, setNLoading] = useState(false);
  const [nError, setNError] = useState<string | null>(null);
  const [nDbSearch, setNDbSearch] = useState('');
  const [nRowSearch, setNRowSearch] = useState('');
  const [nSelectedDbId, setNSelectedDbId] = useState('');
  const [nSelectedDbTitle, setNSelectedDbTitle] = useState('');

  async function fetchDbList() {
    setNLoading(true); setNError(null);
    try {
      const res = await fetch(`${API_URL}/api/v1/notion/databases`, { headers: authLib.getAuthHeader() });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d?.detail ?? '조회 실패'); }
      setNDbs(await res.json()); setNStep('selectDb');
    } catch (e: unknown) { setNError(e instanceof Error ? e.message : '오류'); }
    finally { setNLoading(false); }
  }

  async function loadDbs() {
    const saved = loadNotionProductConfig();
    if (saved) {
      setNSelectedDbId(saved.dbId);
      setNSelectedDbTitle(saved.dbTitle);
      setNMap(saved.mapping);
      await loadRows(saved.dbId, saved.mapping);
      return;
    }
    await fetchDbList();
  }

  async function loadRows(dbId: string, savedMapping?: Record<string, string>) {
    setNLoading(true); setNError(null);
    setNSelectedDbId(dbId);
    try {
      const [pR, rR] = await Promise.all([
        fetch(`${API_URL}/api/v1/notion/databases/${dbId}/properties`, { headers: authLib.getAuthHeader() }),
        fetch(`${API_URL}/api/v1/notion/databases/${dbId}/rows`, { headers: authLib.getAuthHeader() }),
      ]);
      if (!pR.ok || !rR.ok) throw new Error('데이터 조회 실패');
      const props: { name: string }[] = await pR.json();
      const rows: { id: string; properties: Record<string, string> }[] = await rR.json();
      const cols = props.map(p => p.name);
      setNCols(cols); setNRows(rows);
      let finalMap: Record<string, string>;
      if (savedMapping) {
        finalMap = savedMapping;
      } else {
        const m: Record<string, string> = { product_name: '', company: '', target: '', return_rate: '', desc: '' };
        for (const c of cols) {
          const l = c.toLowerCase();
          if (!m.product_name && (l.includes('상품') || l.includes('product') || l.includes('이름') || l.includes('name'))) m.product_name = c;
          if (!m.company && (l.includes('기관') || l.includes('증권') || l.includes('company') || l.includes('거래'))) m.company = c;
          if (!m.target && (l.includes('자산구분') || l.includes('target') || l.includes('대상'))) m.target = c;
          if (!m.return_rate && (l.includes('수익률') || l.includes('return') || l.includes('목표'))) m.return_rate = c;
          if (!m.desc && (l.includes('설명') || l.includes('desc') || l.includes('메모') || l.includes('비고'))) m.desc = c;
        }
        finalMap = m;
      }
      setNMap(finalMap); setNStep('mapping');
    } catch (e: unknown) { setNError(e instanceof Error ? e.message : '오류'); }
    finally { setNLoading(false); }
  }

  // 모달 마운트 시 저장된 설정 복원 (데이터 로드는 버튼 클릭 시)
  useEffect(() => {
    if (nAutoLoaded) return;
    setNAutoLoaded(true);
    const saved = loadNotionProductConfig();
    if (saved) {
      setNSelectedDbId(saved.dbId);
      setNSelectedDbTitle(saved.dbTitle);
      setNMap(saved.mapping);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyRow(row: { properties: Record<string, string> }) {
    if (nMap.product_name && row.properties[nMap.product_name]) setProductName(row.properties[nMap.product_name]);
    if (nMap.company && row.properties[nMap.company]) setCompany(row.properties[nMap.company]);
    if (nMap.target && row.properties[nMap.target]) setInvestmentTarget(row.properties[nMap.target]);
    if (nMap.return_rate && row.properties[nMap.return_rate]) setTargetReturn(row.properties[nMap.return_rate]);
    if (nMap.desc && row.properties[nMap.desc]) setDescription(row.properties[nMap.desc]);
    saveNotionProductConfig(nSelectedDbId, nSelectedDbTitle, nMap);
    // mapping 상태 유지 (목록에서 다른 상품도 바로 선택 가능)
    setNRowSearch('');
  }

  function resetN() { setNStep('idle'); setNDbs([]); setNRows([]); setNCols([]); setNError(null); setNDbSearch(''); setNRowSearch(''); clearNotionProductConfig(); }

  const handleSave = async () => {
    if (!productName.trim()) { setError('상품명을 입력해주세요.'); return; }
    if (!company.trim()) { setError('거래기관을 입력해주세요.'); return; }
    setSaving(true); setError('');
    try {
      const res = await fetch(`${API_URL}/api/v1/retirement/wrap-accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
        body: JSON.stringify({
          product_name: productName.trim(),
          securities_company: company.trim(),
          investment_target: investmentTarget.trim() || null,
          target_return_rate: targetReturn ? parseFloat(targetReturn) : null,
          description: description.trim() || null,
        }),
      });
      if (!res.ok) throw new Error();
      onSaved();
    } catch { setError('등록에 실패했습니다.'); }
    finally { setSaving(false); }
  };

  const mS: React.CSSProperties = { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 };
  const cS: React.CSSProperties = { backgroundColor: '#fff', borderRadius: 12, padding: 28, width: 480, boxShadow: '0 8px 24px rgba(0,0,0,0.15)' };
  const iS: React.CSSProperties = { width: '100%', padding: '10px 12px', fontSize: 14, border: '1px solid #D1D5DB', borderRadius: 8, outline: 'none', boxSizing: 'border-box' };
  const lS: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 };

  return (
    <div style={mS} onClick={onClose}>
      <div style={cS} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 20px', fontSize: '1.1rem', fontWeight: 700, color: '#1E3A5F' }}>Wrap 은퇴 상품 등록</h3>

        {/* Notion 가져오기 */}
        <div style={{ marginBottom: 14 }}>
          {nStep === 'idle' && (
            <button onClick={loadDbs} disabled={nLoading}
              style={{ width: '100%', padding: '9px', borderRadius: 8, border: '1px dashed #D1D5DB', background: '#FAFBFC', color: '#374151', fontSize: 13, fontWeight: 500, cursor: nLoading ? 'wait' : 'pointer', opacity: nLoading ? 0.6 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              {nLoading ? <><span className="notion-spinner" style={{ marginRight: 6 }} />Notion 연결 중...</> : nSelectedDbId ? <>📝 Notion 불러오기 ({nSelectedDbTitle})</> : <>📝 Notion에서 가져오기</>}
            </button>
          )}
          {nError && (
            <div style={{ marginTop: 6, padding: '6px 10px', borderRadius: 6, background: '#FEF2F2', border: '1px solid #FECACA', fontSize: 12, color: '#DC2626' }}>
              {nError} <button onClick={resetN} style={{ marginLeft: 6, background: 'none', border: 'none', color: '#DC2626', textDecoration: 'underline', cursor: 'pointer', fontSize: 12 }}>닫기</button>
            </div>
          )}
          {nStep === 'selectDb' && (
            <div style={{ border: '1px solid #E5E7EB', borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ padding: '7px 10px', background: '#F0F4FA', fontSize: 12, fontWeight: 600, color: '#1E3A5F', display: 'flex', justifyContent: 'space-between' }}>
                <span>데이터베이스 선택</span><button onClick={resetN} style={{ background: 'none', border: 'none', color: '#9CA3AF', cursor: 'pointer', fontSize: 12 }}>취소</button>
              </div>
              <div style={{ padding: '6px 8px', borderBottom: '1px solid #E5E7EB' }}>
                <input type="text" placeholder="검색..." value={nDbSearch} onChange={e => setNDbSearch(e.target.value)} style={{ width: '100%', padding: '5px 8px', borderRadius: 6, border: '1px solid #D1D5DB', fontSize: 12 }} />
              </div>
              {nLoading ? (
                <div style={{ padding: 20, textAlign: 'center', color: '#6B7280', fontSize: 13 }}>불러오는 중...</div>
              ) : (
                <div style={{ maxHeight: 180, overflowY: 'auto' }}>
                  {nDbs.filter(d => !nDbSearch || d.title.toLowerCase().includes(nDbSearch.toLowerCase())).map(d => (
                    <button key={d.id} onClick={() => { setNDbSearch(''); setNSelectedDbTitle(d.title); loadRows(d.id); }}
                      style={{ width: '100%', padding: '9px 10px', border: 'none', borderBottom: '1px solid #F3F4F6', background: '#fff', textAlign: 'left', cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}
                      onMouseOver={e => (e.currentTarget.style.background = '#F9FAFB')} onMouseOut={e => (e.currentTarget.style.background = '#fff')}>
                      <span>{d.icon ?? '📄'}</span><span style={{ fontWeight: 500 }}>{d.title}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {nStep === 'mapping' && (
            <div style={{ border: '1px solid #E5E7EB', borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ padding: '7px 10px', background: '#F0F4FA', fontSize: 12, fontWeight: 600, color: '#1E3A5F', display: 'flex', justifyContent: 'space-between' }}>
                <span>필드 매핑 → 상품 선택{nSelectedDbTitle ? ` (${nSelectedDbTitle})` : ''}</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => { clearNotionProductConfig(); setNRows([]); setNCols([]); setNRowSearch(''); fetchDbList(); }} style={{ background: 'none', border: 'none', color: '#3B82F6', cursor: 'pointer', fontSize: 11 }}>DB 변경</button>
                  <button onClick={resetN} style={{ background: 'none', border: 'none', color: '#9CA3AF', cursor: 'pointer', fontSize: 12 }}>취소</button>
                </div>
              </div>
              {nLoading ? (
                <div style={{ padding: 20, textAlign: 'center', color: '#6B7280', fontSize: 13 }}>데이터 불러오는 중...</div>
              ) : (<>
                <div style={{ padding: '8px 10px', background: '#FAFBFC', borderBottom: '1px solid #E5E7EB' }}>
                  <div style={{ fontSize: 11, color: '#6B7280', marginBottom: 4 }}>Notion → 상품 필드 매핑</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
                    {[{ k: 'product_name', l: '상품명 *' }, { k: 'company', l: '거래기관' }, { k: 'target', l: '자산구분' }, { k: 'return_rate', l: '수익률' }, { k: 'desc', l: '설명' }].map(f => (
                      <div key={f.k} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                        <span style={{ width: 58, color: '#374151', fontWeight: 500, flexShrink: 0 }}>{f.l}</span>
                        <select value={nMap[f.k] ?? ''} onChange={e => {
                            const updated = { ...nMap, [f.k]: e.target.value };
                            setNMap(updated);
                            if (nSelectedDbId) saveNotionProductConfig(nSelectedDbId, nSelectedDbTitle, updated);
                          }}
                          style={{ flex: 1, padding: '3px 5px', borderRadius: 4, border: '1px solid #D1D5DB', fontSize: 11, background: nMap[f.k] ? '#ECFDF5' : '#fff' }}>
                          <option value="">--</option>{nCols.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
                <div style={{ padding: '6px 8px', borderBottom: '1px solid #E5E7EB' }}>
                  <input type="text" placeholder="상품 검색..." value={nRowSearch} onChange={e => setNRowSearch(e.target.value)} style={{ width: '100%', padding: '5px 8px', borderRadius: 6, border: '1px solid #D1D5DB', fontSize: 12 }} />
                </div>
                <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                  {(() => {
                    const q = nRowSearch.toLowerCase().trim();
                    const f = q ? nRows.filter(r => Object.values(r.properties).some(v => v?.toLowerCase().includes(q))) : nRows;
                    if (!f.length) return <div style={{ padding: 14, textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>{q ? '검색 결과 없음' : '데이터 없음'}</div>;
                    return f.map(r => {
                      const dn = nMap.product_name ? (r.properties[nMap.product_name] ?? '-') : Object.values(r.properties)[0] ?? '-';
                      const dc = nMap.company ? (r.properties[nMap.company] ?? '') : '';
                      return (
                        <button key={r.id} onClick={() => applyRow(r)}
                          style={{ width: '100%', padding: '8px 10px', border: 'none', borderBottom: '1px solid #F3F4F6', background: '#fff', textAlign: 'left', cursor: 'pointer', fontSize: 12, display: 'flex', gap: 10 }}
                          onMouseOver={e => (e.currentTarget.style.background = '#F0FFF4')} onMouseOut={e => (e.currentTarget.style.background = '#fff')}>
                          <span style={{ fontWeight: 600, color: '#111827' }}>{dn}</span>
                          {dc && <span style={{ color: '#6B7280', fontSize: 11 }}>{dc}</span>}
                        </button>
                      );
                    });
                  })()}
                </div>
                <div style={{ padding: '5px 8px', background: '#F9FAFB', borderTop: '1px solid #E5E7EB', fontSize: 10, color: '#9CA3AF' }}>총 {nRows.length}건 · 클릭하면 폼에 자동 입력</div>
              </>)}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={lS}>상품명 <span style={{ color: '#EF4444' }}>*</span></label>
            <input style={iS} value={productName} onChange={e => setProductName(e.target.value)} placeholder="예: (올원)예드목표전환형30호" />
          </div>
          <div>
            <label style={lS}>거래기관 <span style={{ color: '#EF4444' }}>*</span></label>
            <input style={iS} value={company} onChange={e => setCompany(e.target.value)} placeholder="예: NH투자증권" />
          </div>
          <div>
            <label style={lS}>자산구분</label>
            <input style={iS} value={investmentTarget} onChange={e => setInvestmentTarget(e.target.value)} placeholder="예: 랩어카운트" />
          </div>
          <div>
            <label style={lS}>목표수익률 (%)</label>
            <input style={iS} type="text" value={targetReturn} onChange={e => setTargetReturn(e.target.value.replace(/[^\d.]/g, ''))} placeholder="예: 6.0" />
          </div>
          <div>
            <label style={lS}>설명</label>
            <textarea style={{ ...iS, minHeight: 50, resize: 'vertical' }} value={description} onChange={e => setDescription(e.target.value)} placeholder="상품 설명 (선택)" />
          </div>
        </div>
        {error && <p style={{ color: '#EF4444', fontSize: 13, marginTop: 8 }}>{error}</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
          <button onClick={onClose} style={{ padding: '8px 18px', fontSize: 14, color: '#6B7280', backgroundColor: '#F3F4F6', border: '1px solid #E1E5EB', borderRadius: 8, cursor: 'pointer' }}>취소</button>
          <button onClick={handleSave} disabled={saving} style={{ padding: '8px 18px', fontSize: 14, fontWeight: 600, color: '#fff', backgroundColor: saving ? '#9CA3AF' : '#1E3A5F', border: 'none', borderRadius: 8, cursor: saving ? 'not-allowed' : 'pointer' }}>
            {saving ? '등록 중...' : '등록'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  예수금 계좌 수정 모달                                                */
/* ------------------------------------------------------------------ */

function EditDepositAccountModal({ account, onClose, onSaved }: {
  account: DepositAccount; onClose: () => void; onSaved: () => void;
}) {
  const [company, setCompany] = useState(account.securities_company);
  const [number, setNumber] = useState(account.account_number || '');
  const [nick, setNick] = useState(account.nickname || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    if (!company.trim()) { setError('거래기관을 입력해주세요.'); return; }
    setSaving(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/retirement/deposit-accounts/${account.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
        body: JSON.stringify({
          securities_company: company.trim(),
          account_number: number.trim() || null,
          nickname: nick.trim() || null,
        }),
      });
      if (!res.ok) throw new Error();
      onSaved();
    } catch {
      setError('수정에 실패했습니다.');
    } finally { setSaving(false); }
  };

  const mStyle: React.CSSProperties = { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 };
  const cStyle: React.CSSProperties = { backgroundColor: '#fff', borderRadius: 12, padding: 28, width: 440, boxShadow: '0 8px 24px rgba(0,0,0,0.15)' };
  const iStyle: React.CSSProperties = { width: '100%', padding: '10px 12px', fontSize: 14, border: '1px solid #D1D5DB', borderRadius: 8, outline: 'none', boxSizing: 'border-box' };
  const lStyle: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 };

  return (
    <div style={mStyle} onClick={onClose}>
      <div style={cStyle} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 20px', fontSize: '1.1rem', fontWeight: 700, color: '#1E3A5F' }}>예수금 계좌 수정</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={lStyle}>거래기관 <span style={{ color: '#EF4444' }}>*</span></label>
            <input style={iStyle} value={company} onChange={e => setCompany(e.target.value)} />
          </div>
          <div>
            <label style={lStyle}>계좌번호</label>
            <input style={iStyle} value={number} onChange={e => setNumber(e.target.value)} placeholder="예: 123-456-789" />
          </div>
          <div>
            <label style={lStyle}>별명</label>
            <input style={iStyle} value={nick} onChange={e => setNick(e.target.value)} placeholder="예: 메인계좌" />
          </div>
        </div>
        {error && <p style={{ color: '#EF4444', fontSize: 13, marginTop: 8 }}>{error}</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
          <button onClick={onClose} style={{ padding: '8px 18px', fontSize: 14, color: '#6B7280', backgroundColor: '#F3F4F6', border: '1px solid #E1E5EB', borderRadius: 8, cursor: 'pointer' }}>취소</button>
          <button onClick={handleSave} disabled={saving} style={{ padding: '8px 18px', fontSize: 14, fontWeight: 600, color: '#fff', backgroundColor: saving ? '#9CA3AF' : '#1E3A5F', border: 'none', borderRadius: 8, cursor: saving ? 'not-allowed' : 'pointer' }}>
            {saving ? '수정 중...' : '수정'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  공통 스타일 상수                                                     */
/* ------------------------------------------------------------------ */

const tdBase: React.CSSProperties = {
  padding: '9px 12px',
  verticalAlign: 'middle',
  color: '#1A1A2E',
  fontSize: 13,
};

const tdCenter: React.CSSProperties = {
  ...tdBase,
  textAlign: 'center',
};

const tdRight: React.CSSProperties = {
  ...tdBase,
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 600,
  color: '#374151',
  marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  border: '1px solid #D1D5DB',
  borderRadius: 7,
  fontSize: 13,
  color: '#1A1A2E',
  outline: 'none',
  boxSizing: 'border-box',
  backgroundColor: '#fff',
};

const selectStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  border: '1px solid #D1D5DB',
  borderRadius: 7,
  fontSize: 13,
  color: '#1A1A2E',
  outline: 'none',
  boxSizing: 'border-box',
  backgroundColor: '#fff',
  cursor: 'pointer',
};

const cancelBtnStyle: React.CSSProperties = {
  padding: '8px 16px',
  fontSize: 13,
  fontWeight: 500,
  borderRadius: 7,
  border: '1px solid #E5E7EB',
  backgroundColor: '#fff',
  color: '#6B7280',
  cursor: 'pointer',
};

const saveBtnStyle: React.CSSProperties = {
  padding: '8px 16px',
  fontSize: 13,
  fontWeight: 600,
  borderRadius: 7,
  border: 'none',
  backgroundColor: '#1E3A5F',
  color: '#fff',
  cursor: 'pointer',
};

/* ---- 예수금 거래내역 테이블 스타일 ---- */
const txTdBase: React.CSSProperties = {
  padding: '8px 12px',
  verticalAlign: 'middle',
  color: '#1A1A2E',
  fontSize: 13,
};

const txTdCenter: React.CSSProperties = {
  ...txTdBase,
  textAlign: 'center',
};

const txTdRight: React.CSSProperties = {
  ...txTdBase,
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
};
