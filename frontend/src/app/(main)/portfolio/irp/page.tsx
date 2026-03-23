'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Tab, type TabItem } from '@/components/common/Tab';
import { Button } from '@/components/common/Button';
import { Card } from '@/components/common/Card';
import { ClientRow } from '@/components/portfolio/ClientRow';
import { ClientManagementModal } from '@/components/portfolio/ClientManagementModal';
import { SnapshotDataTable } from '@/components/portfolio/SnapshotDataTable';
import { SuggestionEditor } from '@/components/portfolio/SuggestionEditor';
import { authLib } from '@/lib/auth';
import type { PeriodKey, HistoryPoint, DistributionItem } from '@/components/portfolio/PortfolioCharts';
import { API_URL } from '@/lib/api-url';
import type { ProductMaster } from '@/components/portfolio/ProductMasterTable';

const PortfolioCharts = dynamic(
  () => import('@/components/portfolio/PortfolioCharts').then((m) => m.PortfolioCharts),
  { ssr: false }
);

/* ------------------------------------------------------------------ */
/*  Dynamic import for ReportView (recharts SSR 방지)                   */
/* ------------------------------------------------------------------ */

const ReportView = dynamic(() => import('@/components/portfolio/ReportView'), { ssr: false });

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

interface ClientAccount {
  id: string;
  client_id: string;
  account_type: 'irp' | 'pension1' | 'pension2';
  account_number?: string;
  securities_company?: string;
  monthly_payment?: number;
}

interface Client {
  id: string;
  name: string;
  memo?: string;
  email?: string;
  portal_token?: string;
  accounts: ClientAccount[];
}

interface Holding {
  id: string;
  seq?: number;
  product_name: string;
  product_code?: string;
  product_type?: string;
  risk_level?: string;
  region?: string;
  quantity?: number;
  purchase_price?: number;
  current_price?: number;
  purchase_amount?: number;
  evaluation_amount?: number;
  return_amount?: number;
  return_rate?: number;
  weight?: number;
  reference_price?: number;
}

interface Snapshot {
  id: string;
  client_account_id: string;
  snapshot_date: string;
  deposit_amount?: number;
  foreign_deposit_amount?: number;
  total_assets?: number;
  total_purchase?: number;
  total_evaluation?: number;
  total_return?: number;
  total_return_rate?: number;
  holdings: Holding[];
}

interface ReportData {
  snapshot: {
    id: string;
    snapshot_date: string;
    deposit_amount?: number;
    total_purchase?: number;
    total_evaluation?: number;
    total_return?: number;
    total_return_rate?: number;
  };
  account: {
    id: string;
    account_type: string;
    account_number?: string;
    securities_company?: string;
    monthly_payment?: number;
  };
  holdings: Holding[];
  history: { date: string; return_rate?: number }[];
  ai_comment?: string;
  ai_change_comment?: string;
}

interface ClientRowData {
  clientId: string;
  clientName: string;
  accountId: string;
  accountType: 'irp' | 'pension1' | 'pension2';
  accountNumber: string;
  securitiesCompany: string;
  imageFile: File | null;
  imagePreview: string;
  snapshotDate: string;
}

interface ProcessResult {
  clientName: string;
  accountType: string;
  status: 'pending' | 'processing' | 'done' | 'error';
  snapshotId?: string;
  errorMsg?: string;
}

/* Inline extraction result state per snapshot */
interface HoldingEdit {
  holdingId: string;
  productName: string;
  productCode: string;
  riskLevel: string;
  region: string;
  quantity?: number;
  purchasePrice?: number;
  currentPrice?: number;
  purchaseAmount?: number;
  evaluationAmount?: number;
  returnAmount?: number;
  returnRate?: number;
  unmapped: boolean; /* not found in product master */
  saving: boolean;
}

interface ExtractionResult {
  snapshotId: string;
  clientName: string;
  accountType: string;
  snapshotDate: string;
  holdings: HoldingEdit[];
  applyingMaster: boolean;
  toastMsg: string;
  depositAmount?: number;
  foreignDepositAmount?: number;
  totalAssets?: number;
  totalPurchase?: number;
  totalEvaluation?: number;
  totalReturn?: number;
  totalReturnRate?: number;
}

const RISK_LEVELS = ['절대안정형', '안정형', '안정성장형', '성장형', '절대성장형'];
const REGIONS = ['국내', '미국', '글로벌', '베트남', '인도', '중국', '기타'];

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

const accountTypeLabel = (t: string) =>
  ({
    irp: 'IRP',
    pension: '연금저축',
    pension_saving: '연금저축(적립)',
    pension_hold: '연금저축(거치)',
    retirement: '퇴직연금',
    pension1: '연금저축1',
    pension2: '연금저축2',
  } as Record<string, string>)[t] || t;

function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

function makeDefaultRow(accountType: 'irp' | 'pension1' | 'pension2' = 'irp'): ClientRowData {
  return {
    clientId: '',
    clientName: '',
    accountId: '',
    accountType,
    accountNumber: '',
    securitiesCompany: '',
    imageFile: null,
    imagePreview: '',
    snapshotDate: todayString(),
  };
}

/* ------------------------------------------------------------------ */
/*  고객 계좌 조회/생성                                                  */
/* ------------------------------------------------------------------ */

