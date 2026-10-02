'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { Modal } from '@/components/common/Modal';
import { useRetirementStore } from '../../hooks/useRetirementStore';
import { Section } from '../common/Section';
import { formatCurrency, formatInputCurrency } from '../../utils/formatCurrency';
import { API_URL } from '@/lib/api-url';
import { notifyError, okOrNotify } from '@/lib/notify';
import { isNotionConfig, loadJSON, loadString, saveString } from '@/lib/storage';
import { authLib } from '@/lib/auth';
import { loadClientContact, setPdfContact } from '@/lib/reportContact';
import { AddDepositAccountModal, AddWrapProductModal, EditDepositAccountModal, StatusChangeModal } from './investment-flow/modals';
import { NOTION_DTX_CONFIG_KEY, NOTION_IR_CONFIG_KEY, NOTION_IR_TARGET_CATEGORY, NotionImportDepositTxModal, NotionImportRecordsModal, SyncPlanItem, SyncPreviewModal, asSortDir, depositTxKey, fetchNotionRowsWithFallback, notionNormName, notionRowToRecordBody, notionRowToTxBody, notionTxBodyKey } from './investment-flow/notion';
import { AnnualFlowRow, DepositAccount, DepositTransaction, InvestmentRecord, STATUS_LABELS, STATUS_STYLES, StatusFilter, TRANSACTION_TYPE_COLORS, TRANSACTION_TYPE_LABELS, TransactionType, WrapAccount } from './investment-flow/types';
import { SubHead, inlineCancelBtn, inlineInput, inlineSaveBtn, inlineSelect, selectStyle, tdBase, tdCenter, tdRight, txTdBase, txTdCenter, txTdRight } from './investment-flow/ui';


