'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Tab } from '@/components/common/Tab';
import { Button } from '@/components/common/Button';
import { Card } from '@/components/common/Card';
import { ExcelUpload, UploadResult } from '@/components/commission/ExcelUpload';
import { CalculationResultTable, CommissionResult } from '@/components/commission/CalculationResultTable';
import { authLib } from '@/lib/auth';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

type CalcStatus = 'idle' | 'pending' | 'processing' | 'completed' | 'failed';

interface CommissionCalc {
  id: number;
  calc_type: string;
  status: CalcStatus;
  created_at: string;
  completed_at?: string;
  error_message?: string;
}

/* ------------------------------------------------------------------ */
/*  Status badge                                                         */
/* ------------------------------------------------------------------ */
function StatusBadge({ status }: { status: CalcStatus }) {
  const config: Record<CalcStatus, { label: string; bg: string; color: string }> = {
    idle:       { label: '대기',    bg: '#F5F7FA',                  color: '#6B7280' },
    pending:    { label: '처리 대기', bg: 'rgba(74,144,217,0.1)',  color: '#4A90D9' },
    processing: { label: '계산 중',  bg: 'rgba(74,144,217,0.1)',  color: '#4A90D9' },
    completed:  { label: '완료',    bg: 'rgba(16,185,129,0.1)',   color: '#10B981' },
    failed:     { label: '실패',    bg: 'rgba(239,68,68,0.1)',    color: '#EF4444' },
  };
  const { label, bg, color } = config[status] ?? config.idle;

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '3px 10px',
        borderRadius: 20,
        fontSize: '0.75rem',
        fontWeight: 600,
        backgroundColor: bg,
        color,
      }}
    >
      {(status === 'pending' || status === 'processing') && (
        <span
          style={{
            width: 8,
            height: 8,
            border: '1.5px solid currentColor',
            borderTopColor: 'transparent',
            borderRadius: '50%',
            display: 'inline-block',
            animation: 'spin 0.7s linear infinite',
          }}
        />
      )}
      {label}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Preview / Download panel                                             */
/* ------------------------------------------------------------------ */
function PreviewPanel({
  calcId,
  results,
  onDownloadAll,
}: {
  calcId: number | null;
  results: CommissionResult[];
  onDownloadAll: () => void;
}) {
  if (!calcId || results.length === 0) {
    return (
      <div
        style={{
          padding: '48px 24px',
          textAlign: 'center',
          color: '#6B7280',
          fontSize: '0.9rem',
        }}
      >
        <svg
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#E1E5EB"
          strokeWidth="1.5"
          style={{ margin: '0 auto 16px', display: 'block' }}
        >
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
          <polyline points="10 9 9 9 8 9" />
        </svg>
        <p style={{ margin: 0, fontWeight: 500 }}>미리보기할 계산 결과가 없습니다.</p>
        <p style={{ margin: '6px 0 0', fontSize: '0.8125rem' }}>탭 1에서 파일을 업로드하고 계산을 실행하세요.</p>
      </div>
    );
  }

  const totalAmount = results.reduce((s, r) => s + r.total_amount, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
        {[
          { label: '총 인원', value: `${results.length}명`, icon: '👥' },
          {
            label: '총 수당 합계',
            value: totalAmount.toLocaleString('ko-KR') + '원',
            icon: '💰',
          },
          {
            label: '1인 평균',
            value: Math.round(totalAmount / results.length).toLocaleString('ko-KR') + '원',
            icon: '📊',
          },
        ].map((item) => (
          <Card key={item.label} padding={16}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: '1.375rem' }}>{item.icon}</span>
              <span style={{ fontSize: '0.75rem', color: '#6B7280', fontWeight: 500 }}>{item.label}</span>
              <span style={{ fontSize: '1.125rem', fontWeight: 700, color: '#1A1A2E' }}>{item.value}</span>
            </div>
          </Card>
        ))}
      </div>

      {/* Download buttons */}
      <div style={{ display: 'flex', gap: 10 }}>
        <Button onClick={onDownloadAll} size="md">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          전체 PDF 다운로드
        </Button>
        <Button variant="secondary" size="md">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
          엑셀 내보내기
        </Button>
      </div>

      {/* Results table */}
      <CalculationResultTable
        calcId={calcId}
        results={results}
        loading={false}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                                 */