async function getOrCreateClientAccount(
  row: ClientRowData,
  _createdClientIds?: Map<string, string>
): Promise<string> {
  // If an account is already selected, use it directly
  if (row.accountId) return row.accountId;

  // clientId must be set (validated before calling this function)
  const clientId = row.clientId;
  if (!clientId) throw new Error('고객을 선택하세요.');

  // Create a new account under the existing client
  const res = await fetch(`${API_URL}/api/v1/clients/${clientId}/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
    body: JSON.stringify({
      account_type: row.accountType,
      account_number: row.accountNumber || undefined,
      securities_company: row.securitiesCompany || undefined,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.detail || '계좌 생성 실패');
  }
  const account: ClientAccount = await res.json();
  return account.id;
}

/* ------------------------------------------------------------------ */
/*  Step indicator                                                      */
/* ------------------------------------------------------------------ */

function StepDot({ step, active, done }: { step: number; active: boolean; done: boolean }) {
  return (
    <div
      style={{
        width: 28,
        height: 28,
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: done ? '#1E3A5F' : active ? '#3B82F6' : '#E1E5EB',
        color: done || active ? '#fff' : '#9CA3AF',
        fontSize: '0.75rem',
        fontWeight: 700,
        flexShrink: 0,
        transition: 'all 0.2s ease',
      }}
    >
      {done ? (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        step
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Process result status icon                                          */
/* ------------------------------------------------------------------ */

function StatusIcon({ status }: { status: ProcessResult['status'] }) {
  if (status === 'done')
    return (
      <span style={{ color: '#10B981', fontWeight: 700, fontSize: '1.1rem' }}>✓</span>
    );
  if (status === 'processing')
    return (
      <span
        style={{
          display: 'inline-block',
          width: 14,
          height: 14,
          border: '2px solid #1E3A5F',
          borderTopColor: 'transparent',
          borderRadius: '50%',
          animation: 'spin 0.7s linear infinite',
        }}
      />
    );
  if (status === 'error')
    return <span style={{ color: '#EF4444', fontWeight: 700, fontSize: '1.1rem' }}>✗</span>;
  return <span style={{ color: '#9CA3AF' }}>–</span>;
}

/* ------------------------------------------------------------------ */
/*  Tabs definition                                                     */
/* ------------------------------------------------------------------ */

const TABS: TabItem[] = [
  { key: 'data', label: '1. 데이터 입력' },
  { key: 'template', label: '2. 데이터 확인' },
  { key: 'report', label: '3. 보고서' },
];

/* ------------------------------------------------------------------ */
/*  Tab2 Types                                                          */
/* ------------------------------------------------------------------ */

interface RebalRow {
  id: string; /* holdingId or temp key */
  productName: string;
  productCode: string;
  riskLevel: string;
  region: string;
  quantity: number;
  purchasePrice: number;
  currentPrice: number;
  purchaseAmount: number;
  evaluationAmount: number;
  returnAmount: number;
  returnRate: number;
  evalRatio: number; /* 평가비율 */
  rebalRatio: number; /* 재조정 비율 (%) */
  rebalAmount: number; /* 재조정 잔액 */
  sellBuy: number; /* Sell/Buy */
  shares: number; /* 좌수 */
  isRow1: boolean; /* 예수금/자동운용상품 row */
}

interface Tab2SectionProps {
  clients: Client[];
  productMasters: ProductMaster[];
  histClientId: string;
  setHistClientId: (id: string) => void;
  histAccountId: string;
  setHistAccountId: (id: string) => void;
  historyList: Array<{ id: string; snapshot_date: string; total_return_rate?: number }>;
  setHistoryList: React.Dispatch<React.SetStateAction<Array<{ id: string; snapshot_date: string; total_return_rate?: number }>>>;
  historyLoading: boolean;
  setHistoryLoading: (v: boolean) => void;
  historyPoints: HistoryPoint[];
  setHistoryPoints: React.Dispatch<React.SetStateAction<HistoryPoint[]>>;
  historyChartLoading: boolean;
  setHistoryChartLoading: (v: boolean) => void;
  activeSnapshotId: string | null;
  setActiveSnapshotId: (id: string | null) => void;
  activeSnapshot: Snapshot | null;
  setActiveSnapshot: React.Dispatch<React.SetStateAction<Snapshot | null>>;
  activeSnapshotLoading: boolean;
  setActiveSnapshotLoading: (v: boolean) => void;
  regionDist: DistributionItem[];
  setRegionDist: React.Dispatch<React.SetStateAction<DistributionItem[]>>;
  riskDist: DistributionItem[];
  setRiskDist: React.Dispatch<React.SetStateAction<DistributionItem[]>>;
  selectedSnapshotIds: Set<string>;
  setSelectedSnapshotIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  onGoToReport: () => void;
  onProductMasterCreated: (pm: ProductMaster) => void;
}

/* ------------------------------------------------------------------ */
/*  Tab2Section                                                         */
/* ------------------------------------------------------------------ */

function Tab2Section({
  clients,
  productMasters,
  histClientId,
  setHistClientId,
  histAccountId,
  setHistAccountId,
  historyList,
  setHistoryList,
  historyLoading,
  setHistoryLoading,
  historyPoints,
  setHistoryPoints,
  historyChartLoading,
  setHistoryChartLoading,
  activeSnapshotId,
  setActiveSnapshotId,
  activeSnapshot,
  setActiveSnapshot,
  activeSnapshotLoading,
  setActiveSnapshotLoading,
  regionDist,
  setRegionDist,
  riskDist,
  setRiskDist,
  selectedSnapshotIds,
  setSelectedSnapshotIds,
  onGoToReport,
  onProductMasterCreated,
}: Tab2SectionProps) {
  /* ---- Area 1 local state ---- */
  const [t2DatePage, setT2DatePage] = useState(0);
  const [t2Summary, setT2Summary] = useState<Snapshot | null>(null);
  const T2_DATES_PER_PAGE = 10;

  /* ---- Area 2 local state ---- */
  const [t2ShowDetail, setT2ShowDetail] = useState(false);
  const [t2DetailLoading, setT2DetailLoading] = useState(false);

  /* ---- Area 3 local state ---- */
  const [t2HistPeriod, setT2HistPeriod] = useState<PeriodKey>('1y');

  /* ---- Area 5 local state ---- */
  const [t2RebalRows, setT2RebalRows] = useState<RebalRow[]>([]);
  const [t2RebalSaving, setT2RebalSaving] = useState(false);
  const [t2ProductSearch, setT2ProductSearch] = useState('');
  const [t2AddProductOpen, setT2AddProductOpen] = useState(false);
  const [t2Toast, setT2Toast] = useState('');

  /* ---- Date edit/delete modal state ---- */
  const [t2DateEditOpen, setT2DateEditOpen] = useState(false);
  const [t2DateEditSearch, setT2DateEditSearch] = useState('');
  const [t2DateDeleteConfirmId, setT2DateDeleteConfirmId] = useState<string | null>(null);
  const [t2DateDeleting, setT2DateDeleting] = useState(false);

  /* ---- Product add: new master creation state ---- */
  const [t2NewMasterOpen, setT2NewMasterOpen] = useState(false);
  const [t2NewMasterForm, setT2NewMasterForm] = useState({ product_name: '', product_code: '', risk_level: '', region: '', product_type: '' });
  const [t2NewMasterSaving, setT2NewMasterSaving] = useState(false);

  /* ---- Row replace: which row to replace ---- */
  const [t2ReplaceRowId, setT2ReplaceRowId] = useState<string | null>(null);

  /* ---- helpers ---- */
  const fmtNum = (n?: number | null) =>
    n != null ? n.toLocaleString('ko-KR') : '-';

  function showT2Toast(msg: string) {
    setT2Toast(msg);
    setTimeout(() => setT2Toast(''), 3000);
  }

  async function handleT2DeleteSnapshot(snapshotId: string) {
    setT2DateDeleting(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/snapshots/${snapshotId}`, {
        method: 'DELETE',
        headers: { ...authLib.getAuthHeader() },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showT2Toast(`삭제 실패: ${err?.detail || '알 수 없는 오류'}`);
        return;
      }
      /* Remove from historyList */
      setHistoryList((prev) => prev.filter((item) => item.id !== snapshotId));
      /* If active snapshot deleted, clear */
      if (activeSnapshotId === snapshotId) {
        setActiveSnapshotId(null);
        setActiveSnapshot(null);
        setT2ShowDetail(false);
        setT2RebalRows([]);
        setT2Summary(null);
      }
      setT2DateDeleteConfirmId(null);
      setT2DateEditOpen(false);
      showT2Toast('날짜 데이터가 삭제되었습니다.');
    } catch {
      showT2Toast('삭제 중 오류가 발생했습니다.');
    } finally {
      setT2DateDeleting(false);
    }
  }

  async function handleT2CreateNewMaster() {
    if (!t2NewMasterForm.product_name.trim()) return;
    setT2NewMasterSaving(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/product-master`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
        body: JSON.stringify({
          product_name: t2NewMasterForm.product_name,
          product_code: t2NewMasterForm.product_code || undefined,
          risk_level: t2NewMasterForm.risk_level || undefined,
          region: t2NewMasterForm.region || undefined,
          product_type: t2NewMasterForm.product_type || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showT2Toast(`등록 실패: ${err?.detail || '알 수 없는 오류'}`);
        return;
      }
      const newMaster: ProductMaster = await res.json();
      /* Notify parent to update its productMasters state (triggers re-render with new list) */
      onProductMasterCreated(newMaster);
      setT2NewMasterOpen(false);
      setT2NewMasterForm({ product_name: '', product_code: '', risk_level: '', region: '', product_type: '' });
      /* Pre-fill search so user can immediately find and click the new product */
      setT2ProductSearch(newMaster.product_name);
      showT2Toast(`'${newMaster.product_name}' 상품이 등록되었습니다.`);
    } catch {
      showT2Toast('등록 중 오류가 발생했습니다.');
    } finally {
      setT2NewMasterSaving(false);
    }
  }

  function handleT2ReplaceProductFromMaster(pm: ProductMaster) {
    if (!t2ReplaceRowId) return;
    setT2RebalRows((prev) =>
      prev.map((r) =>
        r.id !== t2ReplaceRowId ? r : {
          ...r,
          productName: pm.product_name,
          productCode: pm.product_code ?? '',
          riskLevel: pm.risk_level ?? '',
          region: pm.region ?? '',
        }
      )
    );
    setT2ReplaceRowId(null);
    setT2AddProductOpen(false);
    setT2ProductSearch('');
  }

  /* ---- Derived: unique clients (deduplicate by name, merge accounts) ---- */
  const uniqueClientsMap = new Map<string, { id: string; name: string; accounts: ClientAccount[] }>();
  for (const c of clients) {
    if (uniqueClientsMap.has(c.name)) {
      /* Merge accounts into existing entry */
      const existing = uniqueClientsMap.get(c.name)!;
      existing.accounts = [...existing.accounts, ...c.accounts];
    } else {
      uniqueClientsMap.set(c.name, { id: c.id, name: c.name, accounts: [...c.accounts] });
    }
  }
  const uniqueClients = Array.from(uniqueClientsMap.values());

  /* ---- Derived: accounts for selected client (all accounts across same-name clients) ---- */
  /* When histClientId is set, find the name of that client, then collect all accounts from all clients with that name */
  const selectedClientName = clients.find((c) => c.id === histClientId)?.name ?? '';
  const t2ClientAccounts: ClientAccount[] = selectedClientName
    ? clients.filter((c) => c.name === selectedClientName).flatMap((c) => c.accounts)
    : [];

  /* ---- Derived: selected account info ---- */
  const t2SelectedAccount = t2ClientAccounts.find((a) => a.id === histAccountId);

  /* ---- Derived: paginated dates ---- */
  const t2PagedDates = historyList.slice(
    t2DatePage * T2_DATES_PER_PAGE,
    (t2DatePage + 1) * T2_DATES_PER_PAGE
  );
  const t2TotalPages = Math.ceil(historyList.length / T2_DATES_PER_PAGE);

  /* ---- Handlers ---- */
  function handleT2ClientChange(clientId: string) {
    setHistClientId(clientId);
    setHistAccountId('');
    setHistoryList([]);
    setT2DatePage(0);
    setT2Summary(null);
    setActiveSnapshotId(null);
    setActiveSnapshot(null);
    setT2ShowDetail(false);
    setT2RebalRows([]);
    setHistoryPoints([]);
    setRegionDist([]);
    setRiskDist([]);
    setSelectedSnapshotIds(new Set());
  }

  async function handleT2AccountChange(accountId: string) {
    setHistAccountId(accountId);
    setHistoryList([]);
    setT2DatePage(0);
    setT2Summary(null);
    setActiveSnapshotId(null);
    setActiveSnapshot(null);
    setT2ShowDetail(false);
    setT2RebalRows([]);
    setHistoryPoints([]);
    setRegionDist([]);
    setRiskDist([]);
    setSelectedSnapshotIds(new Set());

    if (!accountId) return;
    setHistoryLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/snapshots?account_id=${accountId}`, {
        headers: { ...authLib.getAuthHeader() },
      });
      if (!res.ok) return;
      const data = await res.json();
      const list: Array<{ id: string; snapshot_date: string; total_return_rate?: number }> = Array.isArray(data)
        ? data
        : data.snapshots ?? [];
      /* Sort newest first */
      const sorted = [...list].sort((a, b) => b.snapshot_date.localeCompare(a.snapshot_date));
      setHistoryList(sorted);

      /* Also load chart data */
      loadT2ChartData(accountId, t2HistPeriod);
    } catch {
      /* silent */
    } finally {
      setHistoryLoading(false);
    }
  }

  async function loadT2ChartData(accountId: string, period: PeriodKey) {
    setHistoryChartLoading(true);
    try {
      const res = await fetch(
        `${API_URL}/api/v1/snapshots?account_id=${accountId}`,
        { headers: { ...authLib.getAuthHeader() } }
      );
      if (!res.ok) return;
      const data = await res.json();
      const list: Array<{ id: string; snapshot_date: string; total_return_rate?: number }> = Array.isArray(data)
        ? data
        : data.snapshots ?? [];
      /* Sort newest first to find most recent snapshot date */
      const sorted = [...list].sort((a, b) => b.snapshot_date.localeCompare(a.snapshot_date));
      if (sorted.length === 0) {
        setHistoryPoints([]);
        return;
      }
      const mostRecentDate = new Date(sorted[0].snapshot_date);
      /* Calculate cutoff date based on period */
      const cutoff = new Date(mostRecentDate);
      if (period === '3m') cutoff.setMonth(cutoff.getMonth() - 3);
      else if (period === '6m') cutoff.setMonth(cutoff.getMonth() - 6);
      else cutoff.setFullYear(cutoff.getFullYear() - 1);
      /* Filter by date range */
      const filtered = sorted.filter((s) => new Date(s.snapshot_date) >= cutoff);
      /* Sort ascending for chart */
      const ascending = [...filtered].sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));
      setHistoryPoints(ascending.map((s) => ({ date: s.snapshot_date, return_rate: s.total_return_rate })));
    } catch {
      /* silent */
    } finally {
      setHistoryChartLoading(false);
    }
  }

  async function handleT2DateSelect(snapshotId: string) {
    setActiveSnapshotId(snapshotId);
    setT2Summary(null);
    setActiveSnapshotLoading(true);
    setT2ShowDetail(false);
    setT2RebalRows([]);
    try {
      const res = await fetch(`${API_URL}/api/v1/snapshots/${snapshotId}`, {
        headers: { ...authLib.getAuthHeader() },
      });
      if (!res.ok) return;
      const snap: Snapshot = await res.json();
      setT2Summary(snap);
    } catch {
      /* silent */
    } finally {
      setActiveSnapshotLoading(false);
    }
  }

  async function handleT2LoadDetail() {
    if (!activeSnapshotId) return;
    setT2DetailLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/snapshots/${activeSnapshotId}`, {
        headers: { ...authLib.getAuthHeader() },
      });
      if (!res.ok) return;
      const snap: Snapshot = await res.json();
      setActiveSnapshot(snap);
      setT2ShowDetail(true);

      /* Build distribution data */
      const evalByRegion: Record<string, number> = {};
      const evalByRisk: Record<string, number> = {};
      for (const h of snap.holdings) {
        const evalAmt = h.evaluation_amount ?? 0;
        if (h.region) evalByRegion[h.region] = (evalByRegion[h.region] ?? 0) + evalAmt;
        if (h.risk_level) evalByRisk[h.risk_level] = (evalByRisk[h.risk_level] ?? 0) + evalAmt;
      }
      setRegionDist(
        Object.entries(evalByRegion)
          .filter(([, v]) => v > 0)
          .map(([name, value]) => ({ name, value }))
          .sort((a, b) => b.value - a.value)
      );
      setRiskDist(
        Object.entries(evalByRisk)
          .filter(([, v]) => v > 0)
          .map(([name, value]) => ({ name, value }))
          .sort((a, b) => b.value - a.value)
      );

      /* Build rebal rows */
      buildRebalRows(snap);
    } catch {
      /* silent */
    } finally {
      setT2DetailLoading(false);
    }
  }

  function buildRebalRows(snap: Snapshot) {
    const account = t2ClientAccounts.find((a) => a.id === histAccountId);
    const accountType = account?.account_type ?? 'irp';
    const isPension = accountType === 'pension1' || accountType === 'pension2';

    const totalEval = (snap.total_evaluation ?? 0) + (snap.deposit_amount ?? 0);

    /* Identify row1 product — fixed name regardless of account type */
    const row1Name = '예수금/자동운용상품(고유계정대)';

    const row1Holding = snap.holdings.find(
      (h) => h.product_name === '자동운용상품(고유계정대)' || h.product_name === '예수금' || h.product_name === '예수금/자동운용상품(고유계정대)'
    );

    const otherHoldings = snap.holdings.filter(
      (h) => h.product_name !== '자동운용상품(고유계정대)' && h.product_name !== '예수금' && h.product_name !== '예수금/자동운용상품(고유계정대)'
    );

    const rows: RebalRow[] = [];

    /* Row 1 */
    const row1EvalAmt = row1Holding
      ? (row1Holding.evaluation_amount ?? 0)
      : (snap.deposit_amount ?? 0);
    const row1PurchAmt = row1Holding
      ? (row1Holding.purchase_amount ?? 0)
      : (snap.deposit_amount ?? 0);

    rows.push({
      id: row1Holding?.id ?? '__row1__',
      productName: row1Name,
      productCode: row1Holding?.product_code ?? '',
      riskLevel: row1Holding?.risk_level ?? '절대안정형',
      region: row1Holding?.region ?? '국내',
      quantity: row1Holding?.quantity ?? (isPension ? (snap.deposit_amount ?? 0) : 0),
      purchasePrice: row1Holding?.purchase_price ?? 1,
      currentPrice: row1Holding?.current_price ?? 1,
      purchaseAmount: row1PurchAmt,
      evaluationAmount: row1EvalAmt,
      returnAmount: row1EvalAmt - row1PurchAmt,
      returnRate: row1PurchAmt > 0 ? parseFloat(((row1EvalAmt - row1PurchAmt) / row1PurchAmt * 100).toFixed(2)) : 0,
      evalRatio: totalEval > 0 ? parseFloat((row1EvalAmt / totalEval * 100).toFixed(2)) : 0,
      rebalRatio: 0,
      rebalAmount: 0,
      sellBuy: 0,
      shares: 0,
      isRow1: true,
    });

    /* Other rows */
    for (const h of otherHoldings) {
      const isFund = (h.product_type || '').includes('펀드');
      const calcPurchAmt = (h.quantity != null && h.purchase_price != null)
        ? (isFund ? Math.ceil(h.quantity * h.purchase_price / 1000) : h.quantity * h.purchase_price)
        : h.purchase_amount;
      const calcEvalAmt = (h.quantity != null && h.current_price != null)
        ? (isFund ? Math.ceil(h.quantity * h.current_price / 1000) : h.quantity * h.current_price)
        : h.evaluation_amount;
      const purchAmt = calcPurchAmt ?? 0;
      const evalAmt = calcEvalAmt ?? 0;
      const retAmt = evalAmt - purchAmt;
      const retRate = purchAmt > 0 ? parseFloat((retAmt / purchAmt * 100).toFixed(2)) : 0;
      const evalRatio = totalEval > 0 ? parseFloat((evalAmt / totalEval * 100).toFixed(2)) : 0;

      rows.push({
        id: h.id,
        productName: h.product_name,
        productCode: h.product_code ?? '',
        riskLevel: h.risk_level ?? '',
        region: h.region ?? '',
        quantity: h.quantity ?? 0,
        purchasePrice: h.purchase_price ?? 0,
        currentPrice: h.current_price ?? 0,
        purchaseAmount: purchAmt,
        evaluationAmount: evalAmt,
        returnAmount: retAmt,
        returnRate: retRate,
        evalRatio,
        rebalRatio: 0,
        rebalAmount: 0,
        sellBuy: 0,
        shares: 0,
        isRow1: false,
      });
    }

    setT2RebalRows(rows);
  }

  function recalcRebalRows(rows: RebalRow[]): RebalRow[] {
    const otherRows = rows.filter((r) => !r.isRow1);
    const row1 = rows.find((r) => r.isRow1);
    if (!row1) return rows;

    /* totalEval = sum of ALL evaluation amounts — this is the base for rebal */
    const totalEval = rows.reduce((s, r) => s + r.evaluationAmount, 0);
    const otherRebalRatioSum = otherRows.reduce((s, r) => s + (isNaN(r.rebalRatio) ? 0 : r.rebalRatio), 0);

    /* For non-row1: rebalAmount = (rebalRatio / 100) * totalEval */
    const updatedOtherRows = otherRows.map((r) => {
      const rebalAmt = r.rebalRatio > 0
        ? Math.round(r.rebalRatio / 100 * totalEval)
        : r.rebalAmount;
      const sellBuy = rebalAmt - r.evaluationAmount;
      const shares = r.currentPrice > 0 ? Math.floor(rebalAmt / r.currentPrice) : 0;
      return { ...r, rebalAmount: rebalAmt, sellBuy, shares };
    });

    /* For row1: rebalAmount = totalEval - sum(other rebalAmounts) → ensures sum(rebalAmt) = totalEval → sum(sellBuy) = 0 */
    const otherRebalAmtSum = updatedOtherRows.reduce((s, r) => s + r.rebalAmount, 0);
    const row1RebalRatio = parseFloat((100 - otherRebalRatioSum).toFixed(2));
    const row1RebalAmt = totalEval - otherRebalAmtSum;
    const row1SellBuy = row1RebalAmt - row1.evaluationAmount;
    const row1Shares = row1.currentPrice > 0 ? Math.floor(row1RebalAmt / row1.currentPrice) : 0;

    const updatedRow1 = {
      ...row1,
      rebalRatio: row1RebalRatio,
      rebalAmount: row1RebalAmt,
      sellBuy: row1SellBuy,
      shares: row1Shares,
    };

    /* Reconstruct rows preserving original order */
    return rows.map((r) => {
      if (r.isRow1) return updatedRow1;
      return updatedOtherRows.find((ur) => ur.id === r.id) ?? r;
    });
  }

  function handleT2RebalRatioChange(id: string, val: string) {
    const num = parseFloat(val);
    setT2RebalRows((prev) => {
      const updated = prev.map((r) =>
        r.id !== id ? r : { ...r, rebalRatio: isNaN(num) ? 0 : num }
      );
      return recalcRebalRows(updated);
    });
  }

  function handleT2RebalAmtChange(id: string, val: string) {
    const raw = val.replace(/[^0-9\-]/g, '');
    const num = parseFloat(raw);
    setT2RebalRows((prev) => {
      const totalEval = prev.reduce((s, r) => s + r.evaluationAmount, 0);
      const updated = prev.map((r) => {
        if (r.id !== id) return r;
        const rebalAmt = isNaN(num) ? 0 : num;
        const newRatio = totalEval > 0 ? parseFloat((rebalAmt / totalEval * 100).toFixed(2)) : 0;
        return { ...r, rebalAmount: rebalAmt, rebalRatio: newRatio };
      });
      return recalcRebalRows(updated);
    });
  }

  function handleT2CurrentPriceChange(id: string, val: string) {
    const raw = val.replace(/[^0-9.]/g, '');
    const num = parseFloat(raw);
    setT2RebalRows((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        const cp = isNaN(num) ? r.currentPrice : num;
        const shares = cp > 0 ? Math.floor(r.rebalAmount / cp) : 0;
        return { ...r, currentPrice: cp, shares };
      })
    );
  }

  function handleT2Recalc() {
    setT2RebalRows((prev) => recalcRebalRows(prev));
  }

  function handleT2AddProductFromMaster(pm: ProductMaster) {
    if (!activeSnapshot) return;
    const totalEval = t2RebalRows.reduce((s, r) => s + r.evaluationAmount, 0);
    const newRow: RebalRow = {
      id: `__new__${Date.now()}`,
      productName: pm.product_name,
      productCode: pm.product_code ?? '',
      riskLevel: pm.risk_level ?? '',
      region: pm.region ?? '',
      quantity: 0,
      purchasePrice: 0,
      currentPrice: 0,
      purchaseAmount: 0,
      evaluationAmount: 0,
      returnAmount: 0,
      returnRate: 0,
      evalRatio: 0,
      rebalRatio: 0,
      rebalAmount: 0,
      sellBuy: 0,
      shares: 0,
      isRow1: false,
    };
    setT2RebalRows((prev) => recalcRebalRows([...prev, newRow]));
    setT2AddProductOpen(false);
    setT2ProductSearch('');
  }

  async function handleT2SaveRebal() {
    if (!activeSnapshotId || !histAccountId) return;
    setT2RebalSaving(true);
    try {
      const rows = t2RebalRows;
      const suggested_weights: Record<string, number> = {};
      for (const r of rows) {
        if (!r.id.startsWith('__')) {
          const totalEval = rows.reduce((s, rr) => s + rr.evaluationAmount, 0);
          suggested_weights[r.id] = totalEval > 0 ? r.rebalRatio / 100 : 0;
        }
      }

      const res = await fetch(`${API_URL}/api/v1/portfolios/suggestions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authLib.getAuthHeader(),
        },
        body: JSON.stringify({
          account_id: histAccountId,
          snapshot_id: activeSnapshotId,
          suggested_weights,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showT2Toast(`저장 실패: ${err?.detail || '알 수 없는 오류'}`);
        return;
      }
      showT2Toast('리밸런싱 제안이 저장되었습니다.');
    } catch {
      showT2Toast('저장 중 오류가 발생했습니다.');
    } finally {
      setT2RebalSaving(false);
    }
  }

  /* ---- Styles ---- */
  const cardStyle: React.CSSProperties = {
    border: '1px solid #E1E5EB',
    borderRadius: 12,
    padding: 20,
    backgroundColor: '#fff',
  };
  const sectionTitleStyle: React.CSSProperties = {
    fontSize: '0.9375rem',
    fontWeight: 700,
    color: '#1A1A2E',
  };
  const thStyle: React.CSSProperties = {
    padding: '9px 10px',
    fontSize: '0.75rem',
    fontWeight: 600,
    color: '#6B7280',
    textAlign: 'right',
    backgroundColor: '#F5F7FA',
    borderBottom: '1px solid #E1E5EB',
    whiteSpace: 'nowrap',
  };
  const tdStyle: React.CSSProperties = {
    padding: '8px 10px',
    fontSize: '0.8125rem',
    color: '#374151',
    textAlign: 'right',
    borderBottom: '1px solid #F3F4F6',
    whiteSpace: 'nowrap',
  };
  const totalRowStyle: React.CSSProperties = {
    padding: '9px 10px',
    fontSize: '0.8125rem',
    fontWeight: 700,
    color: '#1A1A2E',
    textAlign: 'right',
    backgroundColor: '#F5F7FA',
    borderBottom: 'none',
    whiteSpace: 'nowrap',
  };

  function rateColor(v?: number | null) {
    if (v == null) return '#374151';
    if (v > 0) return '#10B981';
    if (v < 0) return '#EF4444';
    return '#374151';
  }

  /* Rebal row sums */
  const rebalTotalEval = t2RebalRows.reduce((s, r) => s + r.evaluationAmount, 0);
  const rebalTotalPurch = t2RebalRows.reduce((s, r) => s + r.purchaseAmount, 0);
  const rebalTotalReturn = rebalTotalEval - rebalTotalPurch;
  const rebalTotalReturnRate = rebalTotalPurch > 0
    ? parseFloat((rebalTotalReturn / rebalTotalPurch * 100).toFixed(2))
    : 0;
  const rebalTotalRebalAmt = t2RebalRows.reduce((s, r) => s + r.rebalAmount, 0);
  const rebalTotalSellBuy = t2RebalRows.reduce((s, r) => s + r.sellBuy, 0);
  const rebalOtherRatioSum = t2RebalRows.filter((r) => !r.isRow1).reduce((s, r) => s + r.rebalRatio, 0);
  const rebalRow1RatioCalc = parseFloat((100 - rebalOtherRatioSum).toFixed(2));
  const ratioOverflow = rebalOtherRatioSum > 100;

  /* Detail table sums — use fund-aware calculated values when quantity+price available */
  const detailHoldings = activeSnapshot?.holdings ?? [];
  const detailTotalPurch = detailHoldings.reduce((s, h) => {
    const isFund = (h.product_type ?? '').includes('펀드');
    const hasQP = h.quantity != null && h.purchase_price != null && h.quantity > 0 && h.purchase_price > 0;
    if (hasQP) return s + (isFund ? Math.ceil(h.quantity! * h.purchase_price! / 1000) : h.quantity! * h.purchase_price!);
    return s + (h.purchase_amount ?? 0);
  }, 0);
  const detailTotalEval = detailHoldings.reduce((s, h) => {
    const isFund = (h.product_type ?? '').includes('펀드');
    const hasQC = h.quantity != null && h.current_price != null && h.quantity > 0 && h.current_price > 0;
    if (hasQC) return s + (isFund ? Math.ceil(h.quantity! * h.current_price! / 1000) : h.quantity! * h.current_price!);
    return s + (h.evaluation_amount ?? 0);
  }, 0);
  const detailTotalReturn = detailTotalEval - detailTotalPurch;
  const detailTotalReturnRate = detailTotalPurch > 0
    ? parseFloat((detailTotalReturn / detailTotalPurch * 100).toFixed(2))
    : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* ============================================================ */}
      {/* Area 1: 고객 이력 조회                                        */}
      {/* ============================================================ */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid #E1E5EB' }}>
          <div style={{ width: 3, height: 18, borderRadius: 2, backgroundColor: '#1E3A5F', flexShrink: 0 }} />
          <span style={sectionTitleStyle}>고객 이력 조회</span>
        </div>

        {/* Row 1: client + account type */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}>
          {/* 고객 선택 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 160, flex: 1 }}>
            <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#374151' }}>고객 선택</label>
            <select
              value={histClientId}
              onChange={(e) => handleT2ClientChange(e.target.value)}
              style={{ padding: '8px 10px', fontSize: '0.8125rem', border: '1px solid #E1E5EB', borderRadius: 8, outline: 'none', color: histClientId ? '#1A1A2E' : '#9CA3AF', backgroundColor: '#fff', cursor: 'pointer' }}
            >
              <option value="">-- 고객 선택 --</option>
              {uniqueClients.map((c) => (
                <option key={c.name} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          {/* 계좌 유형 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 120 }}>
            <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#374151' }}>계좌 유형</label>
            <select
              value={histAccountId}
              onChange={(e) => handleT2AccountChange(e.target.value)}
              disabled={!histClientId}
              style={{ padding: '8px 10px', fontSize: '0.8125rem', border: '1px solid #E1E5EB', borderRadius: 8, outline: 'none', color: histAccountId ? '#1A1A2E' : '#9CA3AF', backgroundColor: histClientId ? '#fff' : '#F9FAFB', cursor: histClientId ? 'pointer' : 'not-allowed', opacity: histClientId ? 1 : 0.6 }}
            >
              <option value="">-- 유형 선택 --</option>
              {t2ClientAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {accountTypeLabel(a.account_type)}
                </option>
              ))}
            </select>
          </div>

          {/* 증권사 + 계좌번호 (read-only) */}
          {t2SelectedAccount && (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 120 }}>
                <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#374151' }}>증권사</label>
                <div style={{ padding: '8px 10px', fontSize: '0.8125rem', border: '1px solid #E1E5EB', borderRadius: 8, backgroundColor: '#F9FAFB', color: '#374151', minWidth: 100 }}>
                  {t2SelectedAccount.securities_company || '-'}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 140 }}>
                <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#374151' }}>계좌번호</label>
                <div style={{ padding: '8px 10px', fontSize: '0.8125rem', border: '1px solid #E1E5EB', borderRadius: 8, backgroundColor: '#F9FAFB', color: '#374151', minWidth: 120 }}>
                  {t2SelectedAccount.account_number || '-'}
                </div>
              </div>
            </>
          )}
        </div>

        {/* 날짜 목록 */}
        {histAccountId && (
          <div style={{ marginTop: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#374151' }}>조회 날짜 선택</span>
              {historyLoading && (
                <span style={{ display: 'inline-block', width: 12, height: 12, border: '2px solid #1E3A5F', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
              )}
              {/* 편집 버튼 */}
              {historyList.length > 0 && (
                <button
                  onClick={() => { setT2DateEditOpen(true); setT2DateEditSearch(''); setT2DateDeleteConfirmId(null); }}
                  title="날짜 편집/삭제"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', fontSize: '0.75rem', fontWeight: 600, color: '#6B7280', backgroundColor: '#F9FAFB', border: '1px solid #E1E5EB', borderRadius: 6, cursor: 'pointer' }}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                  </svg>
                  편집
                </button>
              )}
              <span style={{ fontSize: '0.75rem', color: '#9CA3AF', marginLeft: 'auto' }}>
                총 {historyList.length}개 · {t2DatePage + 1}/{Math.max(t2TotalPages, 1)} 페이지
              </span>
            </div>

            {!historyLoading && historyList.length === 0 ? (
              <div style={{ padding: '14px', textAlign: 'center', color: '#9CA3AF', fontSize: '0.875rem', backgroundColor: '#F9FAFB', borderRadius: 8, border: '1px solid #E1E5EB' }}>
                저장된 스냅샷이 없습니다.
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {t2PagedDates.map((item) => {
                    const isActive = activeSnapshotId === item.id;
                    const rate = item.total_return_rate;
                    const rc = rate == null ? '#6B7280' : rate > 0 ? '#10B981' : rate < 0 ? '#EF4444' : '#6B7280';
                    return (
                      <button
                        key={item.id}
                        onClick={() => handleT2DateSelect(item.id)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          padding: '8px 14px', borderRadius: 8,
                          border: `1px solid ${isActive ? '#1E3A5F' : '#E1E5EB'}`,
                          backgroundColor: isActive ? '#EEF2F7' : '#fff',
                          cursor: 'pointer', transition: 'all 0.15s ease',
                          fontWeight: isActive ? 700 : 500, fontSize: '0.8125rem', color: '#1A1A2E',
                        }}
                      >
                        {item.snapshot_date}
                        {rate != null && (
                          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: rc }}>
                            {rate > 0 ? '+' : ''}{rate.toFixed(2)}%
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Pagination */}
                {t2TotalPages > 1 && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
                    <button
                      onClick={() => setT2DatePage((p) => Math.max(0, p - 1))}
                      disabled={t2DatePage === 0}
                      style={{ padding: '5px 12px', fontSize: '0.8125rem', fontWeight: 600, color: t2DatePage === 0 ? '#D1D5DB' : '#1E3A5F', backgroundColor: '#fff', border: `1px solid ${t2DatePage === 0 ? '#E5E7EB' : '#C7D2E2'}`, borderRadius: 7, cursor: t2DatePage === 0 ? 'not-allowed' : 'pointer' }}
                    >
                      이전
                    </button>
                    <span style={{ fontSize: '0.8125rem', color: '#6B7280' }}>
                      {t2DatePage + 1} / {t2TotalPages}
                    </span>
                    <button
                      onClick={() => setT2DatePage((p) => Math.min(t2TotalPages - 1, p + 1))}
                      disabled={t2DatePage >= t2TotalPages - 1}
                      style={{ padding: '5px 12px', fontSize: '0.8125rem', fontWeight: 600, color: t2DatePage >= t2TotalPages - 1 ? '#D1D5DB' : '#1E3A5F', backgroundColor: '#fff', border: `1px solid ${t2DatePage >= t2TotalPages - 1 ? '#E5E7EB' : '#C7D2E2'}`, borderRadius: 7, cursor: t2DatePage >= t2TotalPages - 1 ? 'not-allowed' : 'pointer' }}
                    >
                      다음
                    </button>
                  </div>
                )}
              </>
            )}

            {/* 요약정보 카드 */}
            {activeSnapshotLoading && (
              <div style={{ marginTop: 14, padding: '14px', textAlign: 'center', color: '#9CA3AF', fontSize: '0.875rem' }}>
                로딩 중...
              </div>
            )}
            {!activeSnapshotLoading && t2Summary && (
              <div style={{ marginTop: 14, padding: '14px 16px', backgroundColor: '#EEF2F7', borderRadius: 10, border: '1px solid #C7D2E2' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 10 }}>
                  {[
                    { label: '조회일', value: t2Summary.snapshot_date, isStr: true },
                    { label: '예수금', value: fmtNum(t2Summary.deposit_amount), isStr: true },
                    { label: '총자산', value: fmtNum(t2Summary.total_assets), isStr: true },
                    { label: '매입금액', value: fmtNum(t2Summary.total_purchase), isStr: true },
                    { label: '평가금액', value: fmtNum(t2Summary.total_evaluation), isStr: true },
                    { label: '평가손익', value: t2Summary.total_return != null ? `${t2Summary.total_return > 0 ? '+' : ''}${t2Summary.total_return.toLocaleString('ko-KR')}` : '-', isStr: true, color: rateColor(t2Summary.total_return) },
                    { label: '총수익률', value: t2Summary.total_return_rate != null ? `${t2Summary.total_return_rate > 0 ? '+' : ''}${t2Summary.total_return_rate.toFixed(2)}%` : '-', isStr: true, color: rateColor(t2Summary.total_return_rate) },
                    { label: '상품 갯수', value: `${t2Summary.holdings.length}개`, isStr: true },
                  ].map(({ label, value, color }) => (
                    <div key={label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                      <span style={{ fontSize: '0.6875rem', color: '#6B7280', fontWeight: 500 }}>{label}</span>
                      <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: color ?? '#1A1A2E' }}>{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {!histClientId && (
          <div style={{ marginTop: 8, padding: '14px', backgroundColor: '#F9FAFB', borderRadius: 8, fontSize: '0.8125rem', color: '#9CA3AF', textAlign: 'center' }}>
            고객과 계좌를 선택하면 스냅샷 이력을 조회합니다.
          </div>
        )}
      </div>

      {/* ============================================================ */}
      {/* Area 2: 포트폴리오 상세                                       */}
      {/* ============================================================ */}
      {histAccountId && activeSnapshotId && (
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid #E1E5EB' }}>
            <div style={{ width: 3, height: 18, borderRadius: 2, backgroundColor: '#1E3A5F', flexShrink: 0 }} />
            <span style={sectionTitleStyle}>포트폴리오 상세</span>
            {t2Summary && (
              <span style={{ fontSize: '0.8125rem', color: '#6B7280' }}>— {t2Summary.snapshot_date}</span>
            )}
            <div style={{ marginLeft: 'auto' }}>
              <button
                onClick={handleT2LoadDetail}
                disabled={t2DetailLoading}
                style={{ padding: '8px 18px', fontSize: '0.8125rem', fontWeight: 700, color: '#fff', backgroundColor: t2DetailLoading ? '#9CA3AF' : '#1E3A5F', border: 'none', borderRadius: 8, cursor: t2DetailLoading ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, transition: 'background-color 0.15s' }}
              >
                {t2DetailLoading ? (
                  <span style={{ display: 'inline-block', width: 12, height: 12, border: '2px solid #fff', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                ) : (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                    <polyline points="7 10 12 15 17 10"/>
                    <line x1="12" y1="15" x2="12" y2="3"/>
                  </svg>
                )}
                불러오기
              </button>
            </div>
          </div>

          {t2ShowDetail && activeSnapshot && (
            <>
              {/* Summary bar */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8, padding: '12px 16px', backgroundColor: '#EEF2F7', borderRadius: 10, marginBottom: 16, border: '1px solid #C7D2E2' }}>
                {[
                  { label: '예수금', value: fmtNum(activeSnapshot.deposit_amount) },
                  { label: '외화예수금', value: fmtNum(activeSnapshot.foreign_deposit_amount) },
                  { label: '총자산', value: fmtNum(activeSnapshot.total_assets) },
                  { label: '매입금액', value: fmtNum(activeSnapshot.total_purchase) },
                  { label: '평가금액', value: fmtNum(activeSnapshot.total_evaluation) },
                  { label: '평가손익', value: activeSnapshot.total_return != null ? `${activeSnapshot.total_return > 0 ? '+' : ''}${activeSnapshot.total_return.toLocaleString('ko-KR')}` : '-', color: rateColor(activeSnapshot.total_return) },
                  { label: '총수익률', value: activeSnapshot.total_return_rate != null ? `${activeSnapshot.total_return_rate > 0 ? '+' : ''}${activeSnapshot.total_return_rate.toFixed(2)}%` : '-', color: rateColor(activeSnapshot.total_return_rate) },
                ].map(({ label, value, color }) => (
                  <div key={label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                    <span style={{ fontSize: '0.6875rem', color: '#6B7280', fontWeight: 500 }}>{label}</span>
                    <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: color ?? '#1A1A2E' }}>{value}</span>
                  </div>
                ))}
              </div>

              {/* Holdings table — single table with sticky No./상품유형/상품명 columns */}
              <div style={{ overflowX: 'auto', border: '1px solid #E1E5EB', borderRadius: 8 }}>
                <table style={{ borderCollapse: 'collapse', fontSize: '0.8125rem', minWidth: 1100 }}>
                  <thead>
                    <tr style={{ backgroundColor: '#F5F7FA' }}>
                      <th style={{ ...thStyle, position: 'sticky', left: 0, zIndex: 2, background: '#F5F7FA', textAlign: 'center', minWidth: 36 }}>No.</th>
                      <th style={{ ...thStyle, position: 'sticky', left: 36, zIndex: 2, background: '#F5F7FA', textAlign: 'center', minWidth: 68, borderRight: '2px solid #E1E5EB' }}>상품유형</th>
                      <th style={{ ...thStyle, position: 'sticky', left: 104, zIndex: 2, background: '#F5F7FA', textAlign: 'left', minWidth: 300, borderRight: '2px solid #E1E5EB' }}>상품명</th>
                      <th style={{ ...thStyle, textAlign: 'center', minWidth: 90 }}>종목코드</th>
                      <th style={{ ...thStyle, textAlign: 'center', minWidth: 80 }}>위험도</th>
                      <th style={{ ...thStyle, textAlign: 'center', minWidth: 60 }}>지역</th>
                      <th style={thStyle}>잔고수량</th>
                      <th style={thStyle}>매입가</th>
                      <th style={thStyle}>현재가</th>
                      <th style={thStyle}>매입금액</th>
                      <th style={thStyle}>평가금액</th>
                      <th style={thStyle}>평가손익</th>
                      <th style={thStyle}>수익률</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailHoldings.map((h, idx) => {
                      /* Fund calculation: if product_type contains '펀드', use Math.ceil(qty * price / 1000) */
                      const isFund = (h.product_type ?? '').includes('펀드');
                      const hasQtyAndPurchPrice = h.quantity != null && h.purchase_price != null && h.quantity > 0 && h.purchase_price > 0;
                      const hasQtyAndCurrPrice = h.quantity != null && h.current_price != null && h.quantity > 0 && h.current_price > 0;
                      const calcPurchAmt = hasQtyAndPurchPrice
                        ? (isFund ? Math.ceil(h.quantity! * h.purchase_price! / 1000) : h.quantity! * h.purchase_price!)
                        : null;
                      const calcEvalAmt = hasQtyAndCurrPrice
                        ? (isFund ? Math.ceil(h.quantity! * h.current_price! / 1000) : h.quantity! * h.current_price!)
                        : null;
                      const displayPurchAmt = calcPurchAmt ?? h.purchase_amount;
                      const displayEvalAmt = calcEvalAmt ?? h.evaluation_amount;
                      const calcReturnAmt = (displayEvalAmt != null && displayPurchAmt != null) ? displayEvalAmt - displayPurchAmt : h.return_amount;
                      const calcReturnRate = (calcReturnAmt != null && displayPurchAmt != null && displayPurchAmt !== 0)
                        ? parseFloat((calcReturnAmt / displayPurchAmt * 100).toFixed(2))
                        : null;
                      return (
                        <tr key={h.id}
                          onMouseEnter={(e) => { (e.currentTarget as HTMLTableRowElement).style.backgroundColor = '#F9FAFB'; }}
                          onMouseLeave={(e) => { (e.currentTarget as HTMLTableRowElement).style.backgroundColor = 'transparent'; }}
                        >
                          <td style={{ ...tdStyle, position: 'sticky', left: 0, zIndex: 1, background: '#fff', textAlign: 'center', color: '#9CA3AF' }}>{idx + 1}</td>
                          <td style={{ ...tdStyle, position: 'sticky', left: 36, zIndex: 1, background: '#fff', textAlign: 'center', fontSize: '0.6875rem', color: '#6B7280', borderRight: '2px solid #E1E5EB' }}>{h.product_type || '-'}</td>
                          <td style={{ ...tdStyle, position: 'sticky', left: 104, zIndex: 1, background: '#fff', textAlign: 'left', fontWeight: 500, color: '#1A1A2E', whiteSpace: 'normal', wordBreak: 'keep-all', minWidth: 300, borderRight: '2px solid #E1E5EB' }}>{h.product_name}</td>
                          <td style={{ ...tdStyle, textAlign: 'center', fontFamily: 'monospace', fontSize: '0.75rem' }}>{h.product_code || '-'}</td>
                          <td style={{ ...tdStyle, textAlign: 'center' }}>
                            {h.risk_level ? (
                              <span style={{ fontSize: '0.6875rem', fontWeight: 600, padding: '2px 5px', borderRadius: 4, backgroundColor: h.risk_level === '절대성장형' ? '#FEF2F2' : h.risk_level === '성장형' ? '#FFFBEB' : h.risk_level === '안정형' ? '#ECFDF5' : '#EFF6FF', color: h.risk_level === '절대성장형' ? '#DC2626' : h.risk_level === '성장형' ? '#D97706' : h.risk_level === '안정형' ? '#059669' : '#2563EB' }}>
                                {h.risk_level}
                              </span>
                            ) : '-'}
                          </td>
                          <td style={{ ...tdStyle, textAlign: 'center' }}>
                            {h.region ? (
                              <span style={{ fontSize: '0.75rem', fontWeight: 500, color: '#1E3A5F', backgroundColor: '#EEF2F7', padding: '2px 5px', borderRadius: 4 }}>{h.region}</span>
                            ) : '-'}
                          </td>
                          <td style={tdStyle}>{fmtNum(h.quantity)}</td>
                          <td style={tdStyle}>{fmtNum(h.purchase_price)}</td>
                          <td style={tdStyle}>{fmtNum(h.current_price)}</td>
                          <td style={tdStyle}>{fmtNum(displayPurchAmt)}</td>
                          <td style={{ ...tdStyle, fontWeight: 500 }}>{fmtNum(displayEvalAmt)}</td>
                          <td style={{ ...tdStyle, color: rateColor(calcReturnAmt), fontWeight: calcReturnAmt != null && calcReturnAmt !== 0 ? 500 : undefined }}>
                            {calcReturnAmt != null ? `${calcReturnAmt > 0 ? '+' : ''}${calcReturnAmt.toLocaleString('ko-KR')}` : '-'}
                          </td>
                          <td style={{ ...tdStyle, color: rateColor(calcReturnRate), fontWeight: 600 }}>
                            {calcReturnRate != null ? `${calcReturnRate > 0 ? '+' : ''}${calcReturnRate.toFixed(2)}%` : '-'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{ backgroundColor: '#F5F7FA' }}>
                      <td style={{ ...totalRowStyle, position: 'sticky', left: 0, zIndex: 1, background: '#F5F7FA' }} />
                      <td style={{ ...totalRowStyle, position: 'sticky', left: 36, zIndex: 1, background: '#F5F7FA', borderRight: '2px solid #E1E5EB' }} />
                      <td style={{ ...totalRowStyle, position: 'sticky', left: 104, zIndex: 1, background: '#F5F7FA', textAlign: 'left', borderRight: '2px solid #E1E5EB' }}>합계</td>
                      <td style={totalRowStyle}>-</td>
                      <td style={totalRowStyle}>-</td>
                      <td style={totalRowStyle}>-</td>
                      <td style={totalRowStyle}>-</td>
                      <td style={totalRowStyle}>-</td>
                      <td style={totalRowStyle}>{fmtNum(detailTotalPurch)}</td>
                      <td style={totalRowStyle}>{fmtNum(detailTotalEval)}</td>
                      <td style={{ ...totalRowStyle, color: rateColor(detailTotalReturn) }}>
                        {detailTotalReturn !== 0 ? `${detailTotalReturn > 0 ? '+' : ''}${detailTotalReturn.toLocaleString('ko-KR')}` : '0'}
                      </td>
                      <td style={{ ...totalRowStyle, color: rateColor(detailTotalReturnRate) }}>
                        {detailTotalReturnRate > 0 ? '+' : ''}{detailTotalReturnRate.toFixed(2)}%
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}

          {!t2ShowDetail && !t2DetailLoading && (
            <div style={{ padding: '20px', textAlign: 'center', color: '#9CA3AF', fontSize: '0.875rem' }}>
              [불러오기] 버튼을 클릭하면 포트폴리오 상세 데이터를 조회합니다.
            </div>
          )}
        </div>
      )}

      {/* ============================================================ */}
      {/* Area 3+4: 기간별 수익률 + 포트폴리오 분석 차트               */}
      {/* ============================================================ */}
      {t2ShowDetail && histAccountId && (
        <PortfolioCharts
          accountId={histAccountId}
          snapshotId={activeSnapshotId}
          regionDistribution={regionDist}
          riskDistribution={riskDist}
          historyData={historyPoints}
          historyLoading={historyChartLoading}
          activePeriod={t2HistPeriod}
          onActivePeriodChange={(p) => {
            setT2HistPeriod(p);
            loadT2ChartData(histAccountId, p);
          }}
        />
      )}

      {/* ============================================================ */}
      {/* Area 5: 추천 포트폴리오 (리밸런싱)                            */}
      {/* ============================================================ */}
      {t2ShowDetail && t2RebalRows.length > 0 && (
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid #E1E5EB' }}>
            <div style={{ width: 3, height: 18, borderRadius: 2, backgroundColor: '#1E3A5F', flexShrink: 0 }} />
            <span style={sectionTitleStyle}>추천 포트폴리오</span>
            <span style={{ fontSize: '0.8125rem', color: '#6B7280' }}>재조정 비율을 입력하면 자동 계산됩니다.</span>
            {ratioOverflow && (
              <span style={{ fontSize: '0.8125rem', color: '#EF4444', fontWeight: 600, marginLeft: 8 }}>
                경고: 재조정 비율 합계가 100% 초과 ({rebalOtherRatioSum.toFixed(2)}%)
              </span>
            )}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <button
                onClick={() => setT2AddProductOpen(true)}
                style={{ padding: '6px 14px', fontSize: '0.8125rem', fontWeight: 600, color: '#1E3A5F', backgroundColor: '#EEF2F7', border: '1px solid #C7D2E2', borderRadius: 7, cursor: 'pointer' }}
              >
                + 행추가
              </button>
              <button
                onClick={handleT2Recalc}
                style={{ padding: '6px 14px', fontSize: '0.8125rem', fontWeight: 600, color: '#374151', backgroundColor: '#F3F4F6', border: '1px solid #E1E5EB', borderRadius: 7, cursor: 'pointer' }}
              >
                재계산
              </button>
              <button
                onClick={handleT2SaveRebal}
                disabled={t2RebalSaving}
                style={{ padding: '6px 14px', fontSize: '0.8125rem', fontWeight: 700, color: '#fff', backgroundColor: t2RebalSaving ? '#9CA3AF' : '#1E3A5F', border: 'none', borderRadius: 7, cursor: t2RebalSaving ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}
              >
                {t2RebalSaving ? (
                  <span style={{ display: 'inline-block', width: 11, height: 11, border: '2px solid #fff', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                ) : null}
                저장
              </button>
            </div>
          </div>

          {/* Single table with sticky No./상품명 columns, rest scrollable */}
          <div style={{ overflowX: 'auto', border: '1px solid #E1E5EB', borderRadius: 8 }}>
            <table style={{ borderCollapse: 'collapse', fontSize: '0.8125rem', minWidth: 1200 }}>
              <thead>
                <tr style={{ backgroundColor: '#F5F7FA' }}>
                  <th style={{ ...thStyle, position: 'sticky', left: 0, zIndex: 2, background: '#F5F7FA', textAlign: 'center', minWidth: 36 }}>No.</th>
                  <th style={{ ...thStyle, position: 'sticky', left: 36, zIndex: 2, background: '#F5F7FA', textAlign: 'left', minWidth: 280, borderRight: '2px solid #E1E5EB' }}>상품명</th>
                  <th style={thStyle}>잔고수량</th>
                  <th style={{ ...thStyle, minWidth: 90 }}>현재가(기준가)</th>
                  <th style={thStyle}>매입금액</th>
                  <th style={thStyle}>평가금액</th>
                  <th style={thStyle}>평가손익</th>
                  <th style={thStyle}>수익률</th>
                  <th style={thStyle}>평가비율</th>
                  <th style={{ ...thStyle, minWidth: 100 }}>재조정 비율</th>
                  <th style={{ ...thStyle, minWidth: 110 }}>재조정 잔액</th>
                  <th style={{ ...thStyle, minWidth: 100 }}>Sell/Buy</th>
                  <th style={thStyle}>좌수</th>
                </tr>
              </thead>
              <tbody>
                {t2RebalRows.map((r, idx) => {
                  const isRow1 = r.isRow1;
                  const rowBg = isRow1 ? '#EEF2F7' : 'transparent';
                  const stickyBg = isRow1 ? '#EEF2F7' : '#fff';
                  const isAdded = r.id.startsWith('__new__');
                  return (
                    <tr
                      key={r.id}
                      style={{ backgroundColor: rowBg, transition: 'background-color 0.1s' }}
                      onMouseEnter={(e) => { if (!isRow1) (e.currentTarget as HTMLTableRowElement).style.backgroundColor = '#F9FAFB'; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLTableRowElement).style.backgroundColor = rowBg; }}
                    >
                      <td style={{ ...tdStyle, position: 'sticky', left: 0, zIndex: 1, background: stickyBg, textAlign: 'center', color: '#9CA3AF' }}>{idx + 1}</td>
                      <td style={{ ...tdStyle, position: 'sticky', left: 36, zIndex: 1, background: stickyBg, textAlign: 'left', borderRight: '2px solid #E1E5EB', whiteSpace: 'normal', wordBreak: 'keep-all' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <div>
                            <div style={{ fontWeight: isRow1 ? 700 : 500, color: '#1A1A2E', fontSize: '0.8125rem' }}>{r.productName}</div>
                            {r.riskLevel && <div style={{ fontSize: '0.6875rem', color: '#9CA3AF' }}>{r.riskLevel} | {r.region}</div>}
                          </div>
                          {isAdded && (
                            <button
                              type="button"
                              title="상품 교체"
                              onClick={() => { setT2ReplaceRowId(r.id); setT2ProductSearch(''); setT2AddProductOpen(true); }}
                              style={{ marginLeft: 2, padding: '2px 4px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #C7D2E2', borderRadius: 4, backgroundColor: '#EEF2F7', cursor: 'pointer', color: '#1E3A5F', flexShrink: 0 }}
                            >
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38"/>
                              </svg>
                            </button>
                          )}
                        </div>
                      </td>
                      <td style={{ ...tdStyle, backgroundColor: rowBg }}>{r.quantity > 0 ? r.quantity.toLocaleString('ko-KR') : '-'}</td>
                      {/* 현재가(기준가) - editable */}
                      <td style={{ ...tdStyle, padding: '5px 8px', backgroundColor: rowBg }}>
                        {isRow1 ? (
                          <span>{r.currentPrice.toLocaleString('ko-KR')}</span>
                        ) : (
                          <input
                            type="text"
                            value={r.currentPrice > 0 ? r.currentPrice.toLocaleString('ko-KR') : ''}
                            onChange={(e) => handleT2CurrentPriceChange(r.id, e.target.value)}
                            style={{ width: 80, padding: '4px 6px', fontSize: '0.8125rem', textAlign: 'right', border: '1px solid #E1E5EB', borderRadius: 5, outline: 'none', color: '#1A1A2E' }}
                          />
                        )}
                      </td>
                      <td style={{ ...tdStyle, backgroundColor: rowBg }}>{fmtNum(r.purchaseAmount)}</td>
                      <td style={{ ...tdStyle, fontWeight: 500, backgroundColor: rowBg }}>{fmtNum(r.evaluationAmount)}</td>
                      <td style={{ ...tdStyle, color: rateColor(r.returnAmount), backgroundColor: rowBg }}>
                        {r.returnAmount !== 0 ? `${r.returnAmount > 0 ? '+' : ''}${r.returnAmount.toLocaleString('ko-KR')}` : '0'}
                      </td>
                      <td style={{ ...tdStyle, color: rateColor(r.returnRate), fontWeight: 600, backgroundColor: rowBg }}>
                        {r.purchaseAmount > 0 ? `${r.returnRate > 0 ? '+' : ''}${r.returnRate.toFixed(2)}%` : '-'}
                      </td>
                      <td style={{ ...tdStyle, backgroundColor: rowBg }}>{r.evalRatio.toFixed(2)}%</td>

                      {/* 재조정 비율 */}
                      <td style={{ ...tdStyle, padding: '5px 8px', backgroundColor: rowBg }}>
                        {isRow1 ? (
                          <span style={{ color: ratioOverflow ? '#EF4444' : '#1E3A5F', fontWeight: 700 }}>
                            {rebalRow1RatioCalc.toFixed(2)}%
                          </span>
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              max="100"
                              value={r.rebalRatio}
                              onChange={(e) => handleT2RebalRatioChange(r.id, e.target.value)}
                              style={{ width: 65, padding: '4px 6px', fontSize: '0.8125rem', textAlign: 'right', border: '1px solid #C7D2E2', borderRadius: 5, outline: 'none', color: '#1A1A2E', backgroundColor: '#fff' }}
                            />
                            <span style={{ fontSize: '0.75rem', color: '#6B7280' }}>%</span>
                          </div>
                        )}
                      </td>

                      {/* 재조정 잔액 */}
                      <td style={{ ...tdStyle, padding: '5px 8px', backgroundColor: rowBg }}>
                        {isRow1 ? (
                          <span style={{ fontWeight: 600, color: '#1A1A2E' }}>
                            {(rebalTotalEval - t2RebalRows.filter((rr) => !rr.isRow1).reduce((s, rr) => s + rr.rebalAmount, 0)).toLocaleString('ko-KR')}
                          </span>
                        ) : (
                          <input
                            type="text"
                            value={r.rebalAmount > 0 ? r.rebalAmount.toLocaleString('ko-KR') : ''}
                            onChange={(e) => handleT2RebalAmtChange(r.id, e.target.value)}
                            style={{ width: 90, padding: '4px 6px', fontSize: '0.8125rem', textAlign: 'right', border: '1px solid #C7D2E2', borderRadius: 5, outline: 'none', color: '#1A1A2E' }}
                          />
                        )}
                      </td>

                      {/* Sell/Buy */}
                      <td style={{ ...tdStyle, color: rateColor(r.sellBuy), fontWeight: 600, backgroundColor: rowBg }}>
                        {r.sellBuy !== 0 ? `${r.sellBuy > 0 ? '+' : ''}${r.sellBuy.toLocaleString('ko-KR')}` : '0'}
                      </td>

                      {/* 좌수 */}
                      <td style={{ ...tdStyle, backgroundColor: rowBg }}>{r.shares > 0 ? r.shares.toLocaleString('ko-KR') : '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ backgroundColor: '#F5F7FA' }}>
                  <td style={{ ...totalRowStyle, position: 'sticky', left: 0, zIndex: 1, background: '#F5F7FA' }} />
                  <td style={{ ...totalRowStyle, position: 'sticky', left: 36, zIndex: 1, background: '#F5F7FA', textAlign: 'left', borderRight: '2px solid #E1E5EB' }}>합계</td>
                  <td style={totalRowStyle}>{'-'}</td>
                  <td style={totalRowStyle}>{'-'}</td>
                  <td style={totalRowStyle}>{fmtNum(rebalTotalPurch)}</td>
                  <td style={totalRowStyle}>{fmtNum(rebalTotalEval)}</td>
                  <td style={{ ...totalRowStyle, color: rateColor(rebalTotalReturn) }}>
                    {rebalTotalReturn !== 0 ? `${rebalTotalReturn > 0 ? '+' : ''}${rebalTotalReturn.toLocaleString('ko-KR')}` : '0'}
                  </td>
                  <td style={{ ...totalRowStyle, color: rateColor(rebalTotalReturnRate) }}>
                    {rebalTotalReturnRate > 0 ? '+' : ''}{rebalTotalReturnRate.toFixed(2)}%
                  </td>
                  <td style={totalRowStyle}>100%</td>
                  <td style={{ ...totalRowStyle, color: ratioOverflow ? '#EF4444' : '#374151' }}>
                    {(rebalOtherRatioSum + rebalRow1RatioCalc).toFixed(2)}%
                  </td>
                  <td style={totalRowStyle}>{fmtNum(rebalTotalRebalAmt)}</td>
                  <td style={{ ...totalRowStyle, color: rateColor(rebalTotalSellBuy) }}>
                    {rebalTotalSellBuy !== 0 ? `${rebalTotalSellBuy > 0 ? '+' : ''}${rebalTotalSellBuy.toLocaleString('ko-KR')}` : '0'}
                  </td>
                  <td style={totalRowStyle}>-</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Toast */}
          {t2Toast && (
            <div style={{ marginTop: 10, padding: '10px 14px', backgroundColor: t2Toast.includes('실패') || t2Toast.includes('오류') ? '#FEF2F2' : '#ECFDF5', border: `1px solid ${t2Toast.includes('실패') || t2Toast.includes('오류') ? '#FECACA' : '#A7F3D0'}`, borderRadius: 8, fontSize: '0.8125rem', fontWeight: 500, color: t2Toast.includes('실패') || t2Toast.includes('오류') ? '#DC2626' : '#059669' }}>
              {t2Toast}
            </div>
          )}
        </div>
      )}

      {/* Product search popup for 행추가 / 다시추가 */}
      {t2AddProductOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)' }}
          onClick={(e) => { if (e.target === e.currentTarget) { setT2AddProductOpen(false); setT2ReplaceRowId(null); } }}>
          <div style={{ backgroundColor: '#fff', borderRadius: 14, padding: 24, width: '100%', maxWidth: 560, maxHeight: '75vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#1A1A2E' }}>{t2ReplaceRowId ? '상품 교체' : '상품 추가'}</h3>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button
                  onClick={() => setT2NewMasterOpen(true)}
                  style={{ padding: '5px 10px', fontSize: '0.75rem', fontWeight: 600, color: '#1E3A5F', backgroundColor: '#EEF2F7', border: '1px solid #C7D2E2', borderRadius: 6, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  새 상품 등록
                </button>
                <button onClick={() => { setT2AddProductOpen(false); setT2ReplaceRowId(null); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', padding: 4 }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
            </div>
            <input type="text" placeholder="상품명 또는 종목코드 검색..." value={t2ProductSearch}
              onChange={(e) => setT2ProductSearch(e.target.value)}
              style={{ width: '100%', padding: '8px 10px', fontSize: '0.8125rem', border: '1px solid #E1E5EB', borderRadius: 8, outline: 'none', marginBottom: 10, boxSizing: 'border-box' }}
              autoFocus />
            <div style={{ flex: 1, overflowY: 'auto', border: '1px solid #E1E5EB', borderRadius: 8 }}>
              {productMasters
                .filter((m) => !t2ProductSearch || m.product_name.toLowerCase().includes(t2ProductSearch.toLowerCase()) || (m.product_code ?? '').toLowerCase().includes(t2ProductSearch.toLowerCase()))
                .map((m) => (
                  <button key={m.id} type="button"
                    onClick={() => t2ReplaceRowId ? handleT2ReplaceProductFromMaster(m) : handleT2AddProductFromMaster(m)}
                    style={{ width: '100%', padding: '8px 12px', textAlign: 'left', border: 'none', borderBottom: '1px solid #F3F4F6', cursor: 'pointer', backgroundColor: 'transparent', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, transition: 'background-color 0.1s' }}
                    onMouseEnter={(e) => { (e.currentTarget).style.backgroundColor = '#EEF2F7'; }}
                    onMouseLeave={(e) => { (e.currentTarget).style.backgroundColor = 'transparent'; }}>
                    <div>
                      <div style={{ fontSize: '0.8125rem', fontWeight: 500, color: '#1A1A2E' }}>{m.product_name}</div>
                      <div style={{ fontSize: '0.6875rem', color: '#9CA3AF', marginTop: 2 }}>
                        {m.product_code || '-'} | {m.risk_level || '-'} | {m.region || '-'}
                      </div>
                    </div>
                  </button>
                ))}
              {productMasters.filter((m) => !t2ProductSearch || m.product_name.toLowerCase().includes(t2ProductSearch.toLowerCase()) || (m.product_code ?? '').toLowerCase().includes(t2ProductSearch.toLowerCase())).length === 0 && (
                <div style={{ padding: 20, textAlign: 'center', color: '#9CA3AF', fontSize: '0.8125rem' }}>검색 결과 없음</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* New product master creation (nested popup) */}
      {t2NewMasterOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.5)' }}
          onClick={(e) => { if (e.target === e.currentTarget) setT2NewMasterOpen(false); }}>
          <div style={{ backgroundColor: '#fff', borderRadius: 14, padding: 24, width: '100%', maxWidth: 440, boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#1A1A2E' }}>새 상품 등록</h3>
              <button onClick={() => setT2NewMasterOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', padding: 4 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                { label: '상품명 *', key: 'product_name', placeholder: '상품명 입력' },
                { label: '종목코드', key: 'product_code', placeholder: '종목코드 (선택)' },
                { label: '상품유형', key: 'product_type', placeholder: '예: ETF, 펀드, 채권' },
              ].map(({ label, key, placeholder }) => (
                <div key={key}>
                  <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>{label}</label>
                  <input type="text" placeholder={placeholder}
                    value={(t2NewMasterForm as Record<string, string>)[key]}
                    onChange={(e) => setT2NewMasterForm((prev) => ({ ...prev, [key]: e.target.value }))}
                    style={{ width: '100%', padding: '7px 10px', fontSize: '0.8125rem', border: '1px solid #E1E5EB', borderRadius: 7, outline: 'none', boxSizing: 'border-box' }}
                  />
                </div>
              ))}
              <div>
                <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>위험도</label>
                <select value={t2NewMasterForm.risk_level} onChange={(e) => setT2NewMasterForm((prev) => ({ ...prev, risk_level: e.target.value }))}
                  style={{ width: '100%', padding: '7px 10px', fontSize: '0.8125rem', border: '1px solid #E1E5EB', borderRadius: 7, outline: 'none', backgroundColor: '#fff', boxSizing: 'border-box' }}>
                  <option value="">선택</option>
                  {RISK_LEVELS.map((rl) => <option key={rl} value={rl}>{rl}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>지역</label>
                <select value={t2NewMasterForm.region} onChange={(e) => setT2NewMasterForm((prev) => ({ ...prev, region: e.target.value }))}
                  style={{ width: '100%', padding: '7px 10px', fontSize: '0.8125rem', border: '1px solid #E1E5EB', borderRadius: 7, outline: 'none', backgroundColor: '#fff', boxSizing: 'border-box' }}>
                  <option value="">선택</option>
                  {REGIONS.map((rg) => <option key={rg} value={rg}>{rg}</option>)}
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button onClick={() => setT2NewMasterOpen(false)} style={{ padding: '7px 16px', fontSize: '0.8125rem', fontWeight: 600, color: '#6B7280', backgroundColor: '#F3F4F6', border: '1px solid #E1E5EB', borderRadius: 7, cursor: 'pointer' }}>취소</button>
              <button onClick={handleT2CreateNewMaster} disabled={t2NewMasterSaving || !t2NewMasterForm.product_name.trim()}
                style={{ padding: '7px 16px', fontSize: '0.8125rem', fontWeight: 700, color: '#fff', backgroundColor: t2NewMasterSaving || !t2NewMasterForm.product_name.trim() ? '#9CA3AF' : '#1E3A5F', border: 'none', borderRadius: 7, cursor: t2NewMasterSaving || !t2NewMasterForm.product_name.trim() ? 'not-allowed' : 'pointer' }}>
                {t2NewMasterSaving ? '등록 중...' : '등록'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Date edit/delete modal */}
      {t2DateEditOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)' }}
          onClick={(e) => { if (e.target === e.currentTarget) setT2DateEditOpen(false); }}>
          <div style={{ backgroundColor: '#fff', borderRadius: 14, padding: 24, width: '100%', maxWidth: 480, maxHeight: '70vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#1A1A2E' }}>날짜 편집 / 삭제</h3>
              <button onClick={() => setT2DateEditOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', padding: 4 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <input type="text" placeholder="날짜 검색 (예: 2026-01)..." value={t2DateEditSearch}
              onChange={(e) => setT2DateEditSearch(e.target.value)}
              style={{ width: '100%', padding: '8px 10px', fontSize: '0.8125rem', border: '1px solid #E1E5EB', borderRadius: 8, outline: 'none', marginBottom: 10, boxSizing: 'border-box' }}
              autoFocus />
            <div style={{ flex: 1, overflowY: 'auto', border: '1px solid #E1E5EB', borderRadius: 8 }}>
              {historyList
                .filter((item) => !t2DateEditSearch || item.snapshot_date.includes(t2DateEditSearch))
                .map((item) => {
                  const rate = item.total_return_rate;
                  const rc = rate == null ? '#6B7280' : rate > 0 ? '#10B981' : rate < 0 ? '#EF4444' : '#6B7280';
                  const isConfirming = t2DateDeleteConfirmId === item.id;
                  return (
                    <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '1px solid #F3F4F6' }}>
                      <span style={{ fontSize: '0.8125rem', fontWeight: 500, color: '#1A1A2E', flex: 1 }}>{item.snapshot_date}</span>
                      {rate != null && (
                        <span style={{ fontSize: '0.75rem', fontWeight: 600, color: rc }}>{rate > 0 ? '+' : ''}{rate.toFixed(2)}%</span>
                      )}
                      {isConfirming ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: '0.75rem', color: '#EF4444', fontWeight: 600 }}>이 날짜의 데이터를 삭제하시겠습니까?</span>
                          <button
                            onClick={() => handleT2DeleteSnapshot(item.id)}
                            disabled={t2DateDeleting}
                            style={{ padding: '3px 8px', fontSize: '0.75rem', fontWeight: 700, color: '#fff', backgroundColor: '#EF4444', border: 'none', borderRadius: 5, cursor: 'pointer' }}
                          >
                            {t2DateDeleting ? '삭제 중...' : '확인'}
                          </button>
                          <button
                            onClick={() => setT2DateDeleteConfirmId(null)}
                            style={{ padding: '3px 8px', fontSize: '0.75rem', fontWeight: 600, color: '#6B7280', backgroundColor: '#F3F4F6', border: '1px solid #E1E5EB', borderRadius: 5, cursor: 'pointer' }}
                          >
                            취소
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setT2DateDeleteConfirmId(item.id)}
                          title="삭제"
                          style={{ padding: '4px 6px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #FECACA', borderRadius: 5, backgroundColor: '#FEF2F2', cursor: 'pointer', color: '#EF4444' }}
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                          </svg>
                        </button>
                      )}
                    </div>
                  );
                })}
              {historyList.filter((item) => !t2DateEditSearch || item.snapshot_date.includes(t2DateEditSearch)).length === 0 && (
                <div style={{ padding: 20, textAlign: 'center', color: '#9CA3AF', fontSize: '0.8125rem' }}>검색 결과 없음</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Page                                                           */
/* ------------------------------------------------------------------ */

export default function IRPPage() {
  const router = useRouter();
  const reportRef = useRef<HTMLDivElement>(null);

  /* ---------- global state ---------- */
  const [activeTab, setActiveTab] = useState<'data' | 'template' | 'report'>('data');
  const [clients, setClients] = useState<Client[]>([]);
  const [clientsLoading, setClientsLoading] = useState(false);

  /* ---------- client management modal ---------- */
  const [clientMgmtOpen, setClientMgmtOpen] = useState(false);

  /* ---------- tab1 state ---------- */
  const [rows, setRows] = useState<ClientRowData[]>([makeDefaultRow()]);
  const [processing, setProcessing] = useState(false);

  /* ---------- tab1: extraction results ---------- */
  const [extractionResults, setExtractionResults] = useState<ExtractionResult[]>([]);

  /* ---------- tab2 state ---------- */
  const [processResults, setProcessResults] = useState<ProcessResult[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [snapshotsLoading, setSnapshotsLoading] = useState(false);
  const [searchDate, setSearchDate] = useState(todayString());
  const [searchClientName, setSearchClientName] = useState('');

  /* ---------- tab2: new history-based state ---------- */
  const [histClientId, setHistClientId] = useState('');
  const [histAccountId, setHistAccountId] = useState('');
  const [historyList, setHistoryList] = useState<Array<{ id: string; snapshot_date: string; total_return_rate?: number }>>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [selectedSnapshotIds, setSelectedSnapshotIds] = useState<Set<string>>(new Set());
  const [activeSnapshotId, setActiveSnapshotId] = useState<string | null>(null);
  const [activeSnapshot, setActiveSnapshot] = useState<Snapshot | null>(null);
  const [activeSnapshotLoading, setActiveSnapshotLoading] = useState(false);
  const [histPeriod, setHistPeriod] = useState<PeriodKey>('1y');
  const [historyPoints, setHistoryPoints] = useState<HistoryPoint[]>([]);
  const [historyChartLoading, setHistoryChartLoading] = useState(false);
  const [regionDist, setRegionDist] = useState<DistributionItem[]>([]);
  const [riskDist, setRiskDist] = useState<DistributionItem[]>([]);

  /* ---------- tab3 state ---------- */
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [reportDate, setReportDate] = useState(todayString());
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [modifiedWeights, setModifiedWeights] = useState<Record<string, number>>({});
  const [reportClientName, setReportClientName] = useState('');
  const [saving, setSaving] = useState(false);
  const [aiComment, setAiComment] = useState('');
  const [aiChangeComment, setAiChangeComment] = useState('');
  const [aiCommentLoading, setAiCommentLoading] = useState(false);
  const [aiChangeCommentLoading, setAiChangeCommentLoading] = useState(false);

  /* ---------- product master state ---------- */
  const [productMasters, setProductMasters] = useState<ProductMaster[]>([]);

  /* ---------- product register modal state ---------- */
  const [registerModalOpen, setRegisterModalOpen] = useState(false);
  const [loadMasterTarget, setLoadMasterTarget] = useState<{ snapshotId: string; holdingId: string; productName: string } | null>(null);
  const [loadMasterSearch, setLoadMasterSearch] = useState('');
  const [registerForm, setRegisterForm] = useState({
    product_name: '',
    risk_level: '',
    region: '',
    product_type: '',
    product_code: '',
  });

  /* ---------- tab3: portal link state ---------- */
  const [portalLinkToast, setPortalLinkToast] = useState('');
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailInput, setEmailInput] = useState('');
  const [emailSending, setEmailSending] = useState(false);

  /* ---------- load clients and product masters on mount ---------- */
  useEffect(() => {
    loadClients();
    loadProductMasters();
  }, []);

  async function loadClients() {
    setClientsLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/clients`, {
        headers: { ...authLib.getAuthHeader() },
      });
      if (!res.ok) return;
      const data = await res.json();

      // load accounts for each client
      const withAccounts: Client[] = await Promise.all(
        (data as Client[]).map(async (c) => {
          try {
            const ar = await fetch(`${API_URL}/api/v1/clients/${c.id}/accounts`, {
              headers: { ...authLib.getAuthHeader() },
            });
            const accounts: ClientAccount[] = ar.ok ? await ar.json() : [];
            return { ...c, accounts };
          } catch {
            return { ...c, accounts: [] };
          }
        })
      );
      setClients(withAccounts);
    } catch {
      // silent
    } finally {
      setClientsLoading(false);
    }
  }

  async function loadProductMasters() {
    try {
      const res = await fetch(`${API_URL}/api/v1/product-master`, {
        headers: { ...authLib.getAuthHeader() },
      });
      if (!res.ok) return;
      const data: ProductMaster[] = await res.json();
      setProductMasters(data);
    } catch {
      // silent
    }
  }

  /* ---------- tab1: row management ---------- */

  function addRow() {
    setRows((prev) => [...prev, makeDefaultRow()]);
  }

  function removeRow(index: number) {
    setRows((prev) => prev.filter((_, i) => i !== index));
  }

  function updateRow(index: number, data: ClientRowData) {
    setRows((prev) => prev.map((r, i) => (i === index ? data : r)));
  }

  /* ---------- tab1: process ---------- */

  async function handleProcess() {
    const validRows = rows.filter((r) => r.imageFile);
    if (validRows.length === 0) {
      alert('이미지가 필요합니다.');
      return;
    }

    // 고객 선택 여부 체크
    for (const row of validRows) {
      if (!row.clientId) {
        alert('고객을 먼저 선택하세요. "고객정보 관리" 버튼에서 고객을 등록하거나 드롭다운에서 선택해 주세요.');
        return;
      }
    }

    setProcessing(true);
    setExtractionResults([]);
    const results: ProcessResult[] = validRows.map((r) => ({
      clientName: r.clientName,
      accountType: r.accountType,
      status: 'pending',
    }));
    setProcessResults(results);

    const newSnapshots: Snapshot[] = [];

    for (let i = 0; i < validRows.length; i++) {
      const row = validRows[i];
      setProcessResults((prev) =>
        prev.map((r, idx) => (idx === i ? { ...r, status: 'processing' } : r))
      );

      try {
        const accountId = await getOrCreateClientAccount(row);

        const formData = new FormData();
        formData.append('client_account_id', accountId);
        formData.append('snapshot_date', row.snapshotDate);
        formData.append('image', row.imageFile!, row.imageFile!.name);

        const snapRes = await fetch(`${API_URL}/api/v1/snapshots`, {
          method: 'POST',
          headers: { ...authLib.getAuthHeader() },
          body: formData,
        });

        if (!snapRes.ok) {
          const err = await snapRes.json().catch(() => ({}));
          throw new Error(err?.detail || '스냅샷 생성 실패');
        }

        const snap: Snapshot = await snapRes.json();
        newSnapshots.push(snap);

        /* Build extraction result for inline display — seq 순서 유지 */
        const sortedHoldings = [...snap.holdings].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
        const holdingEdits: HoldingEdit[] = sortedHoldings.map((h) => {
          const master = productMasters.find(
            (m) => m.product_name === h.product_name
          );
          if (master) {
            return {
              holdingId: h.id,
              productName: h.product_name,
              productCode: master.product_code || h.product_code || '',
              riskLevel: master.risk_level ?? h.risk_level ?? '',
              region: master.region ?? h.region ?? '',
              quantity: h.quantity,
              purchasePrice: h.purchase_price,
              currentPrice: h.current_price,
              purchaseAmount: h.purchase_amount,
              evaluationAmount: h.evaluation_amount,
              returnAmount: h.return_amount,
              returnRate: undefined,
              unmapped: false,
              saving: false,
            };
          }
          return {
            holdingId: h.id,
            productName: h.product_name,
            productCode: h.product_code || '',
            riskLevel: h.risk_level ?? '',
            region: h.region ?? '',
            quantity: h.quantity,
            purchasePrice: h.purchase_price,
            currentPrice: h.current_price,
            purchaseAmount: h.purchase_amount,
            evaluationAmount: h.evaluation_amount,
            returnAmount: h.return_amount,
            returnRate: undefined,
            unmapped: true,
            saving: false,
          };
        });

        const extractionEntry: ExtractionResult = {
          snapshotId: snap.id,
          clientName: row.clientName,
          accountType: row.accountType,
          snapshotDate: snap.snapshot_date || todayString(),
          holdings: holdingEdits,
          applyingMaster: false,
          toastMsg: '',
          depositAmount: snap.deposit_amount,
          foreignDepositAmount: snap.foreign_deposit_amount,
          totalAssets: snap.total_assets,
          totalPurchase: snap.total_purchase,
          totalEvaluation: snap.total_evaluation,
          totalReturn: snap.total_return,
          totalReturnRate: snap.total_return_rate,
        };

        setExtractionResults((prev) => [...prev, extractionEntry]);

        setProcessResults((prev) =>
          prev.map((r, idx) =>
            idx === i ? { ...r, status: 'done', snapshotId: snap.id } : r
          )
        );
      } catch (e) {
        setProcessResults((prev) =>
          prev.map((r, idx) =>
            idx === i
              ? { ...r, status: 'error', errorMsg: e instanceof Error ? e.message : '오류 발생' }
              : r
          )
        );
      }
    }

    setSnapshots(newSnapshots);
    setProcessing(false);
    await loadClients();
  }

  /* ---------- tab1: update holding field locally ---------- */

  function updateHoldingField(
    snapshotId: string,
    holdingId: string,
    patch: Partial<Omit<HoldingEdit, 'holdingId' | 'unmapped' | 'saving'>>
  ) {
    setExtractionResults((prev) =>
      prev.map((er) =>
        er.snapshotId !== snapshotId
          ? er
          : {
              ...er,
              holdings: er.holdings.map((h) =>
                h.holdingId !== holdingId ? h : { ...h, ...patch }
              ),
            }
      )
    );
  }

  /* ---------- tab1: save all holdings ---------- */

  const [savingAll, setSavingAll] = useState<string | null>(null);

  async function saveAllHoldings(snapshotId: string) {
    const er = extractionResults.find((e) => e.snapshotId === snapshotId);
    if (!er) return;

    setSavingAll(snapshotId);
    let successCount = 0;
    let failCount = 0;

    // Update snapshot date if set
    if (er.snapshotDate) {
      try {
        await fetch(`${API_URL}/api/v1/snapshots/${snapshotId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
          body: JSON.stringify({ snapshot_date: er.snapshotDate }),
        });
      } catch {
        // non-critical — continue saving holdings
      }
    }

    for (const h of er.holdings) {
      // 수익률 계산
      const calcRate = (h.returnAmount != null && h.purchaseAmount)
        ? Math.round((h.returnAmount / h.purchaseAmount) * 10000) / 100
        : null;

      try {
        const res = await fetch(
          `${API_URL}/api/v1/snapshots/${snapshotId}/holdings/${h.holdingId}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
            body: JSON.stringify({
              product_name: h.productName || null,
              product_code: h.productCode || null,
              risk_level: h.riskLevel || null,
              region: h.region || null,
              quantity: h.quantity ?? null,
              purchase_price: h.purchasePrice ?? null,
              current_price: h.currentPrice ?? null,
              purchase_amount: h.purchaseAmount ?? null,
              evaluation_amount: h.evaluationAmount ?? null,
              return_amount: h.returnAmount ?? null,
              return_rate: calcRate,
            }),
          }
        );
        if (res.ok) successCount++;
        else failCount++;
      } catch {
        failCount++;
      }
    }

    // 토스트 메시지 표시
    const msg = failCount === 0
      ? `${successCount}개 종목 전체 저장 완료`
      : `${successCount}개 저장, ${failCount}개 실패`;

    setExtractionResults((prev) =>
      prev.map((e) =>
        e.snapshotId !== snapshotId ? e : { ...e, toastMsg: msg }
      )
    );

    setSavingAll(null);
    await loadClients();

    // 3초 후 토스트 제거
    setTimeout(() => {
      setExtractionResults((prev) =>
        prev.map((e) =>
          e.snapshotId !== snapshotId ? e : { ...e, toastMsg: '' }
        )
      );
    }, 3000);
  }

  /* ---------- tab1: save single holding ---------- */

  async function saveHolding(snapshotId: string, holdingId: string) {
    const er = extractionResults.find((e) => e.snapshotId === snapshotId);
    const h = er?.holdings.find((h) => h.holdingId === holdingId);
    if (!h) return;

    /* Mark saving */
    setExtractionResults((prev) =>
      prev.map((e) =>
        e.snapshotId !== snapshotId
          ? e
          : {
              ...e,
              holdings: e.holdings.map((hh) =>
                hh.holdingId !== holdingId ? hh : { ...hh, saving: true }
              ),
            }
      )
    );

    try {
      const res = await fetch(
        `${API_URL}/api/v1/snapshots/${snapshotId}/holdings/${holdingId}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
          body: JSON.stringify({ risk_level: h.riskLevel || null, region: h.region || null }),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err?.detail || '저장 실패');
      }
    } catch {
      alert('저장 중 오류가 발생했습니다.');
    } finally {
      setExtractionResults((prev) =>
        prev.map((e) =>
          e.snapshotId !== snapshotId
            ? e
            : {
                ...e,
                holdings: e.holdings.map((hh) =>
                  hh.holdingId !== holdingId ? hh : { ...hh, saving: false }
                ),
              }
        )
      );
    }
  }

  /* ---------- tab1: apply product master ---------- */

  async function applyMaster(snapshotId: string) {
    setExtractionResults((prev) =>
      prev.map((e) =>
        e.snapshotId !== snapshotId ? e : { ...e, applyingMaster: true, toastMsg: '' }
      )
    );

    try {
      const res = await fetch(
        `${API_URL}/api/v1/snapshots/${snapshotId}/holdings/apply-master`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
        }
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err?.detail || '상품 마스터 적용 실패');
        return;
      }

      const result = await res.json();
      const updatedCount: number = result.updated ?? 0;
      const notFoundNames: string[] = result.not_found ?? [];

      /* Fetch fresh snapshot to update local holdings */
      const snapRes = await fetch(`${API_URL}/api/v1/snapshots/${snapshotId}`, {
        headers: { ...authLib.getAuthHeader() },
      });

      if (snapRes.ok) {
        const freshSnap: Snapshot = await snapRes.json();
        setExtractionResults((prev) =>
          prev.map((e) => {
            if (e.snapshotId !== snapshotId) return e;
            const updatedHoldings: HoldingEdit[] = freshSnap.holdings.map((fh) => {
              const master = productMasters.find((m) => m.product_name === fh.product_name);
              return {
                holdingId: fh.id,
                productName: fh.product_name,
                productCode: master?.product_code ?? '',
                riskLevel: fh.risk_level ?? '',
                region: fh.region ?? '',
                quantity: fh.quantity,
                purchasePrice: fh.purchase_price,
                currentPrice: fh.current_price,
                purchaseAmount: fh.purchase_amount,
                evaluationAmount: fh.evaluation_amount,
                returnAmount: fh.return_amount,
                returnRate: fh.return_rate,
                unmapped: notFoundNames.includes(fh.product_name),
                saving: false,
              };
            });
            return {
              ...e,
              holdings: updatedHoldings,
              applyingMaster: false,
              toastMsg: `${updatedCount}개 상품 자동 매핑 완료`,
            };
          })
        );
      } else {
        /* Just mark unmapped without refreshing holding values */
        setExtractionResults((prev) =>
          prev.map((e) => {
            if (e.snapshotId !== snapshotId) return e;
            return {
              ...e,
              applyingMaster: false,
              toastMsg: `${updatedCount}개 상품 자동 매핑 완료`,
              holdings: e.holdings.map((h) => ({
                ...h,
                unmapped: notFoundNames.includes(h.productName),
              })),
            };
          })
        );
      }

      /* Auto-clear toast after 3 seconds */
      setTimeout(() => {
        setExtractionResults((prev) =>
          prev.map((e) =>
            e.snapshotId !== snapshotId ? e : { ...e, toastMsg: '' }
          )
        );
      }, 3000);
    } catch {
      alert('상품 마스터 적용 중 오류가 발생했습니다.');
      setExtractionResults((prev) =>
        prev.map((e) =>
          e.snapshotId !== snapshotId ? e : { ...e, applyingMaster: false }
        )
      );
    }
  }

  /* ---------- tab1: product registration modal ---------- */

  function openRegisterModal(productName: string) {
    setRegisterForm({
      product_name: productName,
      risk_level: '',
      region: '',
      product_type: '',
      product_code: '',
    });
    setRegisterModalOpen(true);
  }

  async function handleRegisterProduct() {
    try {
      const res = await fetch(`${API_URL}/api/v1/product-master`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
        body: JSON.stringify({
          product_name: registerForm.product_name,
          product_code: registerForm.product_code || undefined,
          risk_level: registerForm.risk_level || undefined,
          region: registerForm.region || undefined,
          product_type: registerForm.product_type || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err?.detail || '상품 등록 실패');
        return;
      }
      const newMaster: ProductMaster = await res.json();
      setProductMasters((prev) => [...prev, newMaster]);
      setRegisterModalOpen(false);

      /* Auto-update matching holdings in extraction results */
      setExtractionResults((prev) =>
        prev.map((er) => ({
          ...er,
          holdings: er.holdings.map((h) =>
            h.productName !== newMaster.product_name
              ? h
              : {
                  ...h,
                  productCode: newMaster.product_code ?? '',
                  riskLevel: newMaster.risk_level ?? h.riskLevel,
                  region: newMaster.region ?? h.region,
                  unmapped: false,
                }
          ),
        }))
      );
    } catch {
      alert('상품 등록 중 오류가 발생했습니다.');
    }
  }

  /* ---------- tab2: load snapshots by date ---------- */

  const loadSnapshotsByDate = useCallback(async (date: string) => {
    setSnapshotsLoading(true);
    try {
      // collect all account IDs from clients
      const allAccounts = clients.flatMap((c) => c.accounts);
      const loaded: Snapshot[] = [];
      for (const acc of allAccounts) {
        try {
          const res = await fetch(
            `${API_URL}/api/v1/snapshots?account_id=${acc.id}&snapshot_date=${date}`,
            { headers: { ...authLib.getAuthHeader() } }
          );
          if (!res.ok) continue;
          const list = await res.json();
          // list is SnapshotListItem[]; load full snapshots
          for (const item of list) {
            const sr = await fetch(`${API_URL}/api/v1/snapshots/${item.id}`, {
              headers: { ...authLib.getAuthHeader() },
            });
            if (sr.ok) loaded.push(await sr.json());
          }
        } catch {
          // skip
        }
      }
      setSnapshots(loaded);
    } finally {
      setSnapshotsLoading(false);
    }
  }, [clients]);

  /* ---------- tab2: load snapshot history for selected account ---------- */

  const loadHistoryList = useCallback(async (accountId: string, period: PeriodKey) => {
    if (!accountId) return;
    setHistoryLoading(true);
    setHistoryList([]);
    setActiveSnapshotId(null);
    setActiveSnapshot(null);
    setHistoryPoints([]);
    setRegionDist([]);
    setRiskDist([]);
    try {
      const res = await fetch(
        `${API_URL}/api/v1/snapshots/history?account_id=${accountId}&period=${period}`,
        { headers: { ...authLib.getAuthHeader() } }
      );
      if (!res.ok) return;
      const data = await res.json();
      // API returns array of snapshot summaries sorted newest first
      const list: Array<{ id: string; snapshot_date: string; total_return_rate?: number }> = Array.isArray(data)
        ? data
        : data.snapshots ?? [];
      setHistoryList(list);
    } catch {
      // silent
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const loadHistoryChart = useCallback(async (accountId: string, period: PeriodKey) => {
    if (!accountId) return;
    setHistoryChartLoading(true);
    try {
      const res = await fetch(
        `${API_URL}/api/v1/snapshots/history?account_id=${accountId}&period=${period}`,
        { headers: { ...authLib.getAuthHeader() } }
      );
      if (!res.ok) return;
      const data = await res.json();
      const list: Array<{ id: string; snapshot_date: string; total_return_rate?: number }> = Array.isArray(data)
        ? data
        : data.snapshots ?? [];
      // Build chart points sorted by date asc
      const sorted = [...list].sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));
      setHistoryPoints(sorted.map((s) => ({ date: s.snapshot_date, return_rate: s.total_return_rate })));
    } catch {
      // silent
    } finally {
      setHistoryChartLoading(false);
    }
  }, []);

  const loadActiveSnapshot = useCallback(async (snapshotId: string) => {
    setActiveSnapshotLoading(true);
    setActiveSnapshot(null);
    try {
      const res = await fetch(`${API_URL}/api/v1/snapshots/${snapshotId}`, {
        headers: { ...authLib.getAuthHeader() },
      });
      if (!res.ok) return;
      const snap: Snapshot = await res.json();
      setActiveSnapshot(snap);

      // Build distribution data from holdings
      const evalByRegion: Record<string, number> = {};
      const evalByRisk: Record<string, number> = {};
      for (const h of snap.holdings) {
        const evalAmt = h.evaluation_amount ?? 0;
        if (h.region) evalByRegion[h.region] = (evalByRegion[h.region] ?? 0) + evalAmt;
        if (h.risk_level) evalByRisk[h.risk_level] = (evalByRisk[h.risk_level] ?? 0) + evalAmt;
      }
      setRegionDist(
        Object.entries(evalByRegion)
          .filter(([, v]) => v > 0)
          .map(([name, value]) => ({ name, value }))
          .sort((a, b) => b.value - a.value)
      );
      setRiskDist(
        Object.entries(evalByRisk)
          .filter(([, v]) => v > 0)
          .map(([name, value]) => ({ name, value }))
          .sort((a, b) => b.value - a.value)
      );
    } catch {
      // silent
    } finally {
      setActiveSnapshotLoading(false);
    }
  }, []);

  function handleHistClientChange(clientId: string) {
    setHistClientId(clientId);
    setHistAccountId('');
    setHistoryList([]);
    setActiveSnapshotId(null);
    setActiveSnapshot(null);
    setHistoryPoints([]);
    setSelectedSnapshotIds(new Set());
    setRegionDist([]);
    setRiskDist([]);
  }

  function handleHistAccountChange(accountId: string) {
    setHistAccountId(accountId);
    setSelectedSnapshotIds(new Set());
    setActiveSnapshotId(null);
    setActiveSnapshot(null);
    loadHistoryList(accountId, histPeriod);
    loadHistoryChart(accountId, histPeriod);
  }

  function handleHistPeriodChange(period: PeriodKey) {
    setHistPeriod(period);
    if (histAccountId) {
      loadHistoryList(histAccountId, period);
      loadHistoryChart(histAccountId, period);
    }
  }

  function handleSnapshotSelect(snapshotId: string, checked: boolean) {
    setSelectedSnapshotIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(snapshotId);
      else next.delete(snapshotId);
      return next;
    });
    // 클릭한 스냅샷을 분석 표에 표시
    if (checked) {
      setActiveSnapshotId(snapshotId);
      loadActiveSnapshot(snapshotId);
    } else if (snapshotId === activeSnapshotId) {
      setActiveSnapshotId(null);
      setActiveSnapshot(null);
    }
  }

  function handleSnapshotRowClick(snapshotId: string) {
    setActiveSnapshotId(snapshotId);
    loadActiveSnapshot(snapshotId);
  }

  /* ---------- tab3: report ---------- */

  async function loadReport() {
    if (!selectedAccountId) {
      alert('계좌를 선택하세요.');
      return;
    }
    setReportLoading(true);
    setReportData(null);
    setModifiedWeights({});
    setAiComment('');
    setAiChangeComment('');
    try {
      const res = await fetch(
        `${API_URL}/api/v1/snapshots/report?account_id=${selectedAccountId}&target_date=${reportDate}`,
        { headers: { ...authLib.getAuthHeader() } }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err?.detail || '보고서 로드 실패');
        return;
      }
      const data: ReportData = await res.json();
      setReportData(data);
      // 서버에서 AI 코멘트가 포함된 경우 자동 적용
      if (data.ai_comment) setAiComment(data.ai_comment);
      if (data.ai_change_comment) setAiChangeComment(data.ai_change_comment);
    } catch (e) {
      alert(e instanceof Error ? e.message : '오류 발생');
    } finally {
      setReportLoading(false);
    }
  }

  async function handleGenerateAiComment() {
    if (!reportData) return;
    setAiCommentLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/reports/ai-comment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
        body: JSON.stringify({
          client_name: reportClientName,
          account_type: reportData.account?.account_type,
          snapshot_date: reportData.snapshot?.snapshot_date,
          total_evaluation: reportData.snapshot?.total_evaluation,
          total_return_rate: reportData.snapshot?.total_return_rate,
          holdings: reportData.holdings?.map((h) => ({
            product_name: h.product_name,
            risk_level: h.risk_level,
            region: h.region,
            return_rate: h.return_rate,
            weight: h.weight,
          })),
          comment_type: 'analysis',
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err?.detail || 'AI 코멘트 생성 실패');
        return;
      }
      const data = await res.json();
      setAiComment(data.comment ?? '');
    } catch (e) {
      alert(e instanceof Error ? e.message : 'AI 코멘트 생성 오류');
    } finally {
      setAiCommentLoading(false);
    }
  }

  async function handleGenerateAiChangeComment() {
    if (!reportData) return;
    setAiChangeCommentLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/reports/ai-comment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
        body: JSON.stringify({
          client_name: reportClientName,
          account_type: reportData.account?.account_type,
          snapshot_date: reportData.snapshot?.snapshot_date,
          total_evaluation: reportData.snapshot?.total_evaluation,
          total_return_rate: reportData.snapshot?.total_return_rate,
          holdings: reportData.holdings?.map((h) => ({
            product_name: h.product_name,
            risk_level: h.risk_level,
            region: h.region,
            return_rate: h.return_rate,
            weight: h.weight,
            modified_weight: modifiedWeights[h.id] ?? null,
          })),
          modified_weights: modifiedWeights,
          comment_type: 'change',
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err?.detail || 'AI 변경 코멘트 생성 실패');
        return;
      }
      const data = await res.json();
      setAiChangeComment(data.comment ?? '');
    } catch (e) {
      alert(e instanceof Error ? e.message : 'AI 변경 코멘트 생성 오류');
    } finally {
      setAiChangeCommentLoading(false);
    }
  }

  /* ---------- tab3: portal link helpers ---------- */

  function getReportClientId(): string {
    const account = clients
      .flatMap((c) => c.accounts.map((a) => ({ ...a, clientId: c.id })))
      .find((a) => a.id === selectedAccountId);
    return account?.clientId ?? '';
  }

  function getReportClient(): Client | undefined {
    const clientId = getReportClientId();
    return clients.find((c) => c.id === clientId);
  }

  function showToast(msg: string) {
    setPortalLinkToast(msg);
    setTimeout(() => setPortalLinkToast(''), 3000);
  }

  function handleCopyPortalLink() {
    const client = getReportClient();
    if (!client?.portal_token) {
      showToast('포털 토큰이 없습니다. 관리자에게 문의하세요.');
      return;
    }
    const link = `${window.location.origin}/client/${client.portal_token}`;
    navigator.clipboard.writeText(link).then(
      () => showToast('링크가 복사되었습니다'),
      () => showToast('클립보드 복사에 실패했습니다.')
    );
  }

  async function handleSendPortalEmail() {
    const client = getReportClient();
    const clientId = getReportClientId();
    if (!clientId) return;

    if (!client?.email) {
      setEmailInput('');
      setShowEmailModal(true);
      return;
    }

    await doSendPortalLink(clientId);
  }

  async function doSendPortalLink(clientId: string) {
    setEmailSending(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/clients/${clientId}/send-portal-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showToast(err?.detail || '이메일 발송에 실패했습니다.');
        return;
      }
      showToast('이메일이 발송되었습니다');
    } catch {
      showToast('이메일 발송 중 오류가 발생했습니다.');
    } finally {
      setEmailSending(false);
    }
  }

  async function handleSaveEmailAndSend() {
    const clientId = getReportClientId();
    if (!clientId || !emailInput.trim()) return;

    setEmailSending(true);
    try {
      const patchRes = await fetch(`${API_URL}/api/v1/clients/${clientId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
        body: JSON.stringify({ email: emailInput.trim() }),
      });
      if (!patchRes.ok) {
        const err = await patchRes.json().catch(() => ({}));
        showToast(err?.detail || '이메일 저장에 실패했습니다.');
        setEmailSending(false);
        return;
      }
      // Update local client state
      setClients((prev) =>
        prev.map((c) => (c.id === clientId ? { ...c, email: emailInput.trim() } : c))
      );
      setShowEmailModal(false);
      await doSendPortalLink(clientId);
    } catch {
      showToast('이메일 저장 중 오류가 발생했습니다.');
      setEmailSending(false);
    }
  }

  async function handleSaveImage() {
    if (!reportRef.current) return;
    setSaving(true);
    try {
      const html2canvas = (await import('html2canvas')).default;
      const canvas = await html2canvas(reportRef.current, { scale: 2 });
      const link = document.createElement('a');
      link.download = `${reportClientName}_보고서_${reportDate}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (e) {
      alert(e instanceof Error ? e.message : '이미지 저장 실패');
    } finally {
      setSaving(false);
    }
  }

  async function handleDownloadPDF() {
    if (!reportRef.current) return;
    setSaving(true);
    try {
      const html2canvas = (await import('html2canvas')).default;
      const { default: jsPDF } = await import('jspdf');
      const canvas = await html2canvas(reportRef.current, { scale: 2 });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const w = pdf.internal.pageSize.getWidth();
      const h = (canvas.height * w) / canvas.width;
      pdf.addImage(imgData, 'PNG', 0, 0, w, h);
      pdf.save(`${reportClientName}_보고서_${reportDate}.pdf`);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'PDF 다운로드 실패');
    } finally {
      setSaving(false);
    }
  }

  /* ---------- derived ---------- */

  const stepIndex = TABS.findIndex((t) => t.key === activeTab);

  const filteredSnapshots = snapshots.filter((s) => {
    if (!searchClientName) return true;
    const account = clients
      .flatMap((c) => c.accounts.map((a) => ({ ...a, clientName: c.name })))
      .find((a) => a.id === s.client_account_id);
    return account?.clientName?.includes(searchClientName) ?? false;
  });

  const allAccountsForReport = clients.flatMap((c) =>
    c.accounts.map((a) => ({
      accountId: a.id,
      clientName: c.name,
      label: `${c.name} - ${accountTypeLabel(a.account_type)}${a.account_number ? ` (${a.account_number})` : ''}`,
    }))
  );

  const getClientNameForSnapshot = (accountId: string): string => {
    const found = clients.flatMap((c) => c.accounts.map((a) => ({ ...a, clientName: c.name }))).find((a) => a.id === accountId);
    return found?.clientName ?? '고객';
  };

  const getAccountTypeForSnapshot = (accountId: string): string => {
    const found = clients.flatMap((c) => c.accounts).find((a) => a.id === accountId);
    return found?.account_type ?? 'irp';
  };

  /* ================================================================ */
  /*  Render                                                            */
  /* ================================================================ */

  return (
    <div style={{ maxWidth: '960px', margin: '0 auto' }}>
      {/* ===== 페이지 헤더 ===== */}
      <div style={{ marginBottom: 24 }}>
        <button
          onClick={() => router.push('/dashboard')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            marginBottom: 12,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: '#6B7280',
            fontSize: '0.8125rem',
            padding: 0,
          }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = '#1A1A2E')}
          onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = '#6B7280')}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          대시보드로 돌아가기
        </button>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
          <div>
            <div
              style={{
                width: 32,
                height: 4,
                borderRadius: 2,
                background: 'linear-gradient(90deg,#3B82F6 0%,#1E3A5F 100%)',
                marginBottom: 10,
              }}
            />
            <h1
              style={{
                margin: 0,
                fontSize: '1.375rem',
                fontWeight: 800,
                color: '#1A1A2E',
                letterSpacing: '-0.4px',
              }}
            >
              IRP / 연금저축 포트폴리오 관리
            </h1>
            <p style={{ margin: '5px 0 0', fontSize: '0.875rem', color: '#6B7280' }}>
              증권사 화면을 캡처해 붙여넣으면 AI가 데이터를 인식해 보고서를 생성합니다.
            </p>
          </div>

          {/* Step indicator */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 0, flexShrink: 0 }}>
            {TABS.map((tab, i) => (
              <div key={tab.key} style={{ display: 'flex', alignItems: 'center' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <StepDot step={i + 1} active={activeTab === tab.key} done={i < stepIndex} />
                  <span style={{ fontSize: '0.625rem', color: i < stepIndex ? '#1E3A5F' : activeTab === tab.key ? '#3B82F6' : '#9CA3AF', fontWeight: 600, whiteSpace: 'nowrap' }}>
                    {typeof tab.label === 'string' ? tab.label.replace(/^\d+\.\s/, '') : tab.label}
                  </span>
                </div>
                {i < TABS.length - 1 && (
                  <div
                    style={{
                      width: 32,
                      height: 2,
                      backgroundColor: i < stepIndex ? '#1E3A5F' : '#E1E5EB',
                      marginBottom: 18,
                      transition: 'background-color 0.2s ease',
                    }}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ===== Tabs ===== */}
      <div style={{ marginBottom: 24 }}>
        <Tab items={TABS} activeKey={activeTab} onChange={(k) => setActiveTab(k as typeof activeTab)} />
      </div>

      {/* ===================================================== */}
      {/* TAB 1: 데이터 입력                                     */}
      {/* ===================================================== */}
      {activeTab === 'data' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* 상단 툴바 */}
          <Card padding={16}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <button
                  onClick={() => setClientMgmtOpen(true)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    padding: '6px 14px',
                    fontSize: '0.8125rem',
                    fontWeight: 600,
                    color: '#1E3A5F',
                    backgroundColor: '#fff',
                    border: '1px solid #1E3A5F',
                    borderRadius: 7,
                    cursor: 'pointer',
                  }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                  고객정보 관리
                </button>
                {/* 고객 추가 버튼은 고객정보 관리 팝업에서 처리 */}
              </div>
            </div>
          </Card>

          {/* 로딩 중 */}
          {clientsLoading && (
            <div style={{ textAlign: 'center', color: '#9CA3AF', fontSize: '0.875rem', padding: '12px 0' }}>
              고객 목록 로딩 중...
            </div>
          )}

          {/* 고객 행들 */}
          {rows.map((row, i) => (
            <ClientRow
              key={i}
              index={i}
              clients={clients}
              data={row}
              onChange={(d) => updateRow(i, d)}
              onRemove={() => removeRow(i)}
            />
          ))}

          {rows.length === 0 && (
            <div
              style={{
                padding: '40px 20px',
                textAlign: 'center',
                color: '#9CA3AF',
                fontSize: '0.875rem',
                border: '2px dashed #E1E5EB',
                borderRadius: 12,
              }}
            >
              "고객정보 관리"에서 고객을 등록한 후, 고객을 선택하고 이미지를 붙여넣으세요.
            </div>
          )}

          {/* 처리 버튼 */}
          {rows.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button
                variant="primary"
                size="md"
                loading={processing}
                disabled={rows.filter((r) => r.imageFile).length === 0}
                onClick={handleProcess}
              >
                데이터 처리하기
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </Button>
            </div>
          )}

          {/* ---- 추출 결과 인라인 표시 ---- */}
          {extractionResults.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20, marginTop: 8 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  paddingBottom: 4,
                  borderBottom: '2px solid #1E3A5F',
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1E3A5F" strokeWidth="2">
                  <polyline points="9 11 12 14 22 4" />
                  <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                </svg>
                <span style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#1A1A2E' }}>
                  AI 추출 결과 확인
                </span>
                <span style={{ fontSize: '0.8125rem', color: '#6B7280' }}>
                  위험도·지역을 확인하고 필요시 수정 후 저장하세요.
                </span>
              </div>

              {extractionResults.map((er) => (
                <Card key={er.snapshotId} padding={0} style={{ overflow: 'hidden' }}>
                  {/* Card header */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '12px 16px',
                      backgroundColor: '#F5F7FA',
                      borderBottom: '1px solid #E1E5EB',
                    }}
                  >
                    <span style={{ fontWeight: 700, color: '#1A1A2E', fontSize: '0.9375rem' }}>
                      {er.clientName}
                    </span>
                    <span
                      style={{
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        color: '#1E3A5F',
                        backgroundColor: '#EEF2F7',
                        padding: '2px 8px',
                        borderRadius: 5,
                      }}
                    >
                      {accountTypeLabel(er.accountType)}
                    </span>
                    <span style={{ fontSize: '0.75rem', color: '#9CA3AF' }}>
                      {er.holdings.length}개 종목
                    </span>
                    {/* Extracted snapshot date (editable) */}
                    <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: '0.75rem', color: '#6B7280', fontWeight: 500, whiteSpace: 'nowrap' }}>
                        조회일
                      </span>
                      <input
                        type="date"
                        value={er.snapshotDate}
                        onChange={(e) => {
                          const newDate = e.target.value;
                          setExtractionResults((prev) =>
                            prev.map((r) => r.snapshotId !== er.snapshotId ? r : { ...r, snapshotDate: newDate })
                          );
                        }}
                        style={{
                          padding: '4px 8px',
                          fontSize: '0.75rem',
                          border: '1px solid #CBD5E1',
                          borderRadius: 6,
                          outline: 'none',
                          color: '#1A1A2E',
                          cursor: 'pointer',
                          backgroundColor: '#fff',
                        }}
                      />
                    </div>
                    {/* apply-master button */}
                    <button
                      onClick={() => applyMaster(er.snapshotId)}
                      disabled={er.applyingMaster}
                      style={{
                        padding: '5px 12px',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        color: '#1E3A5F',
                        backgroundColor: er.applyingMaster ? '#E1E5EB' : '#EEF2F7',
                        border: '1px solid #C7D2E2',
                        borderRadius: 6,
                        cursor: er.applyingMaster ? 'not-allowed' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 5,
                        transition: 'background-color 0.15s',
                      }}
                    >
                      {er.applyingMaster ? (
                        <span
                          style={{
                            display: 'inline-block',
                            width: 11,
                            height: 11,
                            border: '2px solid #1E3A5F',
                            borderTopColor: 'transparent',
                            borderRadius: '50%',
                            animation: 'spin 0.7s linear infinite',
                          }}
                        />
                      ) : (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                        </svg>
                      )}
                      상품 마스터 일괄 적용
                    </button>
                  </div>

                  {/* Account summary bar */}
                  {(er.depositAmount != null || er.totalAssets != null || er.totalPurchase != null || er.totalEvaluation != null || er.totalReturn != null || er.totalReturnRate != null) && (
                    <div
                      style={{
                        padding: '10px 16px',
                        backgroundColor: '#EEF2F7',
                        borderBottom: '1px solid #D1D9E6',
                        display: 'grid',
                        gridTemplateColumns: 'repeat(7, 1fr)',
                        gap: 8,
                      }}
                    >
                      {[
                        { label: '예수금', value: er.depositAmount, isRate: false },
                        { label: '외화예수금', value: er.foreignDepositAmount, isRate: false },
                        { label: '총자산', value: er.totalAssets, isRate: false },
                        { label: '매입금액', value: er.totalPurchase, isRate: false },
                        { label: '평가금액', value: er.totalEvaluation, isRate: false },
                        { label: '평가손익', value: er.totalReturn, isRate: false, signed: true },
                        { label: '총수익률', value: er.totalReturnRate, isRate: true, signed: true },
                      ].map(({ label, value, isRate, signed }) => {
                        const color = signed && value != null ? (value > 0 ? '#10B981' : value < 0 ? '#EF4444' : '#374151') : '#374151';
                        const formatted = value == null
                          ? '-'
                          : isRate
                            ? `${value > 0 ? '+' : ''}${value.toFixed(2)}%`
                            : `${signed && value > 0 ? '+' : ''}${value.toLocaleString('ko-KR')}`;
                        return (
                          <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'center' }}>
                            <span style={{ fontSize: '0.6875rem', color: '#6B7280', fontWeight: 500 }}>{label}</span>
                            <span style={{ fontSize: '0.8125rem', fontWeight: 700, color }}>{formatted}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Toast message */}
                  {er.toastMsg && (
                    <div
                      style={{
                        padding: '8px 16px',
                        backgroundColor: '#ECFDF5',
                        borderBottom: '1px solid #6EE7B7',
                        fontSize: '0.8125rem',
                        color: '#059669',
                        fontWeight: 600,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      {er.toastMsg}
                    </div>
                  )}

                  {/* Unmatched notice */}
                  {er.holdings.some((h) => h.unmapped) && (
                    <div
                      style={{
                        padding: '8px 16px',
                        backgroundColor: '#FFFBEB',
                        borderBottom: '1px solid #FDE68A',
                        fontSize: '0.8125rem',
                        color: '#92400E',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="8" x2="12" y2="12" />
                        <line x1="12" y1="16" x2="12.01" y2="16" />
                      </svg>
                      노란색 행은 상품 마스터에서 찾지 못한 항목입니다. 위험도/지역을 수동으로 선택 후 저장하세요.
                    </div>
                  )}

                  {/* Holdings table — 상품명 고정 + 오른쪽 스크롤 */}
                  <div style={{ display: 'flex', border: '1px solid #E1E5EB', borderRadius: 8, overflow: 'hidden' }}>
                    {/* 고정 영역: NO + 상품명 + 액션 */}
                    <div style={{ flexShrink: 0, borderRight: '2px solid #E1E5EB' }}>
                      <table style={{ borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
                        <thead>
                          <tr style={{ backgroundColor: '#F5F7FA' }}>
                            <th style={{ padding: '9px 8px', textAlign: 'center', fontSize: '0.75rem', fontWeight: 600, color: '#6B7280', borderBottom: '1px solid #E1E5EB', width: 32 }}>NO</th>
                            <th style={{ padding: '9px 8px', textAlign: 'left', fontSize: '0.75rem', fontWeight: 600, color: '#6B7280', borderBottom: '1px solid #E1E5EB', width: 220 }}>상품명</th>
                            <th style={{ padding: '9px 4px', textAlign: 'center', fontSize: '0.75rem', fontWeight: 600, color: '#6B7280', borderBottom: '1px solid #E1E5EB', width: 50 }}></th>
                          </tr>
                        </thead>
                        <tbody>
                          {er.holdings.map((h, idx) => {
                            const rowBg = h.unmapped ? '#FEF9C3' : 'transparent';
                            return (
                              <tr key={h.holdingId} style={{ backgroundColor: rowBg }}>
                                <td style={{ padding: '8px 8px', textAlign: 'center', color: '#9CA3AF', borderBottom: '1px solid #F3F4F6', fontSize: '0.75rem' }}>
                                  {idx + 1}
                                </td>
                                <td style={{ padding: '6px 8px', borderBottom: '1px solid #F3F4F6' }}>
                                  <input type="text" value={h.productName}
                                    onChange={(e) => updateHoldingField(er.snapshotId, h.holdingId, { productName: e.target.value })}
                                    title={h.productName}
                                    style={{
                                      width: 210, fontSize: '0.75rem', fontWeight: 500, color: '#1A1A2E',
                                      border: '1px solid transparent', borderRadius: 4, padding: '2px 4px',
                                      background: 'transparent', outline: 'none', whiteSpace: 'nowrap',
                                    }}
                                    onFocus={(e) => { e.currentTarget.style.border = '1px solid #3B82F6'; e.currentTarget.style.background = '#fff'; }}
                                    onBlur={(e) => { e.currentTarget.style.border = '1px solid transparent'; e.currentTarget.style.background = 'transparent'; }}
                                  />
                                </td>
                                <td style={{ padding: '4px 4px', borderBottom: '1px solid #F3F4F6', whiteSpace: 'nowrap' }}>
                                  <div style={{ display: 'flex', gap: 2 }}>
                                    {/* 등록 아이콘 */}
                                    <button type="button" title="상품 마스터에 등록"
                                      onClick={() => openRegisterModal(h.productName)}
                                      style={{ width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #FCD34D', borderRadius: 4, backgroundColor: '#FEF3C7', cursor: 'pointer', color: '#D97706', fontSize: '0.6rem' }}>
                                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                                    </button>
                                    {/* 불러오기 아이콘 */}
                                    <button type="button" title="상품 마스터에서 불러오기"
                                      onClick={() => {
                                        setLoadMasterTarget({ snapshotId: er.snapshotId, holdingId: h.holdingId, productName: h.productName });
                                        setLoadMasterSearch(h.productName);
                                      }}
                                      style={{ width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #93C5FD', borderRadius: 4, backgroundColor: '#EFF6FF', cursor: 'pointer', color: '#2563EB', fontSize: '0.6rem' }}>
                                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* 스크롤 영역: 종목코드 ~ 수익률 */}
                    <div style={{ overflowX: 'auto', flex: 1 }}>
                      <table style={{ borderCollapse: 'collapse', fontSize: '0.8125rem', minWidth: 900 }}>
                        <thead>
                          <tr style={{ backgroundColor: '#F5F7FA' }}>
                            <th style={{ padding: '9px 10px', textAlign: 'center', fontSize: '0.75rem', fontWeight: 600, color: '#6B7280', borderBottom: '1px solid #E1E5EB', whiteSpace: 'nowrap', minWidth: 80 }}>종목코드</th>
                            <th style={{ padding: '9px 10px', textAlign: 'center', fontSize: '0.75rem', fontWeight: 600, color: '#6B7280', borderBottom: '1px solid #E1E5EB', whiteSpace: 'nowrap', minWidth: 110 }}>위험도</th>
                            <th style={{ padding: '9px 10px', textAlign: 'center', fontSize: '0.75rem', fontWeight: 600, color: '#6B7280', borderBottom: '1px solid #E1E5EB', whiteSpace: 'nowrap', minWidth: 80 }}>지역</th>
                            <th style={{ padding: '9px 10px', textAlign: 'right', fontSize: '0.75rem', fontWeight: 600, color: '#6B7280', borderBottom: '1px solid #E1E5EB', whiteSpace: 'nowrap', minWidth: 70 }}>잔고수량</th>
                            <th style={{ padding: '9px 10px', textAlign: 'right', fontSize: '0.75rem', fontWeight: 600, color: '#6B7280', borderBottom: '1px solid #E1E5EB', whiteSpace: 'nowrap', minWidth: 80 }}>매입가</th>
                            <th style={{ padding: '9px 10px', textAlign: 'right', fontSize: '0.75rem', fontWeight: 600, color: '#6B7280', borderBottom: '1px solid #E1E5EB', whiteSpace: 'nowrap', minWidth: 80 }}>현재가</th>
                            <th style={{ padding: '9px 10px', textAlign: 'right', fontSize: '0.75rem', fontWeight: 600, color: '#6B7280', borderBottom: '1px solid #E1E5EB', whiteSpace: 'nowrap', minWidth: 90 }}>매입금액</th>
                            <th style={{ padding: '9px 10px', textAlign: 'right', fontSize: '0.75rem', fontWeight: 600, color: '#6B7280', borderBottom: '1px solid #E1E5EB', whiteSpace: 'nowrap', minWidth: 90 }}>평가금액</th>
                            <th style={{ padding: '9px 10px', textAlign: 'right', fontSize: '0.75rem', fontWeight: 600, color: '#6B7280', borderBottom: '1px solid #E1E5EB', whiteSpace: 'nowrap', minWidth: 90 }}>평가손익</th>
                            <th style={{ padding: '9px 10px', textAlign: 'right', fontSize: '0.75rem', fontWeight: 600, color: '#6B7280', borderBottom: '1px solid #E1E5EB', whiteSpace: 'nowrap', minWidth: 70 }}>수익률</th>
                          </tr>
                        </thead>
                        <tbody>
                          {er.holdings.map((h) => {
                            const rowBg = h.unmapped ? '#FEF9C3' : 'transparent';
                            const calcReturnRate = (h.returnAmount != null && h.purchaseAmount != null && h.purchaseAmount !== 0)
                              ? (h.returnAmount / h.purchaseAmount) * 100
                              : null;
                            const rateColor = calcReturnRate == null ? '#374151' : calcReturnRate > 0 ? '#10B981' : calcReturnRate < 0 ? '#EF4444' : '#374151';
                            return (
                              <tr key={h.holdingId} style={{ backgroundColor: rowBg }}>
                                <td style={{ padding: '8px 10px', textAlign: 'center', color: '#6B7280', borderBottom: '1px solid #F3F4F6', fontSize: '0.75rem', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                                  {h.productCode || '-'}
                                </td>
                                <td style={{ padding: '6px 6px', textAlign: 'center', borderBottom: '1px solid #F3F4F6' }}>
                                  <select value={h.riskLevel}
                                    onChange={(e) => updateHoldingField(er.snapshotId, h.holdingId, { riskLevel: e.target.value })}
                                    style={{ width: '100%', padding: '4px 4px', fontSize: '0.7rem', border: `1px solid ${h.unmapped && !h.riskLevel ? '#F59E0B' : '#E1E5EB'}`, borderRadius: 5, outline: 'none', backgroundColor: '#fff', cursor: 'pointer', color: '#1A1A2E' }}>
                                    <option value="">선택</option>
                                    {RISK_LEVELS.map((rl) => (<option key={rl} value={rl}>{rl}</option>))}
                                  </select>
                                </td>
                                <td style={{ padding: '6px 6px', textAlign: 'center', borderBottom: '1px solid #F3F4F6' }}>
                                  <select value={h.region}
                                    onChange={(e) => updateHoldingField(er.snapshotId, h.holdingId, { region: e.target.value })}
                                    style={{ width: '100%', padding: '4px 4px', fontSize: '0.7rem', border: `1px solid ${h.unmapped && !h.region ? '#F59E0B' : '#E1E5EB'}`, borderRadius: 5, outline: 'none', backgroundColor: '#fff', cursor: 'pointer', color: '#1A1A2E' }}>
                                    <option value="">선택</option>
                                    {REGIONS.map((rg) => (<option key={rg} value={rg}>{rg}</option>))}
                                  </select>
                                </td>
                                {([
                                  { key: 'quantity', val: h.quantity },
                                  { key: 'purchasePrice', val: h.purchasePrice },
                                  { key: 'currentPrice', val: h.currentPrice },
                                  { key: 'purchaseAmount', val: h.purchaseAmount },
                                  { key: 'evaluationAmount', val: h.evaluationAmount },
                                  { key: 'returnAmount', val: h.returnAmount },
                                ] as { key: string; val?: number }[]).map(({ key, val }) => (
                                  <td key={key} style={{ padding: '4px 6px', textAlign: 'right', borderBottom: '1px solid #F3F4F6' }}>
                                    <input type="text"
                                      value={val != null ? val.toLocaleString('ko-KR') : ''}
                                      onChange={(e) => {
                                        const raw = e.target.value.replace(/[^0-9.\-]/g, '');
                                        const num = raw === '' || raw === '-' ? undefined : parseFloat(raw);
                                        updateHoldingField(er.snapshotId, h.holdingId, { [key]: num } as any);
                                      }}
                                      style={{
                                        width: '100%', minWidth: 60, padding: '3px 4px', fontSize: '0.75rem',
                                        textAlign: 'right', border: '1px solid transparent', borderRadius: 4,
                                        background: 'transparent', outline: 'none',
                                        color: key === 'returnAmount' ? ((val ?? 0) >= 0 ? '#10B981' : '#EF4444') : '#374151',
                                        fontWeight: key === 'evaluationAmount' ? 500 : 400,
                                      }}
                                      onFocus={(e) => { e.currentTarget.style.border = '1px solid #3B82F6'; e.currentTarget.style.background = '#fff'; }}
                                      onBlur={(e) => { e.currentTarget.style.border = '1px solid transparent'; e.currentTarget.style.background = 'transparent'; }}
                                    />
                                  </td>
                                ))}
                                <td style={{ padding: '8px 10px', textAlign: 'right', color: rateColor, fontWeight: 600, borderBottom: '1px solid #F3F4F6', whiteSpace: 'nowrap' }}>
                                  {calcReturnRate != null
                                    ? `${calcReturnRate > 0 ? '+' : ''}${parseFloat(calcReturnRate.toFixed(2))}%`
                                    : '-'}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                    </table>
                    </div>
                  </div>

                  {/* Footer: save all and proceed */}
                  <div
                    style={{
                      padding: '12px 16px',
                      backgroundColor: '#F5F7FA',
                      borderTop: '1px solid #E1E5EB',
                      display: 'flex',
                      justifyContent: 'flex-end',
                    }}
                  >
                    <button
                      onClick={() => saveAllHoldings(er.snapshotId)}
                      disabled={savingAll === er.snapshotId}
                      style={{
                        padding: '9px 20px',
                        fontSize: '0.875rem',
                        fontWeight: 700,
                        color: '#fff',
                        backgroundColor: savingAll === er.snapshotId ? '#9CA3AF' : '#1E3A5F',
                        border: 'none',
                        borderRadius: 8,
                        cursor: savingAll === er.snapshotId ? 'not-allowed' : 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 7,
                        transition: 'background-color 0.15s',
                      }}
                      onMouseEnter={(e) => { if (savingAll !== er.snapshotId) (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#162D4A'; }}
                      onMouseLeave={(e) => { if (savingAll !== er.snapshotId) (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#1E3A5F'; }}
                    >
                      {savingAll === er.snapshotId ? (
                        <span style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid #fff', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                      ) : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                      {savingAll === er.snapshotId ? '저장 중...' : '전체 저장'}
                    </button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ===================================================== */}
      {/* TAB 2: 데이터 확인 (완전 재설계)                        */}
      {/* ===================================================== */}
      {activeTab === 'template' && (
        <Tab2Section
          clients={clients}
          productMasters={productMasters}
          histClientId={histClientId}
          setHistClientId={setHistClientId}
          histAccountId={histAccountId}
          setHistAccountId={setHistAccountId}
          historyList={historyList}
          setHistoryList={setHistoryList}
          historyLoading={historyLoading}
          setHistoryLoading={setHistoryLoading}
          historyPoints={historyPoints}
          setHistoryPoints={setHistoryPoints}
          historyChartLoading={historyChartLoading}
          setHistoryChartLoading={setHistoryChartLoading}
          activeSnapshotId={activeSnapshotId}
          setActiveSnapshotId={setActiveSnapshotId}
          activeSnapshot={activeSnapshot}
          setActiveSnapshot={setActiveSnapshot}
          activeSnapshotLoading={activeSnapshotLoading}
          setActiveSnapshotLoading={setActiveSnapshotLoading}
          regionDist={regionDist}
          setRegionDist={setRegionDist}
          riskDist={riskDist}
          setRiskDist={setRiskDist}
          selectedSnapshotIds={selectedSnapshotIds}
          setSelectedSnapshotIds={setSelectedSnapshotIds}
          onGoToReport={() => setActiveTab('report')}
          onProductMasterCreated={(pm) => setProductMasters((prev) => [...prev, pm])}
        />
      )}

      {/* ===================================================== */}
      {/* TAB 3: 보고서                                          */}
      {/* ===================================================== */}
      {activeTab === 'report' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* 컨트롤 바 */}
          <Card padding={16}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              {/* 고객/계좌 선택 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 220 }}>
                <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#374151', whiteSpace: 'nowrap' }}>
                  계좌 선택
                </label>
                <select
                  value={selectedAccountId}
                  onChange={(e) => {
                    const val = e.target.value;
                    setSelectedAccountId(val);
                    const found = allAccountsForReport.find((a) => a.accountId === val);
                    setReportClientName(found?.clientName ?? '');
                  }}
                  style={{
                    flex: 1,
                    padding: '7px 10px',
                    fontSize: '0.8125rem',
                    border: '1px solid #E1E5EB',
                    borderRadius: 8,
                    outline: 'none',
                    color: '#1A1A2E',
                    cursor: 'pointer',
                  }}
                >
                  <option value="">-- 계좌 선택 --</option>
                  {allAccountsForReport.map((a) => (
                    <option key={a.accountId} value={a.accountId}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* 날짜 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#374151', whiteSpace: 'nowrap' }}>
                  날짜
                </label>
                <input
                  type="date"
                  value={reportDate}
                  onChange={(e) => setReportDate(e.target.value)}
                  style={{
                    padding: '7px 10px',
                    fontSize: '0.8125rem',
                    border: '1px solid #E1E5EB',
                    borderRadius: 8,
                    outline: 'none',
                    color: '#1A1A2E',
                  }}
                />
              </div>

              <Button
                variant="primary"
                size="sm"
                loading={reportLoading}
                onClick={loadReport}
                disabled={!selectedAccountId}
              >
                보고서 생성
              </Button>
            </div>
          </Card>

          {/* 저장 버튼들 */}
          {reportData && (
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <Button variant="secondary" size="sm" loading={saving} onClick={handleSaveImage}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <polyline points="21 15 16 10 5 21" />
                </svg>
                이미지 저장
              </Button>
              <Button variant="primary" size="sm" loading={saving} onClick={handleDownloadPDF}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                PDF 다운로드
              </Button>
            </div>
          )}

          {/* 포털 링크 발송 섹션 */}
          {reportData && (
            <div
              style={{
                backgroundColor: '#F0F4FF',
                border: '1px solid #C7D7F9',
                borderRadius: 10,
                padding: '16px 20px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1E3A5F" strokeWidth="2">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                </svg>
                <span style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#1E3A5F' }}>
                  고객 포털 공유
                </span>
              </div>

              {/* 링크 미리보기 */}
              {(() => {
                const client = getReportClient();
                const token = client?.portal_token;
                const linkUrl = token
                  ? `${typeof window !== 'undefined' ? window.location.origin : ''}/client/${token}`
                  : null;
                return (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#6B7280', marginBottom: 4 }}>
                      조회 링크
                    </div>
                    <div
                      style={{
                        padding: '8px 12px',
                        backgroundColor: '#FFFFFF',
                        border: '1px solid #D1D5DB',
                        borderRadius: 6,
                        fontSize: '0.8125rem',
                        color: token ? '#374151' : '#9CA3AF',
                        fontFamily: 'monospace',
                        overflowX: 'auto',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {linkUrl ?? '포털 토큰이 없습니다. 백엔드 설정을 확인하세요.'}
                    </div>
                  </div>
                );
              })()}

              {/* 액션 버튼들 */}
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={handleCopyPortalLink}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '8px 16px',
                    fontSize: '0.8125rem',
                    fontWeight: 600,
                    color: '#1E3A5F',
                    backgroundColor: '#FFFFFF',
                    border: '1px solid #1E3A5F',
                    borderRadius: 7,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#1E3A5F';
                    (e.currentTarget as HTMLButtonElement).style.color = '#FFFFFF';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#FFFFFF';
                    (e.currentTarget as HTMLButtonElement).style.color = '#1E3A5F';
                  }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                  링크 복사
                </button>

                <button
                  onClick={handleSendPortalEmail}
                  disabled={emailSending}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '8px 16px',
                    fontSize: '0.8125rem',
                    fontWeight: 600,
                    color: '#FFFFFF',
                    backgroundColor: emailSending ? '#9CA3AF' : '#1E3A5F',
                    border: 'none',
                    borderRadius: 7,
                    cursor: emailSending ? 'not-allowed' : 'pointer',
                    transition: 'background-color 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    if (!emailSending)
                      (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#152C4A';
                  }}
                  onMouseLeave={(e) => {
                    if (!emailSending)
                      (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#1E3A5F';
                  }}
                >
                  {emailSending ? (
                    <span
                      style={{
                        display: 'inline-block',
                        width: 12,
                        height: 12,
                        border: '1.5px solid #fff',
                        borderTopColor: 'transparent',
                        borderRadius: '50%',
                        animation: 'spin 0.7s linear infinite',
                      }}
                    />
                  ) : (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                      <polyline points="22,6 12,13 2,6" />
                    </svg>
                  )}
                  {emailSending ? '발송 중...' : '이메일 발송'}
                </button>
              </div>

              {/* 토스트 메시지 */}
              {portalLinkToast && (
                <div
                  style={{
                    marginTop: 10,
                    padding: '8px 12px',
                    backgroundColor: portalLinkToast.includes('실패') || portalLinkToast.includes('오류')
                      ? '#FEF2F2'
                      : '#ECFDF5',
                    border: `1px solid ${
                      portalLinkToast.includes('실패') || portalLinkToast.includes('오류')
                        ? '#FECACA'
                        : '#A7F3D0'
                    }`,
                    borderRadius: 6,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: '0.8125rem',
                    fontWeight: 500,
                    color: portalLinkToast.includes('실패') || portalLinkToast.includes('오류')
                      ? '#DC2626'
                      : '#059669',
                  }}
                >
                  {portalLinkToast.includes('실패') || portalLinkToast.includes('오류') ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="8" x2="12" y2="12" />
                      <line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="9 12 11 14 15 10" />
                    </svg>
                  )}
                  {portalLinkToast}
                </div>
              )}
            </div>
          )}

          {/* ReportView */}
          <ReportView
            ref={reportRef}
            reportData={reportData}
            clientName={reportClientName}
            modifiedWeights={modifiedWeights}
            onWeightChange={(id, val) => setModifiedWeights((prev) => ({ ...prev, [id]: val }))}
            aiComment={aiComment}
            onAiCommentChange={setAiComment}
            aiChangeComment={aiChangeComment}
            onAiChangeCommentChange={setAiChangeComment}
            onGenerateAiComment={handleGenerateAiComment}
            onGenerateAiChangeComment={handleGenerateAiChangeComment}
            aiCommentLoading={aiCommentLoading}
            aiChangeCommentLoading={aiChangeCommentLoading}
          />
        </div>
      )}

      {/* 이메일 입력 모달 */}
      {showEmailModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowEmailModal(false);
          }}
        >
          <div
            style={{
              backgroundColor: '#FFFFFF',
              borderRadius: 12,
              padding: '28px 32px',
              width: '100%',
              maxWidth: 420,
              boxShadow: '0 20px 40px rgba(0,0,0,0.18)',
            }}
          >
            <h3
              style={{
                margin: '0 0 6px',
                fontSize: '1.0625rem',
                fontWeight: 800,
                color: '#1A1A2E',
                letterSpacing: '-0.3px',
              }}
            >
              이메일 등록
            </h3>
            <p
              style={{
                margin: '0 0 20px',
                fontSize: '0.8125rem',
                color: '#6B7280',
                lineHeight: 1.5,
              }}
            >
              고객 이메일이 등록되지 않았습니다.
              <br />
              이메일을 입력하고 저장 후 조회 링크를 발송합니다.
            </p>

            <label
              style={{
                display: 'block',
                fontSize: '0.8125rem',
                fontWeight: 600,
                color: '#374151',
                marginBottom: 6,
              }}
            >
              이메일 주소
            </label>
            <input
              type="email"
              placeholder="example@email.com"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && emailInput.trim()) handleSaveEmailAndSend();
              }}
              style={{
                width: '100%',
                padding: '10px 12px',
                fontSize: '0.875rem',
                border: '1px solid #E1E5EB',
                borderRadius: 8,
                outline: 'none',
                color: '#1A1A2E',
                boxSizing: 'border-box',
                marginBottom: 20,
              }}
              autoFocus
            />

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowEmailModal(false)}
                style={{
                  padding: '9px 18px',
                  fontSize: '0.8125rem',
                  fontWeight: 600,
                  color: '#6B7280',
                  backgroundColor: '#F3F4F6',
                  border: 'none',
                  borderRadius: 8,
                  cursor: 'pointer',
                }}
              >
                취소
              </button>
              <button
                onClick={handleSaveEmailAndSend}
                disabled={!emailInput.trim() || emailSending}
                style={{
                  padding: '9px 18px',
                  fontSize: '0.8125rem',
                  fontWeight: 600,
                  color: '#FFFFFF',
                  backgroundColor:
                    !emailInput.trim() || emailSending ? '#9CA3AF' : '#1E3A5F',
                  border: 'none',
                  borderRadius: 8,
                  cursor: !emailInput.trim() || emailSending ? 'not-allowed' : 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                {emailSending && (
                  <span
                    style={{
                      display: 'inline-block',
                      width: 12,
                      height: 12,
                      border: '1.5px solid #fff',
                      borderTopColor: 'transparent',
                      borderRadius: '50%',
                      animation: 'spin 0.7s linear infinite',
                    }}
                  />
                )}
                저장 후 발송
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 상품 등록 모달 */}
      {registerModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setRegisterModalOpen(false);
          }}
        >
          <div
            style={{
              backgroundColor: '#FFFFFF',
              borderRadius: 12,
              padding: '28px 32px',
              width: '100%',
              maxWidth: 460,
              boxShadow: '0 20px 40px rgba(0,0,0,0.18)',
            }}
          >
            <h3
              style={{
                margin: '0 0 6px',
                fontSize: '1.0625rem',
                fontWeight: 800,
                color: '#1A1A2E',
                letterSpacing: '-0.3px',
              }}
            >
              상품 마스터 등록
            </h3>
            <p style={{ margin: '0 0 20px', fontSize: '0.8125rem', color: '#6B7280', lineHeight: 1.5 }}>
              신규 상품을 마스터에 등록합니다. 등록 후 동일 상품명의 항목에 자동 적용됩니다.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* 상품명 (readonly) */}
              <div>
                <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: '#374151', marginBottom: 5 }}>
                  상품명
                </label>
                <input
                  type="text"
                  value={registerForm.product_name}
                  readOnly
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    fontSize: '0.875rem',
                    border: '1px solid #E1E5EB',
                    borderRadius: 8,
                    outline: 'none',
                    color: '#6B7280',
                    backgroundColor: '#F9FAFB',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              {/* 종목코드 */}
              <div>
                <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: '#374151', marginBottom: 5 }}>
                  종목코드
                </label>
                <input
                  type="text"
                  placeholder="예: KR1234567890"
                  value={registerForm.product_code}
                  onChange={(e) => setRegisterForm((f) => ({ ...f, product_code: e.target.value }))}
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    fontSize: '0.875rem',
                    border: '1px solid #E1E5EB',
                    borderRadius: 8,
                    outline: 'none',
                    color: '#1A1A2E',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              {/* 위험도 */}
              <div>
                <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: '#374151', marginBottom: 5 }}>
                  위험도
                </label>
                <select
                  value={registerForm.risk_level}
                  onChange={(e) => setRegisterForm((f) => ({ ...f, risk_level: e.target.value }))}
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    fontSize: '0.875rem',
                    border: '1px solid #E1E5EB',
                    borderRadius: 8,
                    outline: 'none',
                    color: registerForm.risk_level ? '#1A1A2E' : '#9CA3AF',
                    backgroundColor: '#fff',
                    cursor: 'pointer',
                    boxSizing: 'border-box',
                  }}
                >
                  <option value="">선택</option>
                  {RISK_LEVELS.map((rl) => (
                    <option key={rl} value={rl}>{rl}</option>
                  ))}
                </select>
              </div>

              {/* 지역 */}
              <div>
                <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: '#374151', marginBottom: 5 }}>
                  지역
                </label>
                <select
                  value={registerForm.region}
                  onChange={(e) => setRegisterForm((f) => ({ ...f, region: e.target.value }))}
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    fontSize: '0.875rem',
                    border: '1px solid #E1E5EB',
                    borderRadius: 8,
                    outline: 'none',
                    color: registerForm.region ? '#1A1A2E' : '#9CA3AF',
                    backgroundColor: '#fff',
                    cursor: 'pointer',
                    boxSizing: 'border-box',
                  }}
                >
                  <option value="">선택</option>
                  {REGIONS.map((rg) => (
                    <option key={rg} value={rg}>{rg}</option>
                  ))}
                </select>
              </div>

              {/* 상품유형 */}
              <div>
                <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: '#374151', marginBottom: 5 }}>
                  상품유형
                </label>
                <input
                  type="text"
                  placeholder="예: ETF, 펀드, 채권 등"
                  value={registerForm.product_type}
                  onChange={(e) => setRegisterForm((f) => ({ ...f, product_type: e.target.value }))}
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    fontSize: '0.875rem',
                    border: '1px solid #E1E5EB',
                    borderRadius: 8,
                    outline: 'none',
                    color: '#1A1A2E',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 24 }}>
              <button
                onClick={() => setRegisterModalOpen(false)}
                style={{
                  padding: '9px 18px',
                  fontSize: '0.8125rem',
                  fontWeight: 600,
                  color: '#6B7280',
                  backgroundColor: '#F3F4F6',
                  border: 'none',
                  borderRadius: 8,
                  cursor: 'pointer',
                }}
              >
                취소
              </button>
              <button
                onClick={handleRegisterProduct}
                style={{
                  padding: '9px 18px',
                  fontSize: '0.8125rem',
                  fontWeight: 600,
                  color: '#FFFFFF',
                  backgroundColor: '#1E3A5F',
                  border: 'none',
                  borderRadius: 8,
                  cursor: 'pointer',
                }}
              >
                등록
              </button>
            </div>
          </div>
        </div>
      )}

      {/* spin animation */}
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>

      {/* Client Management Modal */}
      <ClientManagementModal
        isOpen={clientMgmtOpen}
        onClose={() => setClientMgmtOpen(false)}
        onClientAdded={loadClients}
      />

      {/* 상품 마스터 불러오기 모달 */}
      {loadMasterTarget && (() => {
        const searchLower = loadMasterSearch.toLowerCase();
        const targetName = loadMasterTarget.productName.toLowerCase();
        // 유사도 점수: 원래 상품명과 비슷한 순서대로
        const scored = productMasters.map((m) => {
          const name = m.product_name.toLowerCase();
          let score = 0;
          if (name === targetName) score = 100;
          else if (name.includes(targetName) || targetName.includes(name)) score = 80;
          else {
            // 공통 단어 수
            const words1 = targetName.split(/\s+/);
            const words2 = name.split(/\s+/);
            const common = words1.filter((w) => words2.some((w2) => w2.includes(w) || w.includes(w2))).length;
            score = common * 20;
          }
          return { ...m, score };
        });
        const filtered = scored
          .filter((m) => !searchLower || m.product_name.toLowerCase().includes(searchLower) || (m.product_code || '').toLowerCase().includes(searchLower))
          .sort((a, b) => b.score - a.score);

        return (
          <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)' }}
            onClick={(e) => { if (e.target === e.currentTarget) setLoadMasterTarget(null); }}>
            <div style={{ backgroundColor: '#fff', borderRadius: 14, padding: 24, width: '100%', maxWidth: 520, maxHeight: '70vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#1A1A2E' }}>상품 마스터에서 불러오기</h3>
                <button onClick={() => setLoadMasterTarget(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', padding: 4 }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
              <div style={{ marginBottom: 10, fontSize: '0.75rem', color: '#6B7280' }}>
                현재 상품명: <strong style={{ color: '#1A1A2E' }}>{loadMasterTarget.productName}</strong>
              </div>
              <input type="text" placeholder="상품명 또는 종목코드 검색..." value={loadMasterSearch}
                onChange={(e) => setLoadMasterSearch(e.target.value)}
                style={{ width: '100%', padding: '8px 10px', fontSize: '0.8125rem', border: '1px solid #E1E5EB', borderRadius: 8, outline: 'none', marginBottom: 10, boxSizing: 'border-box' }}
                autoFocus />
              <div style={{ flex: 1, overflowY: 'auto', border: '1px solid #E1E5EB', borderRadius: 8 }}>
                {filtered.length === 0 ? (
                  <div style={{ padding: 20, textAlign: 'center', color: '#9CA3AF', fontSize: '0.8125rem' }}>검색 결과 없음</div>
                ) : (
                  filtered.map((m) => (
                    <button key={m.id} type="button"
                      onClick={() => {
                        updateHoldingField(loadMasterTarget.snapshotId, loadMasterTarget.holdingId, {
                          productName: m.product_name,
                          productCode: m.product_code || '',
                          riskLevel: m.risk_level || '',
                          region: m.region || '',
                        });
                        setLoadMasterTarget(null);
                      }}
                      style={{
                        width: '100%', padding: '8px 12px', textAlign: 'left', border: 'none',
                        borderBottom: '1px solid #F3F4F6', cursor: 'pointer', backgroundColor: 'transparent',
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
                        transition: 'background-color 0.1s',
                      }}
                      onMouseEnter={(e) => { (e.currentTarget).style.backgroundColor = '#EEF2F7'; }}
                      onMouseLeave={(e) => { (e.currentTarget).style.backgroundColor = 'transparent'; }}>
                      <div>
                        <div style={{ fontSize: '0.8125rem', fontWeight: 500, color: '#1A1A2E' }}>{m.product_name}</div>
                        <div style={{ fontSize: '0.6875rem', color: '#9CA3AF', marginTop: 2 }}>
                          {m.product_code || '-'} | {m.risk_level || '-'} | {m.region || '-'}
                        </div>
                      </div>
                      {m.score >= 80 && (
                        <span style={{ fontSize: '0.625rem', padding: '2px 6px', backgroundColor: '#DCFCE7', color: '#16A34A', borderRadius: 4, fontWeight: 600, flexShrink: 0 }}>유사</span>
                      )}
                    </button>
                  ))
                )}
              </div>
              <div style={{ marginTop: 8, fontSize: '0.6875rem', color: '#9CA3AF', textAlign: 'right' }}>
                {filtered.length}개 상품
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
