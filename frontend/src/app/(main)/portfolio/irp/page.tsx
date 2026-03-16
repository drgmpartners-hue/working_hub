'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Tab, type TabItem } from '@/components/common/Tab';
import { Button } from '@/components/common/Button';
import { Card } from '@/components/common/Card';
import { ClientRow } from '@/components/portfolio/ClientRow';
import { SnapshotDataTable } from '@/components/portfolio/SnapshotDataTable';
import { SuggestionEditor } from '@/components/portfolio/SuggestionEditor';
import { authLib } from '@/lib/auth';
import type { PeriodKey, HistoryPoint, DistributionItem } from '@/components/portfolio/PortfolioCharts';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

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
  riskLevel: string;
  region: string;
  purchaseAmount?: number;
  evaluationAmount?: number;
  returnRate?: number;
  unmapped: boolean; /* not found in product master */
  saving: boolean;
}

interface ExtractionResult {
  snapshotId: string;
  clientName: string;
  accountType: string;
  holdings: HoldingEdit[];
  applyingMaster: boolean;
  toastMsg: string;
}

const RISK_LEVELS = ['절대안정형', '안정형', '성장형', '절대성장형'];
const REGIONS = ['국내', '미국', '글로벌', '베트남', '인도', '중국', '기타'];

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

const accountTypeLabel = (t: string) =>
  ({ irp: 'IRP', pension1: '연금저축1', pension2: '연금저축2' } as Record<string, string>)[t] || t;

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
    imageFile: null,
    imagePreview: '',
    snapshotDate: todayString(),
  };
}

/* ------------------------------------------------------------------ */
/*  고객/계좌 자동 생성                                                  */
/* ------------------------------------------------------------------ */

