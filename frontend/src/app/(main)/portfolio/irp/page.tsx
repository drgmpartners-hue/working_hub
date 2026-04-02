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
  unique_code?: string;
  memo?: string;
  phone?: string;
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
  totalDeposit?: number; /* 총입금액 (IRP/퇴직연금) */
  totalWithdrawal?: number; /* 총출금액 (IRP/퇴직연금) */
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
  rowIndex?: number; // index in rows[] for image cleanup
  depositAmount?: number;
  foreignDepositAmount?: number;
  totalAssets?: number;
  totalPurchase?: number;
  totalEvaluation?: number;
  totalReturn?: number;
  totalReturnRate?: number;
}

const RISK_LEVELS = ['절대안정형', '안정형', '안정성장형', '성장형', '절대성장형'];
const PRODUCT_TYPES = ['ETF', '펀드', '연금저축펀드', 'IRP펀드', 'MMF', '주식', '해외주식', '랩어카운트'];

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
    pension1: '연금저축',
    pension2: '연금저축',
  } as Record<string, string>)[t] || t;

function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

/** 고객명 표시: 이름(고유번호) | 최근저장일 */
function clientLabel(c: { name: string; unique_code?: string }, latestDate?: string): string {
  const base = c.unique_code ? `${c.name}(${c.unique_code})` : c.name;
  return latestDate ? `${base} | ${latestDate}` : base;
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

async function getClientAccountId(row: ClientRowData): Promise<string> {
  if (row.accountId) return row.accountId;
  if (!row.clientId) throw new Error('고객을 선택하세요.');

  // accountId가 비어있으면 서버에서 기존 계좌를 조회
  // 동일 이름의 다른 clientId에 계좌가 있을 수 있으므로 전체 고객에서 탐색
  const clientsRes = await fetch(`${API_URL}/api/v1/clients`, {
    headers: { ...authLib.getAuthHeader() },
  });
  if (!clientsRes.ok) throw new Error('고객 목록 조회 실패');
  const allClients: Array<{ id: string; name: string }> = await clientsRes.json();
  const targetClient = allClients.find((c) => c.id === row.clientId);
  const sameNameClients = targetClient
    ? allClients.filter((c) => c.name === targetClient.name)
    : [{ id: row.clientId, name: '' }];

  for (const c of sameNameClients) {
    const res = await fetch(`${API_URL}/api/v1/clients/${c.id}/accounts`, {
      headers: { ...authLib.getAuthHeader() },
    });
    if (res.ok) {
      const accounts: ClientAccount[] = await res.json();
      const match = accounts.find((a) => a.account_type === row.accountType);
      if (match) return match.id;
    }
  }
  throw new Error('계좌 정보가 없습니다. 계좌정보 관리에서 계좌를 먼저 등록하세요.');
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
  { key: 'history', label: '4. 내역관리' },
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
  productType: string; /* 상품유형 (ETF, 펀드 등) */
  isRow1: boolean; /* 예수금/자동운용상품 row */
  fullSell: boolean; /* 전액매도 체크 */
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
  clientLatestDates: Record<string, string>;
  clientSortByDate: boolean;
  setClientSortByDate: (v: boolean) => void;
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
  clientLatestDates,
  clientSortByDate,
  setClientSortByDate,
}: Tab2SectionProps) {
  /* ---- Area 1 local state ---- */
  const [t2DatePage, setT2DatePage] = useState(0);
  const [t2Summary, setT2Summary] = useState<Snapshot | null>(null);
  const T2_DATES_PER_PAGE = 10;
  const [t2ClientSearch, setT2ClientSearch] = useState('');

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
  const [t2NewMasterAutoAdd, setT2NewMasterAutoAdd] = useState(false); /* 상품추가 & 반영 모드 */
  const [t2MasterStockQuery, setT2MasterStockQuery] = useState('');
  const [t2MasterStockResults, setT2MasterStockResults] = useState<Array<{ code: string; name: string; nav: number; price: number; type: string }>>([]);
  const [t2MasterStockSearching, setT2MasterStockSearching] = useState(false);
  const t2MasterStockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ---- Row replace: which row to replace ---- */
  const [t2ReplaceRowId, setT2ReplaceRowId] = useState<string | null>(null);

  /* ---- Dr.GM 추천 포트폴리오 state ---- */
  interface DrGmRow {
    id: string;
    product_name: string;
    product_code: string;
    product_type: string;
    region: string;
    current_price: number;
    weight_pension: number;
    weight_irp: number;
    memo: string;
    seq: number;
  }
  const [drGmRows, setDrGmRows] = useState<DrGmRow[]>([]);
  const [drGmLoading, setDrGmLoading] = useState(false);
  const [drGmSaving, setDrGmSaving] = useState(false);
  const [drGmRefreshing, setDrGmRefreshing] = useState(false);
  const [drGmToast, setDrGmToast] = useState('');
  const [drGmProductSearch, setDrGmProductSearch] = useState('');
  const [drGmProductOpen, setDrGmProductOpen] = useState(false);
  const [drGmEditRowId, setDrGmEditRowId] = useState<string | null>(null); /* 상품 선택 대상 행 */
  const [drGmChecked, setDrGmChecked] = useState<Set<string>>(new Set());
  const [drGmAccountType, setDrGmAccountType] = useState<'pension' | 'irp'>('pension'); /* 연금저축/IRP 토글 */
  const [drGmMonthlyAmount, setDrGmMonthlyAmount] = useState<number>(0); /* 월적립금액 */
  const [drGmLumpSumAmount, setDrGmLumpSumAmount] = useState<number>(0); /* 거치금액 */
  const drGmRef = useRef<HTMLDivElement>(null);
  const [t2RebalChecked, setT2RebalChecked] = useState<Set<string>>(new Set());
  const [t2PriceRefreshing, setT2PriceRefreshing] = useState(false);

  /* ---- helpers ---- */
  const fmtNum = (n?: number | null) =>
    n != null ? n.toLocaleString('ko-KR') : '-';

  function showT2Toast(msg: string) {
    setT2Toast(msg);
    setTimeout(() => setT2Toast(''), 3000);
  }

  function showDrGmToast(msg: string) {
    setDrGmToast(msg);
    setTimeout(() => setDrGmToast(''), 3000);
  }

  /* ---- Dr.GM 추천 포트폴리오 functions ---- */
  async function loadDrGmPortfolio() {
    setDrGmLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/recommended-portfolio`, {
        headers: { ...authLib.getAuthHeader() },
      });
      if (res.ok) {
        const items = await res.json();
        setDrGmRows(items.map((it: DrGmRow) => ({
          id: it.id,
          product_name: it.product_name,
          product_code: it.product_code ?? '',
          product_type: it.product_type ?? '',
          region: it.region ?? '',
          current_price: it.current_price ?? 0,
          weight_pension: it.weight_pension != null ? parseFloat((it.weight_pension * 100).toFixed(2)) : 0,
          weight_irp: it.weight_irp != null ? parseFloat((it.weight_irp * 100).toFixed(2)) : 0,
          memo: it.memo ?? '',
          seq: it.seq ?? 0,
        })));
      }
    } catch { /* silent */ }
    finally { setDrGmLoading(false); }
  }

  async function saveDrGmPortfolio() {
    setDrGmSaving(true);
    try {
      const items = drGmRows.map((r, idx) => ({
        product_name: r.product_name,
        product_code: r.product_code || null,
        product_type: r.product_type || null,
        region: r.region || null,
        current_price: r.current_price || null,
        weight_pension: r.weight_pension > 0 ? r.weight_pension / 100 : null,
        weight_irp: r.weight_irp > 0 ? r.weight_irp / 100 : null,
        memo: r.memo || null,
        seq: idx,
      }));
      const res = await fetch(`${API_URL}/api/v1/recommended-portfolio`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
        body: JSON.stringify({ items }),
      });
      if (res.ok) {
        const saved = await res.json();
        setDrGmRows(saved.map((it: DrGmRow) => ({
          id: it.id,
          product_name: it.product_name,
          product_code: it.product_code ?? '',
          product_type: it.product_type ?? '',
          region: it.region ?? '',
          current_price: it.current_price ?? 0,
          weight_pension: it.weight_pension != null ? parseFloat((it.weight_pension * 100).toFixed(2)) : 0,
          weight_irp: it.weight_irp != null ? parseFloat((it.weight_irp * 100).toFixed(2)) : 0,
          memo: it.memo ?? '',
          seq: it.seq ?? 0,
        })));
        showDrGmToast('Dr.GM 추천 포트폴리오가 저장되었습니다.');
      } else {
        showDrGmToast('저장 실패');
      }
    } catch { showDrGmToast('저장 중 오류 발생'); }
    finally { setDrGmSaving(false); }
  }

  async function refreshDrGmPrices() {
    setDrGmRefreshing(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/recommended-portfolio/refresh-prices`, {
        method: 'POST',
        headers: { ...authLib.getAuthHeader() },
      });
      if (res.ok) {
        const items = await res.json();
        setDrGmRows(items.map((it: DrGmRow) => ({
          id: it.id,
          product_name: it.product_name,
          product_code: it.product_code ?? '',
          product_type: it.product_type ?? '',
          region: it.region ?? '',
          current_price: it.current_price ?? 0,
          weight_pension: it.weight_pension != null ? parseFloat((it.weight_pension * 100).toFixed(2)) : 0,
          weight_irp: it.weight_irp != null ? parseFloat((it.weight_irp * 100).toFixed(2)) : 0,
          memo: it.memo ?? '',
          seq: it.seq ?? 0,
        })));
        showDrGmToast('현재가가 갱신되었습니다.');
      } else {
        showDrGmToast('현재가 갱신 실패');
      }
    } catch { showDrGmToast('현재가 갱신 중 오류 발생'); }
    finally { setDrGmRefreshing(false); }
  }

  function addDrGmRow() {
    setDrGmRows((prev) => [...prev, {
      id: `__new__${Date.now()}`,
      product_name: '',
      product_code: '',
      product_type: '',
      region: '',
      current_price: 0,
      weight_pension: 0,
      weight_irp: 0,
      memo: '',
      seq: prev.length,
    }]);
  }

  function removeDrGmRow(id: string) {
    setDrGmRows((prev) => prev.filter((r) => r.id !== id));
  }

  function moveDrGmRow(id: string, dir: -1 | 1) {
    setDrGmRows((prev) => {
      const idx = prev.findIndex((r) => r.id === id);
      if (idx < 0) return prev;
      const target = idx + dir;
      if (target < 0 || target >= prev.length) return prev;
      const arr = [...prev];
      [arr[idx], arr[target]] = [arr[target], arr[idx]];
      return arr;
    });
  }

  function deleteCheckedDrGmRows() {
    if (drGmChecked.size === 0) return;
    setDrGmRows((prev) => prev.filter((r) => !drGmChecked.has(r.id)));
    setDrGmChecked(new Set());
  }

  function moveRebalRow(id: string, dir: -1 | 1) {
    setT2RebalRows((prev) => {
      const idx = prev.findIndex((r) => r.id === id);
      if (idx < 0) return prev;
      const target = idx + dir;
      if (target < 0 || target >= prev.length) return prev;
      const arr = [...prev];
      [arr[idx], arr[target]] = [arr[target], arr[idx]];
      return arr;
    });
  }

  function deleteCheckedRebalRows() {
    if (t2RebalChecked.size === 0) return;
    setT2RebalRows((prev) => {
      const filtered = prev.filter((r) => !t2RebalChecked.has(r.id));
      return recalcRebalRows(filtered);
    });
    setT2RebalChecked(new Set());
  }

  async function refreshRebalPrices() {
    setT2PriceRefreshing(true);
    try {
      const rows = t2RebalRows;
      let updated = 0;
      const newRows = await Promise.all(rows.map(async (r) => {
        if (r.isRow1) return r;
        if (!r.productCode) return r;
        if ((r.productType ?? '').includes('펀드')) return r;
        try {
          const res = await fetch(`${API_URL}/api/v1/stock-search/price/${r.productCode}`, {
            headers: { ...authLib.getAuthHeader() },
          });
          if (res.ok) {
            const data = await res.json();
            if (data.found) {
              const price = data.nav || data.price;
              if (price) {
                updated++;
                const cp = parseFloat(price);
                const shares = calcShares(r.sellBuy, cp, r.productType);
                return { ...r, currentPrice: cp, shares };
              }
            }
          }
        } catch { /* skip */ }
        return r;
      }));
      setT2RebalRows(newRows);
      showT2Toast(`${updated}개 상품의 현재가가 갱신되었습니다.`);
    } catch { showT2Toast('현재가 갱신 중 오류 발생'); }
    finally { setT2PriceRefreshing(false); }
  }

  function selectDrGmProduct(pm: ProductMaster) {
    if (!drGmEditRowId) return;
    setDrGmRows((prev) => prev.map((r) =>
      r.id !== drGmEditRowId ? r : {
        ...r,
        product_name: pm.product_name,
        product_code: pm.product_code ?? '',
        product_type: pm.product_type ?? '',
        region: pm.region ?? '',
      }
    ));
    setDrGmProductOpen(false);
    setDrGmEditRowId(null);
    setDrGmProductSearch('');
  }

  function applyDrGmToRebal() {
    if (t2RebalRows.length === 0) {
      showDrGmToast('먼저 수정 포트폴리오 데이터를 불러와 주세요.');
      return;
    }
    const accountType = t2SelectedAccount?.account_type ?? 'irp';
    const existingCodes = new Set(t2RebalRows.map((r) => r.productCode).filter(Boolean));
    let addedCount = 0;

    // 체크박스: 아무것도 안 체크 또는 모두 체크 → 전체 적용, 일부만 체크 → 체크된 것만
    const allChecked = drGmChecked.size === 0 || drGmChecked.size === drGmRows.length;
    const rowsToApply = allChecked ? drGmRows : drGmRows.filter((r) => drGmChecked.has(r.id));

    const newRows: RebalRow[] = [];
    for (const gm of rowsToApply) {
      if (!gm.product_name) continue;
      if (gm.product_code && existingCodes.has(gm.product_code)) continue;
      /* IRP → weight_irp, 연금저축(pension1/pension2) → weight_pension */
      const weight = accountType === 'irp' ? gm.weight_irp : gm.weight_pension;
      /* 상품 마스터에서 위험도 조회 */
      const master = productMasters.find((pm) => pm.product_name === gm.product_name || pm.product_code === gm.product_code);
      newRows.push({
        id: `__new__${Date.now()}_${addedCount}`,
        productName: gm.product_name,
        productCode: gm.product_code,
        riskLevel: master?.risk_level ?? '',
        region: gm.region || master?.region || '',
        quantity: 0,
        purchasePrice: 0,
        currentPrice: gm.current_price,
        purchaseAmount: 0,
        evaluationAmount: 0,
        returnAmount: 0,
        returnRate: 0,
        evalRatio: 0,
        rebalRatio: weight,
        rebalAmount: 0,
        sellBuy: 0,
        shares: 0,
        productType: gm.product_type,
        isRow1: false,
        fullSell: false,
      });
      addedCount++;
    }

    if (addedCount === 0) {
      showDrGmToast('추가할 신규 상품이 없습니다. (이미 동일 종목코드가 존재)');
      return;
    }

    setT2RebalRows((prev) => recalcRebalRows([...prev, ...newRows]));
    showDrGmToast(`${addedCount}개 상품이 수정 포트폴리오에 적용되었습니다.`);
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
      showT2Toast('날짜 데이터가 삭제되었습니다.');
    } catch {
      showT2Toast('삭제 중 오류가 발생했습니다.');
    } finally {
      setT2DateDeleting(false);
    }
  }

  function handleT2MasterStockSearch(query: string) {
    setT2MasterStockQuery(query);
    setT2NewMasterForm((prev) => ({ ...prev, product_name: query }));
    if (t2MasterStockTimer.current) clearTimeout(t2MasterStockTimer.current);
    if (!query.trim() || query.trim().length < 2) { setT2MasterStockResults([]); return; }
    t2MasterStockTimer.current = setTimeout(async () => {
      setT2MasterStockSearching(true);
      try {
        const res = await fetch(`${API_URL}/api/v1/stock-search?q=${encodeURIComponent(query)}&limit=10`, { headers: authLib.getAuthHeader() });
        if (res.ok) { const data = await res.json(); setT2MasterStockResults(data.results ?? []); }
      } catch { /* silent */ }
      finally { setT2MasterStockSearching(false); }
    }, 400);
  }

  function handleT2MasterStockSelect(item: { code: string; name: string }) {
    setT2NewMasterForm((prev) => ({ ...prev, product_name: item.name, product_code: item.code }));
    setT2MasterStockQuery(item.name);
    setT2MasterStockResults([]);
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

      if (t2NewMasterAutoAdd && activeSnapshot) {
        /* 상품추가 & 반영: 자동으로 행추가 */
        handleT2AddProductFromMaster(newMaster);
        setT2NewMasterAutoAdd(false);
        showT2Toast(`'${newMaster.product_name}' 상품이 등록 및 추가되었습니다.`);
      } else {
        /* Pre-fill search so user can immediately find and click the new product */
        setT2ProductSearch(newMaster.product_name);
        showT2Toast(`'${newMaster.product_name}' 상품이 등록되었습니다.`);
      }
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
          productType: pm.product_type ?? '',
        }
      )
    );
    setT2ReplaceRowId(null);
    setT2AddProductOpen(false);
    setT2ProductSearch('');
  }

  /* ---- Derived: unique clients (deduplicate by name, merge accounts) ---- */
  const uniqueClientsMap = new Map<string, { id: string; name: string; unique_code?: string; accounts: ClientAccount[] }>();
  for (const c of clients) {
    if (uniqueClientsMap.has(c.name)) {
      /* Merge accounts into existing entry */
      const existing = uniqueClientsMap.get(c.name)!;
      existing.accounts = [...existing.accounts, ...c.accounts];
    } else {
      uniqueClientsMap.set(c.name, { id: c.id, name: c.name, unique_code: c.unique_code, accounts: [...c.accounts] });
    }
  }
  const uniqueClients = Array.from(uniqueClientsMap.values()).sort((a, b) => {
    if (clientSortByDate) {
      const da = clientLatestDates[a.id] || '';
      const db_ = clientLatestDates[b.id] || '';
      if (da !== db_) return db_.localeCompare(da); // 최신순
      return a.name.localeCompare(b.name, 'ko');
    }
    return a.name.localeCompare(b.name, 'ko');
  });

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
      /* Enrich holdings with productMasters info */
      snap.holdings = snap.holdings.map((h) => {
        const master = productMasters.find((m) => m.product_name === h.product_name);
        if (master) {
          return {
            ...h,
            risk_level: h.risk_level || master.risk_level || undefined,
            region: h.region || master.region || undefined,
            product_code: h.product_code || master.product_code || undefined,
            product_type: master.product_type || h.product_type || undefined,
          };
        }
        return h;
      });
      setActiveSnapshot(snap);
      setT2ShowDetail(true);
      loadDrGmPortfolio();

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

      /* Load saved suggestion and apply weights */
      try {
        const sugRes = await fetch(`${API_URL}/api/v1/portfolios/suggestions/by-snapshot/${activeSnapshotId}`, {
          headers: { ...authLib.getAuthHeader() },
        });
        if (sugRes.ok) {
          const sug = await sugRes.json();
          const rawWeights: Record<string, unknown> = sug.suggested_weights ?? {};
          const prices: Record<string, number> = (rawWeights._prices as Record<string, number>) ?? {};
          // Remove _prices from weights map
          const cleanWeights: Record<string, number> = {};
          for (const [k, v] of Object.entries(rawWeights)) {
            if (k !== '_prices' && typeof v === 'number') cleanWeights[k] = v;
          }

          if (Object.keys(cleanWeights).length > 0) {
            setT2RebalRows((prev) => {
              // Apply weights to existing rows
              const updated = prev.map((r) => {
                if (r.id in cleanWeights) {
                  return { ...r, rebalRatio: parseFloat((cleanWeights[r.id] * 100).toFixed(2)) };
                }
                return r;
              });

              // Add new products (new:xxx keys) that aren't in existing rows
              const existingIds = new Set(prev.map((r) => r.id));
              const newRows: typeof prev = [];
              for (const [key, weight] of Object.entries(cleanWeights)) {
                if (key.startsWith('new:') && !existingIds.has(key)) {
                  const prodName = key.replace('new:', '');
                  const master = productMasters.find((m) => m.product_name === prodName);
                  const cPrice = prices[key] ?? 0;
                  newRows.push({
                    id: `__new_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                    productName: prodName,
                    productCode: master?.product_code ?? '',
                    riskLevel: master?.risk_level ?? '',
                    region: master?.region ?? '',
                    quantity: 0,
                    purchasePrice: 0,
                    currentPrice: cPrice,
                    purchaseAmount: 0,
                    evaluationAmount: 0,
                    returnAmount: 0,
                    returnRate: 0,
                    evalRatio: 0,
                    rebalRatio: parseFloat((weight * 100).toFixed(2)),
                    rebalAmount: 0,
                    sellBuy: 0,
                    shares: 0,
                    productType: master?.product_type ?? '',
                    isRow1: false,
                    fullSell: false,
                  });
                }
              }

              return recalcRebalRows([...updated, ...newRows]);
            });
          }
        }
      } catch {
        /* suggestion not found — use default zeros */
      }
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
      productType: row1Holding?.product_type ?? '',
      isRow1: true,
      fullSell: false,
    });

    /* Other rows */
    for (const h of otherHoldings) {
      const master = productMasters.find((m) => m.product_name === h.product_name);
      const pType = (master?.product_type || h.product_type || '').toLowerCase();
      const pName = (h.product_name || '').toLowerCase();
      const isFund = pType.includes('펀드') || pType.includes('신탁');
      // MMF, 정기예금, RP, CMA, 예수금 등 현금성 상품은 DB 값 직접 사용
      const isCashLike = pType.includes('mmf') || pType.includes('rp') || pType.includes('cma')
        || pName.includes('정기예금') || pName.includes('예수금') || pName.includes('자동운용상품')
        || pName.includes('mmf') || pName.includes('cma');
      const calcPurchAmt = isCashLike ? h.purchase_amount
        : (h.quantity != null && h.purchase_price != null)
          ? (isFund ? Math.ceil(h.quantity * h.purchase_price / 1000) : h.quantity * h.purchase_price)
          : h.purchase_amount;
      const calcEvalAmt = isCashLike ? h.evaluation_amount
        : (h.quantity != null && h.current_price != null)
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
        riskLevel: master?.risk_level ?? h.risk_level ?? '',
        region: master?.region ?? h.region ?? '',
        quantity: h.quantity ?? 0,
        purchasePrice: h.purchase_price ?? 0,
        currentPrice: h.current_price ?? (
          /* current_price가 없으면 평가금액/수량으로 역산 */
          h.quantity && h.quantity > 0 && evalAmt > 0
            ? (isFund ? Math.round(evalAmt * 1000 / h.quantity * 100) / 100 : Math.round(evalAmt / h.quantity * 100) / 100)
            : 0
        ),
        purchaseAmount: purchAmt,
        evaluationAmount: evalAmt,
        returnAmount: retAmt,
        returnRate: retRate,
        evalRatio,
        rebalRatio: 0,
        rebalAmount: 0,
        sellBuy: 0,
        shares: 0,
        productType: master?.product_type ?? h.product_type ?? '',
        isRow1: false,
        fullSell: false,
      });
    }

    setT2RebalRows(rows);
  }

  /** 좌수 계산: 펀드는 sellBuy*1000/기준가, 그 외는 sellBuy/기준가, 절대값 올림 후 부호 유지 */
  function calcShares(sellBuy: number, currentPrice: number, productType: string): number {
    if (currentPrice <= 0 || sellBuy === 0) return 0;
    const isFund = (productType ?? '').includes('펀드');
    const raw = isFund ? sellBuy * 1000 / currentPrice : sellBuy / currentPrice;
    return raw > 0 ? Math.ceil(raw) : -Math.ceil(Math.abs(raw));
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
      if (r.fullSell) {
        const sellBuy = -r.evaluationAmount;
        /* 전액매도 시 좌수는 잔고수량을 그대로 사용 (음수) */
        const shares = r.quantity > 0 ? -r.quantity : calcShares(sellBuy, r.currentPrice, r.productType);
        return { ...r, rebalRatio: 0, rebalAmount: 0, sellBuy, shares };
      }
      const rebalAmt = r.rebalRatio > 0
        ? Math.round(r.rebalRatio / 100 * totalEval)
        : r.rebalAmount;
      let sellBuy = rebalAmt - r.evaluationAmount;
      /* 소액 Sell/Buy 제거: |sellBuy| ≤ 10,000원이면 0으로 */
      if (Math.abs(sellBuy) <= 10000 && sellBuy !== 0) {
        sellBuy = 0;
      }
      const shares = calcShares(sellBuy, r.currentPrice, r.productType);
      return { ...r, rebalAmount: rebalAmt, sellBuy, shares };
    });

    /* For row1: rebalAmount = totalEval - sum(other rebalAmounts) → ensures sum(rebalAmt) = totalEval → sum(sellBuy) = 0 */
    const otherRebalAmtSum = updatedOtherRows.reduce((s, r) => s + r.rebalAmount, 0);
    const row1RebalRatio = parseFloat((100 - otherRebalRatioSum).toFixed(2));
    const row1RebalAmt = totalEval - otherRebalAmtSum;
    const row1SellBuy = row1RebalAmt - row1.evaluationAmount;
    const row1Shares = calcShares(row1SellBuy, row1.currentPrice, row1.productType);

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

  function handleT2FullSellToggle(id: string) {
    setT2RebalRows((prev) => {
      const updated = prev.map((r) =>
        r.id !== id ? r : { ...r, fullSell: !r.fullSell }
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
        const shares = calcShares(r.sellBuy, cp, r.productType);
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
      productType: pm.product_type ?? '',
      isRow1: false,
      fullSell: false,
    };
    setT2RebalRows((prev) => recalcRebalRows([...prev, newRow]));
    setT2AddProductOpen(false);
    setT2ProductSearch('');
  }

  async function handleT2SaveRebal() {
    if (!activeSnapshotId || !histAccountId) return;

    /* 저장 전 현재가 자동 갱신 (ETF/주식만) */
    showT2Toast('현재가 갱신 중...');
    try {
      let priceUpdated = 0;
      const refreshedRows = await Promise.all(t2RebalRows.map(async (r) => {
        if (r.isRow1 || !r.productCode || (r.productType ?? '').includes('펀드')) return r;
        try {
          const res = await fetch(`${API_URL}/api/v1/stock-search/price/${r.productCode}`, {
            headers: { ...authLib.getAuthHeader() },
          });
          if (res.ok) {
            const data = await res.json();
            if (data.found) {
              const price = data.nav || data.price;
              if (price) {
                priceUpdated++;
                const cp = parseFloat(price);
                const shares = calcShares(r.sellBuy, cp, r.productType);
                return { ...r, currentPrice: cp, shares };
              }
            }
          }
        } catch { /* skip */ }
        return r;
      }));
      setT2RebalRows(refreshedRows);
      if (priceUpdated > 0) showT2Toast(`${priceUpdated}개 현재가 갱신 완료. 저장 중...`);
    } catch { /* 갱신 실패해도 저장은 진행 */ }

    /* 절대안정형 자산 합계 30% 미만 경고 — IRP/퇴직연금 계좌만 해당 */
    const saveAccountType = t2SelectedAccount?.account_type ?? 'irp';
    const isIrpOrRetirement = saveAccountType === 'irp';
    if (isIrpOrRetirement) {
      const safeRatioSum = t2RebalRows
        .filter((r) => r.riskLevel === '절대안정형')
        .reduce((s, r) => s + r.rebalRatio, 0);
      /* 예수금(row1)도 절대안정형에 포함 */
      const row1 = t2RebalRows.find((r) => r.isRow1);
      const row1Ratio = row1 ? (100 - t2RebalRows.filter((r) => !r.isRow1).reduce((s, r) => s + r.rebalRatio, 0)) : 0;
      const totalSafeRatio = safeRatioSum + row1Ratio;
      if (totalSafeRatio < 30) {
        const proceed = window.confirm(
          `⚠️ 경고: 절대안정형 자산의 재조정 비중 합계가 ${totalSafeRatio.toFixed(2)}%로 30% 미만입니다.\n\n안정적인 포트폴리오 운용을 위해 절대안정형 자산(예수금 포함)이 30% 이상이어야 합니다.\n\n그래도 저장하시겠습니까?`
        );
        if (!proceed) return;
      }
    }

    setT2RebalSaving(true);
    try {
      const rows = t2RebalRows;
      const totalEval = rows.reduce((s, rr) => s + rr.evaluationAmount, 0);
      const suggested_weights: Record<string, number> = {};
      const suggested_prices: Record<string, number> = {};
      for (const r of rows) {
        const key = r.id.startsWith('__') ? `new:${r.productName}` : r.id;
        suggested_weights[key] = totalEval > 0 ? r.rebalRatio / 100 : 0;
        if (r.currentPrice > 0) suggested_prices[key] = r.currentPrice;
      }

      // 전체 테이블 데이터 저장 (3번탭, 포털에서 그대로 사용)
      const fullTable = rows.map((r, idx) => ({
        seq: idx + 1,
        product_name: r.productName,
        product_code: r.productCode,
        product_type: r.productType || '',
        risk_level: r.riskLevel || '',
        region: r.region || '',
        quantity: r.quantity,
        reference_price: r.currentPrice,
        purchase_amount: r.purchaseAmount,
        evaluation_amount: r.evaluationAmount,
        return_amount: r.returnAmount,
        return_rate: r.returnRate,
        eval_ratio: r.evalRatio,
        rebal_ratio: r.rebalRatio,
        rebal_amount: r.rebalAmount,
        sell_buy: r.sellBuy,
        shares: r.shares,
        is_new: r.id.startsWith('__'),
        is_deposit: r.isRow1,
        full_sell: r.fullSell,
      }));

      const res = await fetch(`${API_URL}/api/v1/portfolios/suggestions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authLib.getAuthHeader(),
        },
        body: JSON.stringify({
          account_id: histAccountId,
          snapshot_id: activeSnapshotId,
          suggested_weights: { ...suggested_weights, _prices: suggested_prices, _full_table: fullTable },
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showT2Toast(`저장 실패: ${err?.detail || '알 수 없는 오류'}`);
        return;
      }
      showT2Toast('리밸런싱 제안이 저장되었습니다.');

      // 내역관리 기록 저장 (포트폴리오 수정 저장)
      try {
        const clientObj = clients.find((c) => c.id === histClientId);
        const acctObj = t2ClientAccounts.find((a) => a.id === histAccountId);
        const summaryParts = t2RebalRows
          .filter((r) => !r.isRow1 && r.rebalRatio > 0)
          .slice(0, 5)
          .map((r) => `${r.productName} ${r.rebalRatio.toFixed(1)}%`);
        const summary = `[포트폴리오 수정] ${clientObj?.name ?? ''} ${accountTypeLabel(acctObj?.account_type ?? 'irp')} - ${summaryParts.join(', ')}${t2RebalRows.length > 6 ? ' 외' : ''}`;

        const logForm = new FormData();
        logForm.append('client_id', histClientId);
        if (histAccountId) logForm.append('client_account_id', histAccountId);
        logForm.append('message_type', 'portfolio_save');
        logForm.append('message_summary', summary.slice(0, 200));
        logForm.append('message_text', summary);
        logForm.append('sent_at', new Date().toISOString());

        await fetch(`${API_URL}/api/v1/message-logs`, {
          method: 'POST',
          headers: { ...authLib.getAuthHeader() },
          body: logForm,
        });
      } catch { /* 기록 저장 실패해도 무시 */ }
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
    verticalAlign: 'middle',
    backgroundColor: '#F5F7FA',
    borderBottom: '1px solid #E1E5EB',
    whiteSpace: 'nowrap',
  };
  const tdStyle: React.CSSProperties = {
    padding: '8px 10px',
    fontSize: '0.8125rem',
    color: '#374151',
    textAlign: 'right',
    verticalAlign: 'middle',
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
    const m = productMasters.find((pm) => pm.product_name === h.product_name);
    const isFund = (m?.product_type || h.product_type || '').includes('펀드');
    const hasQP = h.quantity != null && h.purchase_price != null && h.quantity > 0 && h.purchase_price > 0;
    if (hasQP) return s + (isFund ? Math.ceil(h.quantity! * h.purchase_price! / 1000) : h.quantity! * h.purchase_price!);
    return s + (h.purchase_amount ?? 0);
  }, 0);
  const detailTotalEval = detailHoldings.reduce((s, h) => {
    const m = productMasters.find((pm) => pm.product_name === h.product_name);
    const isFund = (m?.product_type || h.product_type || '').includes('펀드');
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

        {/* Row 1: search + client + account type */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}>
          {/* 고객 검색 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 140 }}>
            <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#374151' }}>고객 검색</label>
            <div style={{ position: 'relative' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2"
                style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text"
                placeholder="이름/고유번호"
                value={t2ClientSearch}
                onChange={(e) => setT2ClientSearch(e.target.value)}
                style={{ width: '100%', padding: '8px 10px 8px 28px', fontSize: '0.8125rem', border: '1px solid #E1E5EB', borderRadius: 8, outline: 'none', color: '#1A1A2E', boxSizing: 'border-box' }}
              />
            </div>
          </div>

          {/* 고객 선택 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 220, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#374151' }}>고객 선택</label>
              <button
                onClick={() => setClientSortByDate(!clientSortByDate)}
                title={clientSortByDate ? '이름순으로 전환' : '저장일순으로 전환 (저장일 = 데이터 입력 최신일)'}
                style={{ padding: '2px 6px', fontSize: '0.6875rem', fontWeight: 600, color: clientSortByDate ? '#fff' : '#6B7280', backgroundColor: clientSortByDate ? '#1E3A5F' : '#F3F4F6', border: '1px solid #D1D5DB', borderRadius: 4, cursor: 'pointer' }}
              >
                {clientSortByDate ? '저장일순' : '이름순'}
              </button>
            </div>
            <select
              value={histClientId}
              onChange={(e) => { handleT2ClientChange(e.target.value); setT2ClientSearch(''); }}
              style={{ padding: '8px 10px', fontSize: '0.8125rem', border: '1px solid #E1E5EB', borderRadius: 8, outline: 'none', color: histClientId ? '#1A1A2E' : '#9CA3AF', backgroundColor: '#fff', cursor: 'pointer' }}
            >
              <option value="">-- 고객 선택 --</option>
              {uniqueClients
                .filter((c) => {
                  if (!t2ClientSearch.trim()) return true;
                  const q = t2ClientSearch.trim().toLowerCase();
                  return c.name.toLowerCase().includes(q) || (c.unique_code ?? '').includes(q);
                })
                .map((c) => (
                  <option key={c.name} value={c.id}>{clientLabel(c, clientLatestDates[c.id])}</option>
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
                  data-tooltip="날짜 편집/삭제"
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
                          border: `1px solid ${isActive ? '#1E3A5F' : (item as any).has_suggestion ? '#3B82F6' : '#E1E5EB'}`,
                          backgroundColor: isActive ? '#EEF2F7' : (item as any).has_suggestion ? '#EFF6FF' : '#fff',
                          cursor: 'pointer', transition: 'all 0.15s ease',
                          fontWeight: isActive ? 700 : 500, fontSize: '0.8125rem', color: '#1A1A2E',
                        }}
                      >
                        {(item as any).has_suggestion && (
                          <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#3B82F6', flexShrink: 0 }} />
                        )}
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
                {!t2SelectedAccount?.account_type?.startsWith('pension') ? (
                  /* IRP: 5개 항목 */
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
                    {[
                      { label: '조회일', value: t2Summary.snapshot_date },
                      { label: '평가금액', value: fmtNum(t2Summary.total_evaluation) },
                      { label: '평가손익', value: t2Summary.total_return != null ? `${t2Summary.total_return > 0 ? '+' : ''}${t2Summary.total_return.toLocaleString('ko-KR')}` : '-', color: rateColor(t2Summary.total_return) },
                      { label: '수익률', value: t2Summary.total_return_rate != null ? `${t2Summary.total_return_rate > 0 ? '+' : ''}${t2Summary.total_return_rate.toFixed(2)}%` : '-', color: rateColor(t2Summary.total_return_rate) },
                      { label: '상품 갯수', value: `${t2Summary.holdings.length}개` },
                    ].map(({ label, value, color }) => (
                      <div key={label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                        <span style={{ fontSize: '0.6875rem', color: '#6B7280', fontWeight: 500 }}>{label}</span>
                        <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: color ?? '#1A1A2E' }}>{value}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  /* 연금저축: 기존 8개 항목 */
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 10 }}>
                    {[
                      { label: '조회일', value: t2Summary.snapshot_date },
                      { label: '예수금', value: fmtNum(t2Summary.deposit_amount) },
                      { label: '총자산', value: fmtNum(t2Summary.total_assets) },
                      { label: '매입금액', value: fmtNum(t2Summary.total_purchase) },
                      { label: '평가금액', value: fmtNum(t2Summary.total_evaluation) },
                      { label: '평가손익', value: t2Summary.total_return != null ? `${t2Summary.total_return > 0 ? '+' : ''}${t2Summary.total_return.toLocaleString('ko-KR')}` : '-', color: rateColor(t2Summary.total_return) },
                      { label: '총수익률', value: t2Summary.total_return_rate != null ? `${t2Summary.total_return_rate > 0 ? '+' : ''}${t2Summary.total_return_rate.toFixed(2)}%` : '-', color: rateColor(t2Summary.total_return_rate) },
                      { label: '상품 갯수', value: `${t2Summary.holdings.length}개` },
                    ].map(({ label, value, color }) => (
                      <div key={label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                        <span style={{ fontSize: '0.6875rem', color: '#6B7280', fontWeight: 500 }}>{label}</span>
                        <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: color ?? '#1A1A2E' }}>{value}</span>
                      </div>
                    ))}
                  </div>
                )}
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
                data-tooltip="선택한 날짜의 포트폴리오 상세 데이터, 차트, 수정 포트폴리오를 불러옵니다."
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
              {/* ---- 연금저축: Summary bar ---- */}
              {t2SelectedAccount?.account_type !== 'irp' && (
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
              )}

              {/* ---- Holdings table ---- */}
              <div style={{ overflowX: 'scroll', border: '1px solid #E1E5EB', borderRadius: 8 }}>
                <table style={{ borderCollapse: 'collapse', fontSize: '0.8125rem', minWidth: !t2SelectedAccount?.account_type?.startsWith('pension') ? 1000 : 1100 }}>
                  <thead>
                    <tr style={{ backgroundColor: '#F5F7FA' }}>
                      <th style={{ ...thStyle, position: 'sticky', left: 0, zIndex: 2, background: '#F5F7FA', textAlign: 'center', minWidth: 36 }}>No.</th>
                      <th style={{ ...thStyle, position: 'sticky', left: 36, zIndex: 2, background: '#F5F7FA', textAlign: 'center', minWidth: 68, borderRight: '2px solid #E1E5EB' }}>상품유형</th>
                      <th style={{ ...thStyle, position: 'sticky', left: 104, zIndex: 2, background: '#F5F7FA', textAlign: 'left', minWidth: 300, borderRight: '2px solid #E1E5EB' }}>상품명</th>
                      {!t2SelectedAccount?.account_type?.startsWith('pension') ? (
                        <>
                          <th style={thStyle}>수량</th>
                          <th style={thStyle}>기준가</th>
                          <th style={thStyle}>평가금액</th>
                          <th style={thStyle}>매입금액</th>
                          <th style={thStyle}>총입금액</th>
                          <th style={thStyle}>총출금액</th>
                          <th style={thStyle}>평가손익</th>
                          <th style={thStyle}>수익률</th>
                        </>
                      ) : (
                        <>
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
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {detailHoldings.map((h, idx) => {
                      const masterForH = productMasters.find((m) => m.product_name === h.product_name);
                      const isFund = (masterForH?.product_type || h.product_type || '').includes('펀드');
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
                          {!t2SelectedAccount?.account_type?.startsWith('pension') ? (
                            <>
                              <td style={tdStyle}>{fmtNum(h.quantity)}</td>
                              <td style={tdStyle}>{fmtNum(h.current_price)}</td>
                              <td style={{ ...tdStyle, fontWeight: 500 }}>{fmtNum(displayEvalAmt)}</td>
                              <td style={tdStyle}>{fmtNum(displayPurchAmt)}</td>
                              <td style={tdStyle}>{fmtNum((h as any).total_deposit)}</td>
                              <td style={tdStyle}>{fmtNum((h as any).total_withdrawal)}</td>
                              <td style={{ ...tdStyle, color: rateColor(calcReturnAmt), fontWeight: calcReturnAmt != null && calcReturnAmt !== 0 ? 500 : undefined }}>
                                {calcReturnAmt != null ? `${calcReturnAmt > 0 ? '+' : ''}${calcReturnAmt.toLocaleString('ko-KR')}` : '-'}
                              </td>
                              <td style={{ ...tdStyle, color: rateColor(calcReturnRate), fontWeight: 600 }}>
                                {calcReturnRate != null ? `${calcReturnRate > 0 ? '+' : ''}${calcReturnRate.toFixed(2)}%` : '-'}
                              </td>
                            </>
                          ) : (
                            <>
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
                            </>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{ backgroundColor: '#F5F7FA' }}>
                      <td style={{ ...totalRowStyle, position: 'sticky', left: 0, zIndex: 1, background: '#F5F7FA' }} />
                      <td style={{ ...totalRowStyle, position: 'sticky', left: 36, zIndex: 1, background: '#F5F7FA', borderRight: '2px solid #E1E5EB' }} />
                      <td style={{ ...totalRowStyle, position: 'sticky', left: 104, zIndex: 1, background: '#F5F7FA', textAlign: 'left', borderRight: '2px solid #E1E5EB' }}>합계</td>
                      {!t2SelectedAccount?.account_type?.startsWith('pension') ? (
                        <>
                          <td style={totalRowStyle} />
                          <td style={totalRowStyle} />
                          <td style={totalRowStyle}>{fmtNum(detailTotalEval)}</td>
                          <td style={totalRowStyle}>{fmtNum(detailTotalPurch)}</td>
                          <td style={totalRowStyle} />
                          <td style={totalRowStyle} />
                          <td style={{ ...totalRowStyle, color: rateColor(detailTotalReturn) }}>
                            {detailTotalReturn !== 0 ? `${detailTotalReturn > 0 ? '+' : ''}${detailTotalReturn.toLocaleString('ko-KR')}` : '0'}
                          </td>
                          <td style={{ ...totalRowStyle, color: rateColor(detailTotalReturnRate) }}>
                            {detailTotalReturnRate > 0 ? '+' : ''}{detailTotalReturnRate.toFixed(2)}%
                          </td>
                        </>
                      ) : (
                        <>
                          <td style={totalRowStyle}>-</td>
                          <td style={totalRowStyle}>-</td>
                          <td style={totalRowStyle}>-</td>
                          <td style={totalRowStyle}>-</td>
                          <td style={totalRowStyle}>-</td>
                          <td style={totalRowStyle} />
                          <td style={totalRowStyle}>{fmtNum(detailTotalPurch)}</td>
                          <td style={totalRowStyle}>{fmtNum(detailTotalEval)}</td>
                          <td style={{ ...totalRowStyle, color: rateColor(detailTotalReturn) }}>
                            {detailTotalReturn !== 0 ? `${detailTotalReturn > 0 ? '+' : ''}${detailTotalReturn.toLocaleString('ko-KR')}` : '0'}
                          </td>
                          <td style={{ ...totalRowStyle, color: rateColor(detailTotalReturnRate) }}>
                            {detailTotalReturnRate > 0 ? '+' : ''}{detailTotalReturnRate.toFixed(2)}%
                          </td>
                        </>
                      )}
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
      {/* Area 4.5: Dr.GM 추천 포트폴리오 (전 고객 공통)                */}
      {/* ============================================================ */}
      {t2ShowDetail && (
        <div style={cardStyle} ref={drGmRef}>
          {/* 헤더 1열: 제목 + 토글 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, paddingBottom: 8, borderBottom: '1px solid #E1E5EB' }}>
            <div style={{ width: 3, height: 18, borderRadius: 2, backgroundColor: '#F59E0B', flexShrink: 0 }} />
            <span style={sectionTitleStyle}>Dr.GM 추천 포트폴리오</span>
            {/* 연금저축/IRP 토글 */}
            <div style={{ marginLeft: 'auto', display: 'flex', borderRadius: 6, overflow: 'hidden', border: '1px solid #E1E5EB' }}>
              <button onClick={() => setDrGmAccountType('pension')}
                style={{ padding: '5px 14px', fontSize: '0.75rem', fontWeight: 600, border: 'none', cursor: 'pointer',
                  backgroundColor: drGmAccountType === 'pension' ? '#F59E0B' : '#fff',
                  color: drGmAccountType === 'pension' ? '#fff' : '#6B7280' }}>
                연금저축
              </button>
              <button onClick={() => setDrGmAccountType('irp')}
                style={{ padding: '5px 14px', fontSize: '0.75rem', fontWeight: 600, border: 'none', cursor: 'pointer',
                  backgroundColor: drGmAccountType === 'irp' ? '#1E3A5F' : '#fff',
                  color: drGmAccountType === 'irp' ? '#fff' : '#6B7280' }}>
                IRP
              </button>
            </div>
            {/* 월적립금액 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 16 }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151', whiteSpace: 'nowrap' }}>월적립</span>
              <input type="number" value={drGmMonthlyAmount || ''} onChange={(e) => setDrGmMonthlyAmount(parseInt(e.target.value) || 0)}
                placeholder="0" style={{ width: 90, padding: '4px 6px', fontSize: '0.8125rem', textAlign: 'right', border: '1px solid #E1E5EB', borderRadius: 5, outline: 'none' }} />
              <span style={{ fontSize: '0.7rem', color: '#9CA3AF' }}>원</span>
            </div>
            {/* 거치금액 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151', whiteSpace: 'nowrap' }}>거치</span>
              <input type="number" value={drGmLumpSumAmount || ''} onChange={(e) => setDrGmLumpSumAmount(parseInt(e.target.value) || 0)}
                placeholder="0" style={{ width: 100, padding: '4px 6px', fontSize: '0.8125rem', textAlign: 'right', border: '1px solid #E1E5EB', borderRadius: 5, outline: 'none' }} />
              <span style={{ fontSize: '0.7rem', color: '#9CA3AF' }}>원</span>
            </div>
          </div>
          {/* 헤더 2열: 버튼들 */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <button onClick={refreshDrGmPrices} disabled={drGmRefreshing}
              style={{ padding: '6px 14px', fontSize: '0.8125rem', fontWeight: 600, color: '#374151', backgroundColor: '#FEF3C7', border: '1px solid #FCD34D', borderRadius: 7, cursor: drGmRefreshing ? 'not-allowed' : 'pointer', opacity: drGmRefreshing ? 0.6 : 1 }}>
              {drGmRefreshing ? '갱신 중...' : '현재가 갱신'}
            </button>
            <button onClick={addDrGmRow}
              style={{ padding: '6px 14px', fontSize: '0.8125rem', fontWeight: 600, color: '#1E3A5F', backgroundColor: '#EEF2F7', border: '1px solid #C7D2E2', borderRadius: 7, cursor: 'pointer' }}>
              + 행추가
            </button>
            <button onClick={deleteCheckedDrGmRows} disabled={drGmChecked.size === 0}
              style={{ padding: '6px 14px', fontSize: '0.8125rem', fontWeight: 600, color: drGmChecked.size > 0 ? '#EF4444' : '#9CA3AF', backgroundColor: '#fff', border: `1px solid ${drGmChecked.size > 0 ? '#FECACA' : '#E1E5EB'}`, borderRadius: 7, cursor: drGmChecked.size > 0 ? 'pointer' : 'not-allowed' }}>
              삭제 ({drGmChecked.size})
            </button>
            <button onClick={saveDrGmPortfolio} disabled={drGmSaving}
              style={{ padding: '6px 14px', fontSize: '0.8125rem', fontWeight: 700, color: '#fff', backgroundColor: drGmSaving ? '#9CA3AF' : '#F59E0B', border: 'none', borderRadius: 7, cursor: drGmSaving ? 'not-allowed' : 'pointer' }}>
              {drGmSaving ? '저장 중...' : '저장'}
            </button>
            <button onClick={applyDrGmToRebal}
              style={{ padding: '6px 14px', fontSize: '0.8125rem', fontWeight: 700, color: '#fff', backgroundColor: '#1E3A5F', border: 'none', borderRadius: 7, cursor: 'pointer' }}>
              수정 포트폴리오 적용 ↓
            </button>
            <button onClick={async () => {
              if (!drGmRef.current) return;
              const html2canvas = (await import('html2canvas')).default;
              const canvas = await html2canvas(drGmRef.current, { scale: 2, width: drGmRef.current.scrollWidth });
              const link = document.createElement('a');
              link.download = `DrGM_추천포트폴리오_${drGmAccountType === 'pension' ? '연금저축' : 'IRP'}.png`;
              link.href = canvas.toDataURL('image/png');
              link.click();
            }}
              style={{ padding: '6px 14px', fontSize: '0.8125rem', fontWeight: 600, color: '#059669', backgroundColor: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: 7, cursor: 'pointer' }}>
              이미지 다운로드
            </button>
          </div>

          {drGmLoading ? (
            <div style={{ padding: 20, textAlign: 'center', color: '#9CA3AF' }}>불러오는 중...</div>
          ) : (
            <div style={{ overflowX: 'auto', border: '1px solid #E1E5EB', borderRadius: 8 }}>
              <table style={{ borderCollapse: 'collapse', fontSize: '0.8125rem', minWidth: 1100, width: '100%' }} className="drgm-table">
                <style>{`.drgm-table td, .drgm-table th { vertical-align: middle !important; }`}</style>
                <thead>
                  <tr style={{ backgroundColor: '#FFFBEB' }}>
                    <th style={{ ...thStyle, backgroundColor: '#FFFBEB', textAlign: 'center', minWidth: 36, position: 'sticky', left: 0, zIndex: 2 }}>No.</th>
                    <th style={{ ...thStyle, backgroundColor: '#FFFBEB', textAlign: 'left', minWidth: 220, position: 'sticky', left: 36, zIndex: 2, borderRight: '2px solid #E1E5EB' }}>상품명</th>
                    <th style={{ ...thStyle, backgroundColor: '#FFFBEB', minWidth: 80 }}>종목코드</th>
                    <th style={{ ...thStyle, backgroundColor: '#FFFBEB', minWidth: 80 }}>현재가</th>
                    <th style={{ ...thStyle, backgroundColor: '#F59E0B', color: '#fff', minWidth: 90 }}>비중(연금저축)</th>
                    <th style={{ ...thStyle, backgroundColor: '#1E3A5F', color: '#fff', minWidth: 100 }}>비중(IRP/퇴직연금)</th>
                    <th style={{ ...thStyle, backgroundColor: '#ECFDF5', minWidth: 90 }}>월적립투자</th>
                    <th style={{ ...thStyle, backgroundColor: '#DBEAFE', minWidth: 80 }}>거치투자</th>
                    <th style={{ ...thStyle, backgroundColor: '#DBEAFE', minWidth: 80 }}>구매좌수(거치)</th>
                    <th style={{ ...thStyle, backgroundColor: '#FFFBEB', textAlign: 'left', minWidth: 90 }}>비고</th>
                    <th style={{ ...thStyle, backgroundColor: '#FFFBEB', textAlign: 'center', minWidth: 36 }}>
                      <input type="checkbox" checked={drGmRows.length > 0 && drGmChecked.size === drGmRows.length}
                        onChange={(e) => { if (e.target.checked) setDrGmChecked(new Set(drGmRows.map((r) => r.id))); else setDrGmChecked(new Set()); }}
                        style={{ width: 14, height: 14, cursor: 'pointer' }} />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {drGmRows.length === 0 && (
                    <tr><td colSpan={12} style={{ padding: 20, textAlign: 'center', color: '#9CA3AF' }}>등록된 추천 상품이 없습니다. [+ 행추가] 버튼으로 추가하세요.</td></tr>
                  )}
                  {drGmRows.map((r, idx) => {
                    const weight = drGmAccountType === 'pension' ? r.weight_pension : r.weight_irp;
                    const monthlyInv = drGmMonthlyAmount > 0 ? Math.floor(drGmMonthlyAmount * weight / 100 / 1000) * 1000 : 0;
                    const lumpInv = drGmLumpSumAmount > 0 ? Math.floor(drGmLumpSumAmount * weight / 100 / 1000) * 1000 : 0;
                    const lumpShares = lumpInv > 0 && r.current_price > 0 ? Math.floor(lumpInv / r.current_price) : 0;
                    return (
                    <tr key={r.id} style={{ transition: 'background-color 0.1s' }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLTableRowElement).style.backgroundColor = '#FFFBEB'; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLTableRowElement).style.backgroundColor = 'transparent'; }}>
                      <td style={{ ...tdStyle, textAlign: 'center', color: '#9CA3AF', position: 'sticky', left: 0, backgroundColor: '#fff', zIndex: 1 }}>{idx + 1}</td>
                      <td style={{ ...tdStyle, textAlign: 'left', padding: '5px 8px', whiteSpace: 'normal', wordBreak: 'keep-all', position: 'sticky', left: 36, backgroundColor: '#fff', zIndex: 1, borderRight: '2px solid #E1E5EB' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 0, flexShrink: 0 }}>
                            <button type="button" onClick={() => moveDrGmRow(r.id, -1)} disabled={idx === 0}
                              style={{ background: 'none', border: 'none', cursor: idx === 0 ? 'default' : 'pointer', padding: 0, lineHeight: 1, color: idx === 0 ? '#D1D5DB' : '#6B7280', fontSize: '0.625rem' }}>▲</button>
                            <button type="button" onClick={() => moveDrGmRow(r.id, 1)} disabled={idx === drGmRows.length - 1}
                              style={{ background: 'none', border: 'none', cursor: idx === drGmRows.length - 1 ? 'default' : 'pointer', padding: 0, lineHeight: 1, color: idx === drGmRows.length - 1 ? '#D1D5DB' : '#6B7280', fontSize: '0.625rem' }}>▼</button>
                          </div>
                          <div style={{ flex: 1 }}>
                            {r.product_name ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                <span style={{ fontWeight: 500, color: '#1A1A2E' }}>{r.product_name}</span>
                                <button type="button" onClick={() => { setDrGmEditRowId(r.id); setDrGmProductSearch(''); setDrGmProductOpen(true); }}
                                  style={{ padding: '2px 4px', border: '1px solid #C7D2E2', borderRadius: 4, backgroundColor: '#EEF2F7', cursor: 'pointer', color: '#1E3A5F', flexShrink: 0 }}>
                                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38"/>
                                  </svg>
                                </button>
                              </div>
                            ) : (
                              <button type="button" onClick={() => { setDrGmEditRowId(r.id); setDrGmProductSearch(''); setDrGmProductOpen(true); }}
                                style={{ padding: '4px 10px', fontSize: '0.75rem', color: '#6B7280', backgroundColor: '#F3F4F6', border: '1px dashed #D1D5DB', borderRadius: 5, cursor: 'pointer' }}>
                                상품 선택...
                              </button>
                            )}
                          </div>
                        </div>
                      </td>
                      <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: '0.75rem', color: '#6B7280' }}>{r.product_code || '-'}</td>
                      <td style={tdStyle}>{r.current_price > 0 ? r.current_price.toLocaleString('ko-KR') : '-'}</td>
                      <td style={{ ...tdStyle, padding: '5px 8px', backgroundColor: drGmAccountType === 'pension' ? '#FEF9C3' : undefined }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                          <input type="number" step="0.01" min="0" max="100" value={r.weight_pension || ''}
                            onChange={(e) => { const v = parseFloat(e.target.value); setDrGmRows((prev) => prev.map((rr) => rr.id !== r.id ? rr : { ...rr, weight_pension: isNaN(v) ? 0 : v })); }}
                            style={{ width: 55, padding: '4px 6px', fontSize: '0.8125rem', textAlign: 'right', border: '1px solid #FCD34D', borderRadius: 5, outline: 'none' }} />
                          <span style={{ fontSize: '0.75rem', color: '#6B7280' }}>%</span>
                        </div>
                      </td>
                      <td style={{ ...tdStyle, padding: '5px 8px', backgroundColor: drGmAccountType === 'irp' ? '#DBEAFE' : undefined }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                          <input type="number" step="0.01" min="0" max="100" value={r.weight_irp || ''}
                            onChange={(e) => { const v = parseFloat(e.target.value); setDrGmRows((prev) => prev.map((rr) => rr.id !== r.id ? rr : { ...rr, weight_irp: isNaN(v) ? 0 : v })); }}
                            style={{ width: 55, padding: '4px 6px', fontSize: '0.8125rem', textAlign: 'right', border: '1px solid #93C5FD', borderRadius: 5, outline: 'none' }} />
                          <span style={{ fontSize: '0.75rem', color: '#6B7280' }}>%</span>
                        </div>
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right', color: monthlyInv > 0 ? '#059669' : '#9CA3AF', backgroundColor: '#F0FDF4' }}>
                        {monthlyInv > 0 ? monthlyInv.toLocaleString('ko-KR') : '-'}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right', color: lumpInv > 0 ? '#2563EB' : '#9CA3AF', backgroundColor: '#EFF6FF' }}>
                        {lumpInv > 0 ? lumpInv.toLocaleString('ko-KR') : '-'}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right', color: lumpShares > 0 ? '#2563EB' : '#9CA3AF', backgroundColor: '#EFF6FF' }}>
                        {lumpShares > 0 ? lumpShares.toLocaleString('ko-KR') : '-'}
                      </td>
                      <td style={{ ...tdStyle, padding: '5px 8px', textAlign: 'left' }}>
                        <input type="text" value={r.memo} onChange={(e) => setDrGmRows((prev) => prev.map((rr) => rr.id !== r.id ? rr : { ...rr, memo: e.target.value }))}
                          style={{ width: '100%', minWidth: 70, padding: '4px 6px', fontSize: '0.8125rem', border: '1px solid #E1E5EB', borderRadius: 5, outline: 'none' }} />
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'center' }}>
                        <input type="checkbox" checked={drGmChecked.has(r.id)}
                          onChange={(e) => { const s = new Set(drGmChecked); if (e.target.checked) s.add(r.id); else s.delete(r.id); setDrGmChecked(s); }}
                          style={{ width: 14, height: 14, cursor: 'pointer' }} />
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
                {drGmRows.length > 0 && (() => {
                  const totalPension = drGmRows.reduce((s, r) => s + (r.weight_pension || 0), 0);
                  const totalIrp = drGmRows.reduce((s, r) => s + (r.weight_irp || 0), 0);
                  const activeWeight = drGmAccountType === 'pension' ? totalPension : totalIrp;
                  const totalMonthly = drGmRows.reduce((s, r) => {
                    const w = drGmAccountType === 'pension' ? r.weight_pension : r.weight_irp;
                    return s + (drGmMonthlyAmount > 0 ? Math.floor(drGmMonthlyAmount * w / 100 / 1000) * 1000 : 0);
                  }, 0);
                  const totalLump = drGmRows.reduce((s, r) => {
                    const w = drGmAccountType === 'pension' ? r.weight_pension : r.weight_irp;
                    return s + (drGmLumpSumAmount > 0 ? Math.floor(drGmLumpSumAmount * w / 100 / 1000) * 1000 : 0);
                  }, 0);
                  return (
                  <tfoot>
                    <tr style={{ backgroundColor: '#FFFBEB' }}>
                      <td style={{ ...totalRowStyle, position: 'sticky', left: 0, backgroundColor: '#FFFBEB', zIndex: 1 }} />
                      <td style={{ ...totalRowStyle, textAlign: 'left', position: 'sticky', left: 36, backgroundColor: '#FFFBEB', zIndex: 1, borderRight: '2px solid #E1E5EB' }}>합계</td>
                      <td style={totalRowStyle} />
                      <td style={totalRowStyle} />
                      <td style={{ ...totalRowStyle, backgroundColor: '#FDE68A' }}>
                        {totalPension.toFixed(2)}%
                      </td>
                      <td style={{ ...totalRowStyle, backgroundColor: '#93C5FD' }}>
                        {totalIrp.toFixed(2)}%
                      </td>
                      <td style={{ ...totalRowStyle, color: '#059669', backgroundColor: '#D1FAE5' }}>
                        {totalMonthly > 0 ? totalMonthly.toLocaleString('ko-KR') : '-'}
                      </td>
                      <td style={{ ...totalRowStyle, color: '#2563EB', backgroundColor: '#BFDBFE' }}>
                        {totalLump > 0 ? totalLump.toLocaleString('ko-KR') : '-'}
                      </td>
                      <td style={totalRowStyle} />
                      <td style={totalRowStyle} />
                      <td style={totalRowStyle} />
                    </tr>
                  </tfoot>
                  );
                })()}
              </table>
            </div>
          )}

          {drGmToast && (
            <div style={{ marginTop: 10, padding: '10px 14px', backgroundColor: drGmToast.includes('실패') || drGmToast.includes('오류') ? '#FEF2F2' : '#FFFBEB', border: `1px solid ${drGmToast.includes('실패') || drGmToast.includes('오류') ? '#FECACA' : '#FCD34D'}`, borderRadius: 8, fontSize: '0.8125rem', fontWeight: 500, color: drGmToast.includes('실패') || drGmToast.includes('오류') ? '#DC2626' : '#92400E' }}>
              {drGmToast}
            </div>
          )}
        </div>
      )}

      {/* Dr.GM 상품 선택 팝업 */}
      {drGmProductOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)' }}
          onClick={(e) => { if (e.target === e.currentTarget) { setDrGmProductOpen(false); setDrGmEditRowId(null); } }}>
          <div style={{ backgroundColor: '#fff', borderRadius: 14, padding: 24, width: '100%', maxWidth: 560, maxHeight: '75vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#1A1A2E' }}>상품 선택</h3>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button
                  onClick={() => setT2NewMasterOpen(true)}
                  style={{ padding: '5px 10px', fontSize: '0.75rem', fontWeight: 600, color: '#92400E', backgroundColor: '#FEF3C7', border: '1px solid #FCD34D', borderRadius: 6, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  새 상품 등록
                </button>
                <button onClick={() => { setDrGmProductOpen(false); setDrGmEditRowId(null); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', padding: 4 }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
            </div>
            <input type="text" placeholder="상품명 또는 종목코드 검색..." value={drGmProductSearch}
              onChange={(e) => setDrGmProductSearch(e.target.value)}
              style={{ width: '100%', padding: '8px 10px', fontSize: '0.8125rem', border: '1px solid #E1E5EB', borderRadius: 8, outline: 'none', marginBottom: 10, boxSizing: 'border-box' }}
              autoFocus />
            <div style={{ flex: 1, overflowY: 'auto', border: '1px solid #E1E5EB', borderRadius: 8 }}>
              {productMasters
                .filter((m) => !drGmProductSearch || m.product_name.toLowerCase().includes(drGmProductSearch.toLowerCase()) || (m.product_code ?? '').toLowerCase().includes(drGmProductSearch.toLowerCase()))
                .map((m) => (
                  <button key={m.id} type="button"
                    onClick={() => selectDrGmProduct(m)}
                    style={{ width: '100%', padding: '8px 12px', textAlign: 'left', border: 'none', borderBottom: '1px solid #F3F4F6', cursor: 'pointer', backgroundColor: 'transparent', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, transition: 'background-color 0.1s' }}
                    onMouseEnter={(e) => { (e.currentTarget).style.backgroundColor = '#FFFBEB'; }}
                    onMouseLeave={(e) => { (e.currentTarget).style.backgroundColor = 'transparent'; }}>
                    <div>
                      <div style={{ fontSize: '0.8125rem', fontWeight: 500, color: '#1A1A2E' }}>{m.product_name}</div>
                      <div style={{ fontSize: '0.6875rem', color: '#9CA3AF', marginTop: 2 }}>
                        <span style={{ fontWeight: 600, color: '#92400E', backgroundColor: '#FEF3C7', padding: '1px 6px', borderRadius: 3, marginRight: 4 }}>{m.product_type || '-'}</span>{m.product_code || '-'} | {m.risk_level || '-'} | {m.region || '-'}
                      </div>
                    </div>
                  </button>
                ))}
              {productMasters.filter((m) => !drGmProductSearch || m.product_name.toLowerCase().includes(drGmProductSearch.toLowerCase()) || (m.product_code ?? '').toLowerCase().includes(drGmProductSearch.toLowerCase())).length === 0 && (
                <div style={{ padding: 20, textAlign: 'center', color: '#9CA3AF', fontSize: '0.8125rem' }}>검색 결과 없음</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* Area 5: 수정 포트폴리오 (리밸런싱)                            */}
      {/* ============================================================ */}
      {t2ShowDetail && t2RebalRows.length > 0 && (
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid #E1E5EB' }}>
            <div style={{ width: 3, height: 18, borderRadius: 2, backgroundColor: '#1E3A5F', flexShrink: 0 }} />
            <span style={sectionTitleStyle}>수정 포트폴리오</span>
            {ratioOverflow && (
              <span style={{ fontSize: '0.8125rem', color: '#EF4444', fontWeight: 600, marginLeft: 8 }}>
                경고: 재조정 비율 합계가 100% 초과 ({rebalOtherRatioSum.toFixed(2)}%)
              </span>
            )}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button onClick={refreshRebalPrices} disabled={t2PriceRefreshing}
                data-tooltip="ETF/주식 종목의 현재가를 갱신합니다."
                style={{ padding: '6px 14px', fontSize: '0.8125rem', fontWeight: 600, color: '#374151', backgroundColor: '#FEF3C7', border: '1px solid #FCD34D', borderRadius: 7, cursor: t2PriceRefreshing ? 'not-allowed' : 'pointer', opacity: t2PriceRefreshing ? 0.6 : 1 }}>
                {t2PriceRefreshing ? '갱신 중...' : '현재가 갱신'}
              </button>
              <button
                onClick={() => { setT2NewMasterAutoAdd(true); setT2NewMasterOpen(true); }}
                data-tooltip="새 상품을 등록하고 바로 추가합니다."
                style={{ padding: '6px 14px', fontSize: '0.8125rem', fontWeight: 600, color: '#fff', backgroundColor: '#059669', border: 'none', borderRadius: 7, cursor: 'pointer' }}
              >
                + 상품추가 & 반영
              </button>
              <button
                onClick={() => setT2AddProductOpen(true)}
                data-tooltip="상품 마스터에서 상품을 선택하여 행을 추가합니다."
                style={{ padding: '6px 14px', fontSize: '0.8125rem', fontWeight: 600, color: '#1E3A5F', backgroundColor: '#EEF2F7', border: '1px solid #C7D2E2', borderRadius: 7, cursor: 'pointer' }}
              >
                + 행추가
              </button>
              <button onClick={deleteCheckedRebalRows} disabled={t2RebalChecked.size === 0}
                data-tooltip="체크된 행을 삭제합니다."
                style={{ padding: '6px 14px', fontSize: '0.8125rem', fontWeight: 600, color: t2RebalChecked.size > 0 ? '#EF4444' : '#9CA3AF', backgroundColor: '#fff', border: `1px solid ${t2RebalChecked.size > 0 ? '#FECACA' : '#E1E5EB'}`, borderRadius: 7, cursor: t2RebalChecked.size > 0 ? 'pointer' : 'not-allowed' }}>
                삭제 ({t2RebalChecked.size})
              </button>
              <button
                onClick={handleT2Recalc}
                data-tooltip="재조정 비율과 금액을 다시 계산합니다."
                style={{ padding: '6px 14px', fontSize: '0.8125rem', fontWeight: 600, color: '#374151', backgroundColor: '#F3F4F6', border: '1px solid #E1E5EB', borderRadius: 7, cursor: 'pointer' }}
              >
                재계산
              </button>
              <button
                onClick={handleT2SaveRebal}
                disabled={t2RebalSaving}
                data-tooltip="수정 포트폴리오 리밸런싱 제안을 저장합니다."
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
          <div style={{ overflowX: 'scroll', border: '1px solid #E1E5EB', borderRadius: 8 }}>
            <table style={{ borderCollapse: 'collapse', fontSize: '0.8125rem', minWidth: 1200 }}>
              <thead>
                <tr style={{ backgroundColor: '#F5F7FA' }}>
                  <th style={{ ...thStyle, position: 'sticky', left: 0, zIndex: 2, background: '#F5F7FA', textAlign: 'center', minWidth: 36 }}>No.</th>
                  <th style={{ ...thStyle, position: 'sticky', left: 36, zIndex: 2, background: '#F5F7FA', textAlign: 'left', minWidth: 280, borderRight: '2px solid #E1E5EB' }}>상품명</th>
                  {!t2SelectedAccount?.account_type?.startsWith('pension') && <th style={thStyle}>상품코드</th>}
                  <th style={thStyle}>잔고수량</th>
                  <th style={{ ...thStyle, minWidth: 90 }}>기준가</th>
                  <th style={thStyle}>매입금액</th>
                  <th style={thStyle}>평가금액</th>
                  <th style={thStyle}>평가손익</th>
                  <th style={thStyle}>수익률</th>
                  <th style={thStyle}>평가비율</th>
                  <th style={{ ...thStyle, minWidth: 100, backgroundColor: '#059669', color: '#fff' }}>재조정 비율</th>
                  <th style={{ ...thStyle, minWidth: 110, backgroundColor: '#059669', color: '#fff' }}>재조정 잔액</th>
                  <th style={{ ...thStyle, minWidth: 100, backgroundColor: '#059669', color: '#fff' }}>
                    <span data-tooltip="±10,000원 이하인 경우 0원으로 자동 처리됩니다." style={{ cursor: 'help', borderBottom: '1px dashed rgba(255,255,255,0.5)' }}>Sell/Buy</span>
                  </th>
                  <th style={{ ...thStyle, backgroundColor: '#059669', color: '#fff' }}>좌수</th>
                  <th style={{ ...thStyle, textAlign: 'center', minWidth: 36 }}>
                    <input type="checkbox" checked={t2RebalRows.filter((r) => !r.isRow1).length > 0 && t2RebalChecked.size === t2RebalRows.filter((r) => !r.isRow1).length}
                      onChange={(e) => { if (e.target.checked) setT2RebalChecked(new Set(t2RebalRows.filter((r) => !r.isRow1).map((r) => r.id))); else setT2RebalChecked(new Set()); }}
                      style={{ width: 14, height: 14, cursor: 'pointer' }} />
                  </th>
                </tr>
              </thead>
              <tbody>
                {t2RebalRows.map((r, idx) => {
                  const isRow1 = r.isRow1;
                  const rowBg = isRow1 ? '#EEF2F7' : 'transparent';
                  const stickyBg = isRow1 ? '#EEF2F7' : '#fff';
                  const isAdded = r.id.startsWith('__new__');
                  const addedBg = isAdded && !isRow1 ? '#F0F7FF' : rowBg;
                  const addedStickyBg = isAdded && !isRow1 ? '#F0F7FF' : stickyBg;
                  return (
                    <tr
                      key={r.id}
                      style={{ backgroundColor: addedBg, transition: 'background-color 0.1s' }}
                      onMouseEnter={(e) => { if (!isRow1) (e.currentTarget as HTMLTableRowElement).style.backgroundColor = isAdded ? '#EFF6FF' : '#F9FAFB'; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLTableRowElement).style.backgroundColor = addedBg; }}
                    >
                      <td style={{ ...tdStyle, position: 'sticky', left: 0, zIndex: 1, background: addedStickyBg, textAlign: 'center', color: '#9CA3AF' }}>{idx + 1}</td>
                      <td style={{ ...tdStyle, position: 'sticky', left: 36, zIndex: 1, background: addedStickyBg, textAlign: 'left', borderRight: '2px solid #E1E5EB', whiteSpace: 'normal', wordBreak: 'keep-all' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          {/* 순서 이동 화살표 */}
                          {!isRow1 && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 0, flexShrink: 0 }}>
                              <button type="button" onClick={() => moveRebalRow(r.id, -1)} disabled={idx === 0}
                                style={{ background: 'none', border: 'none', cursor: idx === 0 ? 'default' : 'pointer', padding: 0, lineHeight: 1, color: idx === 0 ? '#D1D5DB' : '#6B7280', fontSize: '0.625rem' }}>▲</button>
                              <button type="button" onClick={() => moveRebalRow(r.id, 1)} disabled={idx === t2RebalRows.length - 1}
                                style={{ background: 'none', border: 'none', cursor: idx === t2RebalRows.length - 1 ? 'default' : 'pointer', padding: 0, lineHeight: 1, color: idx === t2RebalRows.length - 1 ? '#D1D5DB' : '#6B7280', fontSize: '0.625rem' }}>▼</button>
                            </div>
                          )}
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontWeight: isRow1 ? 700 : 500, color: '#1A1A2E', fontSize: '0.8125rem' }}>
                              {r.productName}
                              {isAdded && !isRow1 && <span style={{ fontSize: '0.625rem', fontWeight: 700, color: '#1D4ED8', backgroundColor: '#DBEAFE', border: '1px solid #93C5FD', padding: '1px 6px', borderRadius: 4, flexShrink: 0 }}>신규</span>}
                            </div>
                            {(r.productType || r.riskLevel) && <div style={{ fontSize: '0.6875rem', color: '#9CA3AF' }}>{[r.productType, r.riskLevel, r.region].filter(Boolean).join(' | ')}</div>}
                          </div>
                          {isAdded && (
                            <button
                              type="button"
                              data-tooltip="상품 교체"
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
                      {!t2SelectedAccount?.account_type?.startsWith('pension') && (
                        <td style={{ ...tdStyle, backgroundColor: rowBg, fontFamily: 'monospace', fontSize: '0.75rem', color: '#6B7280' }}>{r.productCode || '-'}</td>
                      )}
                      <td style={{ ...tdStyle, backgroundColor: rowBg }}>{r.quantity > 0 ? r.quantity.toLocaleString('ko-KR') : '-'}</td>
                      {/* 기준가 - editable */}
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

                      {/* 재조정 비율 + 전액매도 체크 */}
                      <td style={{ ...tdStyle, padding: '5px 8px', backgroundColor: isRow1 ? '#D1FAE5' : '#F0FDF4' }}>
                        {isRow1 ? (
                          <span style={{ color: ratioOverflow ? '#EF4444' : '#1E3A5F', fontWeight: 700 }}>
                            {rebalRow1RatioCalc.toFixed(2)}%
                          </span>
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                            <input
                              type="checkbox"
                              checked={r.fullSell}
                              onChange={() => handleT2FullSellToggle(r.id)}
                              data-tooltip="전액매도"
                              style={{ width: 14, height: 14, cursor: 'pointer', accentColor: '#EF4444', flexShrink: 0 }}
                            />
                            {r.fullSell ? (
                              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#EF4444' }}>매도</span>
                            ) : (
                              <>
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  max="100"
                                  value={r.rebalRatio}
                                  onChange={(e) => handleT2RebalRatioChange(r.id, e.target.value)}
                                  style={{ width: 55, padding: '4px 6px', fontSize: '0.8125rem', textAlign: 'right', border: '1px solid #C7D2E2', borderRadius: 5, outline: 'none', color: '#1A1A2E', backgroundColor: '#fff' }}
                                />
                                <span style={{ fontSize: '0.75rem', color: '#6B7280' }}>%</span>
                              </>
                            )}
                          </div>
                        )}
                      </td>

                      {/* 재조정 잔액 */}
                      <td style={{ ...tdStyle, padding: '5px 8px', backgroundColor: isRow1 ? '#D1FAE5' : '#F0FDF4' }}>
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
                      <td style={{ ...tdStyle, color: rateColor(r.sellBuy), fontWeight: 600, backgroundColor: isRow1 ? '#D1FAE5' : '#F0FDF4' }}>
                        {r.sellBuy !== 0 ? `${r.sellBuy > 0 ? '+' : ''}${r.sellBuy.toLocaleString('ko-KR')}` : '0'}
                      </td>

                      {/* 좌수 */}
                      <td style={{ ...tdStyle, backgroundColor: isRow1 ? '#D1FAE5' : '#F0FDF4', color: r.shares < 0 ? '#EF4444' : undefined }}>{r.shares !== 0 ? r.shares.toLocaleString('ko-KR') : '-'}</td>
                      <td style={{ ...tdStyle, textAlign: 'center' }}>
                        {!isRow1 && (
                          <input type="checkbox" checked={t2RebalChecked.has(r.id)}
                            onChange={(e) => { const s = new Set(t2RebalChecked); if (e.target.checked) s.add(r.id); else s.delete(r.id); setT2RebalChecked(s); }}
                            style={{ width: 14, height: 14, cursor: 'pointer' }} />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ backgroundColor: '#F5F7FA' }}>
                  <td style={{ ...totalRowStyle, position: 'sticky', left: 0, zIndex: 1, background: '#F5F7FA' }} />
                  <td style={{ ...totalRowStyle, position: 'sticky', left: 36, zIndex: 1, background: '#F5F7FA', textAlign: 'left', borderRight: '2px solid #E1E5EB' }}>합계</td>
                  {!t2SelectedAccount?.account_type?.startsWith('pension') && <td style={totalRowStyle} />}
                  <td style={totalRowStyle} />
                  <td style={totalRowStyle} />
                  <td style={totalRowStyle}>{fmtNum(rebalTotalPurch)}</td>
                  <td style={totalRowStyle}>{fmtNum(rebalTotalEval)}</td>
                  <td style={{ ...totalRowStyle, color: rateColor(rebalTotalReturn) }}>
                    {rebalTotalReturn !== 0 ? `${rebalTotalReturn > 0 ? '+' : ''}${rebalTotalReturn.toLocaleString('ko-KR')}` : '0'}
                  </td>
                  <td style={{ ...totalRowStyle, color: rateColor(rebalTotalReturnRate) }}>
                    {rebalTotalReturnRate > 0 ? '+' : ''}{rebalTotalReturnRate.toFixed(2)}%
                  </td>
                  <td style={totalRowStyle}>100%</td>
                  <td style={{ ...totalRowStyle, backgroundColor: '#BBF7D0', color: ratioOverflow ? '#EF4444' : '#374151' }}>
                    {(rebalOtherRatioSum + rebalRow1RatioCalc).toFixed(2)}%
                  </td>
                  <td style={{ ...totalRowStyle, backgroundColor: '#BBF7D0' }}>{fmtNum(rebalTotalRebalAmt)}</td>
                  <td style={{ ...totalRowStyle, backgroundColor: '#BBF7D0', color: rateColor(rebalTotalSellBuy) }}>
                    {rebalTotalSellBuy !== 0 ? `${rebalTotalSellBuy > 0 ? '+' : ''}${rebalTotalSellBuy.toLocaleString('ko-KR')}` : '0'}
                  </td>
                  <td style={{ ...totalRowStyle, backgroundColor: '#BBF7D0' }} />
                  <td style={totalRowStyle} />
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
                        <span style={{ fontWeight: 600, color: '#1E3A5F', backgroundColor: '#EEF2F7', padding: '1px 6px', borderRadius: 3, marginRight: 4 }}>{m.product_type || '-'}</span>{m.product_code || '-'} | {m.risk_level || '-'} | {m.region || '-'}
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
          onClick={(e) => { if (e.target === e.currentTarget) { setT2NewMasterOpen(false); setT2NewMasterAutoAdd(false); setT2MasterStockQuery(''); setT2MasterStockResults([]); } }}>
          <div style={{ backgroundColor: '#fff', borderRadius: 14, padding: 24, width: '100%', maxWidth: 440, boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#1A1A2E' }}>{t2NewMasterAutoAdd ? '상품추가 & 반영' : '새 상품 등록'}</h3>
              <button onClick={() => { setT2NewMasterOpen(false); setT2NewMasterAutoAdd(false); setT2MasterStockQuery(''); setT2MasterStockResults([]); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', padding: 4 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* 1. 상품유형 먼저 */}
              <div>
                <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>상품유형 <span style={{ color: '#EF4444' }}>*</span></label>
                <select value={t2NewMasterForm.product_type}
                  onChange={(e) => { setT2NewMasterForm((prev) => ({ ...prev, product_type: e.target.value, product_name: '', product_code: '' })); setT2MasterStockQuery(''); setT2MasterStockResults([]); }}
                  style={{ width: '100%', padding: '7px 10px', fontSize: '0.8125rem', border: '1px solid #E1E5EB', borderRadius: 7, outline: 'none', backgroundColor: '#fff', boxSizing: 'border-box', cursor: 'pointer' }}>
                  <option value="">상품유형을 먼저 선택하세요</option>
                  {PRODUCT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>

              {/* 2. 상품명 — ETF/MMF: 자동검색, 그 외: 직접입력 */}
              {t2NewMasterForm.product_type && (
                <div style={{ position: 'relative' }}>
                  <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>
                    상품명 <span style={{ color: '#EF4444' }}>*</span>
                    {(t2NewMasterForm.product_type === 'ETF' || t2NewMasterForm.product_type === 'MMF') ? (
                      <span style={{ fontWeight: 400, marginLeft: 8, color: '#9CA3AF', fontSize: '0.6875rem' }}>2글자 이상 입력 시 자동 검색</span>
                    ) : (
                      <span style={{ fontWeight: 400, marginLeft: 8, color: '#9CA3AF', fontSize: '0.6875rem' }}>
                        직접 입력 |{' '}
                        <a href="https://www.nhsec.com/index.jsp" target="_blank" rel="noopener noreferrer" data-tooltip="NH투자증권 > 금융상품 > 펀드 > 펀드검색" style={{ color: '#2563EB', textDecoration: 'underline' }}>펀드 검색</a>
                      </span>
                    )}
                  </label>
                  {(t2NewMasterForm.product_type === 'ETF' || t2NewMasterForm.product_type === 'MMF') ? (
                    <>
                      <input type="text" placeholder="상품명을 입력하세요 (예: KODEX, TIGER...)"
                        value={t2MasterStockQuery || t2NewMasterForm.product_name}
                        onChange={(e) => handleT2MasterStockSearch(e.target.value)}
                        style={{ width: '100%', padding: '7px 10px', fontSize: '0.8125rem', border: '1px solid #E1E5EB', borderRadius: 7, outline: 'none', boxSizing: 'border-box' }} autoFocus />
                      {t2MasterStockSearching && <div style={{ position: 'absolute', right: 10, top: 28, color: '#9CA3AF', fontSize: '0.6875rem' }}>검색 중...</div>}
                      {t2MasterStockResults.length > 0 && (
                        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100, backgroundColor: '#fff', border: '1px solid #E1E5EB', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', maxHeight: 200, overflowY: 'auto', marginTop: 4 }}>
                          {t2MasterStockResults.map((item) => (
                            <button key={item.code} type="button" onClick={() => handleT2MasterStockSelect(item)}
                              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 10px', border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left', borderBottom: '1px solid #F3F4F6', fontSize: '0.8125rem' }}
                              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#F5F7FA'; }}
                              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}>
                              <div>
                                <div style={{ fontWeight: 600, color: '#1A1A2E' }}>{item.name}</div>
                                <div style={{ fontSize: '0.6875rem', color: '#6B7280' }}>{item.code}</div>
                              </div>
                              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                                <div style={{ fontWeight: 600, color: '#1E3A5F', fontSize: '0.8125rem' }}>{item.price?.toLocaleString('ko-KR')}</div>
                                <div style={{ fontSize: '0.6875rem', color: '#9CA3AF' }}>NAV {item.nav?.toLocaleString('ko-KR')}</div>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <input type="text" placeholder="상품명을 직접 입력하세요"
                      value={t2NewMasterForm.product_name}
                      onChange={(e) => setT2NewMasterForm((prev) => ({ ...prev, product_name: e.target.value }))}
                      style={{ width: '100%', padding: '7px 10px', fontSize: '0.8125rem', border: '1px solid #E1E5EB', borderRadius: 7, outline: 'none', boxSizing: 'border-box' }} autoFocus />
                  )}
                </div>
              )}

              {/* 3. 종목코드 */}
              {t2NewMasterForm.product_type && (
                <div>
                  <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>종목코드</label>
                  <input type="text" placeholder="종목코드"
                    value={t2NewMasterForm.product_code}
                    onChange={(e) => setT2NewMasterForm((prev) => ({ ...prev, product_code: e.target.value }))}
                    readOnly={t2NewMasterForm.product_type === 'ETF' || t2NewMasterForm.product_type === 'MMF'}
                    style={{ width: '100%', padding: '7px 10px', fontSize: '0.8125rem', border: '1px solid #E1E5EB', borderRadius: 7, outline: 'none', boxSizing: 'border-box', fontFamily: 'monospace', backgroundColor: (t2NewMasterForm.product_type === 'ETF' || t2NewMasterForm.product_type === 'MMF') ? '#F9FAFB' : '#fff' }}
                  />
                </div>
              )}

              {/* 4. 위험도 + 지역 */}
              {t2NewMasterForm.product_type && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <div>
                    <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>위험도</label>
                    <select value={t2NewMasterForm.risk_level} onChange={(e) => setT2NewMasterForm((prev) => ({ ...prev, risk_level: e.target.value }))}
                      style={{ width: '100%', padding: '7px 10px', fontSize: '0.8125rem', border: '1px solid #E1E5EB', borderRadius: 7, outline: 'none', backgroundColor: '#fff', boxSizing: 'border-box', cursor: 'pointer' }}>
                      <option value="">선택</option>
                      {RISK_LEVELS.map((rl) => <option key={rl} value={rl}>{rl}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>지역</label>
                    <select value={t2NewMasterForm.region} onChange={(e) => setT2NewMasterForm((prev) => ({ ...prev, region: e.target.value }))}
                      style={{ width: '100%', padding: '7px 10px', fontSize: '0.8125rem', border: '1px solid #E1E5EB', borderRadius: 7, outline: 'none', backgroundColor: '#fff', boxSizing: 'border-box', cursor: 'pointer' }}>
                      <option value="">선택</option>
                      {REGIONS.map((rg) => <option key={rg} value={rg}>{rg}</option>)}
                    </select>
                  </div>
                </div>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button onClick={() => { setT2NewMasterOpen(false); setT2NewMasterAutoAdd(false); setT2MasterStockQuery(''); setT2MasterStockResults([]); }} style={{ padding: '7px 16px', fontSize: '0.8125rem', fontWeight: 600, color: '#6B7280', backgroundColor: '#F3F4F6', border: '1px solid #E1E5EB', borderRadius: 7, cursor: 'pointer' }}>취소</button>
              <button onClick={handleT2CreateNewMaster} disabled={t2NewMasterSaving || !t2NewMasterForm.product_name.trim()}
                style={{ padding: '7px 16px', fontSize: '0.8125rem', fontWeight: 700, color: '#fff', backgroundColor: t2NewMasterSaving || !t2NewMasterForm.product_name.trim() ? '#9CA3AF' : (t2NewMasterAutoAdd ? '#059669' : '#1E3A5F'), border: 'none', borderRadius: 7, cursor: t2NewMasterSaving || !t2NewMasterForm.product_name.trim() ? 'not-allowed' : 'pointer' }}>
                {t2NewMasterSaving ? '등록 중...' : (t2NewMasterAutoAdd ? '등록 & 반영' : '등록')}
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
                          data-tooltip="삭제"
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
  const [activeTab, setActiveTab] = useState<'data' | 'template' | 'report' | 'history'>('data');
  const [clients, setClients] = useState<Client[]>([]);
  const [clientsLoading, setClientsLoading] = useState(false);

  /* ---------- client latest dates & sort ---------- */
  const [clientLatestDates, setClientLatestDates] = useState<Record<string, string>>({});
  const [suggestionLatestDates, setSuggestionLatestDates] = useState<Record<string, string>>({});
  const [clientSortByDate, setClientSortByDate] = useState(false);

  const loadClientLatestDates = useCallback(async () => {
    try {
      const [snapRes, suggRes] = await Promise.all([
        fetch(`${API_URL}/api/v1/snapshots/latest-dates`, { headers: { ...authLib.getAuthHeader() } }),
        fetch(`${API_URL}/api/v1/portfolios/suggestions/latest-dates/all`, { headers: { ...authLib.getAuthHeader() } }),
      ]);
      if (snapRes.ok) setClientLatestDates(await snapRes.json());
      if (suggRes.ok) setSuggestionLatestDates(await suggRes.json());
    } catch { /* ignore */ }
  }, []);

  /* ---------- client management modal ---------- */
  const [clientMgmtOpen, setClientMgmtOpen] = useState(false);

  /* ---------- product name change memo ---------- */
  const [nameChangeMemoOpen, setNameChangeMemoOpen] = useState(false);
  const [nameChanges, setNameChanges] = useState<{id:string; old_keyword:string; new_keyword:string; memo?:string}[]>([]);
  const [ncLoading, setNcLoading] = useState(false);
  const [ncNewOld, setNcNewOld] = useState('');
  const [ncNewNew, setNcNewNew] = useState('');
  const [ncNewMemo, setNcNewMemo] = useState('');
  const [ncEditId, setNcEditId] = useState<string|null>(null);
  const [ncEditOld, setNcEditOld] = useState('');
  const [ncEditNew, setNcEditNew] = useState('');
  const [ncEditMemo, setNcEditMemo] = useState('');

  const loadNameChanges = useCallback(async () => {
    setNcLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/product-name-changes`, { headers: { Authorization: `Bearer ${authLib.getToken()}` } });
      if (res.ok) setNameChanges(await res.json());
    } catch { /* ignore */ }
    setNcLoading(false);
  }, []);

  const addNameChange = async () => {
    if (!ncNewOld.trim() || !ncNewNew.trim()) return;
    try {
      const res = await fetch(`${API_URL}/api/v1/product-name-changes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authLib.getToken()}` },
        body: JSON.stringify({ old_keyword: ncNewOld.trim(), new_keyword: ncNewNew.trim(), memo: ncNewMemo.trim() || null }),
      });
      if (res.ok) { setNcNewOld(''); setNcNewNew(''); setNcNewMemo(''); loadNameChanges(); }
    } catch { /* ignore */ }
  };

  const updateNameChange = async (id: string) => {
    try {
      await fetch(`${API_URL}/api/v1/product-name-changes/${id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authLib.getToken()}` },
        body: JSON.stringify({ old_keyword: ncEditOld.trim(), new_keyword: ncEditNew.trim(), memo: ncEditMemo.trim() || null }),
      });
      setNcEditId(null); loadNameChanges();
    } catch { /* ignore */ }
  };

  const deleteNameChange = async (id: string) => {
    if (!confirm('삭제하시겠습니까?')) return;
    try {
      await fetch(`${API_URL}/api/v1/product-name-changes/${id}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${authLib.getToken()}` },
      });
      loadNameChanges();
    } catch { /* ignore */ }
  };

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
  const [tab3ClientSearch, setTab3ClientSearch] = useState('');
  const [tab3ClientId, setTab3ClientId] = useState('');
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [reportDate, setReportDate] = useState('');
  const [reportDateList, setReportDateList] = useState<string[]>([]);
  const [reportDateLoading, setReportDateLoading] = useState(false);
  const [reportExtraHoldings, setReportExtraHoldings] = useState<ReportData['holdings']>([]);
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [modifiedWeights, setModifiedWeights] = useState<Record<string, number>>({});
  const [reportClientName, setReportClientName] = useState('');
  const [saving, setSaving] = useState(false);
  const [aiComment, setAiComment] = useState('');
  const [aiChangeComment, setAiChangeComment] = useState('');
  const [aiCommentLoading, setAiCommentLoading] = useState(false);
  const [aiChangeCommentLoading, setAiChangeCommentLoading] = useState(false);
  const [managerNote, setManagerNote] = useState('');
  const [reportSaved, setReportSaved] = useState(false);
  const [savedSuggestionId, setSavedSuggestionId] = useState('');
  const [reportSaving, setReportSaving] = useState(false);

  /* ---------- product master state ---------- */
  const [productMasters, setProductMasters] = useState<ProductMaster[]>([]);

  /* ---------- product register modal state ---------- */
  const [registerModalOpen, setRegisterModalOpen] = useState(false);
  const [loadMasterTarget, setLoadMasterTarget] = useState<{ snapshotId: string; holdingId: string; productName: string; accountType?: string } | null>(null);
  const [loadMasterSearch, setLoadMasterSearch] = useState('');
  const [registerForm, setRegisterForm] = useState({
    product_name: '',
    risk_level: '',
    region: '',
    product_type: '',
    product_code: '',
  });
  const [regStockQuery, setRegStockQuery] = useState('');
  const [regStockResults, setRegStockResults] = useState<Array<{ code: string; name: string; nav: number; price: number; type: string }>>([]);
  const [regStockSearching, setRegStockSearching] = useState(false);
  const regStockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ---------- tab3: portal link state ---------- */
  const [portalLinkToast, setPortalLinkToast] = useState('');
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailInput, setEmailInput] = useState('');
  const [emailSending, setEmailSending] = useState(false);
  const [smsSending, setSmsSending] = useState(false);
  const [smsModalOpen, setSmsModalOpen] = useState(false);
  const [smsModalType, setSmsModalType] = useState<'portal' | 'suggestion'>('portal');
  const [smsMessage, setSmsMessage] = useState('');
  const [smsTemplates, setSmsTemplates] = useState<Array<{ id: string; name: string; text: string }>>([]);
  const [smsTemplateName, setSmsTemplateName] = useState('');

  /* ---------- 알림톡 state ---------- */
  const [alimtalkModalOpen, setAlimtalkModalOpen] = useState(false);
  const [alimtalkModalType, setAlimtalkModalType] = useState<'portal' | 'suggestion'>('portal');
  const [kakaoTemplates, setKakaoTemplates] = useState<Array<{ templateId: string; name: string; content: string; buttons?: Array<{ buttonType: string; buttonName: string; linkMo?: string; linkPc?: string }> }>>([]);
  const [kakaoTemplatesLoading, setKakaoTemplatesLoading] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [alimtalkSending, setAlimtalkSending] = useState(false);

  /* ---------- tab4 state ---------- */
  const [tab4ClientSearch, setTab4ClientSearch] = useState('');
  const [tab4ClientId, setTab4ClientId] = useState('');
  const [tab4Logs, setTab4Logs] = useState<Array<{
    id: string; client_id: string; client_name: string; client_account_id?: string;
    account_type?: string; account_number?: string; securities_company?: string;
    message_type: string; message_summary: string; message_text?: string;
    has_image: boolean; sent_at: string; created_at: string;
  }>>([]);
  const [tab4LogsTotal, setTab4LogsTotal] = useState(0);
  const [tab4LogsLoading, setTab4LogsLoading] = useState(false);
  const [tab4FilterCompany, setTab4FilterCompany] = useState('');
  const [tab4FilterAccount, setTab4FilterAccount] = useState('');
  const [tab4FilterPeriod, setTab4FilterPeriod] = useState<'6m' | '1y' | 'all'>('1y');
  const tab4HistoryRef = useRef<HTMLDivElement>(null);
  const [tab4PdfSaving, setTab4PdfSaving] = useState(false);

  /* ---------- load clients and product masters on mount ---------- */
  useEffect(() => {
    loadClients();
    loadProductMasters();
    loadClientLatestDates();
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
    const validRowsWithIndex = rows.map((r, idx) => ({ ...r, _origIdx: idx })).filter((r) => r.imageFile);
    const validRows = validRowsWithIndex;
    if (validRows.length === 0) {
      alert('이미지가 필요합니다.');
      return;
    }

    // 고객 선택 여부 체크
    for (const row of validRows) {
      if (!row.clientId) {
        alert('고객을 먼저 선택하세요. "계좌정보 관리" 버튼에서 고객을 등록하거나 드롭다운에서 선택해 주세요.');
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
        const accountId = await getClientAccountId(row);

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
              totalDeposit: (h as any).total_deposit ?? undefined,
              totalWithdrawal: (h as any).total_withdrawal ?? undefined,
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
            totalDeposit: (h as any).total_deposit ?? undefined,
            totalWithdrawal: (h as any).total_withdrawal ?? undefined,
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
          rowIndex: (row as any)._origIdx,
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
        const errMsg = e instanceof Error ? e.message : '오류 발생';
        setProcessResults((prev) =>
          prev.map((r, idx) =>
            idx === i
              ? { ...r, status: 'error', errorMsg: errMsg }
              : r
          )
        );
        alert(`데이터 처리 오류: ${errMsg}`);
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
    patch: Partial<Omit<HoldingEdit, 'holdingId' | 'saving'>>
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

  /* ---------- tab1: add/remove holding row ---------- */

  function addHoldingRow(snapshotId: string, atIndex: number, position: 'above' | 'below') {
    const newHolding: HoldingEdit = {
      holdingId: `__manual__${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      productName: '',
      productCode: '',
      riskLevel: '',
      region: '',
      quantity: undefined,
      purchasePrice: undefined,
      currentPrice: undefined,
      purchaseAmount: undefined,
      evaluationAmount: undefined,
      returnAmount: undefined,
      returnRate: undefined,
      unmapped: false,
      saving: false,
    };
    setExtractionResults((prev) =>
      prev.map((er) => {
        if (er.snapshotId !== snapshotId) return er;
        const newHoldings = [...er.holdings];
        const insertAt = position === 'above' ? atIndex : atIndex + 1;
        newHoldings.splice(insertAt, 0, newHolding);
        return { ...er, holdings: newHoldings };
      })
    );
  }

  function removeHoldingRow(snapshotId: string, holdingId: string) {
    setExtractionResults((prev) =>
      prev.map((er) => {
        if (er.snapshotId !== snapshotId) return er;
        return { ...er, holdings: er.holdings.filter((h) => h.holdingId !== holdingId) };
      })
    );
  }

  /* ---------- tab1: save all holdings ---------- */

  const [savingAll, setSavingAll] = useState<string | null>(null);

  async function saveAllHoldings(snapshotId: string) {
    const er = extractionResults.find((e) => e.snapshotId === snapshotId);
    if (!er) return;

    /* Check for duplicate: same account + same date */
    try {
      const snapInfoRes = await fetch(`${API_URL}/api/v1/snapshots/${snapshotId}`, {
        headers: { ...authLib.getAuthHeader() },
      });
      if (snapInfoRes.ok) {
        const snapInfo = await snapInfoRes.json();
        const accountId = snapInfo.client_account_id;
        const saveDate = er.snapshotDate || snapInfo.snapshot_date;

        const existingRes = await fetch(`${API_URL}/api/v1/snapshots?account_id=${accountId}`, {
          headers: { ...authLib.getAuthHeader() },
        });
        if (existingRes.ok) {
          const existingList: Array<{ id: string; snapshot_date: string }> = await existingRes.json();
          const duplicate = existingList.find((s) => s.snapshot_date === saveDate && s.id !== snapshotId);
          if (duplicate) {
            const overwrite = window.confirm(
              `${er.clientName}의 ${saveDate} 데이터가 이미 존재합니다.\n\n덮어쓰시겠습니까?\n(확인: 기존 데이터 삭제 후 저장 / 취소: 저장 중단)`
            );
            if (!overwrite) {
              setSavingAll(null);
              return;
            }
            await fetch(`${API_URL}/api/v1/snapshots/${duplicate.id}`, {
              method: 'DELETE',
              headers: { ...authLib.getAuthHeader() },
            });
          }
        }
      }
    } catch {
      // non-critical — proceed with save
    }

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

    for (let hi = 0; hi < er.holdings.length; hi++) {
      const h = er.holdings[hi];
      if (!h.productName?.trim()) continue; // 빈 상품명은 건너뜀

      const calcRate = (h.returnAmount != null && h.purchaseAmount)
        ? Math.round((h.returnAmount / h.purchaseAmount) * 10000) / 100
        : null;

      const holdingBody = {
        product_name: h.productName || null,
        product_code: h.productCode || null,
        risk_level: h.riskLevel || null,
        region: h.region || null,
        quantity: h.quantity ?? null,
        purchase_price: h.purchasePrice ?? null,
        current_price: h.currentPrice ?? null,
        purchase_amount: h.purchaseAmount ?? null,
        evaluation_amount: h.evaluationAmount ?? null,
        total_deposit: h.totalDeposit ?? null,
        total_withdrawal: h.totalWithdrawal ?? null,
        return_amount: (h.evaluationAmount != null && h.purchaseAmount != null) ? h.evaluationAmount - h.purchaseAmount : (h.returnAmount ?? null),
        return_rate: calcRate,
        seq: hi + 1,
      };

      try {
        let res: Response;
        if (h.holdingId.startsWith('__manual__')) {
          // 수동 추가 행 → POST로 새 holding 생성
          res = await fetch(`${API_URL}/api/v1/snapshots/${snapshotId}/holdings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
            body: JSON.stringify(holdingBody),
          });
        } else {
          // 기존 행 → PUT으로 업데이트
          res = await fetch(
            `${API_URL}/api/v1/snapshots/${snapshotId}/holdings/${h.holdingId}`,
            {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
              body: JSON.stringify(holdingBody),
            }
          );
        }
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
    loadClientLatestDates();

    // 전체 저장 완료 후 이미지 자동 삭제
    if (failCount === 0 && er.rowIndex != null) {
      setRows((prev) =>
        prev.map((r, idx) => {
          if (idx === er.rowIndex && r.imagePreview) {
            URL.revokeObjectURL(r.imagePreview);
            return { ...r, imageFile: null, imagePreview: '' };
          }
          return r;
        })
      );
    }

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

  function handleRegStockSearch(query: string) {
    setRegStockQuery(query);
    setRegisterForm((f) => ({ ...f, product_name: query }));
    if (regStockTimer.current) clearTimeout(regStockTimer.current);
    if (!query.trim() || query.trim().length < 2) {
      setRegStockResults([]);
      return;
    }
    regStockTimer.current = setTimeout(async () => {
      setRegStockSearching(true);
      try {
        const res = await fetch(`${API_URL}/api/v1/stock-search?q=${encodeURIComponent(query)}&limit=10`, {
          headers: authLib.getAuthHeader(),
        });
        if (res.ok) {
          const data = await res.json();
          setRegStockResults(data.results ?? []);
        }
      } catch { /* silent */ }
      finally { setRegStockSearching(false); }
    }, 400);
  }

  function handleRegStockSelect(item: { code: string; name: string; type: string }) {
    setRegisterForm((f) => ({ ...f, product_name: item.name, product_code: item.code }));
    setRegStockQuery(item.name);
    setRegStockResults([]);
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

      /* Auto-update: match by original product name OR holdingId from loadMasterTarget */
      const targetHoldingId = loadMasterTarget?.holdingId;
      const targetSnapshotId = loadMasterTarget?.snapshotId;
      const originalName = loadMasterTarget?.productName;

      setExtractionResults((prev) =>
        prev.map((er) => ({
          ...er,
          holdings: er.holdings.map((h) => {
            const isTarget = (targetHoldingId && h.holdingId === targetHoldingId)
              || h.productName === newMaster.product_name
              || (originalName && h.productName === originalName);
            if (!isTarget) return h;
            return {
              ...h,
              productName: newMaster.product_name,
              productCode: newMaster.product_code ?? '',
              riskLevel: newMaster.risk_level ?? h.riskLevel,
              region: newMaster.region ?? h.region,
              unmapped: false,
            };
          }),
        }))
      );

      /* Update DB holding with new product_name if target exists */
      if (targetSnapshotId && targetHoldingId) {
        fetch(`${API_URL}/api/v1/snapshots/${targetSnapshotId}/holdings/${targetHoldingId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
          body: JSON.stringify({
            product_name: newMaster.product_name,
            product_code: newMaster.product_code || null,
            product_type: newMaster.product_type || null,
            risk_level: newMaster.risk_level || null,
            region: newMaster.region || null,
          }),
        }).catch(() => { /* silent */ });
      }
      setLoadMasterTarget(null);
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

      // 예수금/자동운용상품 중복 제거 (OCR에서 중복 추출된 경우)
      const depositIndices = snap.holdings
        .map((h, i) => ({ i, name: h.product_name ?? '' }))
        .filter((x) => x.name.includes('예수금') || x.name.includes('자동운용상품'));
      if (depositIndices.length > 1) {
        const keepIdx = depositIndices.reduce((best, cur) =>
          (snap.holdings[cur.i].evaluation_amount ?? 0) > (snap.holdings[best.i].evaluation_amount ?? 0) ? cur : best
        ).i;
        const removeSet = new Set(depositIndices.map((d) => d.i).filter((i) => i !== keepIdx));
        snap.holdings = snap.holdings.filter((_, i) => !removeSet.has(i));
      }

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

  /* ---------- tab3: load snapshot dates for selected account ---------- */

  const [reportDateItems, setReportDateItems] = useState<Array<{ date: string; has_report: boolean }>>([]);

  async function loadReportDates(accountId: string) {
    if (!accountId) { setReportDateList([]); setReportDate(''); setReportDateItems([]); return; }
    setReportDateLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/snapshots?account_id=${accountId}`, {
        headers: { ...authLib.getAuthHeader() },
      });
      if (res.ok) {
        const data = await res.json();
        const items = (data as Array<{ snapshot_date: string; has_report?: boolean }>)
          .map((s) => ({ date: s.snapshot_date, has_report: s.has_report ?? false }))
          .sort((a, b) => b.date.localeCompare(a.date));
        setReportDateItems(items);
        const dates = items.map((i) => i.date);
        setReportDateList(dates);
        if (dates.length > 0) setReportDate(dates[0]);
        else setReportDate('');
      } else {
        setReportDateList([]);
        setReportDate('');
        setReportDateItems([]);
      }
    } catch {
      setReportDateList([]);
      setReportDate('');
      setReportDateItems([]);
    } finally {
      setReportDateLoading(false);
    }
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
    setReportSaved(false);
    setSavedSuggestionId('');
    setAiChangeComment('');
    try {
      const res = await fetch(
        `${API_URL}/api/v1/snapshots/report?account_id=${selectedAccountId}&target_date=${reportDate}`,
        { headers: { ...authLib.getAuthHeader() } }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showToast(err?.detail || '보고서 로드 실패');
        return;
      }
      const data: ReportData = await res.json();
      setReportData(data);
      // 서버에서 AI 코멘트가 포함된 경우 자동 적용
      if (data.ai_comment) setAiComment(data.ai_comment);
      if (data.ai_change_comment) setAiChangeComment(data.ai_change_comment);

      // 저장된 suggestion weights 자동 로드
      if (data.snapshot?.id) {
        try {
          const sugRes = await fetch(`${API_URL}/api/v1/portfolios/suggestions/by-snapshot/${data.snapshot.id}`, {
            headers: { ...authLib.getAuthHeader() },
          });
          if (sugRes.ok) {
            const sug = await sugRes.json();
            // 저장된 suggestion이 있으면 링크 & 저장 상태 복원
            if (sug.id) {
              setSavedSuggestionId(sug.id);
              setReportSaved(true);
            }
            const rawWeights: Record<string, unknown> = sug.suggested_weights ?? {};
            // _prices, _full_table 분리
            const prices: Record<string, number> = (rawWeights._prices as Record<string, number>) ?? {};
            const weights: Record<string, number> = {};
            for (const [k, v] of Object.entries(rawWeights)) {
              if (k.startsWith('_') || typeof v !== 'number') continue;
              weights[k] = v;
            }

            if (Object.keys(weights).length > 0) {
              const converted: Record<string, number> = {};
              const existingHoldings = [...(data.holdings ?? [])];

              // Normalize: if any weight > 1, values are already percentage (0-100), otherwise decimal (0-1)
              const maxW = Math.max(...Object.values(weights).map(v => Math.abs(v as number)));
              const isDecimal = maxW <= 1;

              for (const [key, w] of Object.entries(weights)) {
                const pctValue = isDecimal ? parseFloat((w * 100).toFixed(2)) : parseFloat((w as number).toFixed(2));
                const isNewKey = key.startsWith('new:');
                const isVirtualKey = key.startsWith('virtual_');
                if (isNewKey || isVirtualKey) {
                  const productName = isNewKey ? key.slice(4) : key.slice(8); // 'new:xxx' or 'virtual_xxx'
                  const virtualId = isVirtualKey ? key : `virtual_${productName}`;
                  // 이미 existingHoldings에 같은 virtual_id가 있으면 스킵
                  if (existingHoldings.some((h) => h.id === virtualId)) {
                    converted[virtualId] = pctValue;
                    continue;
                  }
                  const pm = productMasters.find((m) => m.product_name === productName);
                  existingHoldings.push({
                    id: virtualId,
                    product_name: productName,
                    product_code: pm?.product_code,
                    product_type: pm?.product_type,
                    risk_level: pm?.risk_level,
                    region: pm?.region,
                    purchase_amount: 0,
                    evaluation_amount: 0,
                    return_amount: 0,
                    return_rate: 0,
                    weight: 0,
                    reference_price: prices[key] ?? 0,
                  });
                  converted[virtualId] = pctValue;
                } else {
                  converted[key] = pctValue;
                  // 기존 holding에도 현재가 반영
                  const existH = existingHoldings.find((h) => h.id === key);
                  if (existH && prices[key]) {
                    existH.reference_price = prices[key];
                  }
                }
              }

              // reportData는 원본 유지, 신규 종목은 별도 저장
              const newHoldings = existingHoldings.filter((h) => h.id.startsWith('virtual_'));
              setReportExtraHoldings(newHoldings);
              setModifiedWeights(converted);
            }

            // AI 코멘트 복원 (suggestion에 저장된 것 우선)
            if (sug.ai_comment) {
              const changeIdx = sug.ai_comment.indexOf('[변경 분석]');
              if (changeIdx !== -1) {
                const analysis = sug.ai_comment.substring(0, changeIdx).replace('[포트폴리오 분석]', '').trim();
                const change = sug.ai_comment.substring(changeIdx).replace('[변경 분석]', '').trim();
                if (analysis) setAiComment(analysis);
                if (change) setAiChangeComment(change);
              } else {
                setAiComment(sug.ai_comment);
              }
            }

            // 담당자 의견: 48시간 이내면 복원
            if (sug.manager_note && sug.created_at) {
              const createdAt = new Date(sug.created_at);
              const hoursSince = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60);
              if (hoursSince <= 48) {
                setManagerNote(sug.manager_note);
              }
            }
          }
        } catch { /* suggestion 없음 - 무시 */ }
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : '오류 발생');
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
          holdings: (() => {
            const totalEval = reportData.snapshot?.total_evaluation ?? 0;
            return reportData.holdings?.map((h) => ({
              product_name: h.product_name,
              product_type: h.product_type,
              risk_level: h.risk_level,
              region: h.region,
              evaluation_amount: h.evaluation_amount,
              return_rate: h.return_rate,
              weight: h.weight ?? (totalEval > 0 && h.evaluation_amount ? parseFloat(((h.evaluation_amount / totalEval) * 100).toFixed(1)) : 0),
            }));
          })(),
          comment_type: 'analysis',
          changes_summary: (() => {
            if (!reportData.holdings || Object.keys(modifiedWeights).length === 0) return undefined;
            const totalEval = reportData.snapshot?.total_evaluation ?? 0;
            return reportData.holdings
              .filter((h) => modifiedWeights[h.id] != null)
              .map((h) => {
                const before = h.weight ?? (totalEval > 0 && h.evaluation_amount ? parseFloat(((h.evaluation_amount / totalEval) * 100).toFixed(1)) : 0);
                const after = modifiedWeights[h.id];
                const diff = after - before;
                if (after === 0) return `- [전액 매도] ${h.product_name}: ${before.toFixed(1)}% → 0%`;
                if (diff > 0.5) return `- [비중 확대] ${h.product_name}: ${before.toFixed(1)}% → ${after.toFixed(1)}% (+${diff.toFixed(1)}%p)`;
                if (diff < -0.5) return `- [비중 축소] ${h.product_name}: ${before.toFixed(1)}% → ${after.toFixed(1)}% (${diff.toFixed(1)}%p)`;
                return null;
              })
              .filter(Boolean)
              .join('\n') || undefined;
          })(),
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
          holdings: (() => {
            const totalEval = reportData.snapshot?.total_evaluation ?? 0;
            return reportData.holdings?.map((h) => ({
              product_name: h.product_name,
              product_type: h.product_type,
              risk_level: h.risk_level,
              region: h.region,
              evaluation_amount: h.evaluation_amount,
              return_rate: h.return_rate,
              weight: h.weight ?? (totalEval > 0 && h.evaluation_amount ? parseFloat(((h.evaluation_amount / totalEval) * 100).toFixed(1)) : 0),
            }));
          })(),
          holdings_after: (() => {
            return reportData.holdings?.filter((h) => modifiedWeights[h.id] != null).map((h) => ({
              product_name: h.product_name,
              product_type: h.product_type,
              region: h.region,
              weight: modifiedWeights[h.id],
            }));
          })(),
          comment_type: 'change',
          manager_note: managerNote || undefined,
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
    return tab3ClientId || '';
  }

  function getReportClient(): Client | undefined {
    return clients.find((c) => c.id === tab3ClientId);
  }

  /* ---------- tab3: stepped selection handlers ---------- */

  function handleTab3ClientChange(clientId: string) {
    setTab3ClientId(clientId);
    setSelectedAccountId('');
    setReportDateList([]);
    setReportDate('');
    setReportData(null);
    setReportClientName('');
    setModifiedWeights({});
    setAiComment('');
    setAiChangeComment('');
  }

  function handleTab3AccountChange(accountId: string) {
    setSelectedAccountId(accountId);
    setReportDate('');
    setReportData(null);
    setModifiedWeights({});
    setAiComment('');
    setAiChangeComment('');
    // Set client name
    const client = clients.find((c) => c.id === tab3ClientId);
    setReportClientName(client ? clientLabel(client) : '');
    loadReportDates(accountId);
  }

  /* ---------- tab4: handlers ---------- */

  function handleTab4ClientChange(clientId: string) {
    setTab4ClientId(clientId);
    setTab4FilterCompany('');
    setTab4FilterAccount('');
    setTab4Logs([]);
    setTab4LogsTotal(0);
    if (clientId) loadTab4Logs(clientId, '', '', tab4FilterPeriod);
  }

  async function loadTab4Logs(
    clientId: string,
    accountId: string,
    company: string,
    period: '6m' | '1y' | 'all',
  ) {
    if (!clientId) return;
    setTab4LogsLoading(true);
    try {
      const params = new URLSearchParams({ client_id: clientId, limit: '200' });
      if (accountId) params.set('account_id', accountId);
      if (company) params.set('securities_company', company);
      if (period !== 'all') {
        const now = new Date();
        const from = new Date(now);
        from.setMonth(from.getMonth() - (period === '6m' ? 6 : 12));
        params.set('date_from', from.toISOString().slice(0, 10));
      }
      const res = await fetch(`${API_URL}/api/v1/message-logs?${params}`, {
        headers: { ...authLib.getAuthHeader() },
      });
      if (res.ok) {
        const data = await res.json();
        setTab4Logs(data.items ?? []);
        setTab4LogsTotal(data.total ?? 0);
      }
    } catch { /* silent */ } finally {
      setTab4LogsLoading(false);
    }
  }

  async function handleTab4DownloadImage(logId: string) {
    try {
      const res = await fetch(`${API_URL}/api/v1/message-logs/${logId}/image`, {
        headers: { ...authLib.getAuthHeader() },
      });
      if (!res.ok) { showToast('이미지를 찾을 수 없습니다.'); return; }
      const blob = await res.blob();
      const { saveAs } = await import('file-saver');
      saveAs(blob, `report_${logId}.png`);
    } catch { showToast('다운로드 실패'); }
  }

  async function handleTab4DownloadPDF() {
    if (!tab4HistoryRef.current) return;
    setTab4PdfSaving(true);
    try {
      const html2canvas = (await import('html2canvas')).default;
      const { default: jsPDF } = await import('jspdf');
      const canvas = await html2canvas(tab4HistoryRef.current, { scale: 2 });
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const margin = 8;
      const contentW = pageW - margin * 2;
      const maxContentH = pageH - margin * 2;
      const mmPerPx = contentW / canvas.width;
      const pageSliceH = Math.floor(maxContentH / mmPerPx);
      let offset = 0;
      let isFirst = true;
      while (offset < canvas.height) {
        const sliceH = Math.min(pageSliceH, canvas.height - offset);
        if (sliceH <= 0) break;
        const sliceCanvas = document.createElement('canvas');
        sliceCanvas.width = canvas.width;
        sliceCanvas.height = sliceH;
        const ctx = sliceCanvas.getContext('2d');
        if (!ctx) break;
        ctx.drawImage(canvas, 0, offset, canvas.width, sliceH, 0, 0, canvas.width, sliceH);
        if (!isFirst) pdf.addPage();
        isFirst = false;
        const imgData = sliceCanvas.toDataURL('image/png');
        pdf.addImage(imgData, 'PNG', margin, margin, contentW, sliceH * mmPerPx);
        offset += sliceH;
      }
      const { saveAs } = await import('file-saver');
      const clientName = clients.find((c) => c.id === tab4ClientId)?.name ?? '전체';
      saveAs(pdf.output('blob'), `발송내역_${clientName}_${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'PDF 다운로드 실패');
    } finally {
      setTab4PdfSaving(false);
    }
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

  /* ---------- 알림톡 handlers ---------- */

  async function openAlimtalkModal(linkType: 'portal' | 'suggestion') {
    const client = getReportClient();
    if (!client) { showToast('고객을 선택하세요.'); return; }
    if (!client.phone) { showToast(`${client.name} 고객의 전화번호가 없습니다.`); return; }

    setAlimtalkModalType(linkType);
    setSelectedTemplateId('');
    setAlimtalkModalOpen(true);

    // 검수 통과된 템플릿 목록 조회
    setKakaoTemplatesLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/messaging/kakao-templates`, {
        headers: { ...authLib.getAuthHeader() },
      });
      if (res.ok) {
        const data = await res.json();
        // 솔라피 응답: { templateList: [...] } 또는 배열
        const list = Array.isArray(data) ? data : data.templateList ?? data.templates ?? [];
        setKakaoTemplates(list);
        if (list.length > 0) setSelectedTemplateId(list[0].templateId);
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(err?.detail || '알림톡 템플릿 조회 실패');
        setKakaoTemplates([]);
      }
    } catch {
      showToast('알림톡 템플릿 조회 오류');
      setKakaoTemplates([]);
    } finally {
      setKakaoTemplatesLoading(false);
    }
  }

  function getAlimtalkPreview(): { content: string; variables: Record<string, string> } {
    const template = kakaoTemplates.find((t) => t.templateId === selectedTemplateId);
    if (!template) return { content: '', variables: {} };

    const client = getReportClient();
    const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
    const portalToken = client?.portal_token ?? '';
    const link = alimtalkModalType === 'suggestion'
      ? `${baseUrl}/client/${portalToken}?view=suggestion`
      : `${baseUrl}/client/${portalToken}`;

    // 템플릿 본문 + 버튼 URL에서 변수 추출하고 자동 매핑
    const varPattern = /#\{([^}]+)\}/g;
    const variables: Record<string, string> = {};
    // 본문 + 버튼 URL 합쳐서 변수 추출
    let fullText = template.content;
    if (template.buttons) {
      for (const btn of template.buttons) {
        if (btn.linkMo) fullText += ' ' + btn.linkMo;
        if (btn.linkPc) fullText += ' ' + btn.linkPc;
      }
    }
    let match;
    while ((match = varPattern.exec(fullText)) !== null) {
      const varName = match[0]; // e.g. "#{고객명}"
      const key = match[1];     // e.g. "고객명"
      if (key === '고유번호' || key.includes('고유번호')) {
        variables[varName] = client?.unique_code ?? '';
      } else if (key.includes('고객') || key.includes('이름') || key === 'name') {
        variables[varName] = client?.name ?? '';
      } else if (key.includes('상품') || key.includes('계좌') || key === 'product') {
        const acctType = reportData?.account?.account_type ?? '';
        const label = acctType === 'irp' || acctType === 'IRP' ? 'IRP' : acctType.includes('연금') ? '연금저축' : acctType;
        variables[varName] = label;
      } else if (key.includes('변경제안') || key.includes('제안링크')) {
        // 변경제안링크는 https:// 제외한 도메인+경로
        variables[varName] = `${baseUrl.replace('https://', '')}/client/${portalToken}?view=suggestion`;
      } else if (key.includes('상시조회')) {
        // 상시조회링크: 솔라피 버튼 URL에 이미 도메인+경로 포함되어 있으므로 토큰만 전달
        variables[varName] = portalToken;
      } else if (key.includes('링크') || key.includes('link') || key === 'url') {
        variables[varName] = link;
      } else {
        variables[varName] = '';
      }
    }

    // 미리보기: 변수 치환
    let preview = template.content;
    for (const [k, v] of Object.entries(variables)) {
      preview = preview.replaceAll(k, v || `[${k}]`);
    }

    return { content: preview, variables };
  }

  async function handleSendAlimtalkConfirm() {
    const clientId = getReportClientId();
    if (!clientId || !selectedTemplateId) return;
    const client = getReportClient();
    if (!client?.phone) return;

    const { variables } = getAlimtalkPreview();

    setAlimtalkSending(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/messaging/send-alimtalk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
        body: JSON.stringify({
          client_id: clientId,
          template_id: selectedTemplateId,
          variables,
        }),
      });
      if (res.ok) {
        setAlimtalkModalOpen(false);
        showToast(`✓ ${client.name}님에게 알림톡이 발송되었습니다.`);

        // 내역관리 기록 저장
        try {
          const template = kakaoTemplates.find((t) => t.templateId === selectedTemplateId);
          const logForm = new FormData();
          logForm.append('client_id', clientId);
          if (selectedAccountId) logForm.append('client_account_id', selectedAccountId);
          logForm.append('message_type', alimtalkModalType === 'suggestion' ? 'alimtalk_suggestion' : 'alimtalk_portal');
          logForm.append('message_summary', `[알림톡] ${template?.name ?? selectedTemplateId}`.slice(0, 200));
          logForm.append('message_text', getAlimtalkPreview().content);
          logForm.append('sent_at', new Date().toISOString());

          // 변경제안일 때만 보고서 이미지 첨부
          if (alimtalkModalType === 'suggestion' && reportRef.current) {
            try {
              const html2canvas = (await import('html2canvas')).default;
              const noPrintEls = reportRef.current.querySelectorAll('[data-no-print]');
              noPrintEls.forEach((el) => ((el as HTMLElement).style.display = 'none'));
              const canvas = await html2canvas(reportRef.current, { scale: 1.5 });
              noPrintEls.forEach((el) => ((el as HTMLElement).style.display = ''));
              const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
              if (blob) logForm.append('image', blob, `report_${clientId}.png`);
            } catch { /* ignore */ }
          }

          await fetch(`${API_URL}/api/v1/message-logs`, {
            method: 'POST',
            headers: { ...authLib.getAuthHeader() },
            body: logForm,
          });
        } catch { /* 기록 저장 실패 무시 */ }
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(err?.detail || '알림톡 발송 실패');
      }
    } catch {
      showToast('알림톡 발송 중 오류가 발생했습니다.');
    } finally {
      setAlimtalkSending(false);
    }
  }

  async function openSmsModal(linkType: 'portal' | 'suggestion') {
    const client = getReportClient();
    if (!client) { showToast('고객을 선택하세요.'); return; }
    if (!client.portal_token) { showToast('포털 토큰이 없습니다.'); return; }
    if (!client.phone) { showToast(`${client.name} 고객의 전화번호가 없습니다.`); return; }

    const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
    const cLabel = `${client.name}(${client.unique_code || ''})`;

    let defaultMsg = '';
    if (linkType === 'suggestion') {
      const link = `${baseUrl}/client/${client.portal_token}?view=suggestion`;
      defaultMsg = `[Working Hub] ${cLabel}님,\n포트폴리오 변경 제안이 도착했습니다.\n아래 링크에서 확인해주세요.\n${link}`;
    } else {
      const link = `${baseUrl}/client/${client.portal_token}`;
      defaultMsg = `[Working Hub] ${cLabel}님,\n포트폴리오 현황을 확인하세요.\n${link}`;
    }

    setSmsModalType(linkType);
    setSmsMessage(defaultMsg);
    setSmsTemplateName('');
    setSmsModalOpen(true);

    // DB에서 템플릿 로드
    try {
      const res = await fetch(`${API_URL}/api/v1/sms-templates`, { headers: { ...authLib.getAuthHeader() } });
      if (res.ok) {
        const data = await res.json();
        setSmsTemplates(data.map((t: { id: string; name: string; text: string }) => ({ id: t.id, name: t.name, text: t.text })));
      }
    } catch { /* silent */ }
  }

  async function saveSmsTemplate() {
    if (!smsTemplateName.trim()) { alert('템플릿 이름을 입력하세요.'); return; }
    try {
      const existing = smsTemplates.find((t) => t.name === smsTemplateName.trim());
      if (existing) {
        await fetch(`${API_URL}/api/v1/sms-templates/${existing.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
          body: JSON.stringify({ text: smsMessage }),
        });
      } else {
        await fetch(`${API_URL}/api/v1/sms-templates`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
          body: JSON.stringify({ name: smsTemplateName.trim(), text: smsMessage }),
        });
      }
      // 다시 로드
      const res = await fetch(`${API_URL}/api/v1/sms-templates`, { headers: { ...authLib.getAuthHeader() } });
      if (res.ok) setSmsTemplates(await res.json());
      setSmsTemplateName('');
      showToast('템플릿이 저장되었습니다.');
    } catch { showToast('템플릿 저장 실패'); }
  }

  async function deleteSmsTemplate(id: string) {
    try {
      await fetch(`${API_URL}/api/v1/sms-templates/${id}`, {
        method: 'DELETE',
        headers: { ...authLib.getAuthHeader() },
      });
      setSmsTemplates((prev) => prev.filter((t) => t.id !== id));
    } catch { /* silent */ }
  }

  async function handleSendSmsConfirm() {
    const clientId = getReportClientId();
    if (!clientId) return;
    const client = getReportClient();
    if (!client?.phone) return;

    setSmsSending(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/messaging/send-sms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
        body: JSON.stringify({ client_id: clientId, message: smsMessage }),
      });
      if (res.ok) {
        // 발송 기록 자동 저장
        const logFormData = new FormData();
        logFormData.append('client_id', clientId);
        if (selectedAccountId) logFormData.append('client_account_id', selectedAccountId);
        const msgType = smsModalType === 'suggestion' ? 'suggestion_link' : 'portal_link';
        logFormData.append('message_type', msgType);

        // 링크 URL 제거한 문자 내용 저장
        const msgWithoutLink = smsMessage.replace(/https?:\/\/\S+/g, '').replace(/\n{2,}/g, '\n').trim();
        logFormData.append('message_summary', msgWithoutLink.slice(0, 200));
        logFormData.append('message_text', msgWithoutLink);
        logFormData.append('sent_at', new Date().toISOString());

        // 변경 제안 링크 발송 시에만 보고서 이미지 캡처
        if (smsModalType === 'suggestion' && reportRef.current) {
          try {
            const html2canvas = (await import('html2canvas')).default;
            const noPrintEls = reportRef.current.querySelectorAll('[data-no-print]');
            noPrintEls.forEach((el) => ((el as HTMLElement).style.display = 'none'));
            const canvas = await html2canvas(reportRef.current, { scale: 1.5 });
            noPrintEls.forEach((el) => ((el as HTMLElement).style.display = ''));
            const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
            if (blob) logFormData.append('image', blob, `report_${clientId}.png`);
          } catch { /* 이미지 캡처 실패 시 무시 */ }
        }

        setSmsModalOpen(false);
        showToast(`✓ ${client.name}님에게 문자가 발송되었습니다.`);

        // 로그 저장 (비동기 — UI 블로킹 없음)
        try {
          const logRes = await fetch(`${API_URL}/api/v1/message-logs`, {
            method: 'POST',
            headers: { ...authLib.getAuthHeader() },
            body: logFormData,
          });
          if (!logRes.ok) {
            console.error('발송 기록 저장 실패:', await logRes.text());
          }
        } catch (e) { console.error('발송 기록 저장 오류:', e); }
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(err?.detail || '문자 발송 실패');
      }
    } catch {
      showToast('문자 발송 중 오류가 발생했습니다.');
    } finally {
      setSmsSending(false);
    }
  }

  /* ---------- 보고서 저장 (이미지 + suggestion 생성 + 내역관리 기록) ---------- */
  async function handleSaveReport() {
    if (!reportRef.current || !reportData) return;
    if (!aiComment || !aiChangeComment) {
      alert('AI 분석 코멘트 2개를 모두 생성해주세요.');
      return;
    }
    setReportSaving(true);
    try {
      const html2canvas = (await import('html2canvas')).default;

      // 1) 보고서 이미지 캡처
      const noPrintEls = reportRef.current.querySelectorAll('[data-no-print]');
      noPrintEls.forEach((el) => ((el as HTMLElement).style.display = 'none'));
      const canvas = await html2canvas(reportRef.current, { scale: 2 });
      noPrintEls.forEach((el) => ((el as HTMLElement).style.display = ''));

      const imageBlob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), 'image/png')
      );
      if (!imageBlob) { alert('이미지 생성 실패'); return; }

      // 2) Suggestion 생성 (변경제안 링크용)
      const snapshotId = reportData.snapshot?.id;
      const accountId = reportData.account?.id;
      if (!snapshotId || !accountId) { alert('스냅샷 정보가 없습니다.'); return; }

      // Build weights + prices for all products (including new/virtual)
      const sugWeights: Record<string, number> = {};
      const sugPrices: Record<string, number> = {};
      const allHoldings = [...(reportData.holdings || []), ...reportExtraHoldings];
      for (const [id, val] of Object.entries(modifiedWeights)) {
        sugWeights[id] = val / 100;
        // Find the holding's reference price (original + extra/new holdings)
        const h = allHoldings.find((hh: { id: string }) => hh.id === id);
        const price = h?.reference_price ?? h?.current_price ?? 0;
        if (price > 0) sugPrices[id] = price;
      }

      // _full_table: 3번탭 저장 시에도 2번탭에서 저장된 전체 테이블 유지
      // (ReportView의 WeightEditor 데이터로 재구성)
      const totalEval = allHoldings.reduce((s, h) => s + (h.evaluation_amount ?? 0), 0);
      const fullTable = allHoldings
        .filter((h) => modifiedWeights[h.id] !== undefined || (h.product_name ?? '').match(/예수금|자동운용상품/))
        .map((h, idx) => {
          const w = modifiedWeights[h.id] ?? 0;
          const rebalAmt = Math.round(totalEval * w / 100);
          const sellBuy = rebalAmt - (h.evaluation_amount ?? 0);
          const price = h.reference_price ?? h.current_price ?? 0;
          const isFund = (h.product_type ?? '').includes('펀드') || (h.product_name ?? '').includes('신탁');
          const shares = price > 0 && Math.abs(sellBuy) >= 50000
            ? (isFund ? Math.floor(Math.abs(sellBuy) * 1000 / price) * (sellBuy >= 0 ? 1 : -1) : Math.floor(Math.abs(sellBuy) / price) * (sellBuy >= 0 ? 1 : -1))
            : 0;
          return {
            seq: idx + 1,
            product_name: h.product_name,
            product_code: h.product_code || '',
            product_type: h.product_type || '',
            risk_level: h.risk_level || '',
            region: h.region || '',
            quantity: h.quantity ?? 0,
            reference_price: price,
            purchase_amount: h.purchase_amount ?? 0,
            evaluation_amount: h.evaluation_amount ?? 0,
            return_amount: h.return_amount ?? 0,
            return_rate: h.return_rate ?? 0,
            eval_ratio: totalEval > 0 ? parseFloat(((h.evaluation_amount ?? 0) / totalEval * 100).toFixed(2)) : 0,
            rebal_ratio: w,
            rebal_amount: rebalAmt,
            sell_buy: Math.abs(sellBuy) < 50000 ? 0 : sellBuy,
            shares,
            is_new: h.id.startsWith('virtual_'),
            is_deposit: (h.product_name ?? '').match(/예수금|자동운용상품/) !== null,
          };
        });

      const sugPayload = {
        account_id: accountId,
        snapshot_id: snapshotId,
        suggested_weights: { ...sugWeights, _prices: sugPrices, _full_table: fullTable },
        ai_comment: `[포트폴리오 분석]\n${aiComment}\n\n[변경 분석]\n${aiChangeComment}`,
        manager_note: managerNote || null,
      };

      let suggestionId = savedSuggestionId;

      if (savedSuggestionId) {
        // 기존 suggestion 업데이트
        const updateRes = await fetch(`${API_URL}/api/v1/portfolios/suggestions/${savedSuggestionId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
          body: JSON.stringify(sugPayload),
        });
        if (!updateRes.ok) {
          // PUT 실패 시 새로 생성
          const createRes = await fetch(`${API_URL}/api/v1/portfolios/suggestions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
            body: JSON.stringify(sugPayload),
          });
          if (createRes.ok) {
            const d = await createRes.json();
            suggestionId = d.suggestion_id || d.id || '';
          }
        }
      } else {
        // 새로 생성
        const createRes = await fetch(`${API_URL}/api/v1/portfolios/suggestions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
          body: JSON.stringify(sugPayload),
        });
        if (createRes.ok) {
          const d = await createRes.json();
          suggestionId = d.suggestion_id || d.id || '';
        }
      }
      setSavedSuggestionId(suggestionId);

      // 3) 4번 탭 내역관리에 기록 추가
      const logForm = new FormData();
      logForm.append('client_id', tab3ClientId);
      logForm.append('client_account_id', accountId);
      logForm.append('log_type', 'suggestion');
      logForm.append('message_text', `[보고서 저장] ${reportClientName} - ${reportDate} | AI 분석 완료`);
      logForm.append('sent_at', new Date().toISOString());
      logForm.append('image', imageBlob, `${reportClientName}_보고서_${reportDate}.png`);

      await fetch(`${API_URL}/api/v1/message-logs`, {
        method: 'POST',
        headers: { ...authLib.getAuthHeader() },
        body: logForm,
      });

      setReportSaved(true);
      showToast('보고서가 저장되었습니다.');
    } catch (e) {
      alert(e instanceof Error ? e.message : '보고서 저장 실패');
    } finally {
      setReportSaving(false);
    }
  }

  async function handleSaveImage() {
    if (!reportRef.current) return;
    setSaving(true);
    try {
      const html2canvas = (await import('html2canvas')).default;
      const { saveAs } = await import('file-saver');
      // 다운로드 시 숨길 요소 처리
      const noPrintEls = reportRef.current.querySelectorAll('[data-no-print]');
      noPrintEls.forEach((el) => ((el as HTMLElement).style.display = 'none'));
      const canvas = await html2canvas(reportRef.current, { scale: 2 });
      noPrintEls.forEach((el) => ((el as HTMLElement).style.display = ''));
      canvas.toBlob((blob) => {
        if (blob) saveAs(blob, `${reportClientName}_보고서_${reportDate}.png`);
        else alert('이미지 생성 실패');
      }, 'image/png');
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
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const margin = 8;
      const contentW = pageW - margin * 2;
      const maxContentH = pageH - margin * 2;

      const container = reportRef.current;

      // 각 페이지 div를 개별 캡처
      const pageDivs = container.querySelectorAll('[data-pdf-page]');

      // 다운로드 시 숨길 요소 처리
      const noPrintEls = container.querySelectorAll('[data-no-print]');
      noPrintEls.forEach((el) => ((el as HTMLElement).style.display = 'none'));

      let isFirstPage = true;

      for (const pageDiv of Array.from(pageDivs)) {
        const el = pageDiv as HTMLElement;

        // 이 페이지 div를 개별 캡처
        const pageCanvas = await html2canvas(el, { scale: 2, useCORS: true });

        const mmPerPx = contentW / pageCanvas.width;
        const pageSliceH = Math.floor(maxContentH / mmPerPx);

        // 페이지 내용이 A4 한 페이지보다 길면 자동 분할
        let offset = 0;
        while (offset < pageCanvas.height) {
          const sliceH = Math.min(pageSliceH, pageCanvas.height - offset);
          if (sliceH <= 0) break;

          const sliceCanvas = document.createElement('canvas');
          sliceCanvas.width = pageCanvas.width;
          sliceCanvas.height = sliceH;
          const ctx = sliceCanvas.getContext('2d');
          if (!ctx) break;
          ctx.drawImage(pageCanvas, 0, offset, pageCanvas.width, sliceH, 0, 0, pageCanvas.width, sliceH);

          if (!isFirstPage) pdf.addPage();
          isFirstPage = false;

          const imgData = sliceCanvas.toDataURL('image/png');
          const imgH = sliceH * mmPerPx;
          pdf.addImage(imgData, 'PNG', margin, margin, contentW, imgH);

          offset += sliceH;
        }
      }

      noPrintEls.forEach((el) => ((el as HTMLElement).style.display = ''));

      // file-saver로 다운로드
      const { saveAs } = await import('file-saver');
      const pdfBlob = pdf.output('blob');
      saveAs(pdfBlob, `${reportClientName}_보고서_${reportDate}.pdf`);
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

  /* Unique clients (deduplicated by name) — shared across Tab3 / Tab4 */
  const mainUniqueClientsMap = new Map<string, { id: string; name: string; unique_code?: string; accounts: ClientAccount[] }>();
  for (const c of clients) {
    if (mainUniqueClientsMap.has(c.name)) {
      const existing = mainUniqueClientsMap.get(c.name)!;
      existing.accounts = [...existing.accounts, ...c.accounts];
    } else {
      mainUniqueClientsMap.set(c.name, { id: c.id, name: c.name, unique_code: c.unique_code, accounts: [...c.accounts] });
    }
  }
  const mainUniqueClients = Array.from(mainUniqueClientsMap.values()).sort((a, b) => {
    if (clientSortByDate) {
      const da = suggestionLatestDates[a.id] || '';
      const db_ = suggestionLatestDates[b.id] || '';
      if (da !== db_) return db_.localeCompare(da);
      return a.name.localeCompare(b.name, 'ko');
    }
    return a.name.localeCompare(b.name, 'ko');
  });

  const allAccountsForReport = clients.flatMap((c) =>
    c.accounts.map((a) => ({
      accountId: a.id,
      clientName: clientLabel(c),
      label: `${clientLabel(c)} - ${accountTypeLabel(a.account_type)}${a.account_number ? ` (${a.account_number})` : ''}`,
    }))
  );

  /* Tab3: stepped selection derived */
  const tab3SelectedClientName = clients.find((c) => c.id === tab3ClientId)?.name ?? '';
  const tab3ClientAccounts: ClientAccount[] = tab3SelectedClientName
    ? clients.filter((c) => c.name === tab3SelectedClientName).flatMap((c) => c.accounts)
    : [];
  const tab3SelectedAccount = tab3ClientAccounts.find((a) => a.id === selectedAccountId);

  /* Tab4: derived */
  const tab4SelectedClientName = clients.find((c) => c.id === tab4ClientId)?.name ?? '';
  const tab4ClientAccounts: ClientAccount[] = tab4SelectedClientName
    ? clients.filter((c) => c.name === tab4SelectedClientName).flatMap((c) => c.accounts)
    : [];
  const tab4SecuritiesCompanies = [...new Set(tab4ClientAccounts.map((a) => a.securities_company).filter(Boolean))] as string[];

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
                  계좌정보 관리
                </button>
                <button
                  onClick={() => { setNameChangeMemoOpen(true); loadNameChanges(); }}
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
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                  상품명 변경 메모
                </button>
                {/* 고객 추가 버튼은 계좌정보 관리 팝업에서 처리 */}
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
              "계좌정보 관리"에서 고객을 등록한 후, 고객을 선택하고 이미지를 붙여넣으세요.
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
                                    data-tooltip={h.productName}
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
                                    <button type="button" data-tooltip="상품 마스터에 등록"
                                      onClick={() => openRegisterModal(h.productName)}
                                      style={{ width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #FCD34D', borderRadius: 4, backgroundColor: '#FEF3C7', cursor: 'pointer', color: '#D97706', fontSize: '0.6rem' }}>
                                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                                    </button>
                                    {/* 불러오기 아이콘 */}
                                    <button type="button" data-tooltip="상품 마스터에서 불러오기"
                                      onClick={() => {
                                        setLoadMasterTarget({ snapshotId: er.snapshotId, holdingId: h.holdingId, productName: h.productName, accountType: er.accountType });
                                        setLoadMasterSearch(h.productName);
                                      }}
                                      style={{ width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #93C5FD', borderRadius: 4, backgroundColor: '#EFF6FF', cursor: 'pointer', color: '#2563EB', fontSize: '0.6rem' }}>
                                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                                    </button>
                                    {/* 위에 행 추가 */}
                                    <button type="button" data-tooltip="위에 행 추가"
                                      onClick={() => addHoldingRow(er.snapshotId, idx, 'above')}
                                      style={{ width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #D1D5DB', borderRadius: 4, backgroundColor: '#F9FAFB', cursor: 'pointer', color: '#6B7280' }}>
                                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="18 15 12 9 6 15"/></svg>
                                    </button>
                                    {/* 아래에 행 추가 */}
                                    <button type="button" data-tooltip="아래에 행 추가"
                                      onClick={() => addHoldingRow(er.snapshotId, idx, 'below')}
                                      style={{ width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #D1D5DB', borderRadius: 4, backgroundColor: '#F9FAFB', cursor: 'pointer', color: '#6B7280' }}>
                                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9"/></svg>
                                    </button>
                                    {/* 수동 추가 행 삭제 */}
                                    {h.holdingId.startsWith('__manual__') && (
                                      <button type="button" data-tooltip="행 삭제"
                                        onClick={() => removeHoldingRow(er.snapshotId, h.holdingId)}
                                        style={{ width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #FECACA', borderRadius: 4, backgroundColor: '#FEF2F2', cursor: 'pointer', color: '#EF4444' }}>
                                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                                      </button>
                                    )}
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
                            {!er.accountType?.startsWith('pension') && (
                              <>
                                <th style={{ padding: '9px 10px', textAlign: 'right', fontSize: '0.75rem', fontWeight: 600, color: '#6B7280', borderBottom: '1px solid #E1E5EB', whiteSpace: 'nowrap', minWidth: 90 }}>총입금액</th>
                                <th style={{ padding: '9px 10px', textAlign: 'right', fontSize: '0.75rem', fontWeight: 600, color: '#6B7280', borderBottom: '1px solid #E1E5EB', whiteSpace: 'nowrap', minWidth: 90 }}>총출금액</th>
                              </>
                            )}
                            <th style={{ padding: '9px 10px', textAlign: 'right', fontSize: '0.75rem', fontWeight: 600, color: '#6B7280', borderBottom: '1px solid #E1E5EB', whiteSpace: 'nowrap', minWidth: 90 }}>평가금액</th>
                            <th style={{ padding: '9px 10px', textAlign: 'right', fontSize: '0.75rem', fontWeight: 600, color: '#6B7280', borderBottom: '1px solid #E1E5EB', whiteSpace: 'nowrap', minWidth: 90 }}>평가손익</th>
                            <th style={{ padding: '9px 10px', textAlign: 'right', fontSize: '0.75rem', fontWeight: 600, color: '#6B7280', borderBottom: '1px solid #E1E5EB', whiteSpace: 'nowrap', minWidth: 70 }}>수익률</th>
                          </tr>
                        </thead>
                        <tbody>
                          {er.holdings.map((h) => {
                            const rowBg = h.unmapped ? '#FEF9C3' : 'transparent';
                            const calcReturnAmt = (h.evaluationAmount != null && h.purchaseAmount != null)
                              ? h.evaluationAmount - h.purchaseAmount
                              : h.returnAmount ?? null;
                            const calcReturnRate = (calcReturnAmt != null && h.purchaseAmount != null && h.purchaseAmount !== 0)
                              ? (calcReturnAmt / h.purchaseAmount) * 100
                              : null;
                            const returnColor = calcReturnAmt == null ? '#374151' : calcReturnAmt > 0 ? '#10B981' : calcReturnAmt < 0 ? '#EF4444' : '#374151';
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
                                  ...(!er.accountType?.startsWith('pension') ? [
                                    { key: 'totalDeposit', val: h.totalDeposit },
                                    { key: 'totalWithdrawal', val: h.totalWithdrawal },
                                  ] : []),
                                  { key: 'evaluationAmount', val: h.evaluationAmount },
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
                                {/* 평가손익 (자동계산: 평가금액 - 매입금액) */}
                                <td style={{ padding: '8px 10px', textAlign: 'right', color: returnColor, fontWeight: 500, borderBottom: '1px solid #F3F4F6', whiteSpace: 'nowrap' }}>
                                  {calcReturnAmt != null
                                    ? `${calcReturnAmt > 0 ? '+' : ''}${calcReturnAmt.toLocaleString('ko-KR')}`
                                    : '-'}
                                </td>
                                {/* 수익률 (자동계산: 평가손익 / 매입금액) */}
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
          clientLatestDates={clientLatestDates}
          clientSortByDate={clientSortByDate}
          setClientSortByDate={setClientSortByDate}
        />
      )}

      {/* ===================================================== */}
      {/* TAB 3: 보고서                                          */}
      {/* ===================================================== */}
      {activeTab === 'report' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* 컨트롤 바 — 고객검색 → 선택 → 계좌유형 → 기준일 */}
          <Card padding={16}>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              {/* 고객 검색 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 140 }}>
                <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#374151' }}>고객 검색</label>
                <div style={{ position: 'relative' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2"
                    style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
                    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  <input
                    type="text"
                    placeholder="이름/고유번호"
                    value={tab3ClientSearch}
                    onChange={(e) => setTab3ClientSearch(e.target.value)}
                    style={{ width: '100%', padding: '8px 10px 8px 28px', fontSize: '0.8125rem', border: '1px solid #E1E5EB', borderRadius: 8, outline: 'none', color: '#1A1A2E', boxSizing: 'border-box' }}
                  />
                </div>
              </div>

              {/* 고객 선택 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 220, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#374151' }}>고객 선택</label>
                  <button
                    onClick={() => setClientSortByDate(!clientSortByDate)}
                    title={clientSortByDate ? '이름순으로 전환' : '저장일순으로 전환 (저장일 = 수정 포트폴리오 최신 저장일)'}
                    style={{ padding: '2px 6px', fontSize: '0.6875rem', fontWeight: 600, color: clientSortByDate ? '#fff' : '#6B7280', backgroundColor: clientSortByDate ? '#1E3A5F' : '#F3F4F6', border: '1px solid #D1D5DB', borderRadius: 4, cursor: 'pointer' }}
                  >
                    {clientSortByDate ? '저장일순' : '이름순'}
                  </button>
                </div>
                <select
                  value={tab3ClientId}
                  onChange={(e) => { handleTab3ClientChange(e.target.value); setTab3ClientSearch(''); }}
                  style={{ padding: '8px 10px', fontSize: '0.8125rem', border: '1px solid #E1E5EB', borderRadius: 8, outline: 'none', color: tab3ClientId ? '#1A1A2E' : '#9CA3AF', backgroundColor: '#fff', cursor: 'pointer' }}
                >
                  <option value="">-- 고객 선택 --</option>
                  {mainUniqueClients
                    .filter((c) => {
                      if (!tab3ClientSearch.trim()) return true;
                      const q = tab3ClientSearch.trim().toLowerCase();
                      return c.name.toLowerCase().includes(q) || (c.unique_code ?? '').includes(q);
                    })
                    .map((c) => (
                      <option key={c.name} value={c.id}>{clientLabel(c, suggestionLatestDates[c.id])}</option>
                    ))}
                </select>
              </div>

              {/* 계좌 유형 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 120 }}>
                <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#374151' }}>계좌 유형</label>
                <select
                  value={selectedAccountId}
                  onChange={(e) => handleTab3AccountChange(e.target.value)}
                  disabled={!tab3ClientId}
                  style={{ padding: '8px 10px', fontSize: '0.8125rem', border: '1px solid #E1E5EB', borderRadius: 8, outline: 'none', color: selectedAccountId ? '#1A1A2E' : '#9CA3AF', backgroundColor: tab3ClientId ? '#fff' : '#F9FAFB', cursor: tab3ClientId ? 'pointer' : 'not-allowed', opacity: tab3ClientId ? 1 : 0.6 }}
                >
                  <option value="">-- 유형 선택 --</option>
                  {tab3ClientAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {accountTypeLabel(a.account_type)}
                    </option>
                  ))}
                </select>
              </div>

              {/* 증권사 + 계좌번호 (read-only) */}
              {tab3SelectedAccount && (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 100 }}>
                    <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#374151' }}>증권사</label>
                    <div style={{ padding: '8px 10px', fontSize: '0.8125rem', border: '1px solid #E1E5EB', borderRadius: 8, backgroundColor: '#F9FAFB', color: '#374151' }}>
                      {tab3SelectedAccount.securities_company || '-'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 120 }}>
                    <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#374151' }}>계좌번호</label>
                    <div style={{ padding: '8px 10px', fontSize: '0.8125rem', border: '1px solid #E1E5EB', borderRadius: 8, backgroundColor: '#F9FAFB', color: '#374151' }}>
                      {tab3SelectedAccount.account_number || '-'}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Row 2: 기준일 + 보고서 생성 */}
            {selectedAccountId && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, paddingTop: 12, borderTop: '1px solid #F3F4F6' }}>
                <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#374151', whiteSpace: 'nowrap' }}>
                  기준일
                </label>
                <select
                  value={reportDate}
                  onChange={(e) => setReportDate(e.target.value)}
                  disabled={reportDateList.length === 0}
                  style={{
                    padding: '7px 10px',
                    fontSize: '0.8125rem',
                    border: '1px solid #E1E5EB',
                    borderRadius: 8,
                    outline: 'none',
                    color: '#1A1A2E',
                    cursor: 'pointer',
                    minWidth: 140,
                  }}
                >
                  {reportDateList.length === 0 ? (
                    <option value="">{reportDateLoading ? '로딩 중...' : '날짜를 선택하세요'}</option>
                  ) : (
                    reportDateItems.map((item) => (
                      <option key={item.date} value={item.date}>
                        {item.date}{item.has_report ? ' ✓ 보고서 저장됨' : ''}
                      </option>
                    ))
                  )}
                </select>

                <Button
                  variant="primary"
                  size="sm"
                  loading={reportLoading}
                  onClick={loadReport}
                  disabled={!selectedAccountId || !reportDate}
                >
                  보고서 생성
                </Button>
              </div>
            )}
          </Card>

          {/* 고객 링크 발송 섹션 */}
          {reportData && (() => {
            const client = getReportClient();
            const portalToken = client?.portal_token;
            const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
            const permanentLink = portalToken ? `${baseUrl}/client/${portalToken}` : null;
            const suggestLink = (portalToken && reportSaved) ? `${baseUrl}/client/${portalToken}?view=suggestion` : null;
            const btnBase: React.CSSProperties = {
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '6px 12px', fontSize: '0.75rem', fontWeight: 600,
              borderRadius: 6, cursor: 'pointer', transition: 'all 0.15s ease',
            };
            return (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {/* 상시 링크 */}
                <div style={{ backgroundColor: '#F0F4FF', border: '1px solid #C7D7F9', borderRadius: 10, padding: '14px 16px', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1E3A5F" strokeWidth="2">
                      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                    </svg>
                    <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#1E3A5F' }}>상시 조회 링크</span>
                  </div>
                  <div style={{ fontSize: '0.6875rem', color: '#6B7280', marginBottom: 6 }}>계좌정보 · 포트폴리오 · 분석표 · AI 보고서</div>
                  <div style={{ padding: '6px 10px', backgroundColor: '#fff', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: '0.6875rem', color: portalToken ? '#374151' : '#9CA3AF', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 8 }}>
                    {permanentLink ?? '포털 토큰 없음'}
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button onClick={handleCopyPortalLink}
                      style={{ ...btnBase, color: '#374151', backgroundColor: '#fff', border: '1px solid #D1D5DB' }}>
                      링크 복사
                    </button>
                    <button disabled={smsSending} onClick={() => openSmsModal('portal')}
                      style={{ ...btnBase, color: '#fff', backgroundColor: smsSending ? '#9CA3AF' : '#059669', border: 'none' }}>
                      {smsSending ? '발송 중...' : '문자 발송'}
                    </button>
                    <button disabled={alimtalkSending} onClick={() => openAlimtalkModal('portal')}
                      style={{ ...btnBase, color: '#92400E', backgroundColor: alimtalkSending ? '#E5E7EB' : '#FEF3C7', border: '1px solid #FCD34D' }}>
                      {alimtalkSending ? '발송 중...' : '알림톡 발송'}
                    </button>
                  </div>
                </div>

                {/* 변경 제안 링크 */}
                <div style={{ backgroundColor: '#FFFBEB', border: '1px solid #FCD34D', borderRadius: 10, padding: '14px 16px', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                    <span style={{ fontSize: 12 }}>✨</span>
                    <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#92400E' }}>변경 제안 링크</span>
                  </div>
                  <div style={{ fontSize: '0.6875rem', color: '#6B7280', marginBottom: 6 }}>위 항목 + 수정 포트폴리오 · AI 변경 분석</div>
                  <div style={{ padding: '6px 10px', backgroundColor: '#fff', border: '1px solid #FCD34D', borderRadius: 6, fontSize: '0.6875rem', color: suggestLink ? '#92400E' : '#9CA3AF', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 4 }}>
                    {suggestLink ?? (reportSaved ? '생성 중...' : '보고서를 저장하면 링크가 생성됩니다')}
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <button onClick={() => {
                      if (!reportSaved) { alert('보고서를 먼저 저장해 주세요.'); return; }
                      if (!suggestLink) { showToast('링크가 아직 생성되지 않았습니다.'); return; }
                      navigator.clipboard.writeText(suggestLink).then(
                        () => showToast('변경 제안 링크가 복사되었습니다.'),
                        () => showToast('복사에 실패했습니다.')
                      );
                    }}
                      style={{ ...btnBase, color: '#374151', backgroundColor: '#fff', border: '1px solid #D1D5DB', opacity: reportSaved ? 1 : 0.5 }}>
                      링크 복사
                    </button>
                    <button
                      disabled={smsSending || !reportSaved}
                      onClick={() => {
                        if (!reportSaved) { alert('보고서를 먼저 저장해 주세요.'); return; }
                        openSmsModal('suggestion');
                      }}
                      style={{ ...btnBase, color: '#fff', backgroundColor: (smsSending || !reportSaved) ? '#9CA3AF' : '#059669', border: 'none' }}>
                      {smsSending ? '발송 중...' : '문자 발송'}
                    </button>
                    <button disabled={alimtalkSending || !reportSaved} onClick={() => {
                        if (!reportSaved) { alert('보고서를 먼저 저장해 주세요.'); return; }
                        openAlimtalkModal('suggestion');
                      }}
                      style={{ ...btnBase, color: '#92400E', backgroundColor: (alimtalkSending || !reportSaved) ? '#E5E7EB' : '#FEF3C7', border: '1px solid #FCD34D' }}>
                      {alimtalkSending ? '발송 중...' : '알림톡 발송'}
                    </button>
                    {reportSaved && <span style={{ fontSize: '0.5625rem', color: '#9CA3AF' }}>* 유효 7일</span>}
                  </div>
                </div>

                {/* 토스트 메시지 */}
                {portalLinkToast && (
                  <div style={{
                    padding: '8px 12px',
                    backgroundColor: portalLinkToast.includes('실패') || portalLinkToast.includes('오류') ? '#FEF2F2' : '#ECFDF5',
                    border: `1px solid ${portalLinkToast.includes('실패') || portalLinkToast.includes('오류') ? '#FECACA' : '#A7F3D0'}`,
                    borderRadius: 6, fontSize: '0.8125rem', fontWeight: 500,
                    color: portalLinkToast.includes('실패') || portalLinkToast.includes('오류') ? '#DC2626' : '#059669',
                  }}>
                    {portalLinkToast}
                  </div>
                )}
              </div>

            );
          })()}

          {/* SMS 미리보기/발송 모달 */}
          {smsModalOpen && (
            <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)' }}
              onClick={(e) => { if (e.target === e.currentTarget) setSmsModalOpen(false); }}>
              <div style={{ backgroundColor: '#fff', borderRadius: 14, padding: 24, width: '100%', maxWidth: 480, maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#1A1A2E' }}>
                    문자 발송 {smsModalType === 'suggestion' ? '(변경 제안)' : '(포트폴리오 조회)'}
                  </h3>
                  <button onClick={() => setSmsModalOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', padding: 4 }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                </div>

                {/* 수신자 정보 */}
                <div style={{ backgroundColor: '#F9FAFB', borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: '0.8125rem', color: '#374151' }}>
                  <span style={{ fontWeight: 600 }}>수신자:</span> {(() => { const c = getReportClient(); return c ? `${c.name} (${c.phone || '전화번호 없음'})` : '-'; })()}
                </div>

                {/* 저장된 템플릿 선택 */}
                {smsTemplates.length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#6B7280', display: 'block', marginBottom: 4 }}>저장된 템플릿</label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {smsTemplates.map((t) => (
                        <div key={t.name} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                          <button onClick={() => setSmsMessage(t.text)}
                            style={{ padding: '4px 10px', fontSize: '0.75rem', fontWeight: 500, color: '#1E3A5F', backgroundColor: '#EEF2F7', border: '1px solid #C7D2E2', borderRadius: 6, cursor: 'pointer' }}>
                            {t.name}
                          </button>
                          <button onClick={() => deleteSmsTemplate(t.id)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#D1D5DB', padding: 0, fontSize: '0.75rem', lineHeight: 1 }}>×</button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 메시지 편집 */}
                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#6B7280', display: 'block', marginBottom: 4 }}>메시지 내용</label>
                  <textarea
                    value={smsMessage}
                    onChange={(e) => setSmsMessage(e.target.value)}
                    rows={6}
                    style={{ width: '100%', padding: '10px 12px', fontSize: '0.8125rem', border: '1px solid #E1E5EB', borderRadius: 8, outline: 'none', resize: 'vertical', lineHeight: 1.6, boxSizing: 'border-box', color: '#1A1A2E' }}
                  />
                  <span style={{ fontSize: '0.6875rem', color: '#9CA3AF' }}>
                    {new TextEncoder().encode(smsMessage).length > 90 ? 'LMS (장문)' : 'SMS (단문)'} · {smsMessage.length}자
                  </span>
                </div>

                {/* 템플릿 저장 */}
                <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
                  <input type="text" placeholder="템플릿 이름 입력 후 저장" value={smsTemplateName}
                    onChange={(e) => setSmsTemplateName(e.target.value)}
                    style={{ flex: 1, padding: '6px 10px', fontSize: '0.8125rem', border: '1px solid #E1E5EB', borderRadius: 6, outline: 'none' }} />
                  <button onClick={saveSmsTemplate}
                    style={{ padding: '6px 14px', fontSize: '0.8125rem', fontWeight: 600, color: '#6B7280', backgroundColor: '#F3F4F6', border: '1px solid #E1E5EB', borderRadius: 6, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                    템플릿 저장
                  </button>
                </div>

                {/* 발송/취소 */}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => setSmsModalOpen(false)}
                    style={{ flex: 1, padding: '10px', fontSize: '0.875rem', fontWeight: 600, color: '#6B7280', backgroundColor: '#F3F4F6', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
                    취소
                  </button>
                  <button onClick={handleSendSmsConfirm} disabled={smsSending || !smsMessage.trim()}
                    style={{ flex: 1, padding: '10px', fontSize: '0.875rem', fontWeight: 700, color: '#fff', backgroundColor: smsSending ? '#9CA3AF' : '#059669', border: 'none', borderRadius: 8, cursor: smsSending ? 'not-allowed' : 'pointer' }}>
                    {smsSending ? '발송 중...' : '발송하기'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 저장 버튼들 */}
          {reportData && (
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
              {reportSaved && <span style={{ fontSize: '0.75rem', color: '#059669', fontWeight: 600, marginRight: 'auto' }}>✓ 보고서 저장 완료</span>}
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
              <Button
                variant={reportSaved ? 'secondary' : 'primary'}
                size="sm"
                loading={reportSaving}
                onClick={handleSaveReport}
                style={reportSaved ? {} : { backgroundColor: '#D97706', borderColor: '#D97706' }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                  <polyline points="17 21 17 13 7 13 7 21" />
                  <polyline points="7 3 7 8 15 8" />
                </svg>
                {reportSaving ? '저장 중...' : reportSaved ? '다시 저장' : '보고서 저장'}
              </Button>
            </div>
          )}

          {/* ReportView */}
          <ReportView
            ref={reportRef}
            reportData={reportData}
            clientName={reportClientName}
            modifiedWeights={modifiedWeights}
            extraHoldings={reportExtraHoldings}
            onWeightChange={(id, val) => setModifiedWeights((prev) => ({ ...prev, [id]: val }))}
            aiComment={aiComment}
            onAiCommentChange={setAiComment}
            aiChangeComment={aiChangeComment}
            onAiChangeCommentChange={setAiChangeComment}
            onGenerateAiComment={handleGenerateAiComment}
            onGenerateAiChangeComment={handleGenerateAiChangeComment}
            aiCommentLoading={aiCommentLoading}
            aiChangeCommentLoading={aiChangeCommentLoading}
            managerNote={managerNote}
            onManagerNoteChange={setManagerNote}
          />
        </div>
      )}

      {/* ===================================================== */}
      {/* TAB 4: 내역관리                                        */}
      {/* ===================================================== */}
      {activeTab === 'history' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* 고객 선택 + 필터 */}
          <Card padding={16}>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              {/* 고객 검색 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 140 }}>
                <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#374151' }}>고객 검색</label>
                <div style={{ position: 'relative' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2"
                    style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
                    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  <input
                    type="text" placeholder="이름/고유번호"
                    value={tab4ClientSearch}
                    onChange={(e) => setTab4ClientSearch(e.target.value)}
                    style={{ width: '100%', padding: '8px 10px 8px 28px', fontSize: '0.8125rem', border: '1px solid #E1E5EB', borderRadius: 8, outline: 'none', color: '#1A1A2E', boxSizing: 'border-box' }}
                  />
                </div>
              </div>

              {/* 고객 선택 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 160, flex: 1 }}>
                <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#374151' }}>고객 선택</label>
                <select
                  value={tab4ClientId}
                  onChange={(e) => { handleTab4ClientChange(e.target.value); setTab4ClientSearch(''); }}
                  style={{ padding: '8px 10px', fontSize: '0.8125rem', border: '1px solid #E1E5EB', borderRadius: 8, outline: 'none', color: tab4ClientId ? '#1A1A2E' : '#9CA3AF', backgroundColor: '#fff', cursor: 'pointer' }}
                >
                  <option value="">-- 고객 선택 --</option>
                  {mainUniqueClients
                    .filter((c) => {
                      if (!tab4ClientSearch.trim()) return true;
                      const q = tab4ClientSearch.trim().toLowerCase();
                      return c.name.toLowerCase().includes(q) || (c.unique_code ?? '').includes(q);
                    })
                    .map((c) => (
                      <option key={c.name} value={c.id}>{clientLabel(c, clientLatestDates[c.id])}</option>
                    ))}
                </select>
              </div>

              {/* 증권사 필터 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 110 }}>
                <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#374151' }}>증권사</label>
                <select
                  value={tab4FilterCompany}
                  onChange={(e) => {
                    const v = e.target.value;
                    setTab4FilterCompany(v);
                    loadTab4Logs(tab4ClientId, tab4FilterAccount, v, tab4FilterPeriod);
                  }}
                  disabled={!tab4ClientId}
                  style={{ padding: '8px 10px', fontSize: '0.8125rem', border: '1px solid #E1E5EB', borderRadius: 8, outline: 'none', color: tab4FilterCompany ? '#1A1A2E' : '#9CA3AF', backgroundColor: tab4ClientId ? '#fff' : '#F9FAFB', cursor: tab4ClientId ? 'pointer' : 'not-allowed' }}
                >
                  <option value="">전체</option>
                  {tab4SecuritiesCompanies.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              {/* 계좌 필터 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 120 }}>
                <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#374151' }}>계좌</label>
                <select
                  value={tab4FilterAccount}
                  onChange={(e) => {
                    const v = e.target.value;
                    setTab4FilterAccount(v);
                    loadTab4Logs(tab4ClientId, v, tab4FilterCompany, tab4FilterPeriod);
                  }}
                  disabled={!tab4ClientId}
                  style={{ padding: '8px 10px', fontSize: '0.8125rem', border: '1px solid #E1E5EB', borderRadius: 8, outline: 'none', color: tab4FilterAccount ? '#1A1A2E' : '#9CA3AF', backgroundColor: tab4ClientId ? '#fff' : '#F9FAFB', cursor: tab4ClientId ? 'pointer' : 'not-allowed' }}
                >
                  <option value="">전체</option>
                  {tab4ClientAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {accountTypeLabel(a.account_type)}{a.account_number ? ` (${a.account_number})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* 기간 필터 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 100 }}>
                <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#374151' }}>기간</label>
                <select
                  value={tab4FilterPeriod}
                  onChange={(e) => {
                    const v = e.target.value as '6m' | '1y' | 'all';
                    setTab4FilterPeriod(v);
                    loadTab4Logs(tab4ClientId, tab4FilterAccount, tab4FilterCompany, v);
                  }}
                  disabled={!tab4ClientId}
                  style={{ padding: '8px 10px', fontSize: '0.8125rem', border: '1px solid #E1E5EB', borderRadius: 8, outline: 'none', color: '#1A1A2E', backgroundColor: tab4ClientId ? '#fff' : '#F9FAFB', cursor: tab4ClientId ? 'pointer' : 'not-allowed' }}
                >
                  <option value="6m">6개월</option>
                  <option value="1y">1년</option>
                  <option value="all">전체</option>
                </select>
              </div>
            </div>
          </Card>

          {/* 고객 기본정보 헤더 */}
          {tab4ClientId && tab4ClientAccounts.length > 0 && (
            <Card padding={16}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <div style={{ width: 3, height: 18, borderRadius: 2, backgroundColor: '#1E3A5F', flexShrink: 0 }} />
                <span style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#1A1A2E' }}>
                  {clients.find((c) => c.id === tab4ClientId)?.name ?? ''} 고객 정보
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {tab4ClientAccounts.map((a) => (
                  <div key={a.id} style={{
                    display: 'flex', gap: 12, padding: '10px 16px', backgroundColor: '#F5F7FA',
                    borderRadius: 10, border: '1px solid #E1E5EB', fontSize: '0.8125rem',
                  }}>
                    <span style={{ fontWeight: 600, color: '#1E3A5F' }}>{a.securities_company || '-'}</span>
                    <span style={{ color: '#6B7280' }}>|</span>
                    <span style={{ color: '#374151' }}>{accountTypeLabel(a.account_type)}</span>
                    <span style={{ color: '#6B7280' }}>|</span>
                    <span style={{ fontFamily: 'monospace', color: '#374151' }}>{a.account_number || '-'}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* 발송기록 테이블 + PDF 다운로드 */}
          {tab4ClientId && (
            <Card padding={0}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', borderBottom: '1px solid #E1E5EB' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 3, height: 18, borderRadius: 2, backgroundColor: '#1E3A5F', flexShrink: 0 }} />
                  <span style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#1A1A2E' }}>
                    발송 기록 ({tab4LogsTotal}건)
                  </span>
                  {tab4LogsLoading && (
                    <span style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid #1E3A5F', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                  )}
                </div>
                <button
                  onClick={handleTab4DownloadPDF}
                  disabled={tab4Logs.length === 0 || tab4PdfSaving}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '7px 14px', fontSize: '0.8125rem', fontWeight: 600,
                    color: tab4Logs.length > 0 ? '#1E3A5F' : '#9CA3AF',
                    backgroundColor: tab4Logs.length > 0 ? '#EEF2F7' : '#F9FAFB',
                    border: '1px solid #E1E5EB', borderRadius: 8, cursor: tab4Logs.length > 0 ? 'pointer' : 'not-allowed',
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="12" y1="18" x2="12" y2="12" />
                    <polyline points="9 15 12 18 15 15" />
                  </svg>
                  {tab4PdfSaving ? '저장 중...' : 'PDF 다운로드'}
                </button>
              </div>

              <div ref={tab4HistoryRef}>
                {tab4Logs.length === 0 ? (
                  <div style={{ padding: 40, textAlign: 'center', color: '#9CA3AF', fontSize: '0.875rem' }}>
                    {tab4LogsLoading ? '로딩 중...' : '발송 기록이 없습니다.'}
                  </div>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
                      <thead>
                        <tr style={{ backgroundColor: '#F5F7FA', borderBottom: '2px solid #E1E5EB' }}>
                          <th style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 700, color: '#374151', whiteSpace: 'nowrap', width: 50 }}>No</th>
                          <th style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 700, color: '#374151', whiteSpace: 'nowrap', width: 110 }}>발송일</th>
                          <th style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 700, color: '#374151', whiteSpace: 'nowrap', width: 80 }}>유형</th>
                          <th style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 700, color: '#374151', whiteSpace: 'nowrap', width: 100 }}>계좌</th>
                          <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 700, color: '#374151' }}>발송 내용 요약</th>
                          <th style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 700, color: '#374151', whiteSpace: 'nowrap', width: 80 }}>보고서</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tab4Logs.map((log, idx) => (
                          <tr key={log.id} style={{ borderBottom: '1px solid #F3F4F6' }}
                            onMouseEnter={(e) => { (e.currentTarget).style.backgroundColor = '#FAFBFC'; }}
                            onMouseLeave={(e) => { (e.currentTarget).style.backgroundColor = 'transparent'; }}>
                            <td style={{ padding: '10px 12px', textAlign: 'center', color: '#6B7280' }}>{idx + 1}</td>
                            <td style={{ padding: '10px 12px', textAlign: 'center', color: '#1A1A2E', whiteSpace: 'nowrap' }}>
                              {new Date(log.sent_at).toLocaleDateString('ko-KR')}
                            </td>
                            <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                              <span style={{
                                display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: '0.75rem', fontWeight: 600,
                                backgroundColor:
                                  log.message_type === 'portfolio_save' ? '#EDE9FE'
                                  : log.message_type.includes('suggestion') ? '#FFFBEB'
                                  : log.message_type.includes('alimtalk') ? '#FEF3C7'
                                  : '#ECFDF5',
                                color:
                                  log.message_type === 'portfolio_save' ? '#6D28D9'
                                  : log.message_type.includes('suggestion') ? '#92400E'
                                  : log.message_type.includes('alimtalk') ? '#92400E'
                                  : '#059669',
                              }}>
                                {log.message_type === 'portfolio_save' ? '수정저장'
                                  : log.message_type === 'suggestion_link' ? '변경제안(SMS)'
                                  : log.message_type === 'alimtalk_suggestion' ? '변경제안(톡)'
                                  : log.message_type === 'alimtalk_portal' ? '상시조회(톡)'
                                  : '상시조회(SMS)'}
                              </span>
                            </td>
                            <td style={{ padding: '10px 12px', textAlign: 'center', fontSize: '0.75rem', color: '#6B7280' }}>
                              {log.account_type ? accountTypeLabel(log.account_type) : '-'}
                            </td>
                            <td style={{ padding: '10px 12px', textAlign: 'left', color: '#374151', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {log.message_summary}
                            </td>
                            <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                              {log.has_image ? (
                                <button
                                  onClick={() => handleTab4DownloadImage(log.id)}
                                  style={{
                                    display: 'inline-flex', alignItems: 'center', gap: 4,
                                    padding: '4px 10px', fontSize: '0.75rem', fontWeight: 600,
                                    color: '#1E3A5F', backgroundColor: '#EEF2F7',
                                    border: '1px solid #D1D9E6', borderRadius: 6, cursor: 'pointer',
                                  }}
                                >
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                    <polyline points="7 10 12 15 17 10" />
                                    <line x1="12" y1="15" x2="12" y2="3" />
                                  </svg>
                                  다운
                                </button>
                              ) : (
                                <span style={{ color: '#D1D5DB', fontSize: '0.75rem' }}>-</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </Card>
          )}

          {/* 안내 */}
          {!tab4ClientId && (
            <div style={{
              padding: 48, textAlign: 'center', backgroundColor: '#F9FAFB',
              borderRadius: 14, border: '1px solid #E5E7EB', color: '#9CA3AF', fontSize: '0.875rem',
            }}>
              고객을 선택하면 발송 내역을 확인할 수 있습니다.
            </div>
          )}
        </div>
      )}

      {/* 알림톡 발송 모달 */}
      {alimtalkModalOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)' }}
          onClick={(e) => { if (e.target === e.currentTarget) setAlimtalkModalOpen(false); }}>
          <div style={{ backgroundColor: '#fff', borderRadius: 14, padding: 24, width: '100%', maxWidth: 480, maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#1A1A2E' }}>
                알림톡 발송 {alimtalkModalType === 'suggestion' ? '(변경 제안)' : '(포트폴리오 조회)'}
              </h3>
              <button onClick={() => setAlimtalkModalOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', padding: 4 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            {/* 수신자 정보 */}
            <div style={{ padding: '10px 14px', backgroundColor: '#F5F7FA', borderRadius: 8, marginBottom: 16, fontSize: '0.8125rem' }}>
              <span style={{ color: '#6B7280' }}>수신: </span>
              <span style={{ fontWeight: 600, color: '#1A1A2E' }}>{getReportClient()?.name}</span>
              <span style={{ color: '#9CA3AF', marginLeft: 8 }}>{getReportClient()?.phone}</span>
            </div>

            {/* 템플릿 목록 */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: '#374151', marginBottom: 8 }}>
                알림톡 템플릿 선택
              </label>
              {kakaoTemplatesLoading ? (
                <div style={{ padding: 20, textAlign: 'center', color: '#9CA3AF', fontSize: '0.8125rem' }}>
                  <span style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid #1E3A5F', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite', marginRight: 6 }} />
                  템플릿 로딩 중...
                </div>
              ) : kakaoTemplates.length === 0 ? (
                <div style={{ padding: 20, textAlign: 'center', backgroundColor: '#FEF2F2', borderRadius: 8, fontSize: '0.8125rem', color: '#DC2626' }}>
                  등록된 알림톡 템플릿이 없습니다.<br />
                  <span style={{ fontSize: '0.75rem', color: '#9CA3AF' }}>솔라피 콘솔에서 카카오 채널 연결 및 템플릿을 등록해주세요.</span>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {kakaoTemplates.map((t) => (
                    <button
                      key={t.templateId}
                      onClick={() => setSelectedTemplateId(t.templateId)}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left',
                        padding: '12px 14px', borderRadius: 10, cursor: 'pointer',
                        border: selectedTemplateId === t.templateId ? '2px solid #F7C948' : '1px solid #E1E5EB',
                        backgroundColor: selectedTemplateId === t.templateId ? '#FFFBEB' : '#fff',
                        transition: 'all 0.15s',
                      }}
                    >
                      <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#1A1A2E', marginBottom: 4 }}>
                        {t.name}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#6B7280', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                        {t.content.length > 120 ? t.content.slice(0, 120) + '...' : t.content}
                      </div>
                      {t.buttons && t.buttons.length > 0 && (
                        <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                          {t.buttons.map((b, i) => (
                            <span key={i} style={{ display: 'inline-block', padding: '2px 8px', fontSize: '0.6875rem', fontWeight: 600, backgroundColor: '#EEF2F7', color: '#1E3A5F', borderRadius: 4 }}>
                              {b.buttonName}
                            </span>
                          ))}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* 미리보기 */}
            {selectedTemplateId && (() => {
              const { content } = getAlimtalkPreview();
              return (
                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: '#374151', marginBottom: 6 }}>
                    발송 미리보기
                  </label>
                  <div style={{
                    padding: '14px 16px', backgroundColor: '#FEF9E7', border: '1px solid #FCD34D',
                    borderRadius: 10, fontSize: '0.8125rem', color: '#374151', lineHeight: 1.6, whiteSpace: 'pre-wrap',
                  }}>
                    {content}
                  </div>
                  <p style={{ fontSize: '0.6875rem', color: '#9CA3AF', marginTop: 4 }}>
                    * 알림톡 발송 실패 시 SMS로 자동 대체 발송됩니다.
                  </p>
                </div>
              );
            })()}

            {/* 발송 버튼 */}
            <button
              onClick={handleSendAlimtalkConfirm}
              disabled={alimtalkSending || !selectedTemplateId}
              style={{
                width: '100%', padding: '12px 0', fontSize: '0.875rem', fontWeight: 700,
                color: '#fff', backgroundColor: alimtalkSending || !selectedTemplateId ? '#D1D5DB' : '#F59E0B',
                border: 'none', borderRadius: 10, cursor: alimtalkSending || !selectedTemplateId ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}
            >
              {alimtalkSending && (
                <span style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid #fff', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
              )}
              {alimtalkSending ? '발송 중...' : '알림톡 발송'}
            </button>
          </div>
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
              {/* 1. 상품유형 (맨 위) */}
              <div>
                <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: '#374151', marginBottom: 5 }}>
                  상품유형 <span style={{ color: '#EF4444' }}>*</span>
                </label>
                <select
                  value={registerForm.product_type}
                  onChange={(e) => {
                    const val = e.target.value;
                    setRegisterForm((f) => ({ ...f, product_type: val, product_name: '', product_code: '' }));
                    setRegStockQuery('');
                    setRegStockResults([]);
                  }}
                  style={{
                    width: '100%', padding: '9px 12px', fontSize: '0.875rem',
                    border: '1px solid #E1E5EB', borderRadius: 8, outline: 'none',
                    color: registerForm.product_type ? '#1A1A2E' : '#9CA3AF',
                    backgroundColor: '#fff', cursor: 'pointer', boxSizing: 'border-box',
                  }}
                >
                  <option value="">상품유형을 먼저 선택하세요</option>
                  {PRODUCT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>

              {/* 2. 상품명 — ETF/MMF: 자동검색, 그 외: 직접입력 */}
              {registerForm.product_type && (
                <div style={{ position: 'relative' }}>
                  <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: '#374151', marginBottom: 5 }}>
                    상품명 <span style={{ color: '#EF4444' }}>*</span>
                    {(registerForm.product_type === 'ETF' || registerForm.product_type === 'MMF') ? (
                      <span style={{ fontWeight: 400, marginLeft: 8, color: '#9CA3AF', fontSize: '0.75rem' }}>
                        2글자 이상 입력 시 자동 검색
                      </span>
                    ) : (
                      <span style={{ fontWeight: 400, marginLeft: 8, color: '#9CA3AF', fontSize: '0.75rem' }}>
                        직접 입력 |{' '}
                        <a href="https://www.nhsec.com/index.jsp" target="_blank" rel="noopener noreferrer"
                          data-tooltip="NH투자증권 > 금융상품 > 펀드 > 펀드검색"
                          style={{ color: '#2563EB', textDecoration: 'underline' }}>
                          펀드 검색(NH투자증권)
                        </a>
                      </span>
                    )}
                  </label>
                  {(registerForm.product_type === 'ETF' || registerForm.product_type === 'MMF') ? (
                    <>
                      <input
                        type="text"
                        placeholder="상품명을 입력하세요 (예: KODEX, TIGER...)"
                        value={regStockQuery || registerForm.product_name}
                        onChange={(e) => handleRegStockSearch(e.target.value)}
                        style={{
                          width: '100%', padding: '9px 12px', fontSize: '0.875rem',
                          border: '1px solid #E1E5EB', borderRadius: 8, outline: 'none',
                          color: '#1A1A2E', boxSizing: 'border-box',
                        }}
                        autoFocus
                      />
                      {regStockSearching && (
                        <div style={{ position: 'absolute', right: 10, top: 30, color: '#9CA3AF', fontSize: '0.75rem' }}>검색 중...</div>
                      )}
                      {regStockResults.length > 0 && (
                        <div style={{
                          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
                          backgroundColor: '#fff', border: '1px solid #E1E5EB', borderRadius: 8,
                          boxShadow: '0 8px 24px rgba(0,0,0,0.12)', maxHeight: 220, overflowY: 'auto', marginTop: 4,
                        }}>
                          {regStockResults.map((item) => (
                            <button key={item.code} type="button" onClick={() => handleRegStockSelect(item)}
                              style={{
                                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                padding: '8px 12px', border: 'none', background: 'none', cursor: 'pointer',
                                textAlign: 'left', borderBottom: '1px solid #F3F4F6', fontSize: '0.8125rem',
                              }}
                              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#F5F7FA'; }}
                              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                            >
                              <div>
                                <div style={{ fontWeight: 600, color: '#1A1A2E' }}>{item.name}</div>
                                <div style={{ fontSize: '0.75rem', color: '#6B7280' }}>
                                  <span style={{ fontFamily: 'monospace' }}>{item.code}</span>
                                </div>
                              </div>
                              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                                <div style={{ fontWeight: 600, color: '#1E3A5F', fontSize: '0.8125rem' }}>
                                  {item.price?.toLocaleString('ko-KR')}
                                </div>
                                <div style={{ fontSize: '0.6875rem', color: '#9CA3AF' }}>NAV {item.nav?.toLocaleString('ko-KR')}</div>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <input
                      type="text"
                      placeholder="상품명을 직접 입력하세요"
                      value={registerForm.product_name}
                      onChange={(e) => setRegisterForm((f) => ({ ...f, product_name: e.target.value }))}
                      style={{
                        width: '100%', padding: '9px 12px', fontSize: '0.875rem',
                        border: '1px solid #E1E5EB', borderRadius: 8, outline: 'none',
                        color: '#1A1A2E', boxSizing: 'border-box',
                      }}
                      autoFocus
                    />
                  )}
                </div>
              )}

              {/* 3. 종목코드 */}
              {registerForm.product_type && (
                <div>
                  <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: '#374151', marginBottom: 5 }}>
                    종목코드
                  </label>
                  <input
                    type="text"
                    placeholder={registerForm.product_code ? registerForm.product_code : '종목코드 입력'}
                    value={registerForm.product_code}
                    onChange={(e) => setRegisterForm((f) => ({ ...f, product_code: e.target.value }))}
                    readOnly={registerForm.product_type === 'ETF' || registerForm.product_type === 'MMF'}
                    style={{
                      width: '100%', padding: '9px 12px', fontSize: '0.875rem',
                      border: '1px solid #E1E5EB', borderRadius: 8, outline: 'none',
                      fontFamily: 'monospace', boxSizing: 'border-box',
                      color: registerForm.product_code ? '#1A1A2E' : '#9CA3AF',
                      backgroundColor: (registerForm.product_type === 'ETF' || registerForm.product_type === 'MMF') ? '#F9FAFB' : '#fff',
                    }}
                  />
                </div>
              )}

              {/* 4. 위험도 + 지역 (2열) */}
              {registerForm.product_type && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: '#374151', marginBottom: 5 }}>위험도</label>
                    <select value={registerForm.risk_level} onChange={(e) => setRegisterForm((f) => ({ ...f, risk_level: e.target.value }))}
                      style={{ width: '100%', padding: '9px 12px', fontSize: '0.875rem', border: '1px solid #E1E5EB', borderRadius: 8, outline: 'none', color: registerForm.risk_level ? '#1A1A2E' : '#9CA3AF', backgroundColor: '#fff', cursor: 'pointer', boxSizing: 'border-box' }}>
                      <option value="">선택</option>
                      {RISK_LEVELS.map((rl) => <option key={rl} value={rl}>{rl}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: '#374151', marginBottom: 5 }}>지역</label>
                    <select value={registerForm.region} onChange={(e) => setRegisterForm((f) => ({ ...f, region: e.target.value }))}
                      style={{ width: '100%', padding: '9px 12px', fontSize: '0.875rem', border: '1px solid #E1E5EB', borderRadius: 8, outline: 'none', color: registerForm.region ? '#1A1A2E' : '#9CA3AF', backgroundColor: '#fff', cursor: 'pointer', boxSizing: 'border-box' }}>
                      <option value="">선택</option>
                      {REGIONS.map((rg) => <option key={rg} value={rg}>{rg}</option>)}
                    </select>
                  </div>
                </div>
              )}
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

      {/* 상품명 변경 메모 팝업 */}
      {nameChangeMemoOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div style={{ backgroundColor: '#fff', borderRadius: 12, width: 640, maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            {/* 헤더 */}
            <div style={{ padding: '20px 24px 12px', borderBottom: '1px solid #E5E7EB', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 700, color: '#1E3A5F' }}>상품명 변경 메모</h3>
                <p style={{ margin: '4px 0 0', fontSize: '0.75rem', color: '#6B7280' }}>
                  상품명 전체가 아닌, 변경된 키워드를 중심으로 입력하세요. (예: 이스트스프링 → 카디안)
                </p>
              </div>
              <button onClick={() => setNameChangeMemoOpen(false)} style={{ background: 'none', border: 'none', fontSize: '1.25rem', cursor: 'pointer', color: '#6B7280' }}>✕</button>
            </div>

            {/* 등록 폼 */}
            <div style={{ padding: '16px 24px', borderBottom: '1px solid #F3F4F6', display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 120 }}>
                <label style={{ fontSize: '0.75rem', color: '#374151', fontWeight: 600 }}>변경 전 키워드</label>
                <input value={ncNewOld} onChange={e => setNcNewOld(e.target.value)} placeholder="예: 이스트스프링"
                  style={{ width: '100%', padding: '6px 10px', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: '0.8125rem', marginTop: 2 }} />
              </div>
              <div style={{ fontSize: '1.25rem', color: '#9CA3AF', paddingBottom: 4 }}>→</div>
              <div style={{ flex: 1, minWidth: 120 }}>
                <label style={{ fontSize: '0.75rem', color: '#374151', fontWeight: 600 }}>변경 후 키워드</label>
                <input value={ncNewNew} onChange={e => setNcNewNew(e.target.value)} placeholder="예: 카디안"
                  style={{ width: '100%', padding: '6px 10px', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: '0.8125rem', marginTop: 2 }} />
              </div>
              <div style={{ flex: 1, minWidth: 100 }}>
                <label style={{ fontSize: '0.75rem', color: '#374151', fontWeight: 600 }}>메모 (선택)</label>
                <input value={ncNewMemo} onChange={e => setNcNewMemo(e.target.value)} placeholder="변경사유"
                  style={{ width: '100%', padding: '6px 10px', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: '0.8125rem', marginTop: 2 }} />
              </div>
              <button onClick={addNameChange} style={{ padding: '6px 16px', backgroundColor: '#1E3A5F', color: '#fff', border: 'none', borderRadius: 6, fontSize: '0.8125rem', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>추가</button>
            </div>

            {/* 목록 */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '12px 24px 20px' }}>
              {ncLoading ? (
                <p style={{ textAlign: 'center', color: '#9CA3AF', fontSize: '0.875rem' }}>로딩 중...</p>
              ) : nameChanges.length === 0 ? (
                <p style={{ textAlign: 'center', color: '#9CA3AF', fontSize: '0.875rem', padding: '24px 0' }}>등록된 변경 메모가 없습니다.</p>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #E5E7EB' }}>
                      <th style={{ padding: '8px 6px', textAlign: 'left', color: '#374151', fontWeight: 600 }}>변경 전</th>
                      <th style={{ padding: '8px 2px', width: 30, textAlign: 'center' }}></th>
                      <th style={{ padding: '8px 6px', textAlign: 'left', color: '#374151', fontWeight: 600 }}>변경 후</th>
                      <th style={{ padding: '8px 6px', textAlign: 'left', color: '#374151', fontWeight: 600 }}>메모</th>
                      <th style={{ padding: '8px 6px', width: 100, textAlign: 'center', color: '#374151', fontWeight: 600 }}>관리</th>
                    </tr>
                  </thead>
                  <tbody>
                    {nameChanges.map(nc => (
                      <tr key={nc.id} style={{ borderBottom: '1px solid #F3F4F6' }}>
                        {ncEditId === nc.id ? (
                          <>
                            <td style={{ padding: '6px' }}><input value={ncEditOld} onChange={e => setNcEditOld(e.target.value)} style={{ width: '100%', padding: '4px 8px', border: '1px solid #D1D5DB', borderRadius: 4, fontSize: '0.8125rem' }} /></td>
                            <td style={{ textAlign: 'center', color: '#9CA3AF' }}>→</td>
                            <td style={{ padding: '6px' }}><input value={ncEditNew} onChange={e => setNcEditNew(e.target.value)} style={{ width: '100%', padding: '4px 8px', border: '1px solid #D1D5DB', borderRadius: 4, fontSize: '0.8125rem' }} /></td>
                            <td style={{ padding: '6px' }}><input value={ncEditMemo} onChange={e => setNcEditMemo(e.target.value)} style={{ width: '100%', padding: '4px 8px', border: '1px solid #D1D5DB', borderRadius: 4, fontSize: '0.8125rem' }} /></td>
                            <td style={{ padding: '6px', textAlign: 'center' }}>
                              <button onClick={() => updateNameChange(nc.id)} style={{ padding: '3px 10px', backgroundColor: '#1E3A5F', color: '#fff', border: 'none', borderRadius: 4, fontSize: '0.75rem', cursor: 'pointer', marginRight: 4 }}>저장</button>
                              <button onClick={() => setNcEditId(null)} style={{ padding: '3px 10px', backgroundColor: '#6B7280', color: '#fff', border: 'none', borderRadius: 4, fontSize: '0.75rem', cursor: 'pointer' }}>취소</button>
                            </td>
                          </>
                        ) : (
                          <>
                            <td style={{ padding: '8px 6px', color: '#DC2626', fontWeight: 500 }}>{nc.old_keyword}</td>
                            <td style={{ textAlign: 'center', color: '#9CA3AF' }}>→</td>
                            <td style={{ padding: '8px 6px', color: '#059669', fontWeight: 500 }}>{nc.new_keyword}</td>
                            <td style={{ padding: '8px 6px', color: '#6B7280' }}>{nc.memo || '-'}</td>
                            <td style={{ padding: '8px 6px', textAlign: 'center' }}>
                              <button onClick={() => { setNcEditId(nc.id); setNcEditOld(nc.old_keyword); setNcEditNew(nc.new_keyword); setNcEditMemo(nc.memo || ''); }} style={{ padding: '3px 10px', backgroundColor: '#3B82F6', color: '#fff', border: 'none', borderRadius: 4, fontSize: '0.75rem', cursor: 'pointer', marginRight: 4 }}>수정</button>
                              <button onClick={() => deleteNameChange(nc.id)} style={{ padding: '3px 10px', backgroundColor: '#EF4444', color: '#fff', border: 'none', borderRadius: 4, fontSize: '0.75rem', cursor: 'pointer' }}>삭제</button>
                            </td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

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
        // 현재 계좌유형에 따라 상품 필터링 (연금저축↔IRP 교차 제외)
        const acctType = loadMasterTarget.accountType || '';
        const typeFiltered = productMasters.filter((m) => {
          const pName = m.product_name.toLowerCase();
          const pType = (m.product_type || '').toLowerCase();
          if (acctType === 'pension1' || acctType === 'pension2' || acctType === '연금저축') {
            if (pType.includes('irp') || pName.includes('irp')) return false;
          } else if (acctType === 'irp' || acctType === 'IRP') {
            if (pType.includes('연금저축') || pName.includes('연금저축')) return false;
          }
          return true;
        });
        // 유사도 점수: 특수문자/공백 모두 제거 후 비교 + LCS 기반
        const normalize = (s: string) => s.replace(/[^가-힣a-zA-Z0-9]/g, '').toLowerCase();
        const normTarget = normalize(targetName);

        // LCS(Longest Common Substring) 길이 계산
        const lcsLength = (a: string, b: string): number => {
          if (!a || !b) return 0;
          const m = a.length, n = b.length;
          let max = 0;
          // 메모리 효율적 1D DP
          const prev = new Array(n + 1).fill(0);
          for (let i = 1; i <= m; i++) {
            const curr = new Array(n + 1).fill(0);
            for (let j = 1; j <= n; j++) {
              if (a[i - 1] === b[j - 1]) {
                curr[j] = prev[j - 1] + 1;
                if (curr[j] > max) max = curr[j];
              }
            }
            for (let j = 0; j <= n; j++) prev[j] = curr[j];
          }
          return max;
        };

        const scored = typeFiltered.map((m) => {
          const normName = normalize(m.product_name);
          let score = 0;

          // 1. 정규화 후 정확 일치
          if (normName === normTarget) {
            score = 100;
          }
          // 2. 정규화 후 포함 관계 (한쪽이 다른쪽에 포함)
          else if (normName.includes(normTarget) || normTarget.includes(normName)) {
            const shorter = Math.min(normName.length, normTarget.length);
            const longer = Math.max(normName.length, normTarget.length);
            score = Math.round(85 * (shorter / longer));
            if (score < 50) score = 50; // 포함되면 최소 50점
          }
          // 3. LCS 비율 기반 유사도
          else {
            const lcs = lcsLength(normTarget, normName);
            const shorter = Math.min(normTarget.length, normName.length);
            if (shorter > 0) {
              const ratio = lcs / shorter;
              score = Math.round(ratio * 80);
            }
          }
          return { ...m, score };
        });

        const normSearch = normalize(searchLower);
        const filtered = scored
          .filter((m) => {
            if (!searchLower) return true;
            return normalize(m.product_name).includes(normSearch) || m.product_name.toLowerCase().includes(searchLower) || (m.product_code || '').toLowerCase().includes(searchLower);
          })
          .sort((a, b) => b.score - a.score)
          .slice(0, searchLower ? 50 : 20);

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
                          unmapped: false,
                        });
                        /* Update DB holding */
                        fetch(`${API_URL}/api/v1/snapshots/${loadMasterTarget.snapshotId}/holdings/${loadMasterTarget.holdingId}`, {
                          method: 'PUT',
                          headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
                          body: JSON.stringify({
                            product_name: m.product_name,
                            product_code: m.product_code || null,
                            product_type: m.product_type || null,
                            risk_level: m.risk_level || null,
                            region: m.region || null,
                          }),
                        }).catch(() => { /* silent */ });
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
                          <span style={{ fontWeight: 600, color: '#1E3A5F', backgroundColor: '#EEF2F7', padding: '1px 6px', borderRadius: 3, marginRight: 4 }}>{m.product_type || '-'}</span>{m.product_code || '-'} | {m.risk_level || '-'} | {m.region || '-'}
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
