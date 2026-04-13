'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Modal } from '@/components/common/Modal';
import { useRetirementStore } from '../../hooks/useRetirementStore';
import { formatCurrency, formatInputCurrency, parseCurrency } from '../../utils/formatCurrency';
import { API_URL } from '@/lib/api-url';
import { authLib } from '@/lib/auth';

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

type TransactionType = 'investment' | 'termination' | 'deposit' | 'withdrawal' | 'interest' | 'other';

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
  other: '기타',
};

const TRANSACTION_TYPE_COLORS: Record<TransactionType, string> = {
  investment: '#3B82F6',
  termination: '#10B981',
  deposit: '#1E3A5F',
  withdrawal: '#EF4444',
  interest: '#D4A847',
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
        <div style={{ padding: '10px 14px', backgroundColor: '#F9FAFB', borderRadius: 8, fontSize: 13, color: '#374151' }}>
          <strong>{record.product_name || '(상품명)'}</strong> 를 종결 처리합니다.
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
  const { selectedCustomerId } = useRetirementStore();

  // 연간 투자흐름표 상태
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [annualFlowData, setAnnualFlowData] = useState<AnnualFlowRow[]>([]);
  const [annualFlowLoading, setAnnualFlowLoading] = useState(false);

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
  const years = Array.from({ length: 10 }, (_, i) => currentYear - 5 + i);

  /* ---- API: 연간 투자흐름 ---- */
  const fetchAnnualFlow = useCallback(async () => {
    if (!selectedCustomerId) return;
    setAnnualFlowLoading(true);
    try {
      const res = await fetch(
        `${API_URL}/api/v1/retirement/investment-records/annual-flow/${selectedCustomerId}/${selectedYear}`,
        { headers: authLib.getAuthHeader() }
      );
      if (!res.ok) { setAnnualFlowData([]); return; }
      const data = await res.json();
      setAnnualFlowData(Array.isArray(data) ? data : [data]);
    } catch {
      setAnnualFlowData([]);
    } finally {
      setAnnualFlowLoading(false);
    }
  }, [selectedCustomerId, selectedYear]);

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
      fetchDepositAccounts();
      expandedAccountIds.forEach(id => fetchTransactions(id));
    } catch {
      // silent
    } finally {
      setRecSaving(false);
    }
  };

  /* ---- 필터링된 기록 ---- */
  const filteredRecords = accountFilter === 'all'
    ? records
    : records.filter((r) => r.deposit_account_id === accountFilter);

  /* ---- 상품명 조회 (wrapAccounts에서 매칭) ---- */
  const getProductName = (record: InvestmentRecord): string => {
    if (record.product_name) return record.product_name;
    if (record.wrap_account_id) {
      const account = wrapAccounts.find((a) => a.id === record.wrap_account_id);
      if (account) return account.product_name;
    }
    return '-';
  };

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>

      {/* ===== (1) 연간 투자흐름표 ===== */}
      <section>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: '#1E3A5F' }}>
            연간 투자흐름표
            <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 400, color: '#9CA3AF' }}>
              (단위: 만원)
            </span>
          </h3>
          <select
            data-testid="year-select"
            value={selectedYear}
            onChange={(e) => setSelectedYear(Number(e.target.value))}
            style={{
              ...selectStyle,
              width: 'auto',
              padding: '6px 10px',
              fontSize: 13,
            }}
          >
            {years.map((y) => (
              <option key={y} value={y}>{y}년</option>
            ))}
          </select>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ minWidth: 900, borderCollapse: 'collapse', fontSize: 13, whiteSpace: 'nowrap' }}>
            <thead>
              <tr style={{ backgroundColor: '#F9FAFB' }}>
                {[
                  { label: '연도', align: 'center' },
                  { label: '연차', align: 'center' },
                  { label: '나이', align: 'center' },
                  { label: '일시납금액', align: 'right' },
                  { label: '연적립금액', align: 'right' },
                  { label: '총납입금액', align: 'right' },
                  { label: '연간총수익', align: 'right' },
                  { label: '연간평가금액', align: 'right' },
                  { label: '연수익률', align: 'right' },
                  { label: '인출금액', align: 'right' },
                  { label: '누적인출액', align: 'right' },
                  { label: '총평가금액', align: 'right' },
                ].map(({ label, align }) => (
                  <th
                    key={label}
                    style={{
                      padding: '8px 12px',
                      textAlign: align as 'center' | 'right',
                      fontWeight: 600,
                      color: '#6B7280',
                      borderBottom: '1px solid #E5E7EB',
                      fontSize: 12,
                    }}
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {annualFlowLoading ? (
                <tr>
                  <td colSpan={12} style={{ textAlign: 'center', padding: 24, color: '#9CA3AF', fontSize: 13 }}>
                    불러오는 중...
                  </td>
                </tr>
              ) : annualFlowData.length === 0 ? (
                <tr>
                  <td colSpan={12} style={{ textAlign: 'center', padding: 24, color: '#9CA3AF', fontSize: 13 }}>
                    데이터가 없습니다.
                  </td>
                </tr>
              ) : (
                annualFlowData.map((row, idx) => {
                  const rateColor = row.annual_return_rate > 0
                    ? '#16A34A'
                    : row.annual_return_rate < 0
                    ? '#DC2626'
                    : '#374151';
                  return (
                    <tr
                      key={idx}
                      style={{
                        borderBottom: '1px solid #F3F4F6',
                        backgroundColor: idx % 2 === 0 ? '#fff' : '#FAFAFA',
                      }}
                    >
                      <td style={tdCenter}>{row.year}</td>
                      <td style={tdCenter}>{row.order_in_year ?? '-'}</td>
                      <td style={tdCenter}>{row.age ?? '-'}</td>
                      <td style={tdRight}>{formatCurrency(row.lump_sum)}</td>
                      <td style={tdRight}>{formatCurrency(row.annual_savings)}</td>
                      <td style={{ ...tdRight, fontWeight: 600 }}>{formatCurrency(row.total_contribution)}</td>
                      <td style={{ ...tdRight, color: row.annual_return >= 0 ? '#16A34A' : '#DC2626' }}>
                        {formatCurrency(row.annual_return)}
                      </td>
                      <td style={tdRight}>{formatCurrency(row.annual_evaluation)}</td>
                      <td style={{ ...tdRight, color: rateColor, fontWeight: 600 }}>
                        {row.annual_return_rate != null ? `${row.annual_return_rate.toFixed(2)}%` : '-'}
                      </td>
                      <td style={tdRight}>{formatCurrency(row.withdrawal)}</td>
                      <td style={tdRight}>{formatCurrency(row.cumulative_withdrawal)}</td>
                      <td style={{ ...tdRight, fontWeight: 700, color: '#1E3A5F' }}>
                        {formatCurrency(row.total_evaluation)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ===== (1.5) 예수금 계좌 기록 ===== */}
      <section>
        <div style={{
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
              const transactions = accountTransactions[account.id] ?? [];
              const txLoading = transactionsLoading[account.id] ?? false;
              const isAddingNewTx = newTxAccountId === account.id;

              return (
                <div
                  key={account.id}
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
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ minWidth: 780, borderCollapse: 'collapse', fontSize: 13, whiteSpace: 'nowrap', width: '100%' }}>
                        <thead>
                          <tr style={{ backgroundColor: '#F9FAFB' }}>
                            {[
                              { label: 'No', align: 'center', width: 44 },
                              { label: '발생일', align: 'left', width: 110 },
                              { label: '구분', align: 'center', width: 90 },
                              { label: '상품명', align: 'left', width: 180 },
                              { label: '입금액', align: 'right', width: 130 },
                              { label: '출금액', align: 'right', width: 130 },
                              { label: '잔액', align: 'right', width: 130 },
                              { label: '메모', align: 'left' },
                              { label: '액션', align: 'center', width: 90 },
                            ].map(({ label, align, width }) => (
                              <th
                                key={label}
                                style={{
                                  padding: '8px 12px',
                                  textAlign: align as 'center' | 'left' | 'right',
                                  fontWeight: 600,
                                  color: '#6B7280',
                                  borderBottom: '1px solid #E5E7EB',
                                  fontSize: 12,
                                  width: width ? `${width}px` : undefined,
                                }}
                              >
                                {label}
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
                                    <td style={{ ...txTdCenter, color: '#9CA3AF' }}>{idx + 1}</td>
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
                                  <td style={{ ...txTdCenter }}>{idx + 1}</td>
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
                                  <td style={{ ...txTdBase, color: '#6B7280', maxWidth: 220, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
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
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ===== (2) 투자기록 테이블 ===== */}
      <section>
        <div style={{
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

        <div style={{ overflowX: 'auto' }}>
          <table style={{ minWidth: 1300, borderCollapse: 'collapse', fontSize: 13, whiteSpace: 'nowrap' }}>
            <thead>
              <tr style={{ backgroundColor: '#F9FAFB' }}>
                {[
                  { label: '#', align: 'left' },
                  { label: '상품명', align: 'left' },
                  { label: '계좌별명', align: 'left' },
                  { label: '투자금액', align: 'right' },
                  { label: '평가금액', align: 'right' },
                  { label: '수익률', align: 'right' },
                  { label: '상태', align: 'left' },
                  { label: '가입일', align: 'left', highlight: true },
                  { label: '예상만기일', align: 'left', highlight: true },
                  { label: '실제만기일', align: 'left', highlight: true },
                  { label: '원만기일', align: 'left', highlight: true },
                  { label: '메모', align: 'left' },
                  { label: '액션', align: 'center' },
                ].map(({ label, align, highlight }) => (
                  <th
                    key={label}
                    style={{
                      padding: '9px 12px',
                      textAlign: align as 'left' | 'right',
                      fontWeight: 600,
                      color: '#6B7280',
                      borderBottom: '1px solid #E5E7EB',
                      fontSize: 11,
                      whiteSpace: 'nowrap',
                      backgroundColor: highlight ? '#EEF2F7' : undefined,
                    }}
                  >
                    {label}
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
                  <td colSpan={14} style={{ textAlign: 'center', padding: 24, color: '#9CA3AF', fontSize: 13 }}>
                    불러오는 중...
                  </td>
                </tr>
              ) : filteredRecords.length === 0 && !addingRecord ? (
                <tr>
                  <td colSpan={14} style={{ textAlign: 'center', padding: 24, color: '#9CA3AF', fontSize: 13 }}>
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
                          {record.status === 'ing' && (
                            <button
                              onClick={() => setStatusChangeRecord({ ...record, product_name: getProductName(record) })}
                              title="종결 처리"
                              style={{
                                padding: '2px 6px',
                                fontSize: 10,
                                borderRadius: 4,
                                border: '1px solid #E5E7EB',
                                backgroundColor: '#fff',
                                color: '#6B7280',
                                cursor: 'pointer',
                              }}
                            >
                              종결
                            </button>
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
                      <td style={{ ...tdBase, color: '#6B7280', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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

function AddWrapProductModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [productName, setProductName] = useState('');
  const [company, setCompany] = useState('');
  const [investmentTarget, setInvestmentTarget] = useState('');
  const [targetReturn, setTargetReturn] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

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
            <label style={lS}>투자대상</label>
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