async function getOrCreateClientAccount(row: ClientRowData): Promise<string> {
  if (row.accountId) return row.accountId;

  let clientId = row.clientId;

  if (!clientId) {
    const res = await fetch(`${API_URL}/api/v1/clients`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
      body: JSON.stringify({ name: row.clientName }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.detail || '고객 생성 실패');
    }
    const client: Client = await res.json();
    clientId = client.id;
  }

  const res = await fetch(`${API_URL}/api/v1/clients/${clientId}/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
    body: JSON.stringify({
      account_type: row.accountType,
      account_number: row.accountNumber || undefined,
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
/*  Main Page                                                           */
/* ------------------------------------------------------------------ */

export default function IRPPage() {
  const router = useRouter();
  const reportRef = useRef<HTMLDivElement>(null);

  /* ---------- global state ---------- */
  const [activeTab, setActiveTab] = useState<'data' | 'template' | 'report'>('data');
  const [clients, setClients] = useState<Client[]>([]);
  const [clientsLoading, setClientsLoading] = useState(false);

  /* ---------- tab1 state ---------- */
  const [rows, setRows] = useState<ClientRowData[]>([makeDefaultRow()]);
  const [commonDate, setCommonDate] = useState(todayString());
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

  /* ---------- tab3: portal link state ---------- */
  const [portalLinkToast, setPortalLinkToast] = useState('');
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailInput, setEmailInput] = useState('');
  const [emailSending, setEmailSending] = useState(false);

  /* ---------- load clients on mount ---------- */
  useEffect(() => {
    loadClients();
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

  // 공통 날짜 변경 → 모든 행에 적용
  function handleCommonDateChange(date: string) {
    setCommonDate(date);
    setRows((prev) => prev.map((r) => ({ ...r, snapshotDate: date })));
    setSearchDate(date);
  }

  /* ---------- tab1: process ---------- */

  async function handleProcess() {
    const validRows = rows.filter((r) => r.clientName && r.imageFile);
    if (validRows.length === 0) {
      alert('고객명과 이미지가 필요합니다.');
      return;
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

        /* Build extraction result for inline display */
        const holdingEdits: HoldingEdit[] = snap.holdings.map((h) => ({
          holdingId: h.id,
          productName: h.product_name,
          riskLevel: h.risk_level ?? '',
          region: h.region ?? '',
          purchaseAmount: h.purchase_amount,
          evaluationAmount: h.evaluation_amount,
          returnRate: h.return_rate,
          unmapped: false,
          saving: false,
        }));

        const extractionEntry: ExtractionResult = {
          snapshotId: snap.id,
          clientName: row.clientName,
          accountType: row.accountType,
          holdings: holdingEdits,
          applyingMaster: false,
          toastMsg: '',
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
    patch: Partial<Pick<HoldingEdit, 'riskLevel' | 'region'>>
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
            const updatedHoldings: HoldingEdit[] = freshSnap.holdings.map((fh) => ({
              holdingId: fh.id,
              productName: fh.product_name,
              riskLevel: fh.risk_level ?? '',
              region: fh.region ?? '',
              purchaseAmount: fh.purchase_amount,
              evaluationAmount: fh.evaluation_amount,
              returnRate: fh.return_rate,
              unmapped: notFoundNames.includes(fh.product_name),
              saving: false,
            }));
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#374151', whiteSpace: 'nowrap' }}>
                  공통 날짜
                </label>
                <input
                  type="date"
                  value={commonDate}
                  onChange={(e) => handleCommonDateChange(e.target.value)}
                  style={{
                    padding: '7px 10px',
                    fontSize: '0.8125rem',
                    border: '1px solid #E1E5EB',
                    borderRadius: 8,
                    outline: 'none',
                    color: '#1A1A2E',
                    cursor: 'pointer',
                  }}
                />
              </div>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <Button variant="secondary" size="sm" onClick={addRow}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  고객 추가
                </Button>
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
              "고객 추가" 버튼으로 처리할 고객을 추가하세요.
            </div>
          )}

          {/* 처리 버튼 */}
          {rows.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button
                variant="primary"
                size="md"
                loading={processing}
                disabled={rows.filter((r) => r.clientName && r.imageFile).length === 0}
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
                    <span style={{ fontSize: '0.75rem', color: '#9CA3AF', marginLeft: 'auto' }}>
                      {er.holdings.length}개 종목
                    </span>
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

                  {/* Holdings table */}
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
                      <thead>
                        <tr style={{ backgroundColor: '#F5F7FA' }}>
                          <th style={{ padding: '9px 12px', textAlign: 'center', fontSize: '0.75rem', fontWeight: 600, color: '#6B7280', borderBottom: '1px solid #E1E5EB', width: 36 }}>NO</th>
                          <th style={{ padding: '9px 12px', textAlign: 'left', fontSize: '0.75rem', fontWeight: 600, color: '#6B7280', borderBottom: '1px solid #E1E5EB' }}>상품명</th>
                          <th style={{ padding: '9px 12px', textAlign: 'center', fontSize: '0.75rem', fontWeight: 600, color: '#6B7280', borderBottom: '1px solid #E1E5EB', width: 130 }}>위험도</th>
                          <th style={{ padding: '9px 12px', textAlign: 'center', fontSize: '0.75rem', fontWeight: 600, color: '#6B7280', borderBottom: '1px solid #E1E5EB', width: 110 }}>지역</th>
                          <th style={{ padding: '9px 12px', textAlign: 'right', fontSize: '0.75rem', fontWeight: 600, color: '#6B7280', borderBottom: '1px solid #E1E5EB', whiteSpace: 'nowrap' }}>매입금액</th>
                          <th style={{ padding: '9px 12px', textAlign: 'right', fontSize: '0.75rem', fontWeight: 600, color: '#6B7280', borderBottom: '1px solid #E1E5EB', whiteSpace: 'nowrap' }}>평가금액</th>
                          <th style={{ padding: '9px 12px', textAlign: 'right', fontSize: '0.75rem', fontWeight: 600, color: '#6B7280', borderBottom: '1px solid #E1E5EB' }}>수익률</th>
                          <th style={{ padding: '9px 12px', textAlign: 'center', fontSize: '0.75rem', fontWeight: 600, color: '#6B7280', borderBottom: '1px solid #E1E5EB', width: 60 }}>저장</th>
                        </tr>
                      </thead>
                      <tbody>
                        {er.holdings.map((h, idx) => {
                          const rowBg = h.unmapped ? '#FEF9C3' : 'transparent';
                          const rateColor = h.returnRate == null ? '#374151' : h.returnRate > 0 ? '#10B981' : h.returnRate < 0 ? '#EF4444' : '#374151';
                          return (
                            <tr
                              key={h.holdingId}
                              style={{ backgroundColor: rowBg, transition: 'background-color 0.1s' }}
                            >
                              <td style={{ padding: '8px 12px', textAlign: 'center', color: '#9CA3AF', borderBottom: '1px solid #F3F4F6' }}>
                                {idx + 1}
                              </td>
                              <td style={{ padding: '8px 12px', textAlign: 'left', color: '#1A1A2E', fontWeight: 500, borderBottom: '1px solid #F3F4F6', maxWidth: 240, wordBreak: 'break-all' }}>
                                {h.productName}
                              </td>
                              <td style={{ padding: '6px 8px', textAlign: 'center', borderBottom: '1px solid #F3F4F6' }}>
                                <select
                                  value={h.riskLevel}
                                  onChange={(e) => updateHoldingField(er.snapshotId, h.holdingId, { riskLevel: e.target.value })}
                                  style={{
                                    width: '100%',
                                    padding: '5px 6px',
                                    fontSize: '0.75rem',
                                    border: `1px solid ${h.unmapped && !h.riskLevel ? '#F59E0B' : '#E1E5EB'}`,
                                    borderRadius: 6,
                                    outline: 'none',
                                    backgroundColor: '#fff',
                                    cursor: 'pointer',
                                    color: '#1A1A2E',
                                  }}
                                >
                                  <option value="">선택</option>
                                  {RISK_LEVELS.map((rl) => (
                                    <option key={rl} value={rl}>{rl}</option>
                                  ))}
                                </select>
                              </td>
                              <td style={{ padding: '6px 8px', textAlign: 'center', borderBottom: '1px solid #F3F4F6' }}>
                                <select
                                  value={h.region}
                                  onChange={(e) => updateHoldingField(er.snapshotId, h.holdingId, { region: e.target.value })}
                                  style={{
                                    width: '100%',
                                    padding: '5px 6px',
                                    fontSize: '0.75rem',
                                    border: `1px solid ${h.unmapped && !h.region ? '#F59E0B' : '#E1E5EB'}`,
                                    borderRadius: 6,
                                    outline: 'none',
                                    backgroundColor: '#fff',
                                    cursor: 'pointer',
                                    color: '#1A1A2E',
                                  }}
                                >
                                  <option value="">선택</option>
                                  {REGIONS.map((rg) => (
                                    <option key={rg} value={rg}>{rg}</option>
                                  ))}
                                </select>
                              </td>
                              <td style={{ padding: '8px 12px', textAlign: 'right', color: '#374151', borderBottom: '1px solid #F3F4F6', whiteSpace: 'nowrap' }}>
                                {h.purchaseAmount != null ? h.purchaseAmount.toLocaleString('ko-KR') : '-'}
                              </td>
                              <td style={{ padding: '8px 12px', textAlign: 'right', color: '#374151', fontWeight: 500, borderBottom: '1px solid #F3F4F6', whiteSpace: 'nowrap' }}>
                                {h.evaluationAmount != null ? h.evaluationAmount.toLocaleString('ko-KR') : '-'}
                              </td>
                              <td style={{ padding: '8px 12px', textAlign: 'right', color: rateColor, fontWeight: 600, borderBottom: '1px solid #F3F4F6', whiteSpace: 'nowrap' }}>
                                {h.returnRate != null
                                  ? `${h.returnRate > 0 ? '+' : ''}${h.returnRate.toFixed(2)}%`
                                  : '-'}
                              </td>
                              <td style={{ padding: '6px 8px', textAlign: 'center', borderBottom: '1px solid #F3F4F6' }}>
                                <button
                                  onClick={() => saveHolding(er.snapshotId, h.holdingId)}
                                  disabled={h.saving}
                                  title="저장"
                                  style={{
                                    padding: '4px 10px',
                                    fontSize: '0.7rem',
                                    fontWeight: 600,
                                    color: '#fff',
                                    backgroundColor: h.saving ? '#9CA3AF' : '#1E3A5F',
                                    border: 'none',
                                    borderRadius: 5,
                                    cursor: h.saving ? 'not-allowed' : 'pointer',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 4,
                                    transition: 'background-color 0.15s',
                                  }}
                                >
                                  {h.saving ? (
                                    <span
                                      style={{
                                        display: 'inline-block',
                                        width: 9,
                                        height: 9,
                                        border: '1.5px solid #fff',
                                        borderTopColor: 'transparent',
                                        borderRadius: '50%',
                                        animation: 'spin 0.7s linear infinite',
                                      }}
                                    />
                                  ) : (
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                                      <polyline points="20 6 9 17 4 12" />
                                    </svg>
                                  )}
                                  저장
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ===================================================== */}
      {/* TAB 2: 데이터 확인 (이력 조회 + 분석)                  */}
      {/* ===================================================== */}
      {activeTab === 'template' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* ---- 고객 이력 조회 패널 ---- */}
          <Card padding={20}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 16,
                paddingBottom: 12,
                borderBottom: '1px solid #E1E5EB',
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1E3A5F" strokeWidth="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              <span style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#1A1A2E' }}>
                고객 이력 조회
              </span>
            </div>

            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              {/* 고객 선택 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 180, flex: 1 }}>
                <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#374151' }}>
                  고객 선택
                </label>
                <select
                  value={histClientId}
                  onChange={(e) => handleHistClientChange(e.target.value)}
                  style={{
                    padding: '8px 10px',
                    fontSize: '0.8125rem',
                    border: '1px solid #E1E5EB',
                    borderRadius: 8,
                    outline: 'none',
                    color: histClientId ? '#1A1A2E' : '#9CA3AF',
                    backgroundColor: '#fff',
                    cursor: 'pointer',
                  }}
                >
                  <option value="">-- 고객 선택 --</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              {/* 계좌 선택 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 200, flex: 1 }}>
                <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#374151' }}>
                  계좌 선택
                </label>
                <select
                  value={histAccountId}
                  onChange={(e) => handleHistAccountChange(e.target.value)}
                  disabled={!histClientId}
                  style={{
                    padding: '8px 10px',
                    fontSize: '0.8125rem',
                    border: '1px solid #E1E5EB',
                    borderRadius: 8,
                    outline: 'none',
                    color: histAccountId ? '#1A1A2E' : '#9CA3AF',
                    backgroundColor: histClientId ? '#fff' : '#F9FAFB',
                    cursor: histClientId ? 'pointer' : 'not-allowed',
                    opacity: histClientId ? 1 : 0.6,
                  }}
                >
                  <option value="">-- 계좌 선택 --</option>
                  {(clients.find((c) => c.id === histClientId)?.accounts ?? []).map((a) => (
                    <option key={a.id} value={a.id}>
                      {accountTypeLabel(a.account_type)}{a.account_number ? ` (${a.account_number})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* 기간 선택 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#374151' }}>
                  이력 기간
                </label>
                <div style={{ display: 'flex', gap: 0, border: '1px solid #E1E5EB', borderRadius: 8, overflow: 'hidden' }}>
                  {(['3m', '6m', '1y'] as PeriodKey[]).map((p) => (
                    <button
                      key={p}
                      onClick={() => handleHistPeriodChange(p)}
                      style={{
                        padding: '7px 14px',
                        fontSize: '0.8125rem',
                        fontWeight: histPeriod === p ? 700 : 500,
                        color: histPeriod === p ? '#fff' : '#6B7280',
                        backgroundColor: histPeriod === p ? '#1E3A5F' : 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      {{ '3m': '3개월', '6m': '6개월', '1y': '1년' }[p]}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* 스냅샷 날짜 목록 */}
            {histAccountId && (
              <div style={{ marginTop: 20 }}>
                <div
                  style={{
                    fontSize: '0.8125rem',
                    fontWeight: 600,
                    color: '#374151',
                    marginBottom: 10,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  스냅샷 목록
                  <span style={{ fontSize: '0.75rem', color: '#9CA3AF', fontWeight: 400 }}>
                    체크하면 분석 표에 표시됩니다 (보고서 포함 여부)
                  </span>
                  {historyLoading && (
                    <span
                      style={{
                        display: 'inline-block',
                        width: 12,
                        height: 12,
                        border: '2px solid #1E3A5F',
                        borderTopColor: 'transparent',
                        borderRadius: '50%',
                        animation: 'spin 0.7s linear infinite',
                      }}
                    />
                  )}
                </div>

                {!historyLoading && historyList.length === 0 ? (
                  <div
                    style={{
                      padding: '16px',
                      textAlign: 'center',
                      color: '#9CA3AF',
                      fontSize: '0.875rem',
                      backgroundColor: '#F9FAFB',
                      borderRadius: 8,
                      border: '1px solid #E1E5EB',
                    }}
                  >
                    해당 기간의 스냅샷이 없습니다.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {historyList.map((item) => {
                      const isSelected = selectedSnapshotIds.has(item.id);
                      const isActive = activeSnapshotId === item.id;
                      const rate = item.total_return_rate;
                      const rateColor = rate == null ? '#6B7280' : rate > 0 ? '#10B981' : rate < 0 ? '#EF4444' : '#6B7280';
                      return (
                        <div
                          key={item.id}
                          onClick={() => handleSnapshotRowClick(item.id)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            padding: '8px 12px',
                            borderRadius: 8,
                            border: `1px solid ${isActive ? '#1E3A5F' : isSelected ? '#C7D2E2' : '#E1E5EB'}`,
                            backgroundColor: isActive ? '#EEF2F7' : isSelected ? '#F5F7FA' : '#fff',
                            cursor: 'pointer',
                            transition: 'all 0.15s ease',
                            userSelect: 'none',
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => handleSnapshotSelect(item.id, e.target.checked)}
                            style={{ cursor: 'pointer', accentColor: '#1E3A5F' }}
                          />
                          <span style={{ fontSize: '0.8125rem', fontWeight: isActive ? 700 : 500, color: '#1A1A2E' }}>
                            {item.snapshot_date}
                          </span>
                          {rate != null && (
                            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: rateColor }}>
                              {rate > 0 ? '+' : ''}{rate.toFixed(2)}%
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {!histClientId && (
              <div
                style={{
                  marginTop: 16,
                  padding: '14px',
                  backgroundColor: '#F9FAFB',
                  borderRadius: 8,
                  fontSize: '0.8125rem',
                  color: '#9CA3AF',
                  textAlign: 'center',
                }}
              >
                고객과 계좌를 선택하면 스냅샷 이력과 분석 데이터를 조회합니다.
              </div>
            )}
          </Card>

          {/* ---- 포트폴리오 분석 표 ---- */}
          {histAccountId && (
            <div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  marginBottom: 12,
                }}
              >
                <div style={{ width: 3, height: 18, borderRadius: 2, backgroundColor: '#1E3A5F' }} />
                <span style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#1A1A2E' }}>
                  포트폴리오 분석
                </span>
                {activeSnapshotId && (
                  <span style={{ fontSize: '0.8125rem', color: '#6B7280' }}>
                    — {historyList.find((h) => h.id === activeSnapshotId)?.snapshot_date ?? ''}
                  </span>
                )}
                {!activeSnapshotId && (
                  <span style={{ fontSize: '0.8125rem', color: '#9CA3AF' }}>
                    스냅샷을 클릭하면 분석 표가 표시됩니다.
                  </span>
                )}
              </div>
              <SnapshotDataTable
                clientName={clients.find((c) => c.id === histClientId)?.name ?? ''}
                accountType={
                  clients
                    .find((c) => c.id === histClientId)
                    ?.accounts.find((a) => a.id === histAccountId)
                    ?.account_type ?? 'irp'
                }
                snapshot={activeSnapshot}
                isLoading={activeSnapshotLoading}
                editable={true}
                onHoldingUpdated={(snapshotId) => loadActiveSnapshot(snapshotId)}
              />

              {/* ---- 리밸런싱 제안 편집기 ---- */}
              {activeSnapshot && activeSnapshot.holdings.length > 0 && (
                <SuggestionEditor
                  key={activeSnapshot.id}
                  holdings={activeSnapshot.holdings}
                  snapshotId={activeSnapshot.id}
                  accountId={histAccountId}
                  totalEvaluation={activeSnapshot.total_evaluation ?? 0}
                />
              )}
            </div>
          )}

          {/* ---- 차트 영역 ---- */}
          {histAccountId && (
            <PortfolioCharts
              accountId={histAccountId}
              snapshotId={activeSnapshotId}
              regionDistribution={regionDist}
              riskDistribution={riskDist}
              historyData={historyPoints}
              historyLoading={historyChartLoading}
              activePeriod={histPeriod}
              onActivePeriodChange={handleHistPeriodChange}
            />
          )}

          {/* ---- 보고서 이동 버튼 ---- */}
          {selectedSnapshotIds.size > 0 && (
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button
                variant="primary"
                size="md"
                onClick={() => setActiveTab('report')}
              >
                선택한 {selectedSnapshotIds.size}개 스냅샷으로 보고서 만들기
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </Button>
            </div>
          )}
        </div>
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

      {/* spin animation */}
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
