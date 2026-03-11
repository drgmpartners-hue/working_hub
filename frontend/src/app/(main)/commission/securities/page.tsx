'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Tab } from '@/components/common/Tab';
import { Button } from '@/components/common/Button';
import { Card } from '@/components/common/Card';
import { Table, TableColumn } from '@/components/common/Table';
import { DataSourceSelector } from '@/components/commission/DataSourceSelector';
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

interface DataReadyPayload {
  source: 'crawling' | 'excel';
  filePath?: string;
  crawlingJobId?: number;
  rows?: Record<string, unknown>[];
}

/* ------------------------------------------------------------------ */
/*  Status badge                                                         */
/* ------------------------------------------------------------------ */
function StatusBadge({ status }: { status: CalcStatus }) {
  const cfg: Record<CalcStatus, { label: string; bg: string; color: string }> = {
    idle:       { label: '대기',    bg: '#F5F7FA',                 color: '#6B7280' },
    pending:    { label: '처리 대기', bg: 'rgba(74,144,217,0.1)', color: '#4A90D9' },
    processing: { label: '계산 중',  bg: 'rgba(74,144,217,0.1)', color: '#4A90D9' },
    completed:  { label: '완료',    bg: 'rgba(16,185,129,0.1)',  color: '#10B981' },
    failed:     { label: '실패',    bg: 'rgba(239,68,68,0.1)',   color: '#EF4444' },
  };
  const { label, bg, color } = cfg[status] ?? cfg.idle;
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
/*  Template Calc Panel (Tab 2)                                          */
/* ------------------------------------------------------------------ */
const TEMPLATES = [
  { id: 'standard', label: '표준 증권사 정산', description: '기본 수당 + 성과급 + 인센티브 계산' },
  { id: 'ifa', label: 'IFA 전용 정산', description: 'IFA 계약 기준 수당 계산' },
  { id: 'premium', label: '프리미엄 정산', description: '프리미엄 계약 전용 고급 계산식' },
];

function TemplateCalcPanel({
  dataReady,
  onCalculate,
  calcStatus,
  calcError,
  calcLoading,
}: {
  dataReady: DataReadyPayload | null;
  onCalculate: (templateId: string) => void;
  calcStatus: CalcStatus;
  calcError: string | null;
  calcLoading: boolean;
}) {
  const [selectedTemplate, setSelectedTemplate] = useState<string>('standard');

  if (!dataReady) {
    return (
      <div
        style={{
          padding: '40px 24px',
          textAlign: 'center',
          color: '#6B7280',
          fontSize: '0.875rem',
        }}
      >
        <svg
          width="40"
          height="40"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#E1E5EB"
          strokeWidth="1.5"
          style={{ margin: '0 auto 12px', display: 'block' }}
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <p style={{ margin: 0, fontWeight: 500 }}>먼저 탭 1에서 데이터를 수집하세요.</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Data source info */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '12px 16px',
          borderRadius: 10,
          backgroundColor: 'rgba(16,185,129,0.06)',
          border: '1px solid rgba(16,185,129,0.2)',
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2.5" strokeLinecap="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
        <span style={{ fontSize: '0.8125rem', color: '#10B981', fontWeight: 500 }}>
          데이터 준비 완료 —{' '}
          {dataReady.source === 'crawling'
            ? `크롤링 작업 #${dataReady.crawlingJobId}`
            : `엑셀 파일: ${dataReady.filePath?.split('/').pop() ?? dataReady.filePath}`}
        </span>
      </div>

      {/* Template selection */}
      <div>
        <p style={{ margin: '0 0 12px', fontSize: '0.875rem', fontWeight: 500, color: '#1A1A2E' }}>
          정산 템플릿 선택
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {TEMPLATES.map((tmpl) => {
            const isSelected = selectedTemplate === tmpl.id;
            return (
              <button
                key={tmpl.id}
                onClick={() => setSelectedTemplate(tmpl.id)}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 12,
                  padding: '14px 16px',
                  borderRadius: 10,
                  border: isSelected ? '2px solid #1E3A5F' : '2px solid #E1E5EB',
                  backgroundColor: isSelected ? 'rgba(30,58,95,0.03)' : '#FFFFFF',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all 0.15s ease',
                }}
              >
                {/* Radio indicator */}
                <span
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: '50%',
                    border: isSelected ? '5px solid #1E3A5F' : '2px solid #E1E5EB',
                    flexShrink: 0,
                    marginTop: 2,
                    transition: 'all 0.15s ease',
                  }}
                />
                <div>
                  <p style={{ margin: 0, fontSize: '0.875rem', fontWeight: 600, color: '#1A1A2E' }}>
                    {tmpl.label}
                  </p>
                  <p style={{ margin: '3px 0 0', fontSize: '0.8125rem', color: '#6B7280' }}>
                    {tmpl.description}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Calculate button */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Button
          onClick={() => onCalculate(selectedTemplate)}
          loading={calcLoading || calcStatus === 'pending' || calcStatus === 'processing'}
          disabled={calcStatus === 'pending' || calcStatus === 'processing'}
          size="md"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
          계산 실행
        </Button>
        {calcStatus !== 'idle' && <StatusBadge status={calcStatus} />}
      </div>

      {calcError && (
        <div
          style={{
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
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Preview / Download Panel (Tab 3)                                     */
/* ------------------------------------------------------------------ */
function PreviewDownloadPanel({
  calcId,
  results,
}: {
  calcId: number | null;
  results: CommissionResult[];
}) {
  const handleDownloadAll = async () => {
    if (!calcId) return;
    try {
      const resp = await fetch(
        `${API_URL}/api/v1/commissions/${calcId}/results/download`,
        { headers: authLib.getAuthHeader() }
      );
      if (!resp.ok) throw new Error('다운로드 실패');
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `securities_commission_${calcId}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert('다운로드에 실패했습니다.');
    }
  };

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
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        <p style={{ margin: 0, fontWeight: 500 }}>아직 계산 결과가 없습니다.</p>
        <p style={{ margin: '6px 0 0', fontSize: '0.8125rem' }}>탭 1~2 순서로 진행하여 계산을 완료하세요.</p>
      </div>
    );
  }

  const totalAmount = results.reduce((s, r) => s + r.total_amount, 0);

  /* Summary stat table */
  const summaryColumns: TableColumn<{ label: string; value: string }>[] = [
    { key: 'label', header: '항목', width: 160 },
    { key: 'value', header: '값', align: 'right' },
  ];
  const summaryRows = [
    { label: '총 대상 인원', value: `${results.length}명` },
    { label: '수당 합계', value: totalAmount.toLocaleString('ko-KR') + '원' },
    { label: '1인 평균 수당', value: Math.round(totalAmount / results.length).toLocaleString('ko-KR') + '원' },
    { label: '최고 수당', value: Math.max(...results.map((r) => r.total_amount)).toLocaleString('ko-KR') + '원' },
    { label: '최저 수당', value: Math.min(...results.map((r) => r.total_amount)).toLocaleString('ko-KR') + '원' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Download actions */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Button onClick={handleDownloadAll} size="md">
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

      {/* Summary */}
      <div>
        <h3 style={{ margin: '0 0 12px', fontSize: '0.9375rem', fontWeight: 600, color: '#1A1A2E' }}>
          정산 요약
        </h3>
        <Table
          columns={summaryColumns}
          data={summaryRows}
          rowKey="label"
        />
      </div>

      {/* Detailed results */}
      <div>
        <h3 style={{ margin: '0 0 12px', fontSize: '0.9375rem', fontWeight: 600, color: '#1A1A2E' }}>
          상세 결과
        </h3>
        <CalculationResultTable
          calcId={calcId}
          results={results}
          loading={false}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                                 */
/* ------------------------------------------------------------------ */
export default function SecuritiesPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('data');

  const [dataReady, setDataReady] = useState<DataReadyPayload | null>(null);
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

  const handleDataReady = useCallback((payload: DataReadyPayload) => {
    setDataReady(payload);
  }, []);

  const handleCalculate = useCallback(
    async (templateId: string) => {
      if (!dataReady) return;
      setCalcLoading(true);
      setCalcError(null);
      setCalcStatus('pending');

      try {
        const body: Record<string, unknown> = {
          calc_type: 'securities',
          input_data: { template_id: templateId },
        };

        if (dataReady.source === 'excel' && dataReady.filePath) {
          body.source_file_path = dataReady.filePath;
        } else if (dataReady.source === 'crawling' && dataReady.crawlingJobId) {
          body.input_data = { ...body.input_data as Record<string, unknown>, crawling_job_id: dataReady.crawlingJobId };
        }

        const resp = await fetch(`${API_URL}/api/v1/commissions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...authLib.getAuthHeader(),
          },
          body: JSON.stringify(body),
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
    },
    [dataReady]
  );

  const tabs = [
    { key: 'data', label: '데이터 확인' },
    {
      key: 'template',
      label: '템플릿 & 계산',
      disabled: !dataReady,
    },
    {
      key: 'preview',
      label: '미리보기 & 다운로드',
      count: results.length > 0 ? results.length : undefined,
      disabled: results.length === 0,
    },
  ];

  /* Progress stepper labels */
  const steps = [
    { key: 'data',     label: '데이터 수집', done: !!dataReady },
    { key: 'template', label: '계산 실행',   done: calcStatus === 'completed' },
    { key: 'preview',  label: '다운로드',    done: false },
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
                background: 'linear-gradient(90deg, #2E8B8B 0%, #4A90D9 100%)',
                marginBottom: 12,
              }}
            />
            <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 800, color: '#1A1A2E', letterSpacing: '-0.4px' }}>
              증권사 수당정산 계산기
            </h1>
            <p style={{ margin: '6px 0 0', fontSize: '0.875rem', color: '#6B7280' }}>
              크롤링 또는 엑셀 업로드로 증권사 수당 데이터를 수집하고 정산합니다.
            </p>
          </div>
          {calcStatus !== 'idle' && <StatusBadge status={calcStatus} />}
        </div>
      </div>

      {/* Progress stepper */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: 24 }}>
        {steps.map((step, idx) => (
          <div
            key={step.key}
            style={{ display: 'flex', alignItems: 'center', flex: idx < steps.length - 1 ? 1 : 'none' }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                cursor: 'default',
              }}
            >
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  backgroundColor: step.done
                    ? '#10B981'
                    : activeTab === step.key
                    ? '#1E3A5F'
                    : '#E1E5EB',
                  color: step.done || activeTab === step.key ? '#FFFFFF' : '#6B7280',
                  transition: 'all 0.2s ease',
                  flexShrink: 0,
                }}
              >
                {step.done ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  idx + 1
                )}
              </div>
              <span
                style={{
                  fontSize: '0.8125rem',
                  fontWeight: activeTab === step.key ? 600 : 400,
                  color: activeTab === step.key ? '#1A1A2E' : '#6B7280',
                  whiteSpace: 'nowrap',
                }}
              >
                {step.label}
              </span>
            </div>
            {idx < steps.length - 1 && (
              <div
                style={{
                  flex: 1,
                  height: 2,
                  margin: '0 12px',
                  backgroundColor: step.done ? '#10B981' : '#E1E5EB',
                  borderRadius: 1,
                  transition: 'background-color 0.3s ease',
                }}
              />
            )}
          </div>
        ))}
      </div>

      {/* Tabs */}
      <Tab items={tabs} activeKey={activeTab} onChange={setActiveTab} />

      <div style={{ marginTop: '24px' }}>
        {/* ---- Tab 1: Data Source ---- */}
        {activeTab === 'data' && (
          <Card padding={24}>
            <h2 style={{ margin: '0 0 6px', fontSize: '1rem', fontWeight: 600, color: '#1A1A2E' }}>
              데이터 수집
            </h2>
            <p style={{ margin: '0 0 20px', fontSize: '0.8125rem', color: '#6B7280' }}>
              크롤링으로 실시간 수집하거나 엑셀 파일을 직접 업로드하세요.
            </p>

            <DataSourceSelector
              onDataReady={handleDataReady}
              sourceType="securities"
            />

            {dataReady && (
              <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end' }}>
                <Button
                  size="md"
                  onClick={() => setActiveTab('template')}
                >
                  다음 단계 — 템플릿 & 계산
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </Button>
              </div>
            )}
          </Card>
        )}

        {/* ---- Tab 2: Template & Calculate ---- */}
        {activeTab === 'template' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <Card padding={24}>
              <h2 style={{ margin: '0 0 6px', fontSize: '1rem', fontWeight: 600, color: '#1A1A2E' }}>
                템플릿 선택 & 계산 실행
              </h2>
              <p style={{ margin: '0 0 20px', fontSize: '0.8125rem', color: '#6B7280' }}>
                정산 유형을 선택하고 수당 계산을 시작하세요.
              </p>

              <TemplateCalcPanel
                dataReady={dataReady}
                onCalculate={handleCalculate}
                calcStatus={calcStatus}
                calcError={calcError}
                calcLoading={calcLoading}
              />
            </Card>

            {/* Results preview if completed */}
            {(calcStatus === 'processing' || calcStatus === 'completed' || results.length > 0) && (
              <Card padding={24}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                  <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: '#1A1A2E' }}>
                    계산 결과
                  </h2>
                  {calcStatus === 'completed' && results.length > 0 && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setActiveTab('preview')}
                    >
                      미리보기 & 다운로드
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </Button>
                  )}
                </div>
                <CalculationResultTable
                  calcId={calcJob?.id ?? null}
                  results={results}
                  loading={calcStatus === 'pending' || calcStatus === 'processing'}
                />
              </Card>
            )}
          </div>
        )}

        {/* ---- Tab 3: Preview & Download ---- */}
        {activeTab === 'preview' && (
          <Card padding={24}>
            <h2 style={{ margin: '0 0 6px', fontSize: '1rem', fontWeight: 600, color: '#1A1A2E' }}>
              미리보기 & 다운로드
            </h2>
            <p style={{ margin: '0 0 20px', fontSize: '0.8125rem', color: '#6B7280' }}>
              계산 결과를 확인하고 PDF 또는 엑셀로 내보내세요.
            </p>
            <PreviewDownloadPanel
              calcId={calcJob?.id ?? null}
              results={results}
            />
          </Card>
        )}
      </div>
    </div>
  );
}
