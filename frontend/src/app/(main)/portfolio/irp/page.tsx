'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Tab, type TabItem } from '@/components/common/Tab';
import { Button } from '@/components/common/Button';
import { Card } from '@/components/common/Card';
import { ClientRow } from '@/components/portfolio/ClientRow';
import { SnapshotDataTable } from '@/components/portfolio/SnapshotDataTable';
import { authLib } from '@/lib/auth';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

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

  /* ---------- tab2 state ---------- */
  const [processResults, setProcessResults] = useState<ProcessResult[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [snapshotsLoading, setSnapshotsLoading] = useState(false);
  const [searchDate, setSearchDate] = useState(todayString());
  const [searchClientName, setSearchClientName] = useState('');

  /* ---------- tab3 state ---------- */
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [reportDate, setReportDate] = useState(todayString());
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [modifiedWeights, setModifiedWeights] = useState<Record<string, number>>({});
  const [reportClientName, setReportClientName] = useState('');
  const [saving, setSaving] = useState(false);

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
    const results: ProcessResult[] = validRows.map((r) => ({
      clientName: r.clientName,
      accountType: r.accountType,
      status: 'pending',
    }));
    setProcessResults(results);
    setActiveTab('template');

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

  /* ---------- tab3: report ---------- */

  async function loadReport() {
    if (!selectedAccountId) {
      alert('계좌를 선택하세요.');
      return;
    }
    setReportLoading(true);
    setReportData(null);
    setModifiedWeights({});
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
    } catch (e) {
      alert(e instanceof Error ? e.message : '오류 발생');
    } finally {
      setReportLoading(false);
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
        </div>
      )}

      {/* ===================================================== */}
      {/* TAB 2: 데이터 확인                                     */}
      {/* ===================================================== */}
      {activeTab === 'template' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* 처리 결과 목록 */}
          {processResults.length > 0 && (
            <Card padding={16}>
              <h3 style={{ margin: '0 0 12px', fontSize: '0.9375rem', fontWeight: 700, color: '#1A1A2E' }}>
                처리 현황
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {processResults.map((r, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '8px 12px',
                      borderRadius: 8,
                      backgroundColor:
                        r.status === 'done'
                          ? '#ECFDF5'
                          : r.status === 'error'
                          ? '#FEF2F2'
                          : '#F9FAFB',
                      border: `1px solid ${
                        r.status === 'done'
                          ? '#6EE7B7'
                          : r.status === 'error'
                          ? '#FECACA'
                          : '#E1E5EB'
                      }`,
                    }}
                  >
                    <StatusIcon status={r.status} />
                    <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#1A1A2E' }}>
                      {r.clientName}
                    </span>
                    <span
                      style={{
                        fontSize: '0.75rem',
                        color: '#6B7280',
                        backgroundColor: '#F3F4F6',
                        padding: '2px 6px',
                        borderRadius: 4,
                      }}
                    >
                      {accountTypeLabel(r.accountType)}
                    </span>
                    {r.status === 'processing' && (
                      <span style={{ fontSize: '0.75rem', color: '#6B7280' }}>처리 중...</span>
                    )}
                    {r.errorMsg && (
                      <span style={{ fontSize: '0.75rem', color: '#EF4444', marginLeft: 4 }}>
                        {r.errorMsg}
                      </span>
                    )}
                    {r.status === 'done' && (
                      <span style={{ fontSize: '0.75rem', color: '#059669', marginLeft: 'auto' }}>
                        완료
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* 날짜/이름 필터 */}
          <Card padding={16}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#374151', whiteSpace: 'nowrap' }}>
                  조회일
                </label>
                <input
                  type="date"
                  value={searchDate}
                  onChange={(e) => setSearchDate(e.target.value)}
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
              <input
                type="text"
                placeholder="고객명 검색"
                value={searchClientName}
                onChange={(e) => setSearchClientName(e.target.value)}
                style={{
                  padding: '7px 10px',
                  fontSize: '0.8125rem',
                  border: '1px solid #E1E5EB',
                  borderRadius: 8,
                  outline: 'none',
                  color: '#1A1A2E',
                  width: 150,
                }}
              />
              <Button
                variant="secondary"
                size="sm"
                loading={snapshotsLoading}
                onClick={() => loadSnapshotsByDate(searchDate)}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                조회
              </Button>
              <div style={{ marginLeft: 'auto' }}>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => setActiveTab('report')}
                  disabled={snapshots.length === 0}
                >
                  보고서 만들기
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </Button>
              </div>
            </div>
          </Card>

          {/* 스냅샷 테이블 목록 */}
          {snapshotsLoading ? (
            <div style={{ textAlign: 'center', padding: '32px', color: '#9CA3AF', fontSize: '0.875rem' }}>
              로딩 중...
            </div>
          ) : filteredSnapshots.length === 0 && processResults.length === 0 ? (
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
              <p style={{ margin: 0, fontWeight: 600 }}>데이터가 없습니다</p>
              <p style={{ margin: '6px 0 0', fontSize: '0.8125rem' }}>
                탭 1에서 이미지를 업로드하거나, 날짜를 선택해 조회하세요.
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {filteredSnapshots.map((snap) => (
                <SnapshotDataTable
                  key={snap.id}
                  clientName={getClientNameForSnapshot(snap.client_account_id)}
                  accountType={getAccountTypeForSnapshot(snap.client_account_id)}
                  snapshot={snap}
                  isLoading={false}
                />
              ))}
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

          {/* ReportView */}
          <ReportView
            ref={reportRef}
            reportData={reportData}
            clientName={reportClientName}
            modifiedWeights={modifiedWeights}
            onWeightChange={(id, val) => setModifiedWeights((prev) => ({ ...prev, [id]: val }))}
          />
        </div>
      )}

      {/* spin animation */}
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