const AssetGrowthChart = dynamic(() => import('./AnnualFlowChart').then(m => m.AssetGrowthChart), { ssr: false });
const LifetimeRetirementFlow = dynamic(() => import('./LifetimeRetirementFlow').then(m => m.LifetimeRetirementFlow), { ssr: false });

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
  // 자산 성장 그래프 (투자흐름·순자산 그래프 2종을 고객 설명용 1종으로 통합)
  const [showGrowthChart, setShowGrowthChart] = useState(false);
  const [growthOpts, setGrowthOpts] = useState({ showRate: false });
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

  /* ---- 원금(입금) 데이터 누락 계좌 ---- */
  // 투자 거래는 있는데 입금(deposit)·적립(savings) 거래가 한 건도 없는 계좌.
  // 이 경우 누적입금액이 0이 되어 순입금액·순자산수익률이 성립하지 않는다.
  // (종료 거래는 투자금 회수이므로 백엔드에서 입금으로 집계하지 않는다)
  const missingDepositAccountIds = useMemo(() => {
    const ids = new Set<number>();
    for (const acc of depositAccounts) {
      const txs = accountTransactions[acc.id];
      if (!txs || txs.length === 0) continue; // 미로드·거래없음은 판정 보류
      const hasInvestment = txs.some((t) => t.transaction_type === 'investment');
      if (!hasInvestment) continue;
      const hasPrincipal = txs.some(
        (t) => t.transaction_type === 'deposit' || t.transaction_type === 'savings' || (t.savings_amount || 0) > 0
      );
      if (!hasPrincipal) ids.add(acc.id);
    }
    return ids;
  }, [depositAccounts, accountTransactions]);

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

  // 계좌 목록이 로드되면 펼침 여부와 무관하게 전 계좌 거래를 미리 로드한다.
  // (연간 투자흐름표의 연도 범위·순자산이 거래 데이터에서 파생되므로,
  //  계좌를 열어야만 표가 채워지던 문제를 방지)
  const prefetchedTxRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    const targets = depositAccounts.filter((a) => !prefetchedTxRef.current.has(a.id));
    if (targets.length === 0) return;
    targets.forEach((a) => prefetchedTxRef.current.add(a.id));
    (async () => {
      for (const acc of targets) await fetchTransactions(acc.id);
    })();
  }, [depositAccounts, fetchTransactions]);

  // 고객 전환 시 이전 고객 상태 잔존 방지 (거래·펼침·적용연도·플랜·선택 초기화)
  useEffect(() => {
    prefetchedTxRef.current = new Set();
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
      } catch (e) { notifyError('100세 플로우 적용 내역을 불러오지 못했습니다.', e); }
    };
    load();
  }, [selectedCustomerId]);

  // applied_years 자동 저장 (적용/취소 시)
  const saveAppliedYears = useCallback(async (newApplied: Record<number, any>) => {
    if (!selectedCustomerId) return;
    try {
      const token = authLib.getToken();
      const res = await fetch(`${API_URL}/api/v1/retirement/desired-plans/${selectedCustomerId}/params`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        // 서버가 calculation_params 의 키 단위로 합치므로 이 키만 보낸다(다른 탭이 바꾼 값을 예전 사본으로 덮지 않게)
        body: JSON.stringify({ calculation_params: { applied_years: newApplied } }),
      });
      await okOrNotify(res, '100세 플로우 적용 내역 저장');
    } catch (e) { notifyError('100세 플로우 적용 내역을 저장하지 못했습니다.', e); }
  }, [selectedCustomerId]);

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
    fetchAnnualFlow();  // 평가금액·종료일은 순자산에 직접 반영되므로 흐름표도 재조회
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
      fetchAnnualFlow();  // 거래가 바뀌면 순자산·입금액이 달라지므로 흐름표도 재조회
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
      fetchAnnualFlow();  // 거래가 바뀌면 순자산·입금액이 달라지므로 흐름표도 재조회
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
  // 사용자·서버별 저장, 이상한 값이면 기본값(수정_tasks P2-6)
  const [txSortKey, setTxSortKey] = useState<string>(() => loadString('tx_sort_key_v2', 'tx_sort_key_v2') || 'transaction_date');
  const [txSortDir, setTxSortDir] = useState<'asc' | 'desc'>(() => asSortDir(loadString('tx_sort_dir_v2', 'tx_sort_dir_v2'), 'desc'));
  useEffect(() => { saveString('tx_sort_key_v2', txSortKey); }, [txSortKey]);
  useEffect(() => { saveString('tx_sort_dir_v2', txSortDir); }, [txSortDir]);
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
      let tie = cmp;
      if (tie === 0 && txSortKey === 'transaction_date') {
        // 같은 날짜: 입금성(입금·적립·이자·종결) 거래가 투자·출금보다 시간상 먼저 —
        // 잔액 계산 순서(백엔드)와 동일한 규칙으로 표시 순서 고정
        const pri = (t: DepositTransaction) =>
          (t.credit_amount + (t.savings_amount || 0)) > 0 && t.debit_amount === 0 ? 0 : 1;
        tie = pri(a) - pri(b);
      }
      // 잔여 동률은 id로 최종 고정
      if (tie === 0) tie = a.id - b.id;
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
  const [recSortKey, setRecSortKey] = useState<string>(() => loadString('rec_sort_key', 'rec_sort_key') || 'id');
  const [recSortDir, setRecSortDir] = useState<'asc' | 'desc'>(() => asSortDir(loadString('rec_sort_dir', 'rec_sort_dir'), 'asc'));
  useEffect(() => { saveString('rec_sort_key', recSortKey); }, [recSortKey]);
  useEffect(() => { saveString('rec_sort_dir', recSortDir); }, [recSortDir]);
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
    const saved = loadJSON<{ dbId: string; dbTitle: string; mapping: Record<string, string> }>(NOTION_IR_CONFIG_KEY, isNotionConfig, NOTION_IR_CONFIG_KEY);
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
    // 고객마다 전용 DB가 다르므로 설정도 고객별 키로 저장돼 있음
    const dtxKey = `${NOTION_DTX_CONFIG_KEY}:${selectedCustomerId}`;
    const saved = loadJSON<{ dbId: string; dbTitle: string; mapping: Record<string, string>; acctId?: number }>(dtxKey, isNotionConfig, dtxKey);
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
    setShowGrowthChart(true);
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
        chartIds: ['print-chart-growth', 'print-chart-lifetime'],
      };

      setPdfContact(await loadClientContact(selectedCustomer?.id)); // 담당 매니저 이름·연락처 (docs/login_logic P9)
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

          /* 각 섹션 페이지 분리 —
             1번 섹션(연간 투자흐름표)은 자산 성장 그래프·100세 은퇴플로우까지
             하나의 섹션이므로 내부에서 끊지 않고 이어서 출력한다 */
          .print-section-flow { page-break-after: always; }
          .print-section-graphs,
          .print-section-lifetime { page-break-before: avoid; page-break-after: auto; }
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
        <Section title="연간 투자흐름표" note="(단위: 원)" headClassName="no-print">
        <div className="no-print" style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          marginBottom: 12,
        }}>
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
                  { label: '순자산', align: 'right', tip: '12/31 예수금 잔액 + 운용중 투자 자금(중간평가>평가금액>원금 · 계좌 연결분만)', hl: true },
                  { label: '순자산증가율', align: 'right', tip: '(현재 순자산 - 직전 순자산) / 직전 순자산 × 100' },
                  { label: '순이익', align: 'right', tip: '순자산 - (누적입금액 - 누적인출액)' },
                  { label: '순자산수익률', align: 'right', tip: '순이익 / (누적입금액 - 누적인출액) × 100', hl: true },
                  { label: '총투자금액', align: 'right', tip: '당해 종결된 상품의 투자원금 합 · 운용중인 자금은 순자산에 반영(중복 방지)' },
                  { label: '연간평가금액', align: 'right', tip: '당해 종결된 상품의 평가금액(회수금액) 합' },
                  { label: '연간총수익', align: 'right', tip: '당해 실현손익 = 연간평가금액 − 총투자금액' },
                  { label: '연수익률', align: 'right', tip: '당해 실현손익 ÷ 총투자금액 × 100 · 종결이 없는 해는 0' },
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
                  const isDetailRow = evalDetailYear === row.year;
                  return (
                    <tr
                      key={year}
                      style={{
                        borderBottom: '1px solid var(--bg-surface)',
                        backgroundColor: idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)',
                        ...(year === currentYear ? { backgroundColor: 'rgba(59,130,246,0.06)' } : {}),
                        // 평가상세를 보고 있는 연도 행 — 상세 화면과 짝을 이루도록 강조
                        ...(isDetailRow ? { backgroundColor: 'rgba(56,189,248,0.16)' } : {}),
                      }}
                    >
                      <td style={{ ...tdCenter, ...(isDetailRow ? { borderLeft: '3px solid var(--cyan-400)', fontWeight: 800, color: '#93C5FD' } : {}) }}>
                        {row.year}
                        {isDetailRow && (
                          <span style={{ display: 'block', fontSize: 9.5, fontWeight: 700, color: 'var(--cyan-400)', marginTop: 1, whiteSpace: 'nowrap' }}>▼ 상세</span>
                        )}
                      </td>
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
                  );
                });
              })()}
            </tbody>
          </table>
        </div>
        {/* ===== 평가 상세 — 가로 스크롤 컨테이너 바깥(스크롤바는 위 표에만 붙는다) ===== */}
        {evalDetailYear !== null && (() => {
          const row = annualFlowData.find(r => r.year === evalDetailYear);
          if (!row) return null;
          const todayStr = new Date().toISOString().slice(0, 10);
          // 투자일 오름차순(빠른 투자일 → 최근 투자일). 투자일이 없으면 맨 뒤로.
          const items = records
            .filter(r => {
              const sy = r.start_date ? parseInt(r.start_date.slice(0, 4)) : 9999;
              const ey = r.end_date ? parseInt(r.end_date.slice(0, 4)) : 9999;
              return sy <= row.year && ey >= row.year && r.record_type === 'investment';
            })
            .sort((a, b) => (a.start_date || '9999-99-99').localeCompare(b.start_date || '9999-99-99'));
          const fmtD = (d?: string | null) => (d ? d.slice(0, 10).replace(/-/g, '.') : '-');
          const thD: React.CSSProperties = { padding: '6px 10px', fontWeight: 600, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' };
          const tdD: React.CSSProperties = { padding: '5px 10px', whiteSpace: 'nowrap' };
          return (
            <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '10px 2px 4px', backgroundColor: 'var(--bg-card)', borderTop: '1px solid var(--border)' }}>
              {/* 내용 폭에 맞춘 블록을 오른쪽 정렬 — 상품명이 데이터 바로 왼쪽에 붙는다 */}
              <div style={{ maxWidth: '100%', overflowX: 'auto' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20, marginBottom: 4, flexWrap: 'wrap' }}>
                  {/* 연도를 크게 — 표를 다시 보지 않아도 어느 해인지 즉시 식별 */}
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontSize: 17, fontWeight: 800, color: '#93C5FD', letterSpacing: '-0.02em', padding: '1px 9px', borderRadius: 5, backgroundColor: 'rgba(56,189,248,0.16)' }}>
                      {row.year}년
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)' }}>평가 상세</span>
                    <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{items.length}건</span>
                  </div>
                  {/* 연도 전환 칩 — 표로 되돌아가지 않고 상세 안에서 연도를 바꾼다 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                    {[...annualFlowData].sort((a, b) => a.year - b.year).map(fr => {
                      const on = fr.year === row.year;
                      return (
                        <button
                          key={fr.year}
                          onClick={() => setEvalDetailYear(fr.year)}
                          style={{
                            padding: '3px 10px', fontSize: 11.5, fontWeight: on ? 800 : 600, borderRadius: 5, cursor: 'pointer',
                            border: `1px solid ${on ? 'var(--cyan-400)' : 'var(--border)'}`,
                            backgroundColor: on ? 'rgba(56,189,248,0.18)' : 'transparent',
                            color: on ? '#93C5FD' : 'var(--text-secondary)',
                          }}
                        >
                          {fr.year}
                        </button>
                      );
                    })}
                    <button
                      onClick={() => setEvalDetailYear(null)}
                      title="닫기"
                      style={{ marginLeft: 6, flexShrink: 0, padding: '3px 9px', fontSize: 11, borderRadius: 5, border: '1px solid var(--border)', backgroundColor: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer' }}
                    >
                      닫기 ✕
                    </button>
                  </div>
                </div>
                {/* 해당 연도 행의 핵심 값 + 순자산 검산 — 표를 다시 대조하지 않아도 되도록 */}
                {(() => {
                  // 순자산에 합산되는 분(= 연말 시점 운용중)만 골라 합계를 낸다. 백엔드 조건과 동일.
                  const activeSum = items.reduce((s, r) => {
                    const ey = r.end_date ? parseInt(r.end_date.slice(0, 4)) : 9999;
                    if (ey <= row.year) return s;  // 당해 종결분은 예수금 잔액에 이미 반영
                    const iv = r.interim_evaluations?.[String(row.year)];
                    return s + (iv ?? (r.evaluation_amount || r.investment_amount));
                  }, 0);
                  const balance = row.total_evaluation - activeSum;  // 역산한 예수금 잔액
                  // 활성 계좌들의 연말 잔액 합(백엔드와 동일 규칙: 날짜·id 최대, 숨긴 계좌 제외)
                  const cutoff = `${row.year}-12-31`;
                  const visibleBal = depositAccounts.filter(a => a.is_active).reduce((s, acc) => {
                    const txs = (accountTransactions[acc.id] || [])
                      .filter(t => (t.transaction_date || '') <= cutoff)
                      .sort((a, b) => (a.transaction_date || '').localeCompare(b.transaction_date || '') || a.id - b.id);
                    return s + (txs.length ? (txs[txs.length - 1].balance || 0) : 0);
                  }, 0);
                  // 순자산에서 역산한 잔액과 실제 계좌 잔액 합의 차이 — 0이어야 정상
                  const unlistedBal = balance - visibleBal;
                  return (
                    <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 7, lineHeight: 1.7 }}>
                      <span title="그 해에 종결된 상품의 투자원금 합 (운용중인 자금은 순자산에 반영)">총투자</span> <b style={{ color: 'var(--text-secondary)' }}>{formatCurrency(row.total_contribution)}</b>
                      {' · '}연간평가 <b style={{ color: '#93C5FD' }}>{formatCurrency(row.annual_evaluation)}</b>
                      {' · '}순자산 <b style={{ color: '#93C5FD' }}>{formatCurrency(row.total_evaluation)}</b>
                      <br />
                      <span style={{ fontSize: 11 }}>
                        순자산 내역 = 예수금 잔액 <b style={{ color: balance < 0 ? '#F87171' : 'var(--text-secondary)' }}>{formatCurrency(balance)}</b>
                        {' + '}운용중 합계 <b style={{ color: '#34D399' }}>{formatCurrency(activeSum)}</b>
                        <span style={{ color: 'var(--text-muted)' }}> (아래 &lsquo;운용중&rsquo; 행의 평가금액 합)</span>
                      </span>
                      {Math.abs(unlistedBal) >= 1 && (
                        <>
                          <br />
                          <span
                            title={'순자산에서 역산한 예수금 잔액이 활성 계좌들의 실제 잔액 합과 다릅니다.\n계좌 연결이 누락된 투자기록이 있거나, 거래 데이터가 갱신되지 않았을 수 있습니다.\n\n[재계산] 버튼을 눌러도 차이가 남으면 데이터 점검이 필요합니다.'}
                            style={{ fontSize: 11, color: '#FCD34D', cursor: 'help' }}
                          >
                            ⚠️ 계좌 잔액 합계({formatCurrency(visibleBal)})와 <b>{formatCurrency(unlistedBal)}</b> 차이가 있습니다
                            {' '}— [재계산] 후에도 남으면 데이터 점검이 필요합니다.
                          </span>
                        </>
                      )}
                    </div>
                  );
                })()}
                {items.length === 0 ? (
                  <div style={{ padding: '18px 40px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
                    해당 연도에 운용된 투자기록이 없습니다.
                  </div>
                ) : (
                <table style={{ fontSize: 11.5, borderCollapse: 'collapse', borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border)' }}>
                  <thead>
                    <tr style={{ backgroundColor: 'var(--bg-card-2)' }}>
                      <th style={{ ...thD, textAlign: 'left', color: 'var(--text-secondary)' }}>상품</th>
                      <th style={{ ...thD, textAlign: 'center', color: 'var(--text-secondary)', width: 92 }}>투자일</th>
                      <th style={{ ...thD, textAlign: 'center', color: 'var(--text-secondary)', width: 92 }}>종료일</th>
                      <th style={{ ...thD, textAlign: 'right', color: 'var(--text-secondary)', width: 110 }}>투자금액</th>
                      <th style={{ ...thD, textAlign: 'right', color: 'var(--warning)', width: 110 }}>중간평가</th>
                      <th style={{ ...thD, textAlign: 'right', color: 'var(--success)', width: 110 }}>투자종료</th>
                      <th style={{ ...thD, textAlign: 'right', color: 'var(--blue-400)', width: 110 }}>평가금액</th>
                      <th style={{ ...thD, textAlign: 'center', color: 'var(--text-secondary)', width: 66 }}>상태</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((r, rIdx) => {
                      const interim = r.interim_evaluations?.[String(row.year)];
                      const isExit = r.status === 'exit' && r.end_date && parseInt(r.end_date.slice(0, 4)) === row.year;
                      const exitVal = isExit ? (r.evaluation_amount ?? null) : null;
                      // 백엔드 순자산과 동일 규칙: 중간평가 > 평가금액 > 투자원금.
                      // (이전엔 운용중 상품의 평가금액을 무시하고 원금을 표시해, 화면 합계와
                      //  순자산이 서로 다른 값이 되어 검산이 불가능했음)
                      const evalVal = interim ?? (r.evaluation_amount || r.investment_amount);
                      // 종결 표시인데 종료일이 아직 오지 않은 경우 — 실제 데이터 이상.
                      // 기준을 '조회 연도'로 잡으면 과거 연도를 볼 때 이듬해 종료 예정인
                      // 정상 상품까지 걸리므로, 오늘 날짜와 비교한다.
                      const dateMismatch = r.status === 'exit' && !!r.end_date
                        && r.end_date.slice(0, 10) > todayStr;
                      const bg = rIdx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)';
                      return (
                        <tr key={r.id} style={{ backgroundColor: bg, borderBottom: '1px solid var(--bg-surface)' }}>
                          <td style={{ ...tdD, color: 'var(--text-secondary)', paddingRight: 18 }}>{getProductName(r)}</td>
                          <td style={{ ...tdD, textAlign: 'center', color: 'var(--text-muted)' }}>{fmtD(r.start_date)}</td>
                          <td style={{ ...tdD, textAlign: 'center', color: 'var(--text-muted)' }}>{fmtD(r.end_date)}</td>
                          <td style={{ ...tdD, textAlign: 'right', color: 'var(--text-muted)' }}>{r.investment_amount.toLocaleString()}</td>
                          <td style={{ ...tdD, textAlign: 'right', color: interim != null ? '#FCD34D' : 'var(--text-muted)', fontWeight: interim != null ? 700 : 400 }}>{interim != null ? interim.toLocaleString() : '-'}</td>
                          <td style={{ ...tdD, textAlign: 'right', color: exitVal != null ? '#34D399' : 'var(--text-muted)', fontWeight: exitVal != null ? 700 : 400 }}>{exitVal != null ? exitVal.toLocaleString() : '-'}</td>
                          <td style={{ ...tdD, textAlign: 'right', fontWeight: 700, color: 'var(--blue-400)' }}>{evalVal.toLocaleString()}</td>
                          <td style={{ ...tdD, textAlign: 'center' }}>
                            <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, backgroundColor: isExit ? 'rgba(16,185,129,0.15)' : 'rgba(59,130,246,0.15)', color: isExit ? '#34D399' : '#60A5FA', fontWeight: 600 }}>{isExit ? '종결' : '운용중'}</span>
                            {dateMismatch && (
                              <span
                                title={`'종결'로 표시돼 있으나 종료일(${r.end_date})이 아직 오지 않았습니다.\n집계와 순자산은 종료일을 기준으로 판단하므로, 이 상품은 종료일이 속한 연도에 실현 성과로 잡히고 그전까지는 운용중으로 계산됩니다.\n종료일이 예상 만기일로 잘못 입력되지 않았는지 확인해주세요.`}
                                style={{ marginLeft: 4, fontSize: 10, cursor: 'help', color: '#FCD34D' }}
                              >⚠️</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                )}
              </div>
            </div>
          );
        })()}

        {/* ── 하위 보기 전환 ──────────────────────────────────────────
             자산 성장 그래프·100세 은퇴플로우는 연간 투자흐름표에서 파생되는
             '보는 방식'이므로 별도 섹션으로 올리지 않고 이 섹션 본문 안에 둔다 */}
        {annualFlowData.length > 0 && (
          <div className="no-print" style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button
              onClick={() => setShowGrowthChart(!showGrowthChart)}
              className="no-print-btn"
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', border: '1px solid var(--border-strong)', borderRadius: 8, backgroundColor: showGrowthChart ? 'rgba(59,130,246,0.12)' : 'var(--bg-card)', cursor: 'pointer', fontSize: 13, color: showGrowthChart ? '#60A5FA' : 'var(--text-secondary)', fontWeight: 500 }}
            >
              {showGrowthChart ? '\u25BC' : '\u25B6'} 자산 성장 그래프
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

        {/* 자산 성장 그래프 — 고객 설명용 단일 그래프 (색면 = 수익 서사) */}
        <section id="print-sec-graphs" className="print-section-graphs">
          {/* 1번 섹션의 하위 블록 — 번호 없이 작은 제목으로 (페이지도 나누지 않는다) */}
          <div className="print-section-title" style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', marginTop: 10, marginBottom: 6 }}>· 자산 성장 그래프</div>
          {showGrowthChart && annualFlowData.length > 0 && (() => {
            // 요약 카드: 최신 연도 기준 헤드라인 숫자 (넣은 돈 → 현재 순자산 → 순이익)
            const latest = [...annualFlowData].sort((a, b) => a.year - b.year).at(-1)!;
            const netDeposit = latest.cumulative_deposit_in - latest.cumulative_withdrawal;
            const netAsset = latest.total_evaluation;
            const netProfit = netAsset - netDeposit;
            const profitRate = netDeposit > 0 ? (netProfit / netDeposit) * 100 : null;
            const profitColor = netProfit > 0 ? '#34D399' : netProfit < 0 ? '#F87171' : 'var(--text-primary)';
            const card = (label: string, value: string, color: string, sub?: string) => (
              <div style={{ flex: 1, minWidth: 150, padding: '10px 14px', borderRadius: 8, backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 3 }}>{label}</div>
                <div style={{ fontSize: 17, fontWeight: 800, color }}>{value}{sub && <span style={{ fontSize: 12, fontWeight: 700, marginLeft: 6 }}>{sub}</span>}</div>
              </div>
            );
            // 가로폭 제한 없음 — 섹션 폭을 그대로 쓴다
            return (
              <div style={{ marginTop: 12, padding: '16px 20px', border: '1px solid var(--border)', borderRadius: 8, backgroundColor: 'var(--bg-card)' }}>
                <SubHead label="자산 성장 그래프" />
                {/* 헤드라인 요약 카드 */}
                <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
                  {card('순입금액', `${netDeposit.toLocaleString()}원`, 'var(--text-primary)')}
                  {card(`현재 순자산 (${latest.year}년)`, `${netAsset.toLocaleString()}원`, '#7CC0FF')}
                  {card('순이익', `${netProfit >= 0 ? '+' : ''}${netProfit.toLocaleString()}원`, profitColor, profitRate != null ? `(${profitRate >= 0 ? '+' : ''}${profitRate.toFixed(1)}%)` : undefined)}
                </div>
                {/* 간단 범례 + 수익률 토글 */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 8, fontSize: 11, flexWrap: 'wrap' }}>
                  <span style={{ color: 'var(--text-muted)' }}>
                    <span style={{ color: '#7CC0FF', fontWeight: 700 }}>파란 선</span> = 순자산 · 회색 점선 = 순입금액 · <span style={{ color: '#34D399', fontWeight: 700 }}>초록면 = 수익</span> · <span style={{ color: '#F87171' }}>빨간면 = 평가 손실</span>
                  </span>
                  <button className="no-print" onClick={() => setGrowthOpts(prev => ({ ...prev, showRate: !prev.showRate }))}
                    style={{ padding: '3px 10px', border: '1px solid var(--border-strong)', borderRadius: 6, backgroundColor: growthOpts.showRate ? 'var(--bg-card-2)' : 'var(--bg-surface)', cursor: 'pointer', opacity: growthOpts.showRate ? 1 : 0.5, fontSize: 11, color: 'var(--text-secondary)' }}>
                    수익률(%) 선
                  </button>
                </div>
                <div id="print-chart-growth" className="print-chart-wrap">
                  <div className="print-section-title" style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>자산 성장 그래프</div>
                  <AssetGrowthChart data={annualFlowData} options={growthOpts} noAnimation={isPrinting} />
                </div>
              </div>
            );
          })()}
        </section>

        {/* 100세 은퇴플로우 */}
        {showLifetimeFlow && (
          <section id="print-sec-lifetime" className="print-section-lifetime" style={{ marginTop: 12 }}>
            <div className="print-section-title" style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', marginTop: 10, marginBottom: 6 }}>· 100세 은퇴플로우</div>
            <div style={{ marginTop: 12, padding: '16px 20px', border: '1px solid var(--border)', borderRadius: 8, backgroundColor: 'var(--bg-card)' }}>
            <SubHead label="100세 은퇴플로우" />
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
            </div>
          </section>
        )}
        </Section>
      </section>

      {/* ===== 섹터2: 예수금 계좌 기록 ===== */}
      <section id="print-sec-deposit" className="print-section-deposit">
        <div className="print-section-title" style={{ fontSize: 13, fontWeight: 700, color: 'var(--blue-400)', marginBottom: 8, paddingBottom: 4, borderBottom: '2px solid var(--blue-500)' }}>2. 예수금 계좌 기록</div>
        <Section title="예수금 계좌 기록" headClassName="no-print">
        <div className="no-print" style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}>
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
                      {/* 원금(입금) 누락 경고 — 투자 기록은 있으나 입금 거래가 0건인 계좌 */}
                      {missingDepositAccountIds.has(account.id) && (
                        <span
                          title={'투자 거래는 있으나 입금 거래가 한 건도 없습니다.\n누적입금액·순입금액이 0이 되어 순자산수익률을 계산할 수 없고, 자산 전액이 수익으로 계상됩니다.\n\n종료(투자금 회수)는 고객이 새로 넣은 돈이 아니므로 입금으로 집계되지 않습니다.\n최초 투자일 이전 날짜로 입금 거래를 추가하면 모든 지표가 정상화됩니다.'}
                          style={{
                            fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', cursor: 'help',
                            color: '#FCD34D', backgroundColor: 'rgba(245,158,11,0.14)',
                            border: '1px solid rgba(245,158,11,0.5)', padding: '1px 7px', borderRadius: 4,
                          }}
                        >
                          ⚠️ 입금 내역 없음
                        </span>
                      )}
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
                                  const res = await fetch(`${API_URL}/api/v1/retirement/deposit-accounts/${account.id}`, {
                                    method: 'DELETE', headers: authLib.getAuthHeader(),
                                  });
                                  await okOrNotify(res, '계좌 숨기기');
                                  fetchDepositAccounts();
                                } catch (err) { notifyError('계좌를 숨기지 못했습니다.', err); }
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
                                  }).then((res) => okOrNotify(res, '계좌 활성화'));
                                  fetchDepositAccounts();
                                } catch (err) { notifyError('계좌를 활성화하지 못했습니다.', err); }
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
                                              const res = await fetch(`${API_URL}/api/v1/retirement/deposit-transactions/${tx.id}`, {
                                                method: 'DELETE', headers: authLib.getAuthHeader(),
                                              });
                                              await okOrNotify(res, '거래내역 삭제');
                                              fetchTransactions(account.id);
                                              fetchDepositAccounts();
                                              fetchAnnualFlow();  // 삭제로 잔액이 바뀌므로 흐름표도 재조회
                                            } catch (err) { notifyError('거래내역을 삭제하지 못했습니다.', err); }
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
        </Section>
      </section>

      {/* ===== 섹터3: 투자기록 테이블 ===== */}
      <section id="print-sec-records" className="print-section-records">
        <div className="print-section-title" style={{ fontSize: 13, fontWeight: 700, color: 'var(--blue-400)', marginBottom: 8, paddingBottom: 4, borderBottom: '2px solid var(--blue-500)' }}>3. 투자기록</div>
        <Section title="투자기록" headClassName="no-print">
        <div className="no-print" style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
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
                              const res = await fetch(`${API_URL}/api/v1/retirement/investment-records/${record.id}`, {
                                method: 'DELETE', headers: authLib.getAuthHeader(),
                              });
                              await okOrNotify(res, '투자기록 삭제');
                              fetchRecords();
                              fetchDepositAccounts();
                              expandedAccountIds.forEach(aid => fetchTransactions(aid));
                              fetchAnnualFlow();  // 투자기록 삭제는 순자산에 직접 반영
                            } catch (err) { notifyError('투자기록을 삭제하지 못했습니다.', err); }
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
        </Section>
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
              ['순자산 ★', '12/31 기준 예수금 잔액 + 운용중 투자 자금(해당 연도 중간평가 > 평가금액 > 투자원금 순 · 예수금 계좌에 연결된 투자만)'],
              ['순자산증가율', '(그해 순자산 − 직전 연도 순자산) ÷ 직전 연도 순자산 × 100'],
              ['순이익', '순자산 − 순입금액'],
              ['순자산수익률 ★', '순이익 ÷ 순입금액 × 100'],
            ]],
            ['투자기록 기반 — 당해 실현 성과', [
              ['총투자금액', '그 해에 종결된 상품의 투자원금 합계. 해를 걸친 투자는 종결된 해에 한 번만 집계되며, 운용 중이던 해에는 목록에 표시만 되고 금액에는 포함되지 않는다(중복 방지). 같은 해에 엑싯 후 재투자한 회전분은 서로 다른 건이므로 각각 집계된다'],
              ['연간평가금액', '그 해에 종결된 상품의 평가금액(회수금액) 합계'],
              ['연간총수익', '당해 실현손익 = 연간평가금액 − 총투자금액. 중간평가는 순자산에만 반영되므로 미실현 수익이 여기에 먼저 잡혔다가 종결 시 다시 잡히는 이중계상은 발생하지 않는다'],
              ['연수익률', '당해 실현손익 ÷ 총투자금액 × 100. 그 해에 종결된 상품이 없으면 0'],
              ['※ 운용 중인 자산', '아직 종결되지 않은 투자는 위 네 항목에 포함되지 않고 순자산에 반영된다'],
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