/* ------------------------------------------------------------------ */
export default function DrGmPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('upload');

  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [calcJob, setCalcJob] = useState<CommissionCalc | null>(null);
  const [calcStatus, setCalcStatus] = useState<CalcStatus>('idle');
  const [results, setResults] = useState<CommissionResult[]>([]);
  const [calcLoading, setCalcLoading] = useState(false);
  const [calcError, setCalcError] = useState<string | null>(null);

  const fetchResults = useCallback(async (calcId: number) => {
    try {
      const resp = await fetch(`${API_URL}/api/v1/commissions/${calcId}/results`, {
        headers: authLib.getAuthHeader(),
      });
      if (!resp.ok) return;
      const data: CommissionResult[] = await resp.json();
      setResults(data);
    } catch {
      // ignore
    }
  }, []);

  /* Poll calculation status */
  useEffect(() => {
    if (!calcJob) return;
    if (calcJob.status === 'completed' || calcJob.status === 'failed') return;

    const interval = setInterval(async () => {
      try {
        const resp = await fetch(`${API_URL}/api/v1/commissions/${calcJob.id}`, {
          headers: authLib.getAuthHeader(),
        });
        if (!resp.ok) return;
        const updated: CommissionCalc = await resp.json();
        setCalcJob(updated);
        setCalcStatus(updated.status);

        if (updated.status === 'completed') {
          fetchResults(updated.id);
        } else if (updated.status === 'failed') {
          setCalcError(updated.error_message || '계산에 실패했습니다.');
        }
      } catch {
        // ignore poll errors
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [calcJob, fetchResults]);

  const handleStartCalculation = useCallback(async () => {
    if (!uploadResult) return;
    setCalcLoading(true);
    setCalcError(null);
    setCalcStatus('pending');

    try {
      const resp = await fetch(`${API_URL}/api/v1/commissions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authLib.getAuthHeader(),
        },
        body: JSON.stringify({
          calc_type: 'dr_gm',
          source_file_path: uploadResult.file_path,
        }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.detail || `계산 시작 실패 (${resp.status})`);
      }

      const job: CommissionCalc = await resp.json();
      setCalcJob(job);
      setCalcStatus(job.status);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '계산 중 오류가 발생했습니다.';
      setCalcError(msg);
      setCalcStatus('failed');
    } finally {
      setCalcLoading(false);
    }
  }, [uploadResult]);

  const handleDownloadAll = async () => {
    if (!calcJob) return;
    try {
      const resp = await fetch(
        `${API_URL}/api/v1/commissions/${calcJob.id}/results/download`,
        { headers: authLib.getAuthHeader() }
      );
      if (!resp.ok) throw new Error('다운로드 실패');
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `dr_gm_commission_${calcJob.id}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert('다운로드에 실패했습니다.');
    }
  };

  const tabs = [
    { key: 'upload', label: '업로드 & 계산' },
    {
      key: 'preview',
      label: '미리보기 & 다운로드',
      count: results.length > 0 ? results.length : undefined,
      disabled: results.length === 0,
    },
  ];

  return (
    <div style={{ maxWidth: '860px', margin: '0 auto' }}>
      {/* Page header */}
      <div style={{ marginBottom: '28px' }}>
        <button
          onClick={() => router.push('/dashboard')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 0',
            border: 'none',
            backgroundColor: 'transparent',
            cursor: 'pointer',
            fontSize: '0.8125rem',
            color: '#6B7280',
            marginBottom: '12px',
            transition: 'color 0.15s ease',
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#1A1A2E'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#6B7280'; }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          대시보드로 돌아가기
        </button>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <div
              style={{
                width: 36,
                height: 4,
                borderRadius: 2,
                background: 'linear-gradient(90deg, #1E3A5F 0%, #4A90D9 100%)',
                marginBottom: 12,
              }}
            />
            <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 800, color: '#1A1A2E', letterSpacing: '-0.4px' }}>
              Dr.GM 수당정산 계산기
            </h1>
            <p style={{ margin: '6px 0 0', fontSize: '0.875rem', color: '#6B7280' }}>
              Dr.GM 엑셀 데이터를 업로드하여 수당을 자동 계산합니다.
            </p>
          </div>

          {calcStatus !== 'idle' && (
            <StatusBadge status={calcStatus} />
          )}
        </div>
      </div>

      {/* Tabs */}
      <Tab items={tabs} activeKey={activeTab} onChange={setActiveTab} />

      <div style={{ marginTop: '24px' }}>
        {/* ---- Tab 1: Upload & Calculate ---- */}
        {activeTab === 'upload' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Upload section */}
            <Card padding={24}>
              <h2 style={{ margin: '0 0 16px', fontSize: '1rem', fontWeight: 600, color: '#1A1A2E' }}>
                1단계: 엑셀 파일 업로드
              </h2>
              <ExcelUpload
                label="Dr.GM 수당 엑셀 파일 (.xlsx / .xls)"
                onUploadSuccess={setUploadResult}
                onUploadError={() => setUploadResult(null)}
              />
            </Card>

            {/* Calculation section */}
            <Card padding={24}>
              <h2 style={{ margin: '0 0 6px', fontSize: '1rem', fontWeight: 600, color: '#1A1A2E' }}>
                2단계: 수당 계산 실행
              </h2>
              <p style={{ margin: '0 0 16px', fontSize: '0.8125rem', color: '#6B7280' }}>
                업로드된 파일을 기반으로 Dr.GM 수당 계산을 시작합니다.
              </p>

              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <Button
                  onClick={handleStartCalculation}
                  loading={calcLoading || calcStatus === 'pending' || calcStatus === 'processing'}
                  disabled={!uploadResult || calcStatus === 'pending' || calcStatus === 'processing'}
                  size="md"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                  계산 시작
                </Button>

                {!uploadResult && (
                  <span style={{ fontSize: '0.8125rem', color: '#6B7280' }}>
                    파일을 먼저 업로드하세요.
                  </span>
                )}

                {calcStatus === 'completed' && results.length > 0 && (
                  <Button
                    variant="secondary"
                    size="md"
                    onClick={() => setActiveTab('preview')}
                  >
                    결과 보기
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </Button>
                )}
              </div>

              {calcError && (
                <div
                  style={{
                    marginTop: 14,
                    padding: '10px 14px',
                    borderRadius: 8,
                    backgroundColor: 'rgba(239,68,68,0.06)',
                    border: '1px solid rgba(239,68,68,0.2)',
                    fontSize: '0.8125rem',
                    color: '#EF4444',
                  }}
                >
                  {calcError}
                </div>
              )}
            </Card>

            {/* Live result preview */}
            {(calcStatus === 'processing' || calcStatus === 'completed' || results.length > 0) && (
              <Card padding={24}>
                <h2 style={{ margin: '0 0 16px', fontSize: '1rem', fontWeight: 600, color: '#1A1A2E' }}>
                  계산 결과
                </h2>
                <CalculationResultTable
                  calcId={calcJob?.id ?? null}
                  results={results}
                  loading={calcStatus === 'pending' || calcStatus === 'processing'}
                />
              </Card>
            )}
          </div>
        )}

        {/* ---- Tab 2: Preview & Download ---- */}
        {activeTab === 'preview' && (
          <Card padding={24}>
            <PreviewPanel
              calcId={calcJob?.id ?? null}
              results={results}
              onDownloadAll={handleDownloadAll}
            />
          </Card>
        )}
      </div>
    </div>
  );
}
