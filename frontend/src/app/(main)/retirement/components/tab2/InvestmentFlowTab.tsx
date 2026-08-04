'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
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
  savings_amount: number;
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
  deposit: '#3B82F6',
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
  ing: { bg: 'rgba(59,130,246,0.13)', text: '#60A5FA', dot: '#3B82F6' },
  exit: { bg: 'rgba(16,185,129,0.12)', text: '#34D399', dot: '#22C55E' },
  deposit: { bg: 'rgba(245,158,11,0.12)', text: '#FCD34D', dot: '#F59E0B' },
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
  border: '1.5px solid var(--blue-400)',
  borderRadius: 5,
  padding: '0 6px',
  outline: 'none',
  boxSizing: 'border-box',
  backgroundColor: 'var(--bg-card)',
  width: '100%',
};

const inlineSelect: React.CSSProperties = {
  height: 30,
  fontSize: 12,
  border: '1.5px solid var(--blue-400)',
  borderRadius: 5,
  padding: '0 4px',
  outline: 'none',
  boxSizing: 'border-box',
  backgroundColor: 'var(--bg-card)',
  width: '100%',
  cursor: 'pointer',
};

const inlineSaveBtn: React.CSSProperties = {
  padding: '3px 8px',
  fontSize: 11,
  fontWeight: 600,
  borderRadius: 4,
  border: 'none',
  backgroundColor: 'var(--blue-600)',
  color: '#fff',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const inlineCancelBtn: React.CSSProperties = {
  padding: '3px 8px',
  fontSize: 11,
  fontWeight: 500,
  borderRadius: 4,
  border: '1px solid var(--border-strong)',
  backgroundColor: 'var(--bg-card)',
  color: 'var(--text-muted)',
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
        <div style={{ padding: '12px 14px', backgroundColor: 'var(--bg-surface)', borderRadius: 8, fontSize: 13, color: 'var(--text-secondary)' }}>
          <div style={{ marginBottom: 8 }}><strong>{record.product_name || '(상품명)'}</strong> 를 종결 처리합니다.</div>
          <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--text-muted)' }}>
            <span>투자금액: <strong style={{ color: 'var(--text-primary)' }}>{record.investment_amount?.toLocaleString() ?? '-'}원</strong></span>
            <span>가입일: <strong style={{ color: 'var(--text-primary)' }}>{record.start_date || record.join_date || '-'}</strong></span>
          </div>
        </div>

        <div>
          <label style={labelStyle}>종료일 <span style={{ color: 'var(--danger)' }}>*</span></label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            style={inputStyle}
          />
        </div>

        <div>
          <label style={labelStyle}>평가금액 (만원) <span style={{ color: 'var(--danger)' }}>*</span></label>
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
            backgroundColor: parseFloat(returnRate) >= 0 ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)',
            borderRadius: 8,
            fontSize: 13,
            color: parseFloat(returnRate) >= 0 ? '#34D399' : '#F87171',
          }}>
            수익률: {returnRate}%
          </div>
        )}

        {error && <p style={{ color: 'var(--danger)', fontSize: 13, margin: 0 }}>{error}</p>}

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
          <label style={labelStyle}>증권사 <span style={{ color: 'var(--danger)' }}>*</span></label>
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
        {error && <p style={{ color: 'var(--danger)', fontSize: 13, margin: 0 }}>{error}</p>}
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
  const [showFlowHelp, setShowFlowHelp] = useState(false);   // 연간투자흐름표 계산식 도움말
  const [evalDetailYear, setEvalDetailYear] = useState<number | null>(null);

  // 투자기록 상태
  const [records, setRecords] = useState<InvestmentRecord[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [selectedRecordIds, setSelectedRecordIds] = useState<Set<number>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [notionSyncing, setNotionSyncing] = useState(false);
  /* ---- Notion 동기화 미리보기: 무엇이 추가/업데이트되는지 보고 선택 후 적용 ---- */
  const [irSyncPlan, setIrSyncPlan] = useState<SyncPlanItem[] | null>(null);
  const [irSyncChecked, setIrSyncChecked] = useState<Set<string>>(new Set());
  const [irSyncApplying, setIrSyncApplying] = useState(false);
  const [dtxSyncPlan, setDtxSyncPlan] = useState<SyncPlanItem[] | null>(null);
  const [dtxSyncChecked, setDtxSyncChecked] = useState<Set<string>>(new Set());
  const [dtxSyncApplying, setDtxSyncApplying] = useState(false);
  const [dtxSyncAcctId, setDtxSyncAcctId] = useState<number | null>(null);
  const [dtxSyncSkipped, setDtxSyncSkipped] = useState(0);
  const [dtxSyncAcctNumber, setDtxSyncAcctNumber] = useState<string | null>(null);  // Notion 증권번호 → 계좌 정보
  const [bulkAccountId, setBulkAccountId] = useState<string>('');  // '' 미선택 · 'none' 해제 · 그 외 계좌id
  const [bulkAssigning, setBulkAssigning] = useState(false);
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
  const [showNotionImportModal, setShowNotionImportModal] = useState(false);
  const [showDepositNotionModal, setShowDepositNotionModal] = useState(false);
  const [depositNotionSyncing, setDepositNotionSyncing] = useState(false);

  /* ---- 예수금 거래 인라인 편집 상태 ---- */
  const [newTxAccountId, setNewTxAccountId] = useState<number | null>(null);
  const [editingTxId, setEditingTxId] = useState<number | null>(null);
  const [txEditDate, setTxEditDate] = useState('');
  const [txEditType, setTxEditType] = useState<TransactionType>('deposit');
  const [txEditCredit, setTxEditCredit] = useState('');
  const [txEditSavings, setTxEditSavings] = useState('');
  const [txEditDebit, setTxEditDebit] = useState('');
  const [txEditMemo, setTxEditMemo] = useState('');
  const [txEditProduct, setTxEditProduct] = useState('');
  const [txSaving, setTxSaving] = useState(false);

  /* ---- 투자기록 인라인 편집 상태 ---- */
  const [addingRecord, setAddingRecord] = useState(false);
  const [editingRecordId, setEditingRecordId] = useState<number | null>(null);
  const [recEditProduct, setRecEditProduct] = useState<number | ''>('');
  const [recEditProductName, setRecEditProductName] = useState('');
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

  /* ---- API: 예수금 거래내역 (state 갱신 + 데이터 반환 — PDF 등 즉시 사용처를 위해) ---- */
  const fetchTransactions = useCallback(async (accountId: number): Promise<DepositTransaction[]> => {
    setTransactionsLoading((prev) => ({ ...prev, [accountId]: true }));
    try {
      const res = await fetch(
        `${API_URL}/api/v1/retirement/deposit-accounts/${accountId}/transactions`,
        { headers: authLib.getAuthHeader() }
      );
      if (!res.ok) { setAccountTransactions((prev) => ({ ...prev, [accountId]: [] })); return []; }
      const data = await res.json();
      const list: DepositTransaction[] = Array.isArray(data) ? data : [];
      setAccountTransactions((prev) => ({ ...prev, [accountId]: list }));
      return list;
    } catch {
      setAccountTransactions((prev) => ({ ...prev, [accountId]: [] }));
      return [];
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

  // 고객 전환 시 이전 고객 상태 잔존 방지 (거래·펼침·적용연도·플랜·선택 초기화)
  useEffect(() => {
    setAccountTransactions({});
    setExpandedAccountIds(new Set());
    setAppliedYears({});
    setDesiredPlanData(null);
    setSelectedRecordIds(new Set());
  }, [selectedCustomerId]);

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
    setTxEditSavings('');
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
    setTxEditSavings(tx.savings_amount > 0 ? tx.savings_amount.toLocaleString() : '');
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
            savings_amount: txEditSavings ? parseInt(txEditSavings.replace(/\D/g, ''), 10) : 0,
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
            savings_amount: txEditSavings ? parseInt(txEditSavings.replace(/\D/g, ''), 10) : 0,
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
    setRecEditProductName('');
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
    // 상품명: 저장된 product_name 우선, 없으면 wrap 계좌명으로 채워 '선택 안함' 방지
    setRecEditProductName(
      record.product_name ||
        (record.wrap_account_id
          ? wrapAccounts.find((a) => a.id === record.wrap_account_id)?.product_name ?? ''
          : '')
    );
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
        product_name: recEditProductName.trim() || null,
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
        product_name: recEditProductName.trim() || null,
        deposit_account_id: recEditAccount || null,
        investment_amount: parseInt(recEditAmount.replace(/\D/g, ''), 10) || 0,
        start_date: recEditJoinDate,
        join_date: recEditJoinDate || null,
        expected_maturity_date: recEditExpMaturity || null,
        actual_maturity_date: recEditActMaturity || null,
        original_maturity_date: recEditOrigMaturity || null,
        memo: recEditMemo.trim() || null,
      };
      // 실제만기일이 있으면 종결 처리 (없으면 상태 변경하지 않음)
      if (recEditActMaturity) body.status = 'exit';
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

  /* ---- 예수금 거래 정렬 (localStorage 영속화) ----
     기본: 거래일 최신순(상단) — '계좌 위에 투자를 날짜별로 쌓아가는' 모델.
     키 v2: 구버전 저장값(id/asc)이 새 기본값을 덮지 않도록 분리 */
  const [txSortKey, setTxSortKey] = useState<string>(() => {
    if (typeof window !== 'undefined') return localStorage.getItem('tx_sort_key_v2') || 'transaction_date';
    return 'transaction_date';
  });
  const [txSortDir, setTxSortDir] = useState<'asc' | 'desc'>(() => {
    if (typeof window !== 'undefined') return (localStorage.getItem('tx_sort_dir_v2') as 'asc' | 'desc') || 'desc';
    return 'desc';
  });
  useEffect(() => { localStorage.setItem('tx_sort_key_v2', txSortKey); }, [txSortKey]);
  useEffect(() => { localStorage.setItem('tx_sort_dir_v2', txSortDir); }, [txSortDir]);
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
        case 'savings_amount': va = a.savings_amount; vb = b.savings_amount; break;
        case 'debit_amount': va = a.debit_amount; vb = b.debit_amount; break;
        case 'balance': va = a.balance; vb = b.balance; break;
        default: return 0;
      }
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb));
      // 동률(같은 거래일 등)은 id로 2차 정렬 — 같은 날 거래의 순서 고정
      const tie = cmp !== 0 ? cmp : a.id - b.id;
      return txSortDir === 'asc' ? tie : -tie;
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

  /* ---- 투자기록 일괄 선택/삭제 ---- */
  const toggleRecordSelect = (id: number) => {
    setSelectedRecordIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleAllRecords = () => {
    const ids = filteredRecords.map(r => r.id);
    const allSelected = ids.length > 0 && ids.every(id => selectedRecordIds.has(id));
    setSelectedRecordIds(prev => {
      const next = new Set(prev);
      if (allSelected) ids.forEach(id => next.delete(id));
      else ids.forEach(id => next.add(id));
      return next;
    });
  };
  const bulkDeleteRecords = async () => {
    if (selectedRecordIds.size === 0) return;
    if (!confirm(`선택한 ${selectedRecordIds.size}건의 투자기록을 정말 삭제하시겠습니까?\n삭제 후에는 되돌릴 수 없습니다.`)) return;
    setBulkDeleting(true);
    const ids = Array.from(selectedRecordIds);
    // 삭제도 연동 거래·잔액 재계산을 수행하므로 병렬 금지 (일괄지정과 동일 사유) — 순차 처리
    let delFail = 0;
    for (const id of ids) {
      try {
        const res = await fetch(`${API_URL}/api/v1/retirement/investment-records/${id}`, {
          method: 'DELETE', headers: authLib.getAuthHeader(),
        });
        if (!res.ok) delFail++;
      } catch { delFail++; }
    }
    if (delFail > 0) alert(`${ids.length - delFail}건 삭제, ${delFail}건 실패했습니다. 다시 시도해주세요.`);
    setSelectedRecordIds(new Set());
    setBulkDeleting(false);
    fetchRecords();
    fetchAnnualFlow();
    fetchDepositAccounts();
    expandedAccountIds.forEach(id => fetchTransactions(id));
  };

  /* ---- 선택 행 계좌별명 일괄 지정 ---- */
  const bulkAssignAccount = async () => {
    if (selectedRecordIds.size === 0 || bulkAccountId === '') return;
    const clear = bulkAccountId === 'none';
    const acctId = clear ? null : Number(bulkAccountId);
    const acct = clear ? null : depositAccounts.find(a => a.id === acctId);
    const label = clear ? '계좌 없음(해제)' : (acct ? (acct.nickname || `${acct.securities_company} ${acct.account_number || ''}`) : '');
    if (!confirm(`선택한 ${selectedRecordIds.size}건의 계좌별명을 '${label}'(으)로 일괄 변경하시겠습니까?`)) return;
    setBulkAssigning(true);
    const ids = Array.from(selectedRecordIds);
    // 각 PUT이 같은 예수금 계좌의 거래 재구성+잔액 재계산(FOR UPDATE)을 수행하므로
    // 병렬 전송 시 잠금 경합으로 일부만 반영됨 → 반드시 순차 처리 + 실패 집계
    let ok = 0, fail = 0;
    for (const id of ids) {
      try {
        const res = await fetch(`${API_URL}/api/v1/retirement/investment-records/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
          body: JSON.stringify({ deposit_account_id: acctId }),
        });
        if (res.ok) ok++; else fail++;
      } catch { fail++; }
    }
    setBulkAssigning(false);
    if (fail > 0) {
      alert(`${ok}건 변경, ${fail}건 실패했습니다. 선택이 유지되니 다시 시도해주세요.`);
    } else {
      setSelectedRecordIds(new Set());
      setBulkAccountId('');
    }
    fetchRecords();
    fetchAnnualFlow();
    fetchDepositAccounts();
    expandedAccountIds.forEach(id => fetchTransactions(id));
  };

  /* ---- Notion 동기화: 저장된 매핑으로 이 고객의 증권사투자 상품을 최신화(추가+업데이트) ---- */
  const handleNotionSync = async () => {
    if (!selectedCustomerId) return;
    let saved: { dbId: string; dbTitle: string; mapping: Record<string, string> } | null = null;
    try { const r = localStorage.getItem(NOTION_IR_CONFIG_KEY); saved = r ? JSON.parse(r) : null; } catch { saved = null; }
    if (!saved || !saved.dbId) {
      alert('먼저 📝 Notion 불러오기에서 DB를 연결하고 필드를 매핑해 주세요.');
      return;
    }
    const custCol = saved.mapping['customer_name'];
    const catCol = saved.mapping['category'];
    if (!custCol || !catCol) {
      alert('고객명·카테고리 매핑이 필요합니다. 📝 Notion 불러오기에서 매핑해 주세요.');
      return;
    }
    // 바로 적용하지 않고 미리보기 계획을 만들어 사용자가 선택하게 한다 (의도치 않은 자동 입력 방지)
    setNotionSyncing(true);
    try {
      // 서버측 필터: 이 고객의 증권사투자 행만 받아옴 — 0건이면 조건을 줄여 재시도
      const rows = await fetchNotionRowsWithFallback(
        saved.dbId,
        [
          { property: custCol, value: selectedCustomer?.name },
          { property: catCol, value: NOTION_IR_TARGET_CATEGORY },
        ],
        Object.values(saved.mapping ?? {}),   // 매핑된 컬럼만 받아 고속화
      );
      const target = notionNormName(selectedCustomer?.name);
      const matched = rows.filter(r =>
        notionNormName(r.properties[custCol]) === target &&
        (r.properties[catCol] ?? '').trim() === NOTION_IR_TARGET_CATEGORY
      );
      if (matched.length === 0) {
        alert(`'${selectedCustomer?.name ?? ''}' 고객의 ${NOTION_IR_TARGET_CATEGORY} 상품을 Notion에서 찾지 못했습니다.`);
        return;
      }
      // 기존 투자기록: 상품명|가입일 → id
      // 중복키 생성 규칙을 한 함수로 통일 (양쪽 키가 어긋나면 동기화마다 중복 추가됨)
      const dupKey = (name: unknown, d: unknown) =>
        `${String(name ?? '').trim()}|${String(d ?? '').slice(0, 10)}`;
      const existMap = new Map<string, number>();
      records.forEach(r => existMap.set(dupKey(getProductName(r), r.join_date || r.start_date), r.id));

      let skipped = 0;
      const items: SyncPlanItem[] = [];
      for (const row of matched) {
        const body = notionRowToRecordBody(row, saved.mapping, selectedCustomerId);
        if (!body) { skipped++; continue; }
        const key = dupKey(body.product_name, body.join_date || body.start_date);
        const existingId = existMap.get(key);
        items.push({
          key: row.id,
          action: existingId != null ? 'update' : 'add',
          recordId: existingId,
          label: String(body.product_name ?? '-'),
          date: String(body.join_date ?? body.start_date ?? '').slice(0, 10),
          amount: Number(body.investment_amount ?? 0) || undefined,
          body,
        });
      }
      if (items.length === 0) {
        alert(`가져올 항목이 없습니다.${skipped > 0 ? ` (가입일 누락 ${skipped}건 제외)` : ''}`);
        return;
      }
      setIrSyncPlan(items);
      setIrSyncChecked(new Set(items.map(i => i.key)));
    } catch (e) {
      alert(`동기화 실패: ${e instanceof Error ? e.message : '오류'}`);
    } finally {
      setNotionSyncing(false);
    }
  };

  /* ---- 투자기록 동기화 미리보기 적용 (선택 항목만) ---- */
  const applyIrSync = async () => {
    if (!irSyncPlan) return;
    const chosen = irSyncPlan.filter(i => irSyncChecked.has(i.key));
    if (chosen.length === 0) return;
    setIrSyncApplying(true);
    let added = 0, updated = 0, fail = 0;
    // 같은 예수금 계좌 잔액 재계산이 맞물리므로 순차 처리
    for (const item of chosen) {
      try {
        if (item.action === 'update' && item.recordId != null) {
          const r2 = await fetch(`${API_URL}/api/v1/retirement/investment-records/${item.recordId}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() }, body: JSON.stringify(item.body),
          });
          if (r2.ok) updated++; else fail++;
        } else {
          const r2 = await fetch(`${API_URL}/api/v1/retirement/investment-records`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() }, body: JSON.stringify(item.body),
          });
          if (r2.ok) added++; else fail++;
        }
      } catch { fail++; }
    }
    setIrSyncApplying(false);
    setIrSyncPlan(null);
    alert(`동기화 완료\n· 추가 ${added}건\n· 업데이트 ${updated}건${fail > 0 ? `\n· 실패 ${fail}건` : ''}`);
    setSelectedRecordIds(new Set());
    fetchRecords();
    fetchAnnualFlow();
    fetchDepositAccounts();
    expandedAccountIds.forEach(id => fetchTransactions(id));
  };

  /* ---- 예수금 거래 Notion 동기화: 저장된 설정(고객별 전용 DB)으로 대상 계좌에 신규 거래만 추가 ---- */
  const handleDepositNotionSync = async () => {
    let saved: { dbId: string; dbTitle: string; mapping: Record<string, string>; acctId?: number } | null = null;
    // 고객마다 전용 DB가 다르므로 설정도 고객별 키로 저장돼 있음
    try { const r = localStorage.getItem(`${NOTION_DTX_CONFIG_KEY}:${selectedCustomerId}`); saved = r ? JSON.parse(r) : null; } catch { saved = null; }
    if (!saved || !saved.dbId || !saved.mapping?.['transaction_date']) {
      alert('먼저 📝 Notion 불러오기에서 이 고객의 DB를 지정하고 발생일 필드를 매핑해 주세요.');
      return;
    }
    const acctId = saved.acctId;
    const acct = acctId != null ? depositAccounts.find(a => a.id === acctId) : undefined;
    if (!acct) {
      alert('동기화 대상 예수금 계좌를 찾을 수 없습니다. 📝 Notion 불러오기에서 대상 계좌를 다시 선택해 주세요.');
      return;
    }
    // 바로 적용하지 않고 미리보기 계획을 만들어 사용자가 선택하게 한다 (의도치 않은 자동 입력 방지)
    setDepositNotionSyncing(true);
    try {
      const [rowsRes, txRes] = await Promise.all([
        fetch(`${API_URL}/api/v1/notion/databases/${saved.dbId}/rows`, { headers: authLib.getAuthHeader() }),
        fetch(`${API_URL}/api/v1/retirement/deposit-accounts/${acctId}/transactions`, { headers: authLib.getAuthHeader() }),
      ]);
      if (!rowsRes.ok) { const d = await rowsRes.json().catch(() => ({})); throw new Error(d?.detail || 'Notion 데이터 조회 실패'); }
      const rows: { id: string; properties: Record<string, string> }[] = await rowsRes.json();
      // 고객별 전용 DB이므로 전체 행이 이 고객의 거래 — 행 필터 없음
      const matched = rows;
      // 기존 거래 조회가 실패하면 "0건"으로 오인해 전부 신규 추가(대량 중복)되므로 반드시 중단
      if (!txRes.ok) throw new Error('기존 거래 조회에 실패해 동기화를 중단했습니다. 잠시 후 다시 시도해주세요.');
      const existTx = await txRes.json();
      const existKeys = new Set<string>((Array.isArray(existTx) ? existTx : []).map(depositTxKey));

      let skipped = 0;
      const items: SyncPlanItem[] = [];
      for (const row of matched) {
        const body = notionRowToTxBody(row, saved.mapping);
        if (!body) { skipped++; continue; }
        if (existKeys.has(notionTxBodyKey(body))) { skipped++; continue; }
        const credit = Number(body.credit_amount ?? 0) + Number(body.savings_amount ?? 0);
        const debit = Number(body.debit_amount ?? 0);
        items.push({
          key: row.id,
          action: 'add',
          label: String(body.related_product ?? '-'),
          date: String(body.transaction_date ?? '').slice(0, 10),
          amount: credit > 0 ? credit : (debit > 0 ? -debit : undefined),
          body,
        });
      }
      if (items.length === 0) {
        alert(`추가할 신규 거래가 없습니다.${skipped > 0 ? ` (중복/거래일 누락 ${skipped}건)` : ''}`);
        return;
      }
      // 증권번호(매핑 시): 계좌 정보(계좌번호)로 반영할 값 추출
      const acctNumCol = saved.mapping['account_number'];
      const svcNum = acctNumCol
        ? (rows.map(r => (r.properties[acctNumCol] ?? '').trim()).find(v => v) ?? '')
        : '';
      setDtxSyncAcctNumber(svcNum || null);
      setDtxSyncAcctId(acctId!);
      setDtxSyncSkipped(skipped);
      setDtxSyncPlan(items);
      setDtxSyncChecked(new Set(items.map(i => i.key)));
    } catch (e) {
      alert(`동기화 실패: ${e instanceof Error ? e.message : '오류'}`);
    } finally {
      setDepositNotionSyncing(false);
    }
  };

  /* ---- 예수금 동기화 미리보기 적용 (선택 항목만) ---- */
  const applyDtxSync = async () => {
    if (!dtxSyncPlan || dtxSyncAcctId == null) return;
    const chosen = dtxSyncPlan.filter(i => dtxSyncChecked.has(i.key));
    if (chosen.length === 0) return;
    setDtxSyncApplying(true);
    let added = 0, fail = 0;
    // 같은 계좌 잔액 재계산이 맞물리므로 순차 처리
    for (const item of chosen) {
      try {
        const res = await fetch(`${API_URL}/api/v1/retirement/deposit-accounts/${dtxSyncAcctId}/transactions`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() }, body: JSON.stringify(item.body),
        });
        if (res.ok) added++; else fail++;
      } catch { fail++; }
    }
    setDtxSyncApplying(false);
    const acct = depositAccounts.find(a => a.id === dtxSyncAcctId);
    // 계좌번호가 비어 있으면 Notion 증권번호로 채움 (수동 입력값은 덮지 않음)
    if (dtxSyncAcctNumber && acct && !acct.account_number) {
      try {
        await fetch(`${API_URL}/api/v1/retirement/deposit-accounts/${dtxSyncAcctId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
          body: JSON.stringify({ account_number: dtxSyncAcctNumber }),
        });
      } catch { /* 계좌번호 갱신 실패는 무시 */ }
    }
    const acctLabel = acct ? (acct.nickname || `${acct.securities_company} ${acct.account_number || ''}`) : '';
    setDtxSyncPlan(null);
    alert(`동기화 완료${acctLabel ? ` (${acctLabel})` : ''}\n· 추가 ${added}건${fail > 0 ? `\n· 실패 ${fail}건` : ''}`);
    fetchDepositAccounts();
    fetchTransactions(dtxSyncAcctId);
    fetchAnnualFlow();
  };

  /* ---- 고객 미선택 ---- */
  if (!selectedCustomerId) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 320,
        color: 'var(--text-muted)',
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

    // 예수금 거래내역 로드 — setState는 클로저에 반영되지 않으므로(stale closure로
    // 첫 PDF가 항상 빈 데이터였음) 반환값을 로컬 맵에 직접 수집한다.
    const allAccIds = new Set(depositAccounts.map(a => a.id));
    setExpandedAccountIds(allAccIds);
    const txByAccount: Record<number, DepositTransaction[]> = { ...accountTransactions };
    for (const a of depositAccounts) {
      if (!txByAccount[a.id]) txByAccount[a.id] = await fetchTransactions(a.id);
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
      const txList = firstAcc ? [...(txByAccount[firstAcc.id] || [])].sort((a: any, b: any) =>
        (a.transaction_date || '').localeCompare(b.transaction_date || '')
      ) : [];
      txList.forEach((tx: any, idx: number) => {
        allTxs.push({
          no: tx.original_no ?? (idx + 1),
          date: tx.transaction_date || '-',
          type: tx.transaction_type || '-',
          product: tx.related_product || '-',
          credit: (tx.credit_amount || 0) + (tx.savings_amount || 0),
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
            border: '1px solid var(--blue-500)',
            borderRadius: 6,
            backgroundColor: 'var(--blue-600)',
            color: '#fff',
            cursor: 'pointer',
            fontWeight: 500,
          }}
        >
          {isPrinting ? 'PDF 생성 중...' : 'PDF 다운로드'}
        </button>
      </div>

      {/* 인쇄용 헤더 (화면에서는 숨김) */}
      <div className="print-header" style={{ display: 'none', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', marginBottom: 12, borderBottom: '3px solid var(--blue-500)' }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--blue-400)', letterSpacing: '-0.5px' }}>
            은퇴플랜 관리
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, fontWeight: 500 }}>
            투자흐름 보고서
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>
            {selectedCustomer?.name}
          </div>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2 }}>
            {selectedCustomer?.birthDate} | 출력일: {new Date().toLocaleDateString('ko-KR')}
          </div>
        </div>
      </div>

      {/* ===== 섹터1: 연간 투자흐름표 ===== */}
      <section id="print-sec-flow" className="print-section-flow">
        <div className="print-section-title" style={{ fontSize: 13, fontWeight: 700, color: 'var(--blue-400)', marginBottom: 8, paddingBottom: 4, borderBottom: '2px solid var(--blue-500)' }}>1. 연간 투자흐름표</div>
        <div className="no-print" style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--blue-400)' }}>
            연간 투자흐름표
            <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 400, color: 'var(--text-muted)' }}>
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
            {/* 계산식 도움말 */}
            <button
              onClick={() => setShowFlowHelp(true)}
              title="각 필드의 계산 방식 보기"
              style={{
                width: 26, height: 26, padding: 0, fontSize: 13, fontWeight: 700,
                border: '1px solid var(--border-strong)', borderRadius: '50%',
                backgroundColor: 'var(--bg-card)', cursor: 'pointer', color: 'var(--blue-400)',
              }}
            >
              ?
            </button>
            {/* 재계산 버튼 */}
            <button
              onClick={fetchAnnualFlow}
              style={{
                padding: '5px 12px',
                fontSize: 12,
                border: '1px solid var(--border-strong)',
                borderRadius: 6,
                backgroundColor: 'var(--bg-card)',
                cursor: 'pointer',
                color: 'var(--text-secondary)',
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
              <tr style={{ backgroundColor: 'var(--bg-surface)' }}>
                {([
                  { label: '연도', align: 'center', tip: '투자 활동이 발생한 연도' },
                  { label: '연차', align: 'center', tip: '최초 투자 연도를 1차로 산정' },
                  { label: '나이', align: 'center', tip: '해당 연도 기준 고객 나이 (만 나이)' },
                  { label: '일시납금액', align: 'right', tip: '예수금 입금(거치) 금액 합계 (투자 제외)' },
                  { label: '연적립금액', align: 'right', tip: '예수금 거래의 적립액(자동이체) 합계 + "적립" 구분 입금액' },
                  { label: '입금액', align: 'right', tip: '일시납금액 + 연적립금액' },
                  { label: '누적입금액', align: 'right', tip: '시작 연도부터 해당 연도까지 입금액 누적 합계' },
                  { label: '인출금액', align: 'right', tip: '투자기록 인출 + 예수금 "출금" 합계' },
                  { label: '누적인출액', align: 'right', tip: '시작 연도부터 해당 연도까지 인출금액 누적 합계' },
                  { label: '순입금액', align: 'right', tip: '해당 연도 누적입금액 - 해당 연도 누적인출액', hl: true },
                  { label: '순자산', align: 'right', tip: '연도말 예수금 잔액 + 미종결 투자금액 + 이자수익', hl: true },
                  { label: '순자산증가율', align: 'right', tip: '(현재 순자산 - 직전 순자산) / 직전 순자산 × 100' },
                  { label: '순이익', align: 'right', tip: '순자산 - (누적입금액 - 누적인출액)' },
                  { label: '순자산수익률', align: 'right', tip: '순이익 / (누적입금액 - 누적인출액) × 100', hl: true },
                  { label: '총납입금액', align: 'right', tip: '당해 투자금액 + 모든 미종결 투자금액' },
                  { label: '연간평가금액', align: 'right', tip: '당해 종결 평가금액 + 모든 미종결 투자금액' },
                  { label: '연간총수익', align: 'right', tip: '연간평가금액 - 총납입금액' },
                  { label: '연수익률', align: 'right', tip: '연간총수익 / 총납입금액 × 100' },
                  { label: '100세플로우', align: 'center', tip: '100세 은퇴플로우에 해당 연도 순자산을 적용/취소' },
                ] as { label: string; align: string; tip: string; hl?: boolean }[]).map(({ label, align, tip, hl }) => (
                  <th
                    key={label}
                    title={tip}
                    style={{
                      padding: '8px 12px',
                      textAlign: align as 'center' | 'right',
                      fontWeight: hl ? 800 : 600,
                      color: hl ? '#93C5FD' : 'var(--text-muted)',
                      borderBottom: hl ? '2px solid var(--blue-500)' : '1px solid var(--border)',
                      backgroundColor: hl ? 'rgba(59,130,246,0.12)' : undefined,
                      fontSize: 12,
                      cursor: 'help',
                      position: 'relative',
                    }}
                  >
                    <span style={{ borderBottom: '1px dashed var(--border-strong)' }}>{label}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {annualFlowLoading ? (
                <tr>
                  <td colSpan={19} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)', fontSize: 13 }}>
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
                      <tr key={year} style={{ borderBottom: '1px solid var(--bg-surface)', backgroundColor: idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
                        <td style={tdCenter}>{year}</td>
                        {Array.from({ length: 18 }).map((_, i) => (
                          <td key={i} style={{ padding: '9px 12px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>-</td>
                        ))}
                      </tr>
                    );
                  }
                  const rateColor = Number(row.annual_return_rate) > 0
                    ? '#34D399'
                    : Number(row.annual_return_rate) < 0
                    ? '#F87171'
                    : 'var(--text-primary)';
                  return (
                    <React.Fragment key={year}>
                    <tr
                      style={{
                        borderBottom: '1px solid var(--bg-surface)',
                        backgroundColor: idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)',
                        ...(year === currentYear ? { backgroundColor: 'rgba(59,130,246,0.06)' } : {}),
                      }}
                    >
                      <td style={tdCenter}>{row.year}</td>
                      <td style={tdCenter}>{row.order_in_year ?? '-'}</td>
                      <td style={tdCenter}>{row.age ?? '-'}</td>
                      <td style={tdRight}>{formatCurrency(row.lump_sum)}</td>
                      <td style={tdRight}>{formatCurrency(row.annual_savings)}</td>
                      <td style={tdRight}>{formatCurrency(row.deposit_in)}</td>
                      <td style={tdRight}>{formatCurrency(row.cumulative_deposit_in)}</td>
                      <td style={tdRight}>{formatCurrency(row.withdrawal)}</td>
                      <td style={tdRight}>{formatCurrency(row.cumulative_withdrawal)}</td>
                      {/* 순입금액: 해당 연도 누적입금액 - 해당 연도 누적인출액 (핵심 지표 — 강조) */}
                      <td style={{ ...tdRight, fontWeight: 800, color: '#E2ECFF', backgroundColor: 'rgba(59,130,246,0.10)' }}>
                        {formatCurrency(row.cumulative_deposit_in - row.cumulative_withdrawal)}
                      </td>
                      {/* 순자산 (핵심 지표 — 강조) */}
                      <td style={{ ...tdRight, fontWeight: 800, color: '#7CC0FF', backgroundColor: 'rgba(59,130,246,0.10)' }}>
                        {formatCurrency(row.total_evaluation)}
                      </td>
                      {/* 순자산증가율 */}
                      {(() => {
                        const prevRow = dataMap.get(year - 1);
                        const prevAsset = prevRow?.total_evaluation ?? 0;
                        if (!prevAsset || prevAsset === 0) return <td style={{ ...tdRight, color: 'var(--text-muted)' }}>-</td>;
                        const rate = ((row.total_evaluation - prevAsset) / prevAsset * 100);
                        const color = rate > 0 ? '#34D399' : rate < 0 ? '#F87171' : 'var(--text-primary)';
                        return <td style={{ ...tdRight, fontWeight: 700, color }}>{rate.toFixed(2)}%</td>;
                      })()}
                      {/* 순이익: 순자산 - (누적입금액 - 누적인출액) */}
                      {(() => {
                        const netInvestment = row.cumulative_deposit_in - row.cumulative_withdrawal;
                        const netProfit = row.total_evaluation - netInvestment;
                        const color = netProfit > 0 ? '#34D399' : netProfit < 0 ? '#F87171' : 'var(--text-primary)';
                        return <td style={{ ...tdRight, fontWeight: 700, color }}>{formatCurrency(netProfit)}</td>;
                      })()}
                      {/* 순자산수익률: 순이익 / (누적입금액 - 누적인출액) × 100 (핵심 지표 — 강조) */}
                      {(() => {
                        const hlBg = 'rgba(59,130,246,0.10)';
                        const netInvestment = row.cumulative_deposit_in - row.cumulative_withdrawal;
                        if (!netInvestment || netInvestment === 0) return <td style={{ ...tdRight, color: 'var(--text-muted)', backgroundColor: hlBg }}>-</td>;
                        const netProfit = row.total_evaluation - netInvestment;
                        const rate = (netProfit / netInvestment * 100);
                        const color = rate > 0 ? '#34D399' : rate < 0 ? '#F87171' : 'var(--text-primary)';
                        return <td style={{ ...tdRight, fontWeight: 800, color, backgroundColor: hlBg }}>{rate.toFixed(2)}%</td>;
                      })()}
                      {/* 투자기록 기반 4종 — 100세 플로우 왼쪽 배치 */}
                      <td style={{ ...tdRight, fontWeight: 700 }}>{formatCurrency(row.total_contribution)}</td>
                      <td
                        onClick={() => setEvalDetailYear(evalDetailYear === row.year ? null : row.year)}
                        style={{ ...tdRight, fontWeight: 700, cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted' as const, textUnderlineOffset: '3px' }}
                        title="클릭하면 평가 상세 보기"
                      >{formatCurrency(row.annual_evaluation)} {evalDetailYear === row.year ? '▲' : '▼'}</td>
                      <td style={{ ...tdRight, color: row.annual_return >= 0 ? '#34D399' : '#F87171' }}>
                        {formatCurrency(row.annual_return)}
                      </td>
                      <td style={{ ...tdRight, color: rateColor, fontWeight: 700 }}>
                        {row.annual_return_rate != null ? `${Number(row.annual_return_rate).toFixed(2)}%` : '-'}
                      </td>
                      {/* 100세 플로우 적용/취소 - 당해연도는 버튼 없음 */}
                      <td style={{ padding: '6px 8px', textAlign: 'center', whiteSpace: 'nowrap', borderBottom: '1px solid var(--border)' }}>
                        {row.year === new Date().getFullYear() ? (
                          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>당해</span>
                        ) : appliedYears[row.year] ? (
                          <button
                            className="no-print-btn"
                            onClick={() => {
                              const next = { ...appliedYears }; delete next[row.year];
                              setAppliedYears(next);
                              saveAppliedYears(next);
                            }}
                            style={{ padding: '3px 10px', fontSize: 11, border: '1px solid var(--danger)', borderRadius: 4, backgroundColor: 'var(--danger-bg)', color: 'var(--danger)', cursor: 'pointer', fontWeight: 500 }}
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
                            style={{ padding: '3px 10px', fontSize: 11, border: '1px solid var(--blue-500)', borderRadius: 4, backgroundColor: 'rgba(56,189,248,0.12)', color: 'var(--blue-400)', cursor: 'pointer', fontWeight: 500 }}
                          >
                            적용
                          </button>
                        )}
                      </td>
                    </tr>
                    {/* 평가상세 펼침 행 */}
                    {evalDetailYear === row.year && (
                      <tr>
                        <td colSpan={20} style={{ padding: 0, backgroundColor: 'var(--bg-card)', borderBottom: '1px solid var(--border)' }}>
                          <div style={{ display: 'flex', justifyContent: 'flex-start', paddingLeft: 'calc(4 * 80px + 4 * 12px)', paddingTop: 8, paddingBottom: 12, paddingRight: 16 }}>
                            <div style={{ width: '100%', maxWidth: 700 }}>
                              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>
                                {row.year}년 평가 상세 — 총납입: {formatCurrency(row.total_contribution)} / 연간평가: {formatCurrency(row.annual_evaluation)}
                              </div>
                              <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse', borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border)' }}>
                                <thead>
                                  <tr style={{ backgroundColor: 'var(--bg-card-2)' }}>
                                    <th style={{ padding: '5px 8px', textAlign: 'left', fontWeight: 600, color: 'var(--text-secondary)', borderBottom: '1px solid var(--border)' }}>상품</th>
                                    <th style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 600, color: 'var(--text-secondary)', borderBottom: '1px solid var(--border)' }}>투자금액</th>
                                    <th style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 600, color: 'var(--warning)', borderBottom: '1px solid var(--border)' }}>중간평가</th>
                                    <th style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 600, color: 'var(--success)', borderBottom: '1px solid var(--border)' }}>투자종료</th>
                                    <th style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 600, color: 'var(--blue-400)', borderBottom: '1px solid var(--border)' }}>평가금액</th>
                                    <th style={{ padding: '5px 8px', textAlign: 'center', fontWeight: 600, color: 'var(--text-secondary)', borderBottom: '1px solid var(--border)' }}>상태</th>
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
                                    const bg = rIdx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)';
                                    return (
                                      <tr key={r.id} style={{ backgroundColor: bg, borderBottom: '1px solid var(--bg-surface)' }}>
                                        <td style={{ padding: '4px 8px', color: 'var(--text-secondary)' }}>{getProductName(r)}</td>
                                        <td style={{ padding: '4px 8px', textAlign: 'right', color: 'var(--text-muted)' }}>{r.investment_amount.toLocaleString()}</td>
                                        <td style={{ padding: '4px 8px', textAlign: 'right', color: interim != null ? '#FCD34D' : 'var(--text-muted)', fontWeight: interim != null ? 700 : 400 }}>{interim != null ? interim.toLocaleString() : '-'}</td>
                                        <td style={{ padding: '4px 8px', textAlign: 'right', color: exitVal != null ? '#34D399' : 'var(--text-muted)', fontWeight: exitVal != null ? 700 : 400 }}>{exitVal != null ? exitVal.toLocaleString() : '-'}</td>
                                        <td style={{ padding: '4px 8px', textAlign: 'right', fontWeight: 700, color: 'var(--blue-400)' }}>{evalVal.toLocaleString()}</td>
                                        <td style={{ padding: '4px 8px', textAlign: 'center' }}>
                                          <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, backgroundColor: isExit ? 'rgba(16,185,129,0.15)' : 'rgba(59,130,246,0.15)', color: isExit ? '#34D399' : '#60A5FA', fontWeight: 600 }}>{isExit ? '종결' : '운용중'}</span>
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
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', border: '1px solid var(--border-strong)', borderRadius: 8, backgroundColor: showFlowChart ? 'rgba(59,130,246,0.12)' : 'var(--bg-card)', cursor: 'pointer', fontSize: 13, color: showFlowChart ? '#60A5FA' : 'var(--text-secondary)', fontWeight: 500 }}
            >
              {showFlowChart ? '\u25BC' : '\u25B6'} 투자흐름 그래프
            </button>
            <button
              onClick={() => setShowNetAssetChart(!showNetAssetChart)}
              className="no-print-btn"
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', border: '1px solid var(--border-strong)', borderRadius: 8, backgroundColor: showNetAssetChart ? 'rgba(59,130,246,0.12)' : 'var(--bg-card)', cursor: 'pointer', fontSize: 13, color: showNetAssetChart ? '#60A5FA' : 'var(--text-secondary)', fontWeight: 500 }}
            >
              {showNetAssetChart ? '\u25BC' : '\u25B6'} 순자산 그래프
            </button>
            <button
              onClick={() => setShowLifetimeFlow(!showLifetimeFlow)}
              className="no-print-btn"
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', border: '1px solid var(--blue-500)', borderRadius: 8, backgroundColor: showLifetimeFlow ? 'var(--blue-600)' : 'var(--bg-card)', color: showLifetimeFlow ? '#fff' : '#60A5FA', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
            >
              {showLifetimeFlow ? '\u25BC' : '\u25B6'} 100세 은퇴플로우
            </button>
          </div>
        )}

        {/* 투자흐름 그래프 + 순자산 그래프 */}
        <section id="print-sec-graphs" className="print-section-graphs">
          <div className="print-section-title" style={{ fontSize: 13, fontWeight: 700, color: 'var(--blue-400)', marginBottom: 8, paddingBottom: 4, borderBottom: '2px solid var(--blue-500)' }}>2. 투자흐름 분석 그래프</div>
          {showFlowChart && annualFlowData.length > 0 && (
            <div style={{ marginTop: 12, padding: 16, border: '1px solid var(--border)', borderRadius: 8, backgroundColor: 'var(--bg-card)' }}>
              <div style={{ display: 'flex', gap: 12, marginBottom: 12, fontSize: 12, flexWrap: 'wrap' }} className="no-print">
                {([
                  { key: 'depositIn' as const, label: '입금액', color: '#8B5CF6' },
                  { key: 'contribution' as const, label: '총납입금액', color: 'var(--blue-400)' },
                  { key: 'annualReturn' as const, label: '연간총수익', color: 'var(--success)' },
                  { key: 'returnRate' as const, label: '연수익률(%)', color: 'var(--warning)' },
                ] as const).map(({ key, label, color }) => (
                  <button key={key} onClick={() => setChartVisibility(prev => ({ ...prev, [key]: !prev[key] }))}
                    style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', border: '1px solid var(--border-strong)', borderRadius: 6, backgroundColor: chartVisibility[key] ? 'var(--bg-card-2)' : 'var(--bg-surface)', cursor: 'pointer', opacity: chartVisibility[key] ? 1 : 0.4, fontSize: 12, color: 'var(--text-secondary)' }}>
                    <span style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: color, display: 'inline-block' }} />
                    {label}
                  </button>
                ))}
              </div>
              <div id="print-chart-flow" className="print-chart-wrap">
                <div className="print-section-title" style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>투자흐름 그래프</div>
                <AnnualFlowChart data={annualFlowData} visibility={chartVisibility} noAnimation={isPrinting} />
              </div>
            </div>
          )}

          {showNetAssetChart && annualFlowData.length > 0 && (
            <div style={{ marginTop: 12, padding: 16, border: '1px solid var(--border)', borderRadius: 8, backgroundColor: 'var(--bg-card)' }}>
              <div style={{ display: 'flex', gap: 12, marginBottom: 12, fontSize: 12, flexWrap: 'wrap' }} className="no-print">
                {([
                  { key: 'cumulativeDeposit' as const, label: '순입금액', color: 'var(--blue-400)' },
                  { key: 'netAsset' as const, label: '순자산', color: 'var(--blue-400)' },
                  { key: 'cumulativeProfit' as const, label: '순이익', color: 'var(--success)' },
                  { key: 'netAssetReturnRate' as const, label: '순자산수익률(%)', color: 'var(--warning)' },
                ] as const).map(({ key, label, color }) => (
                  <button key={key} onClick={() => setNetAssetVisibility(prev => ({ ...prev, [key]: !prev[key] }))}
                    style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', border: '1px solid var(--border-strong)', borderRadius: 6, backgroundColor: netAssetVisibility[key] ? 'var(--bg-card-2)' : 'var(--bg-surface)', cursor: 'pointer', opacity: netAssetVisibility[key] ? 1 : 0.4, fontSize: 12, color: 'var(--text-secondary)' }}>
                    <span style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: color, display: 'inline-block' }} />
                    {label}
                  </button>
                ))}
              </div>
              <div id="print-chart-netasset" className="print-chart-wrap">
                <div className="print-section-title" style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>순자산 그래프</div>
                <NetAssetChart data={annualFlowData} visibility={netAssetVisibility} noAnimation={isPrinting} />
              </div>
            </div>
          )}
        </section>

        {/* 100세 은퇴플로우 */}
        {showLifetimeFlow && (
          <section id="print-sec-lifetime" className="print-section-lifetime" style={{ marginTop: 12 }}>
            <div className="print-section-title" style={{ fontSize: 13, fontWeight: 700, color: 'var(--blue-400)', marginBottom: 8, paddingBottom: 4, borderBottom: '2px solid var(--blue-500)' }}>3. 100세 은퇴플로우</div>
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
        <div className="print-section-title" style={{ fontSize: 13, fontWeight: 700, color: 'var(--blue-400)', marginBottom: 8, paddingBottom: 4, borderBottom: '2px solid var(--blue-500)' }}>4. 예수금 계좌 기록</div>
        <div className="no-print" style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--blue-400)' }}>
            예수금 계좌 기록
          </h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginLeft: 'auto' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer' }}>
              <input type="checkbox" checked={showHidden} onChange={() => setShowHidden(!showHidden)} style={{ cursor: 'pointer' }} />
              숨긴 계좌 보기
            </label>
            <button
              onClick={() => setShowDepositNotionModal(true)}
              title="Notion에서 예수금 거래 불러오기 (계좌가 없으면 모달에서 바로 생성)"
              style={{
                display: 'flex', alignItems: 'center', gap: 4, padding: '7px 14px',
                fontSize: 13, fontWeight: 600, borderRadius: 7, border: '1px solid var(--border-strong)',
                backgroundColor: 'var(--bg-card)', color: 'var(--text-secondary)',
                cursor: 'pointer',
              }}
            >
              📝 Notion 불러오기
            </button>
            <button
              onClick={handleDepositNotionSync}
              disabled={depositNotionSyncing || depositAccounts.filter(a => a.is_active).length === 0}
              title="저장된 설정으로 대상 계좌에 신규 거래 추가(중복 건너뜀)"
              style={{
                display: 'flex', alignItems: 'center', gap: 4, padding: '7px 14px',
                fontSize: 13, fontWeight: 600, borderRadius: 7, border: '1px solid var(--blue-500)',
                backgroundColor: depositNotionSyncing ? 'var(--bg-surface)' : 'var(--bg-card)', color: 'var(--blue-400)',
                cursor: (depositNotionSyncing || depositAccounts.filter(a => a.is_active).length === 0) ? 'not-allowed' : 'pointer',
                opacity: (depositNotionSyncing || depositAccounts.filter(a => a.is_active).length === 0) ? 0.5 : 1,
              }}
            >
              {depositNotionSyncing ? '동기화 중...' : '🔄 Notion 동기화'}
            </button>
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
                backgroundColor: 'var(--blue-600)',
                color: '#fff',
                cursor: 'pointer',
              }}
            >
              + 예수금 계좌 추가
            </button>
          </div>
        </div>

        {depositAccountsLoading ? (
          <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)', fontSize: 13 }}>
            불러오는 중...
          </div>
        ) : depositAccounts.length === 0 ? (
          <div style={{
            textAlign: 'center',
            padding: 24,
            color: 'var(--text-muted)',
            fontSize: 13,
            border: '1px dashed var(--border)',
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
                    border: '1px solid var(--border)',
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
                      backgroundColor: 'var(--bg-surface)',
                      borderLeft: `3px solid ${account.is_active ? '#3B82F6' : '#D1D5DB'}`,
                      opacity: account.is_active ? 1 : 0.6,
                      cursor: 'pointer',
                      userSelect: 'none',
                    }}
                    onClick={() => toggleAccountExpand(account.id)}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>📁</span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--blue-400)' }}>
                        {account.securities_company}
                        {account.account_number && (
                          <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 6 }}>
                            {account.account_number}
                          </span>
                        )}
                        {account.nickname && (
                          <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 6 }}>
                            &quot;{account.nickname}&quot;
                          </span>
                        )}
                        {!account.is_active && (
                          <span style={{ fontSize: 11, color: 'var(--danger)', fontWeight: 600, marginLeft: 8, backgroundColor: 'var(--danger-bg)', padding: '1px 6px', borderRadius: 4 }}>숨김</span>
                        )}
                      </span>
                      <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                        잔액:{' '}
                        <strong style={{ color: 'var(--blue-400)' }}>
                          {(account.current_balance ?? 0).toLocaleString()}원
                        </strong>
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {isExpanded && (
                        <>
                          <button
                            onClick={(e) => { e.stopPropagation(); setEditingAccount(account); }}
                            style={{ padding: '4px 10px', fontSize: 12, fontWeight: 500, borderRadius: 6, border: '1px solid var(--border-strong)', backgroundColor: 'var(--bg-card)', color: 'var(--text-secondary)', cursor: 'pointer' }}
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
                            style={{ padding: '4px 10px', fontSize: 12, fontWeight: 500, borderRadius: 6, border: '1px solid var(--warning)', backgroundColor: 'var(--warning-bg)', color: 'var(--warning)', cursor: 'pointer' }}
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
                              border: '1px solid var(--blue-500)',
                              backgroundColor: 'var(--bg-card)',
                              color: 'var(--blue-400)',
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
                              style={{ padding: '4px 10px', fontSize: 12, fontWeight: 500, borderRadius: 6, border: '1px solid var(--border)', backgroundColor: 'var(--bg-card)', color: 'var(--danger)', cursor: 'pointer' }}
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
                              style={{ padding: '4px 10px', fontSize: 12, fontWeight: 600, borderRadius: 6, border: '1px solid var(--success)', backgroundColor: 'var(--success-bg)', color: 'var(--success)', cursor: 'pointer' }}
                            >
                              활성화
                            </button>
                          )}
                        </>
                      )}
                      <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{isExpanded ? '▲' : '▼'}</span>
                    </div>
                  </div>

                  {/* 거래내역 테이블 (아코디언) */}
                  {isExpanded && (
                    <div>
                      {/* 년도 필터 + 건수 */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', backgroundColor: 'var(--bg-surface)', borderBottom: '1px solid var(--border)' }}>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>년도:</span>
                        <select
                          value={txYearFilter}
                          onChange={e => setTxYearFilter(e.target.value)}
                          style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, border: '1px solid var(--border-strong)', backgroundColor: 'var(--bg-card)', color: 'var(--text-secondary)' }}
                        >
                          <option value="all">전체</option>
                          {txYears.map(y => <option key={y} value={y}>{y}년</option>)}
                        </select>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>({transactions.length}건{txYearFilter !== 'all' ? ` / 총 ${rawTransactions.length}건` : ''})</span>
                        <button
                          onClick={() => {
                            if (transactions.length === 0) return;
                            const TRANSACTION_TYPE_KR: Record<string, string> = { deposit: '입금', savings: '적립', investment: '투자', termination: '종료', withdrawal: '출금', interest: '이자' };
                            const header = ['No', '발생일', '구분', '상품명', '입금액', '적립액', '출금액', '잔액', '메모'];
                            const rows = transactions.map((tx, i) => [
                              txOrigIndex.get(tx.id) ?? (i + 1),
                              tx.transaction_date,
                              TRANSACTION_TYPE_KR[tx.transaction_type] ?? tx.transaction_type,
                              tx.related_product || '',
                              tx.credit_amount || 0,
                              tx.savings_amount || 0,
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
                          style={{ marginLeft: 'auto', padding: '2px 8px', fontSize: 11, fontWeight: 500, borderRadius: 4, border: '1px solid var(--border-strong)', backgroundColor: 'var(--bg-card)', color: 'var(--text-secondary)', cursor: 'pointer' }}
                        >
                          📥 엑셀 다운
                        </button>
                      </div>
                    <div ref={el => { txScrollRefs.current[account.id] = el; }} style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 480 }}>
                      <table style={{ minWidth: 890, borderCollapse: 'collapse', fontSize: 13, whiteSpace: 'nowrap', width: '100%' }}>
                        <thead style={{ position: 'sticky', top: 0, zIndex: 2 }}>
                          <tr style={{ backgroundColor: 'var(--bg-surface)' }}>
                            {[
                              { label: 'No', align: 'center', width: 36, sortKey: 'id' },
                              { label: '발생일', align: 'center', width: 90, sortKey: 'transaction_date' },
                              { label: '구분', align: 'center', width: 52, sortKey: 'transaction_type' },
                              { label: '상품명', align: 'left', width: 120, sortKey: 'related_product' },
                              { label: '입금액', align: 'right', width: 110, sortKey: 'credit_amount' },
                              { label: '적립액', align: 'right', width: 110, sortKey: 'savings_amount' },
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
                                  color: 'var(--text-muted)',
                                  borderBottom: '1px solid var(--border)',
                                  fontSize: 12,
                                  backgroundColor: 'var(--bg-surface)',
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
                            <tr style={{ backgroundColor: 'rgba(245,158,11,0.08)', borderBottom: '1px solid rgba(245,158,11,0.35)' }}>
                              <td style={{ ...txTdCenter, color: 'var(--text-muted)' }}>-</td>
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
                                  value={txEditSavings}
                                  onChange={e => setTxEditSavings(formatInputCurrency(e.target.value))}
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
                              <td style={{ ...txTdRight, color: 'var(--text-muted)' }}>-</td>
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
                              <td colSpan={10} style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)', fontSize: 13 }}>
                                불러오는 중...
                              </td>
                            </tr>
                          ) : transactions.length === 0 && !isAddingNewTx ? (
                            <tr>
                              <td colSpan={10} style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)', fontSize: 13 }}>
                                거래내역이 없습니다.
                              </td>
                            </tr>
                          ) : (
                            transactions.map((tx, idx) => {
                              const badgeColor = TRANSACTION_TYPE_COLORS[tx.transaction_type] ?? '#6B7280';
                              const isEditingThis = editingTxId === tx.id;

                              if (isEditingThis) {
                                return (
                                  <tr key={tx.id} style={{ backgroundColor: 'rgba(245,158,11,0.08)', borderBottom: '1px solid rgba(245,158,11,0.35)' }}>
                                    <td style={{ ...txTdCenter, color: 'var(--text-muted)' }}>{txOrigIndex.get(tx.id) ?? (idx + 1)}</td>
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
                                        value={txEditSavings}
                                        onChange={e => setTxEditSavings(formatInputCurrency(e.target.value))}
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
                                    <td style={{ ...txTdRight, fontWeight: 700, color: 'var(--blue-400)' }}>
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
                                    borderBottom: '1px solid var(--border)',
                                    backgroundColor: idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)',
                                  }}
                                >
                                  <td style={{ ...txTdCenter }}>{txOrigIndex.get(tx.id) ?? (idx + 1)}</td>
                                  <td style={{ ...txTdBase, color: 'var(--text-muted)' }}>{tx.transaction_date}</td>
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
                                  <td style={{ ...txTdBase, color: 'var(--text-secondary)', fontSize: 12 }}>
                                    {tx.related_product || <span style={{ color: 'var(--text-muted)' }}>-</span>}
                                  </td>
                                  <td style={{ ...txTdRight, color: tx.credit_amount > 0 ? '#60A5FA' : 'var(--text-muted)' }}>
                                    {tx.credit_amount > 0 ? tx.credit_amount.toLocaleString() : '-'}
                                  </td>
                                  <td style={{ ...txTdRight, color: tx.savings_amount > 0 ? '#34D399' : 'var(--text-muted)' }}>
                                    {tx.savings_amount > 0 ? tx.savings_amount.toLocaleString() : '-'}
                                  </td>
                                  <td style={{ ...txTdRight, color: tx.debit_amount > 0 ? '#F87171' : 'var(--text-muted)' }}>
                                    {tx.debit_amount > 0 ? tx.debit_amount.toLocaleString() : '-'}
                                  </td>
                                  <td style={{ ...txTdRight, fontWeight: 700, color: 'var(--blue-400)' }}>
                                    {tx.balance.toLocaleString()}
                                  </td>
                                  <td style={{ ...txTdBase, color: 'var(--text-muted)', maxWidth: 200, fontSize: 11, lineHeight: '1.4', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const, wordBreak: 'break-word' }} title={tx.memo || ''}>
                                    {tx.memo || <span style={{ color: 'var(--text-muted)' }}>-</span>}
                                  </td>
                                  <td style={{ ...txTdCenter, whiteSpace: 'nowrap' }}>
                                    {tx.investment_record_id ? (
                                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>자동</span>
                                    ) : (
                                      <>
                                        <button
                                          onClick={() => startEditTx(tx)}
                                          style={{ padding: '2px 6px', fontSize: 11, borderRadius: 4, border: '1px solid var(--border-strong)', backgroundColor: 'var(--bg-card)', color: 'var(--text-secondary)', cursor: 'pointer', marginRight: 3 }}
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
                                          style={{ padding: '2px 6px', fontSize: 11, borderRadius: 4, border: '1px solid rgba(239,68,68,0.35)', backgroundColor: 'var(--danger-bg)', color: 'var(--danger)', cursor: 'pointer' }}
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
        <div className="print-section-title" style={{ fontSize: 13, fontWeight: 700, color: 'var(--blue-400)', marginBottom: 8, paddingBottom: 4, borderBottom: '2px solid var(--blue-500)' }}>5. 투자기록</div>
        <div className="no-print" style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--blue-400)' }}>
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
                    border: statusFilter === value ? '1.5px solid #3B82F6' : '1px solid var(--border-strong)',
                    backgroundColor: statusFilter === value ? 'var(--blue-600)' : 'var(--bg-card)',
                    color: statusFilter === value ? '#fff' : 'var(--text-secondary)',
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
                  border: '1px solid var(--border-strong)', color: 'var(--text-secondary)', cursor: 'pointer',
                  backgroundColor: accountFilter !== 'all' ? 'rgba(59,130,246,0.12)' : 'var(--bg-card)',
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
            {selectedRecordIds.size > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 8px 3px 10px', borderRadius: 8, backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-strong)' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--blue-400)' }}>{selectedRecordIds.size}건 선택</span>
                <span style={{ width: 1, height: 18, backgroundColor: 'var(--border)' }} />
                <select
                  value={bulkAccountId}
                  onChange={e => setBulkAccountId(e.target.value)}
                  style={{ padding: '5px 8px', fontSize: 12, borderRadius: 6, border: '1px solid var(--border-strong)', backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)', cursor: 'pointer' }}
                >
                  <option value="">계좌 선택…</option>
                  <option value="none">— 계좌 해제 —</option>
                  {depositAccounts.filter(a => a.is_active).map(a => (
                    <option key={a.id} value={String(a.id)}>{a.nickname || `${a.securities_company} ${a.account_number || ''}`}</option>
                  ))}
                </select>
                <button
                  onClick={bulkAssignAccount}
                  disabled={bulkAssigning || bulkAccountId === ''}
                  style={{
                    padding: '6px 12px', fontSize: 12, fontWeight: 700, borderRadius: 6, border: 'none',
                    backgroundColor: (bulkAssigning || bulkAccountId === '') ? 'var(--bg-card)' : 'var(--blue-600)',
                    color: (bulkAssigning || bulkAccountId === '') ? 'var(--text-muted)' : '#fff',
                    cursor: (bulkAssigning || bulkAccountId === '') ? 'not-allowed' : 'pointer',
                  }}
                >
                  {bulkAssigning ? '지정 중...' : '계좌 일괄지정'}
                </button>
                <span style={{ width: 1, height: 18, backgroundColor: 'var(--border)' }} />
                <button
                  onClick={bulkDeleteRecords}
                  disabled={bulkDeleting}
                  style={{
                    padding: '6px 12px', fontSize: 12, fontWeight: 700, borderRadius: 6, border: '1px solid rgba(239,68,68,0.5)',
                    backgroundColor: 'var(--danger-bg)', color: 'var(--danger)',
                    cursor: bulkDeleting ? 'wait' : 'pointer', opacity: bulkDeleting ? 0.6 : 1,
                  }}
                >
                  🗑 삭제
                </button>
              </div>
            )}
            <button
              onClick={() => selectedCustomerId && setShowNotionImportModal(true)}
              disabled={!selectedCustomerId}
              title={selectedCustomerId ? undefined : '고객을 먼저 선택하세요'}
              style={{
                display: 'flex', alignItems: 'center', gap: 4, padding: '7px 14px',
                fontSize: 13, fontWeight: 600, borderRadius: 7, border: '1px solid var(--border-strong)',
                backgroundColor: 'var(--bg-card)', color: 'var(--text-secondary)',
                cursor: selectedCustomerId ? 'pointer' : 'not-allowed',
                opacity: selectedCustomerId ? 1 : 0.5,
              }}
            >
              📝 Notion 불러오기
            </button>
            <button
              onClick={handleNotionSync}
              disabled={!selectedCustomerId || notionSyncing}
              title={selectedCustomerId ? 'Notion 기준으로 추가+업데이트' : '고객을 먼저 선택하세요'}
              style={{
                display: 'flex', alignItems: 'center', gap: 4, padding: '7px 14px',
                fontSize: 13, fontWeight: 600, borderRadius: 7, border: '1px solid var(--blue-500)',
                backgroundColor: notionSyncing ? 'var(--bg-surface)' : 'var(--bg-card)', color: 'var(--blue-400)',
                cursor: (!selectedCustomerId || notionSyncing) ? 'not-allowed' : 'pointer',
                opacity: (!selectedCustomerId || notionSyncing) ? 0.5 : 1,
              }}
            >
              {notionSyncing ? '동기화 중...' : '🔄 Notion 동기화'}
            </button>
            <button
              onClick={startNewRecord}
              style={{
                display: 'flex', alignItems: 'center', gap: 4, padding: '7px 14px',
                fontSize: 13, fontWeight: 600, borderRadius: 7, border: 'none',
                backgroundColor: 'var(--blue-600)', color: '#fff', cursor: 'pointer',
              }}
            >
              + 투자기록 추가
            </button>
            <button
              onClick={() => setShowAddProductModal(true)}
              style={{
                display: 'flex', alignItems: 'center', gap: 4, padding: '7px 14px',
                fontSize: 13, fontWeight: 600, borderRadius: 7, border: '1px solid var(--blue-500)',
                backgroundColor: 'var(--bg-card)', color: 'var(--blue-400)', cursor: 'pointer',
              }}
            >
              + 상품 추가
            </button>
          </div>
        </div>

        {/* 투자상품 관리(wrapAccounts) 기반 상품명 자동완성 목록 */}
        <datalist id="wrap-products-datalist">
          {wrapAccounts.map(a => (
            <option key={a.id} value={a.product_name}>{a.securities_company}</option>
          ))}
        </datalist>
        <div ref={recScrollRef} style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 520 }}>
          <table style={{ minWidth: 1300, borderCollapse: 'collapse', fontSize: 13, whiteSpace: 'nowrap' }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 2 }}>
              <tr style={{ backgroundColor: 'var(--bg-surface)' }}>
                <th style={{ padding: '9px 8px', textAlign: 'center', borderBottom: '1px solid var(--border)', backgroundColor: 'var(--bg-surface)', width: 34 }}>
                  <input
                    type="checkbox"
                    checked={filteredRecords.length > 0 && filteredRecords.every(r => selectedRecordIds.has(r.id))}
                    onChange={toggleAllRecords}
                    title="전체 선택/해제"
                    style={{ width: 15, height: 15, cursor: 'pointer' }}
                  />
                </th>
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
                      color: 'var(--text-muted)',
                      borderBottom: '1px solid var(--border)',
                      fontSize: 11,
                      whiteSpace: 'nowrap',
                      backgroundColor: highlight ? 'var(--bg-card-2)' : 'var(--bg-surface)',
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
                <tr style={{ backgroundColor: 'rgba(245,158,11,0.08)', borderBottom: '1px solid rgba(245,158,11,0.35)' }}>
                  <td style={{ ...tdBase, textAlign: 'center' }}></td>
                  <td style={{ ...tdBase, color: 'var(--text-muted)' }}>-</td>
                  {/* 상품 - 직접 입력/검색 콤보박스 */}
                  <td style={{ padding: '6px 8px', minWidth: 180 }}>
                    <input
                      type="text"
                      list="wrap-products-datalist"
                      value={recEditProductName}
                      onChange={e => {
                        const v = e.target.value;
                        setRecEditProductName(v);
                        const m = wrapAccounts.find(a => a.product_name === v);
                        setRecEditProduct(m ? m.id : '');
                      }}
                      placeholder="상품명 입력/검색"
                      style={inlineInput}
                    />
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
                  <td style={{ ...tdRight, color: 'var(--text-muted)', fontSize: 12 }}>-</td>
                  {/* 수익률 */}
                  <td style={{ ...tdRight, color: 'var(--text-muted)', fontSize: 12 }}>-</td>
                  {/* 상태 */}
                  <td style={{ ...tdBase, color: 'var(--text-muted)', fontSize: 12 }}>운용중</td>
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
                  <td style={{ ...tdBase, color: 'var(--text-muted)', fontSize: 12 }}>-</td>
                  {/* 원만기일 - 신규 시 비활성 */}
                  <td style={{ ...tdBase, color: 'var(--text-muted)', fontSize: 12 }}>-</td>
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
                  <td colSpan={18} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)', fontSize: 13 }}>
                    불러오는 중...
                  </td>
                </tr>
              ) : filteredRecords.length === 0 && !addingRecord ? (
                <tr>
                  <td colSpan={18} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)', fontSize: 13 }}>
                    투자기록이 없습니다.
                  </td>
                </tr>
              ) : (
                filteredRecords.map((record, idx) => {
                  const isEditingThis = editingRecordId === record.id;
                  const isHighlighted = highlightedId === record.id;
                  // 실제만기일이 있으면 종결로 간주 (저장 상태가 운용중이어도 표시상 종결)
                  const effectiveStatus = record.actual_maturity_date ? 'exit' : record.status;
                  const statusStyle = STATUS_STYLES[effectiveStatus] ?? STATUS_STYLES.ing;
                  // 수익률: 저장값 우선, 없으면 (평가금액-투자금액)/투자금액 로 자동계산
                  const effectiveRate =
                    record.return_rate != null
                      ? Number(record.return_rate)
                      : record.evaluation_amount != null && record.investment_amount > 0
                      ? ((record.evaluation_amount - record.investment_amount) / record.investment_amount) * 100
                      : null;
                  const returnColor =
                    effectiveRate != null
                      ? effectiveRate > 0
                        ? '#34D399'
                        : effectiveRate < 0
                        ? '#F87171'
                        : 'var(--text-primary)'
                      : 'var(--text-muted)';

                  if (isEditingThis) {
                    return (
                      <tr
                        key={record.id}
                        ref={(el) => {
                          if (el) rowRefs.current.set(record.id, el);
                          else rowRefs.current.delete(record.id);
                        }}
                        style={{ backgroundColor: 'rgba(245,158,11,0.08)', borderBottom: '1px solid rgba(245,158,11,0.35)' }}
                      >
                        <td style={{ ...tdBase, textAlign: 'center' }}></td>
                        <td style={{ ...tdBase, color: 'var(--text-muted)' }}>{idx + 1}</td>
                        {/* 상품 - 직접 입력/검색 콤보박스 (원래 상품명 유지) */}
                        <td style={{ padding: '6px 8px', minWidth: 180 }}>
                          <input
                            type="text"
                            list="wrap-products-datalist"
                            value={recEditProductName}
                            onChange={e => {
                              const v = e.target.value;
                              setRecEditProductName(v);
                              const m = wrapAccounts.find(a => a.product_name === v);
                              setRecEditProduct(m ? m.id : '');
                            }}
                            placeholder="상품명 입력/검색"
                            style={inlineInput}
                          />
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
                        <td style={{ ...tdRight, color: 'var(--text-muted)', fontSize: 12 }}>
                          {recEditEval && recEditAmount
                            ? (() => {
                                const inv = parseInt(recEditAmount, 10);
                                const ev = parseInt(recEditEval, 10);
                                if (inv > 0) {
                                  const rate = ((ev - inv) / inv * 100).toFixed(2);
                                  return <span style={{ color: parseFloat(rate) >= 0 ? '#34D399' : '#F87171' }}>{rate}%</span>;
                                }
                                return '-';
                              })()
                            : '-'}
                        </td>
                        {/* 상태 */}
                        <td style={{ ...tdBase, color: 'var(--text-muted)', fontSize: 12 }}>
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
                        borderBottom: '1px solid var(--border)',
                        backgroundColor: selectedRecordIds.has(record.id)
                          ? 'rgba(239,68,68,0.10)'
                          : isHighlighted ? 'rgba(250,204,21,0.12)' : idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)',
                        transition: 'background-color 0.4s ease',
                      }}
                    >
                      <td style={{ ...tdBase, textAlign: 'center', width: 34 }}>
                        <input
                          type="checkbox"
                          checked={selectedRecordIds.has(record.id)}
                          onChange={() => toggleRecordSelect(record.id)}
                          style={{ width: 14, height: 14, cursor: 'pointer' }}
                        />
                      </td>
                      <td style={{ ...tdBase, color: 'var(--text-muted)', width: 36 }}>{idx + 1}</td>
                      <td style={tdBase}>{getProductName(record)}</td>
                      {/* 계좌별명 */}
                      <td style={tdBase}>
                        {(() => {
                          const acct = depositAccounts.find(a => a.id === record.deposit_account_id);
                          return acct ? (
                            <span style={{ color: 'var(--blue-400)', fontWeight: 500 }}>
                              {acct.nickname || `${acct.securities_company} ${acct.account_number || ''}`}
                            </span>
                          ) : <span style={{ color: 'var(--text-muted)' }}>-</span>;
                        })()}
                      </td>
                      <td style={{ ...tdRight }}>{formatCurrency(record.investment_amount)}</td>
                      <td style={{ ...tdRight }}>
                        {record.evaluation_amount != null ? formatCurrency(record.evaluation_amount) : '-'}
                      </td>
                      <td style={{ ...tdRight, color: returnColor, fontWeight: 600 }}>
                        {effectiveRate != null ? `${effectiveRate.toFixed(2)}%` : '-'}
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
                            {STATUS_LABELS[effectiveStatus]}
                          </span>

                          {/* ing → exit 전환 버튼 */}
                          {effectiveStatus === 'ing' && (<>
                            <button
                              onClick={() => setStatusChangeRecord({ ...record, product_name: getProductName(record) })}
                              title="종결 처리"
                              style={{ padding: '2px 6px', fontSize: 10, borderRadius: 4, border: '1px solid var(--border)', backgroundColor: 'var(--bg-card)', color: 'var(--text-muted)', cursor: 'pointer' }}
                            >종결</button>
                            <button
                              onClick={() => { setInterimRecord(record); setInterimYear(String(new Date().getFullYear())); setInterimAmount(''); }}
                              title="중간평가 입력"
                              style={{ padding: '2px 6px', fontSize: 10, borderRadius: 4, border: '1px solid var(--warning)', backgroundColor: 'var(--warning-bg)', color: 'var(--warning)', cursor: 'pointer' }}
                            >중간</button>
                          </>)}
                          {/* 중간평가 뱃지 */}
                          {record.interim_evaluations && Object.keys(record.interim_evaluations).length > 0 && (
                            <span
                              title={`중간평가: ${Object.entries(record.interim_evaluations).map(([y, v]) => `${y}년 ${(v as number).toLocaleString()}원`).join(', ')}`}
                              style={{ fontSize: 9, padding: '1px 4px', borderRadius: 3, backgroundColor: 'var(--warning-bg)', color: 'var(--warning)', fontWeight: 600 }}
                            >평가 {Object.keys(record.interim_evaluations).length}건</span>
                          )}
                        </div>
                      </td>

                      {/* 가입일 (start_date를 fallback으로 사용) */}
                      <td style={{ ...tdBase, backgroundColor: 'var(--bg-surface)', color: 'var(--text-muted)' }}>
                        {record.join_date || record.start_date || '-'}
                      </td>
                      <td style={{ ...tdBase, backgroundColor: 'var(--bg-surface)', color: 'var(--text-muted)' }}>
                        {record.expected_maturity_date ?? '-'}
                      </td>
                      <td style={{ ...tdBase, backgroundColor: 'var(--bg-surface)', color: 'var(--text-muted)' }}>
                        {record.actual_maturity_date ?? '-'}
                      </td>
                      <td style={{ ...tdBase, backgroundColor: 'var(--bg-surface)', color: 'var(--text-muted)' }}>
                        {record.original_maturity_date ?? '-'}
                      </td>
                      <td style={{ ...tdBase, color: 'var(--text-muted)', maxWidth: 180, fontSize: 11, lineHeight: '1.4', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const, wordBreak: 'break-word' }} title={record.memo || ''}>
                        {record.memo || '-'}
                      </td>

                      {/* 액션 */}
                      <td style={{ ...tdBase, textAlign: 'center', whiteSpace: 'nowrap' }}>
                        <button
                          onClick={() => startEditRecord(record)}
                          style={{ padding: '3px 8px', fontSize: 11, fontWeight: 500, borderRadius: 4, border: '1px solid var(--border-strong)', backgroundColor: 'var(--bg-card)', color: 'var(--text-secondary)', cursor: 'pointer', marginRight: 4 }}
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
                          style={{ padding: '3px 8px', fontSize: 11, fontWeight: 500, borderRadius: 4, border: '1px solid rgba(239,68,68,0.35)', backgroundColor: 'var(--danger-bg)', color: 'var(--danger)', cursor: 'pointer' }}
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
          <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 12, padding: 24, width: 400, boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700 }}>중간평가 입력</h3>
              <button onClick={() => setInterimRecord(null)} style={{ border: 'none', background: 'none', fontSize: 18, cursor: 'pointer' }}>×</button>
            </div>
            {/* 상품 정보 */}
            <div style={{ backgroundColor: 'var(--bg-surface)', borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 13 }}>
              <div><span style={{ color: 'var(--text-muted)' }}>상품명:</span> <strong>{getProductName(interimRecord)}</strong></div>
              <div><span style={{ color: 'var(--text-muted)' }}>가입일:</span> {interimRecord.join_date || interimRecord.start_date}</div>
              <div><span style={{ color: 'var(--text-muted)' }}>투자금액:</span> {interimRecord.investment_amount.toLocaleString()}원</div>
            </div>
            {/* 기존 중간평가 목록 */}
            {interimRecord.interim_evaluations && Object.keys(interimRecord.interim_evaluations).length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>기존 중간평가</div>
                {Object.entries(interimRecord.interim_evaluations).sort(([a], [b]) => Number(a) - Number(b)).map(([y, v]) => (
                  <div key={y} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 8px', fontSize: 12, backgroundColor: 'var(--warning-bg)', borderRadius: 4, marginBottom: 2 }}>
                    <span>{y}년: <strong>{(v as number).toLocaleString()}원</strong></span>
                    <button onClick={() => { deleteInterimEval(interimRecord, y); setInterimRecord({ ...interimRecord, interim_evaluations: (() => { const u = { ...interimRecord.interim_evaluations }; delete u[y]; return u; })() }); }} style={{ border: 'none', background: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 11 }}>삭제</button>
                  </div>
                ))}
              </div>
            )}
            {/* 신규 입력 */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>연도</label>
                <input type="number" value={interimYear} onChange={e => setInterimYear(e.target.value)} style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border-strong)', borderRadius: 6, fontSize: 13, backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)' }} />
              </div>
              <div style={{ flex: 2 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>평가금액 (원)</label>
                <input type="text" value={interimAmount ? Number(interimAmount).toLocaleString() : ''} onChange={e => setInterimAmount(e.target.value.replace(/[^\d]/g, ''))} placeholder="예: 150,000,000" style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border-strong)', borderRadius: 6, fontSize: 13, backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)' }} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setInterimRecord(null)} style={{ padding: '8px 16px', fontSize: 13, borderRadius: 6, border: '1px solid var(--border-strong)', backgroundColor: 'var(--bg-card)', cursor: 'pointer' }}>취소</button>
              <button onClick={saveInterimEval} disabled={interimSaving || !interimYear || !interimAmount} style={{ padding: '8px 16px', fontSize: 13, fontWeight: 600, borderRadius: 6, border: 'none', backgroundColor: 'var(--warning)', color: '#fff', cursor: 'pointer', opacity: interimSaving ? 0.6 : 1 }}>{interimSaving ? '저장 중...' : '저장'}</button>
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

      {/* Notion 투자기록 불러오기 모달 */}
      {showNotionImportModal && selectedCustomerId && (
        <NotionImportRecordsModal
          customerId={selectedCustomerId}
          customerName={selectedCustomer?.name ?? ''}
          existingKeys={new Set(records.map(r => `${getProductName(r).trim()}|${(r.join_date || r.start_date || '').slice(0, 10)}`))}
          onClose={() => setShowNotionImportModal(false)}
          onImported={() => {
            fetchRecords();
            fetchAnnualFlow();
            fetchDepositAccounts();
            expandedAccountIds.forEach(id => fetchTransactions(id));
          }}
        />
      )}

      {editingAccount && (
        <EditDepositAccountModal
          account={editingAccount}
          onClose={() => setEditingAccount(null)}
          onSaved={() => { fetchDepositAccounts(); setEditingAccount(null); }}
        />
      )}

      {/* Notion 예수금 거래 불러오기 모달 */}
      {showDepositNotionModal && (
        <NotionImportDepositTxModal
          customerId={selectedCustomerId}
          customerName={selectedCustomer?.name ?? ''}
          accounts={depositAccounts.filter(a => a.is_active)}
          onClose={() => setShowDepositNotionModal(false)}
          onAccountCreated={fetchDepositAccounts}
          onImported={() => {
            fetchDepositAccounts();
            expandedAccountIds.forEach(id => fetchTransactions(id));
            fetchAnnualFlow();
          }}
        />
      )}

      {/* 연간투자흐름표 계산식 도움말 */}
      {showFlowHelp && (
        <Modal open onClose={() => setShowFlowHelp(false)} title="연간 투자흐름표 — 필드별 계산 방식" maxWidth={680}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
            일시납·연적립·입금·인출은 <b style={{ color: 'var(--text-secondary)' }}>예수금 계좌 거래</b>에서, 납입·평가·수익은 <b style={{ color: 'var(--text-secondary)' }}>투자기록</b>에서 계산됩니다. 계좌 필터를 걸면 해당 계좌의 예수금 거래만 집계됩니다.
            항목 순서는 테이블 컬럼 순서와 동일하며, <b style={{ color: '#93C5FD' }}>★ 표시는 테이블에서 강조된 핵심 지표</b>(순입금액·순자산·순자산수익률)입니다.
          </div>
          {([
            ['기본', [
              ['연도', '투자 활동이 발생한 연도'],
              ['연차', '최초 투자(가장 이른 가입일) 연도를 1차로 산정'],
              ['나이', '연도 − 출생연도 (만 나이)'],
            ]],
            ['예수금 계좌 거래 기반', [
              ['일시납금액', "그 연도 예수금 거래 중 구분='입금' 의 입금액 합계 (거치 개념 · 투자/종결 거래 제외)"],
              ['연적립금액', "그 연도 예수금 거래의 적립액(자동이체) 합계 + 구분='적립' 의 입금액"],
              ['입금액', '일시납금액 + 연적립금액'],
              ['누적입금액', '시작 연도부터 그 연도까지 입금액 누적 합계'],
              ['인출금액', "투자기록의 인출 + 예수금 거래 중 구분='출금' 의 출금액 합계"],
              ['누적인출액', '시작 연도부터 그 연도까지 인출금액 누적 합계'],
              ['순입금액 ★', '해당 연도 누적입금액 − 해당 연도 누적인출액'],
            ]],
            ['순자산', [
              ['순자산 ★', '연도말 예수금 잔액 + 미종결 투자금액 + 이자수익'],
              ['순자산증가율', '(그해 순자산 − 직전 연도 순자산) ÷ 직전 연도 순자산 × 100'],
              ['순이익', '순자산 − 순입금액'],
              ['순자산수익률 ★', '순이익 ÷ 순입금액 × 100'],
            ]],
            ['투자기록 기반', [
              ['총납입금액', '그 연도 기준 살아있는(미종결 또는 당해 종결) 투자기록의 투자금액 합계'],
              ['연간평가금액', '당해 종결 상품의 평가금액 + 미종결 상품의 중간평가금액(없으면 원금)'],
              ['연간총수익', '연간평가금액 − 총납입금액'],
              ['연수익률', '연간총수익 ÷ 총납입금액 × 100'],
            ]],
            ['기타', [
              ['100세플로우', '해당 연도 순자산을 100세 은퇴플로우의 시작값으로 적용/취소'],
            ]],
          ] as [string, [string, string][]][]).map(([group, items]) => (
            <div key={group} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--blue-400)', marginBottom: 4 }}>{group}</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <tbody>
                  {items.map(([name, formula]) => (
                    <tr key={name} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '6px 8px', fontWeight: 600, color: 'var(--text-primary)', width: 110, verticalAlign: 'top', whiteSpace: 'nowrap' }}>{name}</td>
                      <td style={{ padding: '6px 8px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>{formula}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </Modal>
      )}

      {/* Notion 투자기록 동기화 미리보기 — 선택한 항목만 적용 */}
      {irSyncPlan && (
        <SyncPreviewModal
          title="Notion 투자기록 동기화 미리보기"
          subtitle={`'${selectedCustomer?.name ?? ''}'의 ${NOTION_IR_TARGET_CATEGORY} 상품 — 적용할 항목을 선택하세요. (신규=추가, 업데이트=평가금액·만기일 등 Notion 기준 덮어쓰기)`}
          items={irSyncPlan}
          checked={irSyncChecked}
          onToggle={k => setIrSyncChecked(prev => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; })}
          onToggleAll={() => setIrSyncChecked(prev => prev.size === irSyncPlan.length ? new Set() : new Set(irSyncPlan.map(i => i.key)))}
          applying={irSyncApplying}
          onApply={applyIrSync}
          onClose={() => { if (!irSyncApplying) setIrSyncPlan(null); }}
        />
      )}

      {/* Notion 예수금 거래 동기화 미리보기 — 선택한 항목만 적용 */}
      {dtxSyncPlan && (
        <SyncPreviewModal
          title="Notion 예수금 거래 동기화 미리보기"
          subtitle={`신규 거래만 표시됩니다${dtxSyncSkipped > 0 ? ` (중복/거래일 누락 ${dtxSyncSkipped}건 제외)` : ''} — 적용할 항목을 선택하세요.`}
          items={dtxSyncPlan}
          checked={dtxSyncChecked}
          onToggle={k => setDtxSyncChecked(prev => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; })}
          onToggleAll={() => setDtxSyncChecked(prev => prev.size === dtxSyncPlan.length ? new Set() : new Set(dtxSyncPlan.map(i => i.key)))}
          applying={dtxSyncApplying}
          onApply={applyDtxSync}
          onClose={() => { if (!dtxSyncApplying) setDtxSyncPlan(null); }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Wrap 상품 추가 모달                                                  */
/* ------------------------------------------------------------------ */

function AddWrapProductModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [productName, setProductName] = useState('');
  const [category, setCategory] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // 투자상품 관리(retirement/wrap-accounts)에서 상품 검색·선택
  const [pmList, setPmList] = useState<Array<{ id: string; product_name: string; category?: string | null; institution?: string | null }>>([]);
  const [catApiOpts, setCatApiOpts] = useState<string[]>([]);
  const [pmOpen, setPmOpen] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        const [pRes, cRes] = await Promise.all([
          fetch(`${API_URL}/api/v1/retirement/wrap-accounts`, { headers: authLib.getAuthHeader() }),
          fetch(`${API_URL}/api/v1/retirement/wrap-accounts/options?field_name=category`, { headers: authLib.getAuthHeader() }),
        ]);
        if (pRes.ok) { const d = await pRes.json(); setPmList(Array.isArray(d) ? d : d.items ?? []); }
        if (cRes.ok) { const o = await cRes.json(); setCatApiOpts((Array.isArray(o) ? o : []).map((x: { option_value: string }) => x.option_value).filter(Boolean)); }
      } catch { /* ignore */ }
    })();
  }, []);

  // 카테고리 목록 = 투자상품 관리 상품들의 실제 카테고리(distinct) + 옵션 설정값
  const categoryOptions = Array.from(new Set([
    ...catApiOpts,
    ...pmList.map(p => p.category).filter(Boolean) as string[],
  ])).sort((a, b) => a.localeCompare(b, 'ko'));

  const handleSave = async () => {
    if (!productName.trim()) { setError('상품명을 입력해주세요.'); return; }
    setSaving(true); setError('');
    try {
      const res = await fetch(`${API_URL}/api/v1/retirement/wrap-accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
        body: JSON.stringify({ product_name: productName.trim(), category: category.trim() || null }),
      });
      if (!res.ok) throw new Error();
      onSaved();
    } catch { setError('등록에 실패했습니다.'); }
    finally { setSaving(false); }
  };

  const mS: React.CSSProperties = { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 };
  const cS: React.CSSProperties = { backgroundColor: 'var(--bg-card)', borderRadius: 12, padding: 28, width: 460, boxShadow: '0 8px 24px rgba(0,0,0,0.25)' };
  const iS: React.CSSProperties = { width: '100%', padding: '10px 12px', fontSize: 14, border: '1px solid var(--border-strong)', borderRadius: 8, outline: 'none', boxSizing: 'border-box', backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)' };
  const lS: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 };

  const q = productName.trim().toLowerCase();
  // 상품명 중복 제거(같은 이름 여러 건 방지)
  const dedup = Array.from(new Map(pmList.filter(p => p.product_name).map(p => [p.product_name, p])).values());
  const matches = (q ? dedup.filter(p => p.product_name.toLowerCase().includes(q)) : dedup).slice(0, 40);

  return (
    <div style={mS} onClick={onClose}>
      <div style={cS} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 20px', fontSize: '1.1rem', fontWeight: 700, color: 'var(--blue-400)' }}>은퇴플랜 상품등록</h3>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* 상품명 — 투자상품 관리 검색 + 직접입력 */}
          <div style={{ position: 'relative' }}>
            <label style={lS}>상품명 <span style={{ color: 'var(--danger)' }}>*</span> <span style={{ fontWeight: 400, fontSize: 11, color: 'var(--text-muted)' }}>· 투자상품 관리에서 검색 또는 직접 입력</span></label>
            <input style={iS} value={productName}
              onChange={e => { setProductName(e.target.value); setPmOpen(true); }}
              onFocus={() => setPmOpen(true)}
              onBlur={() => setTimeout(() => setPmOpen(false), 150)}
              autoComplete="off"
              placeholder="상품명 검색 또는 직접 입력" />
            {pmOpen && matches.length > 0 && (
              <div style={{ position: 'absolute', top: 'calc(100% - 1px)', left: 0, right: 0, zIndex: 200, backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-strong)', borderTop: 'none', borderRadius: '0 0 8px 8px', maxHeight: 240, overflowY: 'auto' }}>
                {matches.map(p => (
                  <button key={p.id} type="button"
                    onMouseDown={() => { setProductName(p.product_name); if (p.category) setCategory(p.category); setPmOpen(false); }}
                    style={{ width: '100%', textAlign: 'left', padding: '8px 12px', border: 'none', borderBottom: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}
                    onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--bg-card-2)')}
                    onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}>
                    <span style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>{p.product_name}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>{[p.category, p.institution].filter(Boolean).join(' · ')}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 카테고리 — 투자상품 관리 카테고리 드롭다운(상품 선택 시 자동) */}
          <div>
            <label style={lS}>카테고리 <span style={{ fontWeight: 400, fontSize: 11, color: 'var(--text-muted)' }}>· 상품 선택 시 자동 · 목록에서 선택</span></label>
            <select style={{ ...iS, cursor: 'pointer' }} value={category} onChange={e => setCategory(e.target.value)}>
              <option value="">선택하세요</option>
              {(category && !categoryOptions.includes(category) ? [category, ...categoryOptions] : categoryOptions).map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          {error && <div style={{ fontSize: 12, color: 'var(--danger)' }}>{error}</div>}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 24 }}>
          <button onClick={onClose} style={{ padding: '8px 18px', fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' }}>취소</button>
          <button onClick={handleSave} disabled={saving || !productName.trim()}
            style={{ padding: '8px 18px', fontSize: 13, fontWeight: 700, color: '#fff', backgroundColor: saving || !productName.trim() ? 'var(--bg-surface)' : 'var(--blue-600)', border: 'none', borderRadius: 8, cursor: saving || !productName.trim() ? 'not-allowed' : 'pointer' }}>
            {saving ? '등록 중...' : '등록'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Notion 투자기록 불러오기 모달                                         */
/* ------------------------------------------------------------------ */

/** Notion 컬럼 ↔ 투자기록 필드 매핑 대상 (필터용 2개 + 실제 저장 필드 8개) */
const NOTION_IR_MAP_FIELDS: { k: string; l: string; filterHint?: boolean }[] = [
  { k: 'customer_name', l: '고객명', filterHint: true },
  { k: 'category', l: '카테고리', filterHint: true },
  { k: 'asset_class_1', l: '자산구분(1)' },
  { k: 'asset_class_2', l: '자산구분(2)' },
  { k: 'product_name', l: '상품명' },
  { k: 'investment_amount', l: '납입원금' },
  { k: 'evaluation_amount', l: '평가금액' },
  { k: 'join_date', l: '가입일' },
  { k: 'expected_maturity_date', l: '예상만기일' },
  { k: 'actual_maturity_date', l: '실제만기일' },
  { k: 'original_maturity_date', l: '원만기일' },
  { k: 'memo', l: '메모' },
];

const NOTION_IR_CONFIG_KEY = 'notion_investment_record_config_v2';
const NOTION_IR_TARGET_CATEGORY = '증권사투자';
const NOTION_IR_TARGET_DB = '상품가입정보';   // 고정 대상 Notion DB (제목 부분일치) — 예수금 모달과 동일

/** Notion 텍스트 → YYYY-MM-DD 정규화 (실패 시 null) */
function normalizeNotionDate(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const isoMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  const dotMatch = trimmed.match(/^(\d{4})[.\/](\d{1,2})[.\/](\d{1,2})/);
  if (dotMatch) {
    const [, y, m, d] = dotMatch;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  const parsed = new Date(trimmed);
  if (!isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const d = String(parsed.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return null;
}

/** 고객명 정규화 (괄호·공백 제거) — Notion 관계형 값과 견고하게 매칭 */
function notionNormName(s: string | undefined | null): string {
  return (s ?? '').replace(/\(.*?\)/g, '').replace(/\s+/g, '').toLowerCase();
}

/** Notion 동기화 미리보기 항목 — 적용 전에 사용자가 보고 선택한다 */
type SyncPlanItem = {
  key: string;
  action: 'add' | 'update';
  label: string;
  date?: string;
  amount?: number;         // 양수=입금/투자금액, 음수=출금
  body: Record<string, unknown>;
  recordId?: number;       // update 대상 투자기록 id
};

/** Notion 동기화 미리보기 모달 — 체크된 항목만 적용 */
function SyncPreviewModal({ title, subtitle, items, checked, onToggle, onToggleAll, applying, onApply, onClose }: {
  title: string;
  subtitle?: string;
  items: SyncPlanItem[];
  checked: Set<string>;
  onToggle: (k: string) => void;
  onToggleAll: () => void;
  applying: boolean;
  onApply: () => void;
  onClose: () => void;
}) {
  const allChecked = items.length > 0 && items.every(i => checked.has(i.key));
  const nAdd = items.filter(i => i.action === 'add' && checked.has(i.key)).length;
  const nUpd = items.filter(i => i.action === 'update' && checked.has(i.key)).length;
  return (
    <Modal open onClose={onClose} title={title} maxWidth={640}>
      {subtitle && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>{subtitle}</div>}
      <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ padding: '6px 10px', background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={allChecked} onChange={onToggleAll} style={{ width: 15, height: 15, cursor: 'pointer' }} />
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>전체선택 ({checked.size}/{items.length})</span>
        </div>
        <div style={{ maxHeight: 320, overflowY: 'auto' }}>
          {items.map(i => {
            const c = checked.has(i.key);
            return (
              <div key={i.key} onClick={() => onToggle(i.key)}
                style={{ padding: '7px 10px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, cursor: 'pointer', background: c ? 'rgba(16,185,129,0.08)' : 'var(--bg-card)' }}>
                <input type="checkbox" checked={c} onChange={() => onToggle(i.key)} onClick={e => e.stopPropagation()}
                  style={{ width: 14, height: 14, flexShrink: 0, cursor: 'pointer' }} />
                <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 10,
                  color: i.action === 'add' ? 'var(--blue-400)' : 'var(--warning)',
                  border: `1px solid ${i.action === 'add' ? 'rgba(59,130,246,0.4)' : 'rgba(245,158,11,0.4)'}` }}>
                  {i.action === 'add' ? '신규' : '업데이트'}
                </span>
                {i.date && <span style={{ color: 'var(--text-muted)', fontSize: 11, flexShrink: 0, minWidth: 72 }}>{i.date}</span>}
                <span style={{ fontWeight: 600, color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.label}</span>
                {i.amount != null && (
                  <span style={{ color: i.amount >= 0 ? '#3B82F6' : 'var(--danger)', fontSize: 11, flexShrink: 0 }}>
                    {i.amount >= 0 ? '+' : ''}{i.amount.toLocaleString()}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>신규 {nAdd}건{nUpd > 0 ? ` · 업데이트 ${nUpd}건` : ''} 적용 예정</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onClose} disabled={applying}
            style={{ padding: '7px 14px', borderRadius: 7, border: '1px solid var(--border-strong)', fontSize: 13, fontWeight: 600, backgroundColor: 'var(--bg-card)', color: 'var(--text-secondary)', cursor: applying ? 'wait' : 'pointer' }}>
            취소
          </button>
          <button onClick={onApply} disabled={applying || checked.size === 0}
            style={{ padding: '7px 18px', borderRadius: 7, border: 'none', fontSize: 13, fontWeight: 700,
              background: (applying || checked.size === 0) ? 'var(--bg-surface)' : 'var(--blue-600)',
              color: (applying || checked.size === 0) ? 'var(--text-muted)' : '#fff',
              cursor: (applying || checked.size === 0) ? 'not-allowed' : 'pointer' }}>
            {applying ? '적용 중...' : `선택 ${checked.size}건 적용`}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Notion rows 조회 — 서버 필터가 0건이면 조건을 줄여가며 재시도 (전체조건 → 첫 조건만 → 무필터).
 *  Notion 컬럼 타입/값 표기가 필터와 어긋나도 데이터를 받아온 뒤 클라이언트 필터가 최종 판정한다. */
async function fetchNotionRowsWithFallback(
  dbId: string,
  pairs: { property?: string; value?: string }[],
  propNames?: string[],   // 지정 시 해당 컬럼만 받아옴 (롤업·관계형 해석 생략 → 대폭 고속화)
): Promise<{ id: string; properties: Record<string, string> }[]> {
  const wanted = (propNames ?? []).filter(Boolean);
  const propsQS = wanted.length ? `props=${encodeURIComponent(JSON.stringify(wanted))}` : '';
  const withProps = (fq: string) => (propsQS ? (fq ? `${fq}&${propsQS}` : `?${propsQS}`) : fq);
  const fqFull = notionFilterQS(pairs);
  const fqFirst = pairs.length > 1 ? notionFilterQS([pairs[0]]) : '';
  const attempts = [...new Set([fqFull, fqFirst, ''])];   // 중복 제거, 마지막은 무필터
  let lastErr: Error | null = null;
  for (const fq of attempts) {
    try {
      const res = await fetch(`${API_URL}/api/v1/notion/databases/${dbId}/rows${withProps(fq)}`, { headers: authLib.getAuthHeader() });
      if (!res.ok) {
        const d = await res.json().catch(() => ({} as { detail?: string }));
        lastErr = new Error(d?.detail || `데이터 조회 실패 (HTTP ${res.status})`);
        continue;
      }
      const rows = await res.json();
      if (Array.isArray(rows) && rows.length > 0) return rows;
    } catch (e) { lastErr = e instanceof Error ? e : new Error('네트워크 오류'); }
  }
  if (lastErr) throw lastErr;
  return [];
}

/** Notion rows 조회용 서버측 필터 쿼리스트링 (고객명·카테고리) — DB 전체 다운로드로 인한 504 방지.
 *  서버 필터는 최적화일 뿐, 클라이언트 필터가 최종 판정하므로 일부 조건이 생략돼도 결과는 동일하다. */
function notionFilterQS(pairs: { property?: string; value?: string }[]): string {
  const valid = pairs
    .filter(p => !!p.property && !!p.value?.trim())
    // 괄호 표기(예: '박민환(HB5236)')는 제거 후 contains 매칭 — 양쪽 표기 차이에 견고
    .map(p => ({ property: p.property as string, value: (p.value as string).replace(/\(.*?\)/g, '').trim() }));
  return valid.length ? `?filters=${encodeURIComponent(JSON.stringify(valid))}` : '';
}

/** Notion 행 + 매핑 → 투자기록 body (가입일 파싱 실패 시 null). 불러오기·동기화 공통 사용 */
function notionRowToRecordBody(
  row: { properties: Record<string, string> },
  mapping: Record<string, string>,
  profileId: string,
): Record<string, unknown> | null {
  const g = (k: string) => (mapping[k] ? row.properties[mapping[k]] : undefined);
  const productName = mapping['product_name'] ? row.properties[mapping['product_name']]?.trim() : '';
  const startDate = normalizeNotionDate(g('join_date'));
  if (!startDate) return null;
  const actDate = normalizeNotionDate(g('actual_maturity_date'));
  return {
    profile_id: profileId,
    record_type: 'investment',
    product_name: productName || null,
    investment_amount: parseNotionAmountToWon(g('investment_amount')) ?? 0,
    evaluation_amount: parseNotionAmountToWon(g('evaluation_amount')),
    // 실제만기일이 있으면 종결, 없으면 운용중
    status: actDate ? 'exit' : 'ing',
    start_date: startDate,
    join_date: startDate,
    expected_maturity_date: normalizeNotionDate(g('expected_maturity_date')),
    actual_maturity_date: actDate,
    original_maturity_date: normalizeNotionDate(g('original_maturity_date')),
    memo: mapping['memo'] ? (row.properties[mapping['memo']]?.trim() || null) : null,
  };
}

/** Notion 금액 문자열 → 원 단위 정수. '만원/만' 표기가 있으면 ×10000, 그 외는 원 그대로 (원단위 보존). */
function parseNotionAmountToWon(raw: string | undefined | null): number | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const hasManwon = /만\s*원|만$/.test(trimmed);
  const numStr = trimmed.replace(/[^0-9.\-]/g, '');
  if (!numStr) return null;
  let num = parseFloat(numStr);
  if (isNaN(num)) return null;
  if (hasManwon) num = num * 10000;
  return Math.round(num);
}

/* ================================================================== */
/*  예수금 거래 Notion 불러오기 — 상수·헬퍼                            */
/* ================================================================== */

// v4: 고객별 전용 DB(예: '올원랩어카운트_고객명') 방식 — 고객명/카테고리/메모 매핑 제거, 고객별 설정 저장
const NOTION_DTX_CONFIG_KEY = 'notion_deposit_tx_config_v4';

const NOTION_DTX_MAP_FIELDS: { k: string; l: string; req?: boolean; filter?: boolean }[] = [
  { k: 'transaction_date', l: '발생일', req: true },
  { k: 'related_product', l: '상품명' },
  { k: 'credit_amount', l: '입금액' },
  { k: 'credit_amount_2', l: '적립액(자동이체)' },
  { k: 'debit_amount', l: '출금액' },
  { k: 'transaction_type', l: '구분' },
  { k: 'account_number', l: '증권번호' },   // 거래 테이블이 아닌 예수금 계좌 정보(계좌번호)로 저장
];

/** 컬럼명 키워드 추측 (module scope 공용) */
function notionGuessColumn(cols: string[], keywords: string[]): string {
  const found = cols.find(c => { const cl = c.toLowerCase(); return keywords.some(k => cl.includes(k)); });
  return found ?? '';
}

function autoGuessDtxMapping(cols: string[]): Record<string, string> {
  const pick = (exact: string, guesses: string[]) => (cols.includes(exact) ? exact : notionGuessColumn(cols, guesses));
  // 고객별 예수금 DB의 6개 필드(상품명·구분·발생일·자동이체·입금액·출금액) 기준 자동 매칭
  return {
    transaction_date: pick('발생일', ['발생일', '거래일', '가입일', '일자', '날짜', 'date']),
    related_product: pick('상품명', ['상품명', '관련상품', '상품', 'product']),
    credit_amount: pick('입금액', ['입금액', '입금', 'credit']),
    credit_amount_2: pick('자동이체', ['자동이체', '이체', '적립']),
    debit_amount: pick('출금액', ['출금액', '출금', 'debit']),
    transaction_type: pick('구분', ['구분', '거래유형', '유형', 'type']),
    account_number: pick('증권번호', ['증권번호', '계좌번호']),
  };
}

/** Notion 거래유형 텍스트 → 내부 TransactionType */
function normalizeNotionTxType(raw: string | undefined | null): TransactionType {
  const s = (raw ?? '').trim().toLowerCase();
  if (!s) return 'deposit';
  if (/입금|deposit/.test(s)) return 'deposit';
  if (/출금|withdraw/.test(s)) return 'withdrawal';
  if (/이자|interest/.test(s)) return 'interest';
  if (/적립|saving/.test(s)) return 'savings';
  if (/투자|invest/.test(s)) return 'investment';
  if (/종료|해지|만기|terminat/.test(s)) return 'termination';
  return 'other';
}

/** Notion 행 + 매핑 → 예수금 거래 body (거래일 파싱 실패 시 null) */
function notionRowToTxBody(
  row: { properties: Record<string, string> },
  mapping: Record<string, string>,
): Record<string, unknown> | null {
  const g = (k: string) => (mapping[k] ? row.properties[mapping[k]] : undefined);
  const date = normalizeNotionDate(g('transaction_date'));
  if (!date) return null;
  // 입금액과 적립액(자동이체)을 분리 저장 — 잔액 = 입금 + 적립 - 출금
  const credit = parseNotionAmountToWon(g('credit_amount')) ?? 0;
  const savings = parseNotionAmountToWon(g('credit_amount_2')) ?? 0;
  const debit = parseNotionAmountToWon(g('debit_amount')) ?? 0;
  // 거래유형 미매핑 시 입/적립/출금액으로 추론
  const ttype = mapping['transaction_type']
    ? normalizeNotionTxType(g('transaction_type'))
    : (credit > 0 ? 'deposit' : savings > 0 ? 'savings' : debit > 0 ? 'withdrawal' : 'other');
  return {
    transaction_date: date,
    transaction_type: ttype,
    related_product: mapping['related_product'] ? (row.properties[mapping['related_product']]?.trim() || null) : null,
    credit_amount: credit,
    savings_amount: savings,
    debit_amount: debit,
    memo: mapping['memo'] ? (row.properties[mapping['memo']]?.trim() || null) : null,
  };
}

/** 중복 판정 키: 거래일|입금액|적립액|출금액|거래유형 */
function notionTxBodyKey(body: Record<string, unknown>): string {
  return `${body.transaction_date}|${body.credit_amount}|${Number(body.savings_amount ?? 0)}|${body.debit_amount}|${body.transaction_type}`;
}
function depositTxKey(t: DepositTransaction): string {
  return `${t.transaction_date}|${t.credit_amount}|${t.savings_amount ?? 0}|${t.debit_amount}|${t.transaction_type}`;
}

/* ------------------------------------------------------------------ */
/*  다크 커스텀 드롭다운 (네이티브 select의 OS 밝은 팝업 문제 해결)      */
/*  Modal이 overflow:hidden이라 portal + fixed 위치로 렌더            */
/* ------------------------------------------------------------------ */
function MapSelect({ value, onChange, options, placeholder = '--', highlight = false, minWidth }: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  highlight?: boolean;
  minWidth?: number;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; width: number; top?: number; bottom?: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const openMenu = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) {
      const belowSpace = window.innerHeight - r.bottom;
      const openUp = belowSpace < 240 && r.top > belowSpace;
      setPos({
        left: r.left,
        width: r.width,
        top: openUp ? undefined : r.bottom + 2,
        bottom: openUp ? window.innerHeight - r.top + 2 : undefined,
      });
    }
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      // 트리거 버튼 안이나 포털 메뉴 안 클릭은 닫지 않음 (옵션 선택이 취소되지 않도록)
      if (btnRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    // 메뉴 내부 스크롤(옵션 목록 스크롤바)은 닫지 않음 — 바깥 페이지 스크롤만 닫음
    const onScroll = (e: Event) => {
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  const selected = options.find(o => o.value === value);
  const items = [{ value: '', label: placeholder }, ...options];

  return (
    <div style={{ position: 'relative', flex: 1, minWidth }}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openMenu())}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4,
          padding: '4px 8px', borderRadius: 4, fontSize: 11, cursor: 'pointer', textAlign: 'left',
          border: '1px solid var(--border-strong)',
          backgroundColor: highlight ? 'rgba(16,185,129,0.12)' : 'var(--bg-card)',
          color: selected ? 'var(--text-primary)' : 'var(--text-muted)',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selected ? selected.label : placeholder}</span>
        <span style={{ fontSize: 9, color: 'var(--text-muted)', flexShrink: 0 }}>▼</span>
      </button>
      {mounted && open && pos && createPortal(
        <div
          ref={menuRef}
          style={{
            position: 'fixed', left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom,
            zIndex: 2000, maxHeight: 240, overflowY: 'auto',
            backgroundColor: '#1a2332', border: '1px solid #2d3a4f', borderRadius: 6,
            boxShadow: '0 8px 28px rgba(0,0,0,0.45)', padding: '4px 0',
          }}
        >
          {items.map(o => {
            const isSel = o.value === value;
            return (
              <div
                key={o.value || '__empty'}
                onClick={() => { onChange(o.value); setOpen(false); }}
                style={{
                  padding: '6px 10px', fontSize: 11, cursor: 'pointer',
                  color: isSel ? '#60A5FA' : '#e5e7eb',
                  backgroundColor: isSel ? 'rgba(59,130,246,0.15)' : 'transparent',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.backgroundColor = 'rgba(255,255,255,0.07)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.backgroundColor = isSel ? 'rgba(59,130,246,0.15)' : 'transparent'; }}
              >
                {o.label}
              </div>
            );
          })}
        </div>,
        document.body
      )}
    </div>
  );
}

interface NotionImportRecordsModalProps {
  customerId: string;
  customerName: string;
  existingKeys: Set<string>;
  onClose: () => void;
  onImported: () => void;
}

function NotionImportRecordsModal({ customerId, customerName, existingKeys, onClose, onImported }: NotionImportRecordsModalProps) {
  const [irStep, setIrStep] = useState<'idle' | 'selectDb' | 'mapping'>('idle');
  const [irDbs, setIrDbs] = useState<{ id: string; title: string; icon: string | null }[]>([]);
  const [irRows, setIrRows] = useState<{ id: string; properties: Record<string, string> }[]>([]);
  const [irCols, setIrCols] = useState<string[]>([]);
  const [irMap, setIrMap] = useState<Record<string, string>>({});
  const [irLoading, setIrLoading] = useState(false);
  const [irError, setIrError] = useState<string | null>(null);
  const [irDbSearch, setIrDbSearch] = useState('');
  const [irRowSearch, setIrRowSearch] = useState('');
  const [irSelectedDbId, setIrSelectedDbId] = useState('');
  const [irSelectedDbTitle, setIrSelectedDbTitle] = useState('');
  const [irSelectedRows, setIrSelectedRows] = useState<Set<string>>(new Set());
  const [irBulkLoading, setIrBulkLoading] = useState(false);
  const [irLoaded, setIrLoaded] = useState(false);  // '불러오기' 클릭 시 true → 조건 맞는 행 표시

  function saveIrConfig(dbId: string, dbTitle: string, mapping: Record<string, string>) {
    try { localStorage.setItem(NOTION_IR_CONFIG_KEY, JSON.stringify({ dbId, dbTitle, mapping })); } catch { /* ignore */ }
  }
  function loadIrConfig(): { dbId: string; dbTitle: string; mapping: Record<string, string> } | null {
    try { const r = localStorage.getItem(NOTION_IR_CONFIG_KEY); return r ? JSON.parse(r) : null; } catch { return null; }
  }
  function clearIrConfig() {
    try { localStorage.removeItem(NOTION_IR_CONFIG_KEY); } catch { /* ignore */ }
  }

  function guessColumn(cols: string[], keywords: string[]): string {
    const found = cols.find(c => {
      const cl = c.toLowerCase();
      return keywords.some(k => cl.includes(k));
    });
    return found ?? '';
  }

  function autoGuessMapping(cols: string[]): Record<string, string> {
    // 정확한 컬럼명이 있으면 그것을, 없으면 키워드 추측. (상품가입정보 DB 실제 컬럼명 우선)
    const pick = (exact: string, guesses: string[]) => (cols.includes(exact) ? exact : guessColumn(cols, guesses));
    return {
      customer_name: pick('고객명', ['고객명', '고객', 'customer', '이름']),
      category: pick('카테고리', ['카테고리', 'category']),
      asset_class_1: pick('자산구분(1)', ['자산구분(1)', '자산구분1']),
      asset_class_2: pick('자산구분(2)', ['자산구분(2)', '자산구분2']),
      product_name: pick('상품명', ['상품명', '상품', 'product']),
      investment_amount: pick('일시납입금액', ['일시납입', '납입원금', '원금', '납입', '투자금액']),
      evaluation_amount: pick('평가금액', ['평가금액', '평가', 'eval']),
      join_date: pick('가입일', ['가입일', '가입', 'join']),
      expected_maturity_date: pick('예상만기일', ['예상만기']),
      actual_maturity_date: pick('실제만기일', ['실제만기']),
      original_maturity_date: pick('원 만기일', ['원 만기', '원만기']),
      memo: pick('비고', ['비고', '메모', 'note', 'memo']),
    };
  }

  async function irFetchDbList() {
    setIrLoading(true); setIrError(null);
    try {
      const res = await fetch(`${API_URL}/api/v1/notion/databases`, { headers: authLib.getAuthHeader() });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d?.detail || `조회 실패 (HTTP ${res.status})`); }
      setIrDbs(await res.json());
      setIrStep('selectDb');
    } catch (e: unknown) { setIrError(e instanceof Error ? e.message : '오류'); }
    finally { setIrLoading(false); }
  }

  async function irLoadRows(dbId: string, dbTitle: string, savedMapping?: Record<string, string>): Promise<boolean> {
    setIrLoading(true); setIrError(null);
    setIrSelectedDbId(dbId);
    setIrSelectedDbTitle(dbTitle);
    try {
      // 1) 컬럼 목록 먼저 → 매핑 확정
      const pR = await fetch(`${API_URL}/api/v1/notion/databases/${dbId}/properties`, { headers: authLib.getAuthHeader() });
      if (!pR.ok) {
        const d = await pR.json().catch(() => ({} as { detail?: string }));
        throw new Error(d?.detail || `데이터 조회 실패 (HTTP ${pR.status})`);
      }
      const props: { name: string }[] = await pR.json();
      const cols = props.map(p => p.name);
      const resolvedMap = savedMapping ?? autoGuessMapping(cols);
      // 2) 고객명·카테고리 서버측 필터로 이 고객 행만 조회 (전체 DB 다운로드 → 504 방지)
      //    필터가 0건이면 조건을 줄여 재시도 — 컬럼 타입/값 표기 차이에 견고
      const rows = await fetchNotionRowsWithFallback(
        dbId,
        [
          { property: resolvedMap['customer_name'], value: customerName },
          { property: resolvedMap['category'], value: NOTION_IR_TARGET_CATEGORY },
        ],
        Object.values(resolvedMap),   // 매핑된 컬럼만 받아 페이지당 응답 고속화
      );
      setIrCols(cols);
      setIrRows(rows);
      setIrMap(resolvedMap);
      // 매핑 화면 진입 즉시 저장 → 다음에 열면 DB·매핑 자동 복원(재매칭 불필요)
      saveIrConfig(dbId, dbTitle, resolvedMap);
      setIrStep('mapping');
      return true;
    } catch (e: unknown) { setIrError(e instanceof Error ? e.message : '오류'); return false; }
    finally { setIrLoading(false); }
  }

  // 대상 DB('상품가입정보')를 목록에서 찾아 자동 선택. 없으면 수동 선택으로 폴백
  // keepMapping: 같은 대상 DB로 재연결하는 경우 기존 필드 매핑을 그대로 이어받음
  async function irAutoSelectDb(keepMapping?: Record<string, string>) {
    setIrError(null); setIrLoading(true);
    let list: { id: string; title: string; icon: string | null }[];
    try {
      const res = await fetch(`${API_URL}/api/v1/notion/databases`, { headers: authLib.getAuthHeader() });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d?.detail || `조회 실패 (HTTP ${res.status})`); }
      list = await res.json();
      setIrDbs(list);
    } catch (e: unknown) { setIrError(e instanceof Error ? e.message : '오류'); setIrLoading(false); return; }
    const target = list.find(d => d.title.includes(NOTION_IR_TARGET_DB));
    if (target) {
      await irLoadRows(target.id, target.title, keepMapping);   // irLoadRows가 loading 처리
    } else {
      setIrLoading(false);
      setIrStep('selectDb');   // 대상 DB를 못 찾으면 수동 선택
    }
  }

  async function irOpenSelector() {
    const saved = loadIrConfig();
    // 저장된 설정이 대상 DB('상품가입정보')가 아니면 오염된 설정 → 폐기 후 자동 재연결
    // (과거 'DB 변경'으로 다른 DB가 저장되면 매핑이 통째로 덮여 사라지던 문제의 자가 복구)
    if (saved && saved.dbId && saved.dbTitle?.includes(NOTION_IR_TARGET_DB)) {
      const ok = await irLoadRows(saved.dbId, saved.dbTitle, saved.mapping);
      if (!ok) { clearIrConfig(); await irAutoSelectDb(saved.mapping); }  // dbId만 낡은 경우: 매핑은 보존한 채 재연결
    } else {
      if (saved) clearIrConfig();
      await irAutoSelectDb();   // 다른 DB의 매핑은 의미 없으므로 자동 추측으로 새로 매칭
    }
  }

  useEffect(() => {
    irOpenSelector();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function irReset() {
    setIrStep('idle'); setIrDbs([]); setIrRows([]); setIrCols([]);
    setIrError(null); setIrDbSearch(''); setIrRowSearch('');
    setIrSelectedRows(new Set());
    clearIrConfig();
  }

  function irUpdateMap(key: string, value: string) {
    const updated = { ...irMap, [key]: value };
    setIrMap(updated);
    setIrLoaded(false);  // 매핑 바뀌면 다시 '불러오기' 눌러야 함
    if (irSelectedDbId) {
      saveIrConfig(irSelectedDbId, irSelectedDbTitle, updated);
      // 서버측 필터 컬럼이 바뀌면 새 필터로 행 재조회 (이전 필터로 받은 행엔 누락 가능)
      if (key === 'customer_name' || key === 'category') {
        void irLoadRows(irSelectedDbId, irSelectedDbTitle, updated);
      }
    }
  }

  /* ---- 필터: 고객명 일치 + 카테고리 = 증권사투자, '불러오기' 클릭 시 적용 ---- */
  const customerNameCol = irMap['customer_name'];
  const categoryCol = irMap['category'];
  const filterReady = !!customerNameCol && !!categoryCol;

  const matchedRows = (filterReady && irLoaded)
    ? irRows.filter(r =>
        notionNormName(r.properties[customerNameCol]) === notionNormName(customerName) &&
        (r.properties[categoryCol] ?? '').trim() === NOTION_IR_TARGET_CATEGORY
      )
    : [];

  const q = irRowSearch.toLowerCase().trim();
  const displayRows = q
    ? matchedRows.filter(r => Object.values(r.properties).some(v => v?.toLowerCase().includes(q)))
    : matchedRows;

  function irToggleRow(id: string) {
    setIrSelectedRows(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  /** Notion 행의 중복 판정 키: 상품명|가입일 (투자기록의 키와 동일 형식) */
  function irRowKey(row: { properties: Record<string, string> }): string {
    const pn = irMap['product_name'] ? (row.properties[irMap['product_name']]?.trim() ?? '') : '';
    const jd = normalizeNotionDate(irMap['join_date'] ? row.properties[irMap['join_date']] : undefined) ?? '';
    return `${pn}|${jd}`;
  }
  function irIsExisting(row: { properties: Record<string, string> }): boolean {
    return existingKeys.has(irRowKey(row));
  }

  function irToggleAll() {
    // 이미 등록된 행은 제외하고, 신규 행만 전체 선택/해제
    const newIds = displayRows.filter(r => !irIsExisting(r)).map(r => r.id);
    const allSelected = newIds.length > 0 && newIds.every(id => irSelectedRows.has(id));
    setIrSelectedRows(prev => {
      const next = new Set(prev);
      if (allSelected) newIds.forEach(id => next.delete(id));
      else newIds.forEach(id => next.add(id));
      return next;
    });
  }

  /** Notion 행 → 투자기록 생성 body (가입일 파싱 실패 시 null 반환) */
  function irMapRowToBody(row: { properties: Record<string, string> }): Record<string, unknown> | null {
    return notionRowToRecordBody(row, irMap, customerId);
  }

  async function irBulkImport() {
    if (irSelectedRows.size === 0) return;
    setIrBulkLoading(true);
    let success = 0, fail = 0, skipped = 0;
    const items = displayRows.filter(r => irSelectedRows.has(r.id));
    for (const row of items) {
      const body = irMapRowToBody(row);
      if (!body) { skipped++; continue; }
      try {
        const res = await fetch(`${API_URL}/api/v1/retirement/investment-records`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
          body: JSON.stringify(body),
        });
        if (res.ok) success++; else fail++;
      } catch { fail++; }
    }
    setIrBulkLoading(false);
    setIrSelectedRows(new Set());
    saveIrConfig(irSelectedDbId, irSelectedDbTitle, irMap);
    alert(`${success}건 등록 완료${fail > 0 ? `, ${fail}건 실패` : ''}${skipped > 0 ? `, ${skipped}건 가입일 누락으로 스킵` : ''}`);
    onImported();
    onClose();
  }

  /* ---- 목록 불러오기 = 이 고객의 '증권사투자' 상품을 리스트로 표시 (신규만 자동 체크) ---- */
  function irLoadList() {
    if (!filterReady) return;
    const target = notionNormName(customerName);
    const matched = irRows.filter(r =>
      notionNormName(r.properties[customerNameCol]) === target &&
      (r.properties[categoryCol] ?? '').trim() === NOTION_IR_TARGET_CATEGORY
    );
    if (matched.length === 0) {
      // 진단: 불러온 행의 실제 값을 보여줘 어느 쪽(고객명/카테고리)이 어긋났는지 바로 확인
      const sample = (col: string) =>
        [...new Set(irRows.map(r => (r.properties[col] ?? '').trim()).filter(Boolean))].slice(0, 5).join(', ') || '(비어있음)';
      alert(
        `'${customerName}' 고객의 '${NOTION_IR_TARGET_CATEGORY}' 상품을 Notion에서 찾지 못했습니다.\n\n` +
        `불러온 행 ${irRows.length}건 기준 실제 값 예시:\n` +
        `· 고객명(${customerNameCol}): ${sample(customerNameCol)}\n` +
        `· 카테고리(${categoryCol}): ${sample(categoryCol)}\n\n` +
        `위 값이 화면과 다르면 Notion 값 또는 매핑 컬럼을 확인하세요.`
      );
      return;
    }
    // 기존 투자기록에 없는 신규 상품만 미리 체크
    const preselect = new Set<string>();
    for (const r of matched) {
      if (!irIsExisting(r)) preselect.add(r.id);
    }
    setIrSelectedRows(preselect);
    setIrLoaded(true);
    saveIrConfig(irSelectedDbId, irSelectedDbTitle, irMap);
  }

  return (
    <Modal open onClose={onClose} title="Notion에서 투자기록 불러오기" maxWidth={720}>
      <div style={{ marginBottom: 8, padding: '8px 12px', borderRadius: 8, backgroundColor: 'var(--bg-surface)', fontSize: 12, color: 'var(--text-muted)' }}>
        고객 <strong style={{ color: 'var(--text-primary)' }}>{customerName || '(선택된 고객)'}</strong> · 카테고리 <strong style={{ color: 'var(--text-primary)' }}>{NOTION_IR_TARGET_CATEGORY}</strong> 조건에 맞는 행만 표시·등록됩니다.
      </div>

      {irStep === 'idle' && (
        <button
          onClick={irOpenSelector}
          disabled={irLoading}
          style={{ width: '100%', padding: 9, borderRadius: 8, border: '1px dashed var(--border-strong)', background: 'var(--bg-surface)', color: 'var(--text-secondary)', fontSize: 13, fontWeight: 500, cursor: irLoading ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
        >
          {irLoading ? '연결 중...' : (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              Notion에서 데이터 가져오기
            </>
          )}
        </button>
      )}

      {irError && (
        <div style={{ marginTop: 6, padding: '6px 10px', borderRadius: 6, background: 'var(--danger-bg)', border: '1px solid rgba(239,68,68,0.35)', fontSize: 12, color: 'var(--danger)', display: 'flex', justifyContent: 'space-between' }}>
          <span>{irError}</span>
          <button onClick={irReset} style={{ background: 'none', border: 'none', color: 'var(--danger)', textDecoration: 'underline', cursor: 'pointer', fontSize: 12 }}>닫기</button>
        </div>
      )}

      {irStep === 'selectDb' && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ padding: '7px 10px', background: 'var(--bg-surface)', fontSize: 12, fontWeight: 600, color: 'var(--blue-400)', display: 'flex', justifyContent: 'space-between' }}>
            <span>데이터베이스 선택</span>
            <button onClick={irReset} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12 }}>취소</button>
          </div>
          <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>
            <input type="text" placeholder="검색..." value={irDbSearch} onChange={e => setIrDbSearch(e.target.value)}
              style={{ width: '100%', padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border-strong)', fontSize: 12, outline: 'none', boxSizing: 'border-box', backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)' }} />
          </div>
          {irLoading ? (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>불러오는 중...</div>
          ) : (
            <div style={{ maxHeight: 180, overflowY: 'auto' }}>
              {irDbs.filter(d => !irDbSearch || d.title.toLowerCase().includes(irDbSearch.toLowerCase())).map(d => (
                <button key={d.id}
                  onClick={() => { setIrDbSearch(''); irLoadRows(d.id, d.title); }}
                  style={{ width: '100%', padding: '9px 10px', border: 'none', borderBottom: '1px solid var(--border)', background: 'var(--bg-card)', textAlign: 'left', cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-primary)' }}
                  onMouseOver={e => (e.currentTarget.style.background = 'var(--bg-card-2)')}
                  onMouseOut={e => (e.currentTarget.style.background = 'var(--bg-card)')}
                >
                  <span>{d.icon ?? '📄'}</span>
                  <span style={{ fontWeight: 500 }}>{d.title}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {irStep === 'mapping' && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ padding: '7px 10px', background: 'var(--bg-surface)', fontSize: 12, fontWeight: 600, color: 'var(--blue-400)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>필드 매핑 + 투자기록 선택 {irSelectedDbTitle ? `(${irSelectedDbTitle})` : ''}</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => { clearIrConfig(); setIrRows([]); setIrCols([]); irFetchDbList(); }}
                style={{ background: 'none', border: 'none', color: 'var(--blue-400)', cursor: 'pointer', fontSize: 11 }}>DB 변경</button>
              <button onClick={irReset} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12 }}>취소</button>
            </div>
          </div>
          {irLoading ? (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>데이터 불러오는 중...</div>
          ) : (
            <>
              <div style={{ padding: '8px 10px', background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>Notion 컬럼 → 투자기록 필드 매핑 (고객명·카테고리는 필터에도 사용됩니다)</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
                  {NOTION_IR_MAP_FIELDS.map(f => (
                    <div key={f.k} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
                      <span style={{ width: 84, color: f.filterHint ? 'var(--blue-400)' : 'var(--text-secondary)', fontWeight: 600, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {f.l}{f.filterHint ? ' *' : ''}
                      </span>
                      <MapSelect
                        value={irMap[f.k] ?? ''}
                        onChange={v => irUpdateMap(f.k, v)}
                        options={irCols.map(c => ({ value: c, label: c }))}
                        highlight={!!irMap[f.k]}
                      />
                    </div>
                  ))}
                </div>
              </div>

              {!filterReady && (
                <div style={{ padding: '10px 14px', fontSize: 12, color: 'var(--warning)', backgroundColor: 'rgba(245,158,11,0.1)', borderBottom: '1px solid var(--border)' }}>
                  ‘고객명’과 ‘카테고리’ 필드를 먼저 매핑하세요.
                </div>
              )}

              {/* 불러오기 버튼 + 검색 */}
              <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center' }}>
                <button
                  onClick={irLoadList}
                  disabled={!filterReady}
                  title={filterReady ? '' : '고객명·카테고리 매핑 필요'}
                  style={{ flex: 1, padding: '9px 16px', borderRadius: 7, border: 'none', fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap',
                    cursor: !filterReady ? 'not-allowed' : 'pointer',
                    backgroundColor: !filterReady ? 'var(--bg-surface)' : 'var(--blue-600)',
                    color: !filterReady ? 'var(--text-muted)' : '#fff' }}
                >{`🔍 ‘${customerName || '고객'}’의 ${NOTION_IR_TARGET_CATEGORY} 상품 목록 불러오기`}</button>
              </div>

              <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                {!irLoaded ? (
                  <div style={{ padding: 14, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                    {filterReady ? '위 ‘목록 불러오기’ 버튼을 누르면 이 고객의 증권사투자 상품 목록을 보여줍니다. 기존에 없는 신규 상품만 자동 체크되며, 빼고 싶은 상품은 체크를 해제하세요.' : '고객명·카테고리 필드를 매핑하세요.'}
                  </div>
                ) : displayRows.length === 0 ? (
                  <div style={{ padding: 14, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                    {q ? '검색 결과 없음' : '조건에 맞는 상품이 없습니다.'}
                  </div>
                ) : (
                  <>
                    <div style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)', display: 'flex', alignItems: 'center', gap: 8, position: 'sticky', top: 0, zIndex: 1 }}>
                      {(() => {
                        const newRows = displayRows.filter(r => !irIsExisting(r));
                        const allNewChecked = newRows.length > 0 && newRows.every(r => irSelectedRows.has(r.id));
                        return (
                          <>
                            <input type="checkbox" checked={allNewChecked} onChange={irToggleAll} disabled={newRows.length === 0}
                              style={{ width: 15, height: 15, cursor: newRows.length === 0 ? 'default' : 'pointer' }} />
                            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>신규 전체선택 ({irSelectedRows.size}/{newRows.length})</span>
                            <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>총 {displayRows.length}건 · 기존 {displayRows.length - newRows.length}건</span>
                          </>
                        );
                      })()}
                    </div>
                    {displayRows.map(r => {
                      const dn = irMap['product_name'] ? (r.properties[irMap['product_name']] ?? '-') : '-';
                      const rawAmt = irMap['investment_amount'] ? (r.properties[irMap['investment_amount']] ?? '') : '';
                      const wonAmt = parseNotionAmountToWon(rawAmt);
                      const jd = normalizeNotionDate(irMap['join_date'] ? r.properties[irMap['join_date']] : undefined);
                      const existing = irIsExisting(r);
                      const checked = irSelectedRows.has(r.id);
                      return (
                        <div key={r.id}
                          style={{ width: '100%', padding: '7px 10px', borderBottom: '1px solid var(--border)', background: existing ? 'var(--bg-surface)' : checked ? 'rgba(16,185,129,0.1)' : 'var(--bg-card)', display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, cursor: existing ? 'default' : 'pointer', opacity: existing ? 0.6 : 1 }}
                          onClick={existing ? undefined : () => irToggleRow(r.id)}
                        >
                          <input type="checkbox" checked={checked && !existing} disabled={existing}
                            onChange={() => irToggleRow(r.id)} onClick={e => e.stopPropagation()}
                            style={{ width: 14, height: 14, cursor: existing ? 'default' : 'pointer', flexShrink: 0 }} />
                          <span style={{ fontWeight: 600, color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dn}</span>
                          {jd && <span style={{ color: 'var(--text-muted)', fontSize: 11, flexShrink: 0 }}>{jd}</span>}
                          {wonAmt != null && <span style={{ color: 'var(--text-secondary)', fontSize: 11, flexShrink: 0, minWidth: 90, textAlign: 'right' }}>{wonAmt.toLocaleString()}원</span>}
                          {existing && <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', background: 'var(--bg-card-2)', border: '1px solid var(--border)', padding: '1px 6px', borderRadius: 10 }}>이미 등록됨</span>}
                        </div>
                      );
                    })}
                  </>
                )}
              </div>

              {irLoaded && displayRows.length > 0 && (
                <div style={{ padding: '8px 10px', background: 'var(--bg-surface)', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{irSelectedRows.size > 0 ? `${irSelectedRows.size}건 추가 예정` : '추가할 상품을 선택하세요'}</span>
                  <button onClick={irBulkImport} disabled={irBulkLoading || irSelectedRows.size === 0}
                    style={{ padding: '7px 18px', borderRadius: 7, border: 'none', fontSize: 13, fontWeight: 700,
                      background: (irBulkLoading || irSelectedRows.size === 0) ? 'var(--bg-card)' : 'var(--blue-600)',
                      color: (irBulkLoading || irSelectedRows.size === 0) ? 'var(--text-muted)' : '#fff',
                      cursor: (irBulkLoading || irSelectedRows.size === 0) ? 'not-allowed' : 'pointer' }}>
                    {irBulkLoading ? '추가 중...' : `선택 ${irSelectedRows.size}건 투자기록에 추가`}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/*  예수금 거래 Notion 불러오기 모달                                     */
/* ------------------------------------------------------------------ */

function NotionImportDepositTxModal({ customerId, customerName, accounts, onClose, onImported, onAccountCreated }: {
  customerId: string;
  customerName: string;
  accounts: DepositAccount[];
  onClose: () => void;
  onImported: () => void;
  onAccountCreated: () => void;
}) {
  const [step, setStep] = useState<'idle' | 'selectDb' | 'mapping'>('idle');
  const [dbs, setDbs] = useState<{ id: string; title: string; icon: string | null }[]>([]);
  const [rows, setRows] = useState<{ id: string; properties: Record<string, string> }[]>([]);
  const [cols, setCols] = useState<string[]>([]);
  const [map, setMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dbSearch, setDbSearch] = useState('');
  const [rowSearch, setRowSearch] = useState('');
  const [selDbId, setSelDbId] = useState('');
  const [selDbTitle, setSelDbTitle] = useState('');
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [targetAccountId, setTargetAccountId] = useState<number | ''>(accounts[0]?.id ?? '');
  const [existingKeys, setExistingKeys] = useState<Set<string>>(new Set());

  /* ---- 계좌가 없을 때 모달 내에서 바로 생성 ---- */
  const [extraAccounts, setExtraAccounts] = useState<DepositAccount[]>([]);
  const [creatingAcct, setCreatingAcct] = useState(false);
  const [newAcctCompany, setNewAcctCompany] = useState('');
  const [newAcctNumber, setNewAcctNumber] = useState('');
  const [newAcctNick, setNewAcctNick] = useState('');
  const [acctSaving, setAcctSaving] = useState(false);
  const allAccounts = useMemo(() => {
    const ids = new Set(accounts.map(a => a.id));
    return [...accounts, ...extraAccounts.filter(a => !ids.has(a.id))];
  }, [accounts, extraAccounts]);

  const createDepositAccount = async () => {
    if (!newAcctCompany.trim()) { alert('증권사를 입력하세요.'); return; }
    setAcctSaving(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/retirement/deposit-accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
        body: JSON.stringify({
          customer_id: customerId,
          securities_company: newAcctCompany.trim(),
          account_number: newAcctNumber.trim() || null,
          nickname: newAcctNick.trim() || null,
        }),
      });
      if (!res.ok) throw new Error();
      const created: DepositAccount = await res.json();
      setExtraAccounts(prev => [...prev, created]);
      setTargetAccountId(created.id);
      setCreatingAcct(false);
      setNewAcctCompany(''); setNewAcctNumber(''); setNewAcctNick('');
      onAccountCreated();
    } catch { alert('계좌 생성에 실패했습니다.'); }
    finally { setAcctSaving(false); }
  };

  // 고객마다 전용 DB가 다르므로 설정을 고객별로 저장
  const cfgStorageKey = `${NOTION_DTX_CONFIG_KEY}:${customerId}`;
  function saveCfg(dbId: string, dbTitle: string, mapping: Record<string, string>, acctId: number | '') {
    try { localStorage.setItem(cfgStorageKey, JSON.stringify({ dbId, dbTitle, mapping, acctId })); } catch { /* ignore */ }
  }
  function loadCfg(): { dbId: string; dbTitle: string; mapping: Record<string, string>; acctId?: number } | null {
    try { const r = localStorage.getItem(cfgStorageKey); return r ? JSON.parse(r) : null; } catch { return null; }
  }
  function clearCfg() { try { localStorage.removeItem(cfgStorageKey); } catch { /* ignore */ } }

  async function fetchDbList() {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`${API_URL}/api/v1/notion/databases`, { headers: authLib.getAuthHeader() });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d?.detail || `조회 실패 (HTTP ${res.status})`); }
      setDbs(await res.json());
      setStep('selectDb');
    } catch (e: unknown) { setError(e instanceof Error ? e.message : '오류'); }
    finally { setLoading(false); }
  }

  async function loadRows(dbId: string, dbTitle: string, savedMapping?: Record<string, string>): Promise<boolean> {
    setLoading(true); setError(null);
    setSelDbId(dbId); setSelDbTitle(dbTitle);
    try {
      // 1) 컬럼 목록 먼저 → 매핑 확정
      const pR = await fetch(`${API_URL}/api/v1/notion/databases/${dbId}/properties`, { headers: authLib.getAuthHeader() });
      if (!pR.ok) {
        const d = await pR.json().catch(() => ({} as { detail?: string }));
        throw new Error(d?.detail || `데이터 조회 실패 (HTTP ${pR.status})`);
      }
      const props: { name: string }[] = await pR.json();
      const colNames = props.map(p => p.name);
      const resolvedMap = savedMapping ?? autoGuessDtxMapping(colNames);
      // 2) 고객별 전용 DB라 전체 행이 이 고객의 거래 — 필터 없이 조회
      const rR = await fetch(`${API_URL}/api/v1/notion/databases/${dbId}/rows`, { headers: authLib.getAuthHeader() });
      if (!rR.ok) {
        const d = await rR.json().catch(() => ({} as { detail?: string }));
        throw new Error(d?.detail || `데이터 조회 실패 (HTTP ${rR.status})`);
      }
      const rws: { id: string; properties: Record<string, string> }[] = await rR.json();
      setCols(colNames);
      setRows(rws);
      setMap(resolvedMap);
      // 매핑 화면 진입 즉시 저장 → 다음에 열면 DB·매핑 자동 복원(재매칭 불필요)
      saveCfg(dbId, dbTitle, resolvedMap, targetAccountId);
      setStep('mapping');
      return true;
    } catch (e: unknown) { setError(e instanceof Error ? e.message : '오류'); return false; }
    finally { setLoading(false); }
  }

  async function openSelector() {
    // 고객별 전용 DB(예: '올원랩어카운트_고객명')는 사용자가 직접 지정한다.
    // 이 고객에 저장된 설정이 있으면 복원, 없거나 조회 실패면 DB 선택 화면으로.
    const saved = loadCfg();
    if (saved && saved.dbId) {
      if (saved.acctId != null && accounts.some(a => a.id === saved.acctId)) setTargetAccountId(saved.acctId);
      const ok = await loadRows(saved.dbId, saved.dbTitle, saved.mapping);
      if (!ok) { clearCfg(); await fetchDbList(); }  // dbId가 낡은 경우 수동 재선택
    } else {
      await fetchDbList();
    }
  }

  useEffect(() => {
    openSelector();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 대상 계좌의 기존 거래 → 중복 판정 키 셋
  useEffect(() => {
    if (targetAccountId === '') { setExistingKeys(new Set()); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/v1/retirement/deposit-accounts/${targetAccountId}/transactions`, { headers: authLib.getAuthHeader() });
        const data = res.ok ? await res.json() : [];
        if (!cancelled) setExistingKeys(new Set((Array.isArray(data) ? data : []).map(depositTxKey)));
      } catch { if (!cancelled) setExistingKeys(new Set()); }
    })();
    return () => { cancelled = true; };
  }, [targetAccountId]);

  function reset() {
    setStep('idle'); setDbs([]); setRows([]); setCols([]);
    setError(null); setDbSearch(''); setRowSearch(''); setLoaded(false);
    setSelectedRows(new Set()); clearCfg();
  }
  function updateMap(k: string, v: string) {
    const updated = { ...map, [k]: v };
    setMap(updated); setLoaded(false);
    if (selDbId) saveCfg(selDbId, selDbTitle, updated, targetAccountId);
  }

  // 고객별 전용 DB — 발생일(거래일)만 매핑되면 불러오기 가능, 행 필터 불필요
  const filterReady = !!map['transaction_date'];

  const matchedRows = (filterReady && loaded) ? rows : [];
  const q = rowSearch.toLowerCase().trim();
  const displayRows = q
    ? matchedRows.filter(r => Object.values(r.properties).some(v => v?.toLowerCase().includes(q)))
    : matchedRows;

  function rowKey(row: { properties: Record<string, string> }): string {
    const body = notionRowToTxBody(row, map);
    return body ? notionTxBodyKey(body) : '';
  }
  function isExisting(row: { properties: Record<string, string> }): boolean {
    const k = rowKey(row); return !!k && existingKeys.has(k);
  }

  function toggleRow(id: string) {
    setSelectedRows(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }
  function toggleAll() {
    const newIds = displayRows.filter(r => !isExisting(r) && notionRowToTxBody(r, map)).map(r => r.id);
    const allSelected = newIds.length > 0 && newIds.every(id => selectedRows.has(id));
    setSelectedRows(prev => {
      const next = new Set(prev);
      if (allSelected) newIds.forEach(id => next.delete(id)); else newIds.forEach(id => next.add(id));
      return next;
    });
  }

  function loadList() {
    if (!filterReady) return;
    if (rows.length === 0) {
      alert('이 DB에 거래 데이터가 없습니다. DB 선택을 확인하세요.');
      return;
    }
    const preselect = new Set<string>();
    for (const r of rows) { if (notionRowToTxBody(r, map) && !isExisting(r)) preselect.add(r.id); }
    setSelectedRows(preselect);
    setLoaded(true);
    saveCfg(selDbId, selDbTitle, map, targetAccountId);
  }

  async function bulkImport() {
    if (selectedRows.size === 0) return;
    setBulkLoading(true);
    const items = displayRows.filter(r => selectedRows.has(r.id));

    // 증권번호(매핑 시): 거래 테이블이 아닌 예수금 계좌 정보(계좌번호)로 저장
    const acctNumCol = map['account_number'];
    const svcNum = acctNumCol
      ? (items.map(r => (r.properties[acctNumCol] ?? '').trim()).find(v => v) ?? '')
      : '';

    // 대상 계좌 미선택 시 자동 생성 — 체크만 하고 추가해도 동작하도록 (Notion '증권사' 컬럼 값으로 이름 유추)
    let acctId: number | '' = targetAccountId;
    let autoCreatedCompany: string | null = null;
    if (acctId === '') {
      const secCol = cols.find(c => c.includes('증권사'));
      const counts = new Map<string, number>();
      if (secCol) {
        for (const r of items) {
          const v = (r.properties[secCol] ?? '').trim();
          if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
        }
      }
      const company = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || (selDbTitle || '증권사 미지정');
      try {
        const res = await fetch(`${API_URL}/api/v1/retirement/deposit-accounts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
          body: JSON.stringify({ customer_id: customerId, securities_company: company, account_number: svcNum || null, nickname: `${customerName} 예수금`.trim() }),
        });
        if (!res.ok) throw new Error();
        const created: DepositAccount = await res.json();
        setExtraAccounts(prev => [...prev, created]);
        setTargetAccountId(created.id);
        onAccountCreated();
        acctId = created.id;
        autoCreatedCompany = company;
      } catch {
        setBulkLoading(false);
        alert('예수금 계좌 자동 생성에 실패했습니다. [+새 계좌]로 직접 만들어 주세요.');
        return;
      }
    } else if (svcNum) {
      // 기존 계좌: 계좌번호가 비어 있으면 Notion 증권번호로 채움 (수동 입력값은 덮지 않음)
      const acct = allAccounts.find(a => a.id === acctId);
      if (acct && !acct.account_number) {
        try {
          await fetch(`${API_URL}/api/v1/retirement/deposit-accounts/${acctId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
            body: JSON.stringify({ account_number: svcNum }),
          });
          onAccountCreated();   // 계좌 목록 갱신
        } catch { /* 계좌번호 갱신 실패는 거래 추가를 막지 않음 */ }
      }
    }

    let success = 0, fail = 0, skipped = 0;
    let failDetail = '';   // 첫 실패 사유를 표시해 원인 파악 가능하게
    for (const row of items) {
      const body = notionRowToTxBody(row, map);
      if (!body) { skipped++; continue; }
      if (existingKeys.has(notionTxBodyKey(body))) { skipped++; continue; }
      try {
        const res = await fetch(`${API_URL}/api/v1/retirement/deposit-accounts/${acctId}/transactions`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() }, body: JSON.stringify(body),
        });
        if (res.ok) success++;
        else {
          fail++;
          if (!failDetail) {
            const d = await res.json().catch(() => ({} as { detail?: unknown }));
            failDetail = typeof d?.detail === 'string' ? d.detail : `HTTP ${res.status}`;
          }
        }
      } catch (err) { fail++; if (!failDetail) failDetail = err instanceof Error ? err.message : '네트워크 오류'; }
    }
    setBulkLoading(false);
    setSelectedRows(new Set());
    saveCfg(selDbId, selDbTitle, map, acctId);
    alert(
      `${success}건 추가 완료${fail > 0 ? `, ${fail}건 실패` : ''}${skipped > 0 ? `, ${skipped}건 스킵(중복/거래일 누락)` : ''}` +
      (failDetail ? `\n실패 사유: ${failDetail}` : '') +
      (autoCreatedCompany ? `\n(예수금 계좌 '${autoCreatedCompany}' 자동 생성됨 — 계좌번호·별명은 목록에서 수정 가능)` : '')
    );
    onImported();
    onClose();
  }

  const acctLabel = (a: DepositAccount) => a.nickname || `${a.securities_company} ${a.account_number || ''}`;

  return (
    <Modal open onClose={onClose} title="Notion에서 예수금 거래 불러오기" maxWidth={760}>
      {/* 대상 계좌 선택 (항상 표시) — 계좌가 없으면 바로 생성 가능 */}
      <div style={{ marginBottom: 8, padding: '8px 12px', borderRadius: 8, backgroundColor: 'var(--bg-surface)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>대상 예수금 계좌</span>
          <MapSelect
            value={targetAccountId === '' ? '' : String(targetAccountId)}
            onChange={v => {
              const acctId = v ? Number(v) : '';
              setTargetAccountId(acctId);
              if (selDbId) saveCfg(selDbId, selDbTitle, map, acctId);   // 대상 계좌도 저장
            }}
            options={allAccounts.map(a => ({ value: String(a.id), label: acctLabel(a) }))}
            placeholder={allAccounts.length === 0 ? '계좌 없음 — 새로 만드세요' : '계좌 선택…'}
            minWidth={160}
          />
          <button
            type="button"
            onClick={() => setCreatingAcct(v => !v)}
            style={{ padding: '5px 10px', fontSize: 12, fontWeight: 600, borderRadius: 6, border: '1px solid var(--blue-500)', backgroundColor: 'var(--bg-card)', color: 'var(--blue-400)', cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            {creatingAcct ? '취소' : '➕ 새 계좌'}
          </button>
        </div>

        {creatingAcct && (
          <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <input type="text" value={newAcctCompany} onChange={e => setNewAcctCompany(e.target.value)} placeholder="증권사 *"
              style={{ width: 140, padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border-strong)', fontSize: 12, backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)' }} />
            <input type="text" value={newAcctNumber} onChange={e => setNewAcctNumber(e.target.value)} placeholder="계좌번호"
              style={{ width: 140, padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border-strong)', fontSize: 12, backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)' }} />
            <input type="text" value={newAcctNick} onChange={e => setNewAcctNick(e.target.value)} placeholder="별명"
              style={{ width: 120, padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border-strong)', fontSize: 12, backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)' }} />
            <button type="button" onClick={createDepositAccount} disabled={acctSaving}
              style={{ padding: '5px 12px', fontSize: 12, fontWeight: 700, borderRadius: 6, border: 'none', backgroundColor: 'var(--blue-600)', color: '#fff', cursor: acctSaving ? 'wait' : 'pointer' }}>
              {acctSaving ? '생성 중...' : '계좌 만들기'}
            </button>
          </div>
        )}

        <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-muted)' }}>선택 계좌에 이미 있는 거래(거래일·입출금액·유형 동일)는 자동 제외됩니다.</div>
      </div>

      {step === 'idle' && (
        <button
          onClick={openSelector}
          disabled={loading}
          style={{ width: '100%', padding: 9, borderRadius: 8, border: '1px dashed var(--border-strong)', background: 'var(--bg-surface)', color: 'var(--text-secondary)', fontSize: 13, fontWeight: 500, cursor: loading ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
        >
          {loading ? '연결 중...' : '📄 Notion에서 데이터 가져오기'}
        </button>
      )}

      {error && (
        <div style={{ marginTop: 6, padding: '6px 10px', borderRadius: 6, background: 'var(--danger-bg)', border: '1px solid rgba(239,68,68,0.35)', fontSize: 12, color: 'var(--danger)', display: 'flex', justifyContent: 'space-between' }}>
          <span>{error}</span>
          <button onClick={reset} style={{ background: 'none', border: 'none', color: 'var(--danger)', textDecoration: 'underline', cursor: 'pointer', fontSize: 12 }}>닫기</button>
        </div>
      )}

      {step === 'selectDb' && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ padding: '7px 10px', background: 'var(--bg-surface)', fontSize: 12, fontWeight: 600, color: 'var(--blue-400)', display: 'flex', justifyContent: 'space-between' }}>
            <span>데이터베이스 선택</span>
            <button onClick={reset} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12 }}>취소</button>
          </div>
          <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>
            <input type="text" placeholder="검색..." value={dbSearch} onChange={e => setDbSearch(e.target.value)}
              style={{ width: '100%', padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border-strong)', fontSize: 12, outline: 'none', boxSizing: 'border-box', backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)' }} />
          </div>
          {loading ? (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>불러오는 중...</div>
          ) : (
            <div style={{ maxHeight: 180, overflowY: 'auto' }}>
              {dbs.filter(d => !dbSearch || d.title.toLowerCase().includes(dbSearch.toLowerCase())).map(d => (
                <button key={d.id}
                  onClick={() => { setDbSearch(''); loadRows(d.id, d.title); }}
                  style={{ width: '100%', padding: '9px 10px', border: 'none', borderBottom: '1px solid var(--border)', background: 'var(--bg-card)', textAlign: 'left', cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-primary)' }}
                >
                  <span>{d.icon ?? '📄'}</span>
                  <span style={{ fontWeight: 500 }}>{d.title}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {step === 'mapping' && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ padding: '7px 10px', background: 'var(--bg-surface)', fontSize: 12, fontWeight: 600, color: 'var(--blue-400)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>필드 매핑 + 거래 선택 {selDbTitle ? `(${selDbTitle})` : ''}</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => { clearCfg(); setRows([]); setCols([]); fetchDbList(); }}
                style={{ background: 'none', border: 'none', color: 'var(--blue-400)', cursor: 'pointer', fontSize: 11 }}>DB 변경</button>
              <button onClick={reset} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12 }}>취소</button>
            </div>
          </div>
          {loading ? (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>데이터 불러오는 중...</div>
          ) : (
            <>
              <div style={{ padding: '8px 10px', background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>Notion 컬럼 → 예수금 거래 필드 매핑 (발생일 * 필수 · ‘자동이체’는 적립액으로 저장 · 고객별 전용 DB라 행 필터 없음)</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
                  {NOTION_DTX_MAP_FIELDS.map(f => {
                    const hint = f.req || f.filter;
                    return (
                    <div key={f.k} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
                      <span style={{ width: 72, color: hint ? 'var(--blue-400)' : 'var(--text-secondary)', fontWeight: 600, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {f.l}{hint ? ' *' : ''}
                      </span>
                      <MapSelect
                        value={map[f.k] ?? ''}
                        onChange={v => updateMap(f.k, v)}
                        options={cols.map(c => ({ value: c, label: c }))}
                        highlight={!!map[f.k]}
                      />
                    </div>
                    );
                  })}
                </div>
              </div>

              {!filterReady && (
                <div style={{ padding: '10px 14px', fontSize: 12, color: 'var(--warning)', backgroundColor: 'rgba(245,158,11,0.1)', borderBottom: '1px solid var(--border)' }}>
                  ‘발생일’ 필드를 먼저 매핑하세요.
                </div>
              )}

              <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center' }}>
                <button
                  onClick={loadList}
                  disabled={!filterReady}
                  title={filterReady ? '' : '발생일 매핑 필요'}
                  style={{ flex: 1, padding: '9px 16px', borderRadius: 7, border: 'none', fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap',
                    cursor: !filterReady ? 'not-allowed' : 'pointer',
                    backgroundColor: !filterReady ? 'var(--bg-surface)' : 'var(--blue-600)',
                    color: !filterReady ? 'var(--text-muted)' : '#fff' }}
                >{`🔍 ‘${selDbTitle || 'DB'}’ 거래 목록 불러오기`}</button>
                {loaded && (
                  <input type="text" placeholder="행 검색..." value={rowSearch} onChange={e => setRowSearch(e.target.value)}
                    style={{ width: 140, padding: '7px 8px', borderRadius: 6, border: '1px solid var(--border-strong)', fontSize: 12, outline: 'none', boxSizing: 'border-box', backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)' }} />
                )}
              </div>

              <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                {!loaded ? (
                  <div style={{ padding: 14, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                    {filterReady ? '위 버튼을 누르면 이 DB의 거래 목록을 보여줍니다. 대상 계좌에 없는 신규 거래만 자동 체크됩니다.' : '발생일 필드를 매핑하세요.'}
                  </div>
                ) : displayRows.length === 0 ? (
                  <div style={{ padding: 14, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                    {q ? '검색 결과 없음' : '표시할 거래가 없습니다.'}
                  </div>
                ) : (
                  <>
                    <div style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)', display: 'flex', alignItems: 'center', gap: 8, position: 'sticky', top: 0, zIndex: 1 }}>
                      {(() => {
                        const newRows = displayRows.filter(r => !isExisting(r) && notionRowToTxBody(r, map));
                        const allNewChecked = newRows.length > 0 && newRows.every(r => selectedRows.has(r.id));
                        return (
                          <>
                            <input type="checkbox" checked={allNewChecked} onChange={toggleAll} disabled={newRows.length === 0}
                              style={{ width: 15, height: 15, cursor: newRows.length === 0 ? 'default' : 'pointer' }} />
                            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>신규 전체선택 ({selectedRows.size}/{newRows.length})</span>
                            <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>총 {displayRows.length}건 · 중복 {displayRows.filter(r => isExisting(r)).length}건</span>
                          </>
                        );
                      })()}
                    </div>
                    {displayRows.map(r => {
                      const body = notionRowToTxBody(r, map);
                      const date = body?.transaction_date as string | undefined;
                      const ttype = body?.transaction_type as TransactionType | undefined;
                      const credit = (body?.credit_amount as number) ?? 0;
                      const savings = (body?.savings_amount as number) ?? 0;
                      const debit = (body?.debit_amount as number) ?? 0;
                      const product = map['related_product'] ? (r.properties[map['related_product']] ?? '') : '';
                      const existing = isExisting(r);
                      const invalid = !body;
                      const checked = selectedRows.has(r.id);
                      const disabled = existing || invalid;
                      return (
                        <div key={r.id}
                          style={{ width: '100%', padding: '7px 10px', borderBottom: '1px solid var(--border)', background: disabled ? 'var(--bg-surface)' : checked ? 'rgba(16,185,129,0.1)' : 'var(--bg-card)', display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.6 : 1 }}
                          onClick={disabled ? undefined : () => toggleRow(r.id)}
                        >
                          <input type="checkbox" checked={checked && !disabled} disabled={disabled}
                            onChange={() => toggleRow(r.id)} onClick={e => e.stopPropagation()}
                            style={{ width: 14, height: 14, cursor: disabled ? 'default' : 'pointer', flexShrink: 0 }} />
                          <span style={{ color: 'var(--text-muted)', fontSize: 11, flexShrink: 0, minWidth: 72 }}>{date ?? '날짜없음'}</span>
                          <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, color: ttype ? (TRANSACTION_TYPE_COLORS[ttype]) : 'var(--text-muted)' }}>{ttype ? TRANSACTION_TYPE_LABELS[ttype] : '-'}</span>
                          <span style={{ fontWeight: 600, color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{product || '-'}</span>
                          {credit > 0 && <span style={{ color: '#3B82F6', fontSize: 11, flexShrink: 0 }}>+{credit.toLocaleString()}</span>}
                          {savings > 0 && <span style={{ color: '#34D399', fontSize: 11, flexShrink: 0 }} title="적립액(자동이체)">적+{savings.toLocaleString()}</span>}
                          {debit > 0 && <span style={{ color: 'var(--danger)', fontSize: 11, flexShrink: 0 }}>-{debit.toLocaleString()}</span>}
                          {existing && <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', background: 'var(--bg-card-2)', border: '1px solid var(--border)', padding: '1px 6px', borderRadius: 10 }}>중복</span>}
                          {invalid && <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, color: 'var(--warning)', border: '1px solid rgba(245,158,11,0.4)', padding: '1px 6px', borderRadius: 10 }}>거래일 없음</span>}
                        </div>
                      );
                    })}
                  </>
                )}
              </div>

              {loaded && displayRows.length > 0 && (
                <div style={{ padding: '8px 10px', background: 'var(--bg-surface)', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {selectedRows.size > 0
                      ? `${selectedRows.size}건 추가 예정${targetAccountId === '' ? ' — 계좌 미선택 시 자동 생성됩니다' : ''}`
                      : '추가할 거래를 선택하세요'}
                  </span>
                  <button onClick={bulkImport} disabled={bulkLoading || selectedRows.size === 0}
                    title={selectedRows.size === 0 ? '추가할 거래를 선택하세요' : ''}
                    style={{ padding: '7px 18px', borderRadius: 7, border: 'none', fontSize: 13, fontWeight: 700,
                      background: (bulkLoading || selectedRows.size === 0) ? 'var(--bg-card)' : 'var(--blue-600)',
                      color: (bulkLoading || selectedRows.size === 0) ? 'var(--text-muted)' : '#fff',
                      cursor: (bulkLoading || selectedRows.size === 0) ? 'not-allowed' : 'pointer' }}>
                    {bulkLoading ? '추가 중...' : `선택 ${selectedRows.size}건 계좌에 추가`}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </Modal>
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
  const cStyle: React.CSSProperties = { backgroundColor: 'var(--bg-card)', borderRadius: 12, padding: 28, width: 440, boxShadow: '0 8px 24px rgba(0,0,0,0.15)' };
  const iStyle: React.CSSProperties = { width: '100%', padding: '10px 12px', fontSize: 14, border: '1px solid var(--border-strong)', borderRadius: 8, outline: 'none', boxSizing: 'border-box' };
  const lStyle: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 };

  return (
    <div style={mStyle} onClick={onClose}>
      <div style={cStyle} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 20px', fontSize: '1.1rem', fontWeight: 700, color: 'var(--blue-400)' }}>예수금 계좌 수정</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={lStyle}>거래기관 <span style={{ color: 'var(--danger)' }}>*</span></label>
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
        {error && <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: 8 }}>{error}</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
          <button onClick={onClose} style={{ padding: '8px 18px', fontSize: 14, color: 'var(--text-muted)', backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' }}>취소</button>
          <button onClick={handleSave} disabled={saving} style={{ padding: '8px 18px', fontSize: 14, fontWeight: 600, color: '#fff', backgroundColor: saving ? 'var(--bg-surface)' : 'var(--blue-600)', border: 'none', borderRadius: 8, cursor: saving ? 'not-allowed' : 'pointer' }}>
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
  color: 'var(--text-primary)',
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
  color: 'var(--text-secondary)',
  marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  border: '1px solid var(--border-strong)',
  borderRadius: 7,
  fontSize: 13,
  color: 'var(--text-primary)',
  outline: 'none',
  boxSizing: 'border-box',
  backgroundColor: 'var(--bg-card)',
};

const selectStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  border: '1px solid var(--border-strong)',
  borderRadius: 7,
  fontSize: 13,
  color: 'var(--text-primary)',
  outline: 'none',
  boxSizing: 'border-box',
  backgroundColor: 'var(--bg-card)',
  cursor: 'pointer',
};

const cancelBtnStyle: React.CSSProperties = {
  padding: '8px 16px',
  fontSize: 13,
  fontWeight: 500,
  borderRadius: 7,
  border: '1px solid var(--border)',
  backgroundColor: 'var(--bg-card)',
  color: 'var(--text-muted)',
  cursor: 'pointer',
};

const saveBtnStyle: React.CSSProperties = {
  padding: '8px 16px',
  fontSize: 13,
  fontWeight: 600,
  borderRadius: 7,
  border: 'none',
  backgroundColor: 'var(--blue-600)',
  color: '#fff',
  cursor: 'pointer',
};

/* ---- 예수금 거래내역 테이블 스타일 ---- */
const txTdBase: React.CSSProperties = {
  padding: '8px 12px',
  verticalAlign: 'middle',
  color: 'var(--text-primary)',
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
