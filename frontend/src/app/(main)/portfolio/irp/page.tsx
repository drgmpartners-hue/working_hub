/**
 * IRP 포트폴리오 수익률 관리기
 * /portfolio/irp
 *
 * 3-tab layout:
 *  Tab 1: 데이터 확인  – 크롤링 or 엑셀 업로드 → 결과 테이블
 *  Tab 2: 템플릿 & AI  – 항목 편집 + AI 분석 / 리밸런싱 제안
 *  Tab 3: 보고서 & PDF – 보고서 미리보기 + 다운로드
 */
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Tab, type TabItem } from '@/components/common/Tab';
import { Button } from '@/components/common/Button';
import { Card } from '@/components/common/Card';
import { TemplateEditPanel } from '@/components/portfolio/TemplateEditPanel';
import { AIAnalysisPanel } from '@/components/portfolio/AIAnalysisPanel';
import { authLib } from '@/lib/auth';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

interface PortfolioAnalysis {
  id: number;
  title: string;
  status: 'pending' | 'processing' | 'done' | 'error';
  created_at: string;
  item_count?: number;
}

interface CrawlingJob {
  job_id: string;
  status: 'pending' | 'running' | 'done' | 'error';
  progress?: number;
  result?: unknown;
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                      */
/* ------------------------------------------------------------------ */

/** Step indicator dot */
function StepDot({ active, done, label }: { active: boolean; done: boolean; label: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: done ? '#1E3A5F' : active ? '#2E8B8B' : '#E1E5EB',
          color: done || active ? '#fff' : '#9CA3AF',
          fontSize: '0.8125rem',
          fontWeight: 700,
          transition: 'all 0.2s ease',
        }}
      >
        {done ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : (
          label
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tab 1 – DataSourceSelector + DataResultTable                        */
/* ------------------------------------------------------------------ */

function DataTab({
  onAnalysisCreated,
}: {
  onAnalysisCreated: (analysis: PortfolioAnalysis) => void;
}) {
  const [sourceType, setSourceType] = useState<'crawling' | 'excel'>('excel');
  const [crawlingUrl, setCrawlingUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<CrawlingJob | null>(null);
  const [analysis, setAnalysis] = useState<PortfolioAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleExcelUpload() {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('title', title || file.name);
      formData.append('type', 'irp_portfolio');

      const uploadRes = await fetch(`${API_URL}/api/v1/upload/excel`, {
        method: 'POST',
        headers: { ...authLib.getAuthHeader() },
        body: formData,
      });
      if (!uploadRes.ok) throw new Error('파일 업로드에 실패했습니다.');
      const uploadData = await uploadRes.json();

      const createRes = await fetch(`${API_URL}/api/v1/portfolios`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authLib.getAuthHeader(),
        },
        body: JSON.stringify({
          title: title || file.name,
          source: 'excel',
          file_id: uploadData.file_id,
        }),
      });
      if (!createRes.ok) throw new Error('포트폴리오 분석 생성에 실패했습니다.');
      const newAnalysis: PortfolioAnalysis = await createRes.json();
      setAnalysis(newAnalysis);
      onAnalysisCreated(newAnalysis);
    } catch (err) {
      setError(err instanceof Error ? err.message : '알 수 없는 오류');
    } finally {
      setLoading(false);
    }
  }

  async function handleCrawlingStart() {
    if (!crawlingUrl) return;
    setLoading(true);
    setError(null);
    setJobStatus(null);
    try {
      const res = await fetch(`${API_URL}/api/v1/crawling/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authLib.getAuthHeader(),
        },
        body: JSON.stringify({ url: crawlingUrl, type: 'irp_portfolio' }),
      });
      if (!res.ok) throw new Error('크롤링 시작에 실패했습니다.');
      const data = await res.json();
      setJobId(data.job_id);
      pollJobStatus(data.job_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : '알 수 없는 오류');
      setLoading(false);
    }
  }

  async function pollJobStatus(jid: string) {
    const poll = async () => {
      try {
        const res = await fetch(`${API_URL}/api/v1/crawling/${jid}/status`, {
          headers: { ...authLib.getAuthHeader() },
        });
        if (!res.ok) throw new Error('상태 조회 실패');
        const job: CrawlingJob = await res.json();
        setJobStatus(job);

        if (job.status === 'running' || job.status === 'pending') {
          setTimeout(poll, 2000);
        } else if (job.status === 'done') {
          // Create portfolio from crawling result
          const createRes = await fetch(`${API_URL}/api/v1/portfolios`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...authLib.getAuthHeader(),
            },
            body: JSON.stringify({
              title: title || '크롤링 포트폴리오',
              source: 'crawling',
              job_id: jid,
            }),
          });
          if (!createRes.ok) throw new Error('포트폴리오 생성 실패');
          const newAnalysis: PortfolioAnalysis = await createRes.json();
          setAnalysis(newAnalysis);
          onAnalysisCreated(newAnalysis);
          setLoading(false);
        } else {
          throw new Error('크롤링 중 오류가 발생했습니다.');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : '알 수 없는 오류');
        setLoading(false);
      }
    };
    poll();
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Title input */}
      <div>
        <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, color: '#374151', marginBottom: 6 }}>
          분석 제목
        </label>
        <input
          type="text"
          placeholder="예: 2024년 4분기 IRP 포트폴리오"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
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

      {/* Source selector */}
      <div>
        <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, color: '#374151', marginBottom: 10 }}>
          데이터 소스
        </label>
        <div style={{ display: 'flex', gap: 10 }}>
          {(['excel', 'crawling'] as const).map((type) => (
            <button
              key={type}
              onClick={() => setSourceType(type)}
              style={{
                flex: 1,
                padding: '12px 16px',
                borderRadius: 10,
                border: `2px solid ${sourceType === type ? '#1E3A5F' : '#E1E5EB'}`,
                backgroundColor: sourceType === type ? '#EEF2F7' : '#FFFFFF',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                transition: 'all 0.15s ease',
              }}
            >
              {type === 'excel' ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={sourceType === 'excel' ? '#1E3A5F' : '#6B7280'} strokeWidth="1.5">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="9" y1="12" x2="15" y2="12" />
                  <line x1="9" y1="16" x2="15" y2="16" />
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={sourceType === 'crawling' ? '#1E3A5F' : '#6B7280'} strokeWidth="1.5">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="2" y1="12" x2="22" y2="12" />
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                </svg>
              )}
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontSize: '0.875rem', fontWeight: 600, color: sourceType === type ? '#1E3A5F' : '#1A1A2E' }}>
                  {type === 'excel' ? '엑셀 업로드' : '크롤링'}
                </div>
                <div style={{ fontSize: '0.75rem', color: '#6B7280', marginTop: 1 }}>
                  {type === 'excel' ? '.xlsx / .xls 파일' : 'URL에서 자동 수집'}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Excel upload */}
      {sourceType === 'excel' && (
        <Card padding={16}>
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const dropped = e.dataTransfer.files[0];
              if (dropped) setFile(dropped);
            }}
            style={{
              border: '2px dashed #E1E5EB',
              borderRadius: 10,
              padding: '32px 20px',
              textAlign: 'center',
              backgroundColor: file ? '#F0FDF4' : '#FAFBFC',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
            onClick={() => document.getElementById('irp-file-input')?.click()}
          >
            <input
              id="irp-file-input"
              type="file"
              accept=".xlsx,.xls"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) setFile(f);
              }}
            />
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke={file ? '#059669' : '#9CA3AF'}
              strokeWidth="1.5"
              style={{ margin: '0 auto 10px' }}
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <p style={{ margin: 0, fontSize: '0.875rem', color: file ? '#059669' : '#6B7280' }}>
              {file ? file.name : '파일을 드래그하거나 클릭하여 선택하세요'}
            </p>
            {!file && (
              <p style={{ margin: '4px 0 0', fontSize: '0.75rem', color: '#9CA3AF' }}>
                .xlsx, .xls 형식 지원
              </p>
            )}
          </div>
          {file && (
            <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
              <Button size="sm" variant="ghost" onClick={() => setFile(null)}>
                파일 제거
              </Button>
            </div>
          )}
        </Card>
      )}

      {/* Crawling URL */}
      {sourceType === 'crawling' && (
        <Card padding={16}>
          <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, color: '#374151', marginBottom: 6 }}>
            크롤링 URL
          </label>
          <input
            type="url"
            placeholder="https://example.com/portfolio"
            value={crawlingUrl}
            onChange={(e) => setCrawlingUrl(e.target.value)}
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

          {/* Crawling progress */}
          {jobStatus && (
            <div style={{ marginTop: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: '0.8125rem', color: '#6B7280' }}>
                  {jobStatus.status === 'running' ? '크롤링 진행 중...' : '크롤링 완료'}
                </span>
                <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#1E3A5F' }}>
                  {jobStatus.progress ?? 0}%
                </span>
              </div>
              <div style={{ height: 6, backgroundColor: '#E1E5EB', borderRadius: 3, overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${jobStatus.progress ?? 0}%`,
                    backgroundColor: '#1E3A5F',
                    borderRadius: 3,
                    transition: 'width 0.4s ease',
                  }}
                />
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Error */}
      {error && (
        <div
          style={{
            padding: '12px 16px',
            backgroundColor: '#FEF2F2',
            border: '1px solid #FECACA',
            borderRadius: 8,
            color: '#B91C1C',
            fontSize: '0.875rem',
          }}
        >
          {error}
        </div>
      )}

      {/* Success */}
      {analysis && (
        <div
          style={{
            padding: '14px 16px',
            backgroundColor: '#ECFDF5',
            border: '1px solid #6EE7B7',
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2.5" strokeLinecap="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span style={{ fontSize: '0.875rem', color: '#065F46' }}>
            분석이 생성되었습니다. (ID: {analysis.id}) — 다음 탭에서 편집하고 AI 분석을 요청하세요.
          </span>
        </div>
      )}

      {/* Submit */}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button
          variant="primary"
          size="md"
          loading={loading}
          disabled={
            (sourceType === 'excel' && !file) ||
            (sourceType === 'crawling' && !crawlingUrl) ||
            !!analysis
          }
          onClick={sourceType === 'excel' ? handleExcelUpload : handleCrawlingStart}
        >
          {loading
            ? sourceType === 'crawling'
              ? '크롤링 중...'
              : '업로드 중...'
            : '데이터 불러오기'}
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tab 3 – Report preview                                              */
/* ------------------------------------------------------------------ */

function ReportTab({ analysisId }: { analysisId: number | null }) {
  const [loading, setLoading] = useState(false);
  const [reportHtml, setReportHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  async function generateReport() {
    if (!analysisId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/v1/portfolios/${analysisId}`, {
        headers: { ...authLib.getAuthHeader() },
      });
      if (!res.ok) throw new Error('보고서 조회 실패');
      const data = await res.json();
      setReportHtml(data.report_html ?? buildFallbackReport(data));
    } catch (err) {
      setError(err instanceof Error ? err.message : '보고서 생성 중 오류');
    } finally {
      setLoading(false);
    }
  }

  function buildFallbackReport(data: Record<string, unknown>): string {
    return `
      <div style="font-family:sans-serif;padding:32px;max-width:760px;margin:0 auto;">
        <h1 style="color:#1E3A5F;border-bottom:3px solid #1E3A5F;padding-bottom:12px;">
          IRP 포트폴리오 분석 보고서
        </h1>
        <p style="color:#6B7280;font-size:14px;">생성일: ${new Date().toLocaleDateString('ko-KR')}</p>
        <h2 style="color:#1E3A5F;margin-top:28px;">분석 요약</h2>
        <p>${(data.ai_analysis as string) ?? '분석 결과가 없습니다. AI 분석을 먼저 요청하세요.'}</p>
      </div>
    `;
  }

  async function downloadPDF() {
    if (!analysisId) return;
    setDownloading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/portfolios/${analysisId}/export/pdf`, {
        headers: { ...authLib.getAuthHeader() },
      });
      if (!res.ok) throw new Error('PDF 다운로드 실패');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `portfolio_report_${analysisId}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'PDF 다운로드 오류');
    } finally {
      setDownloading(false);
    }
  }

  if (!analysisId) {
    return (
      <div
        style={{
          padding: '60px 20px',
          textAlign: 'center',
          color: '#6B7280',
        }}
      >
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#D1D5DB" strokeWidth="1" style={{ margin: '0 auto 16px', display: 'block' }}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="9" y1="12" x2="15" y2="12" />
          <line x1="9" y1="16" x2="15" y2="16" />
        </svg>
        <p style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 600 }}>데이터를 먼저 불러오세요</p>
        <p style={{ margin: '6px 0 0', fontSize: '0.8125rem' }}>
          탭 1에서 데이터를 업로드한 후 보고서를 생성할 수 있습니다.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <p style={{ margin: 0, fontSize: '0.875rem', color: '#6B7280' }}>
          분석 ID: <strong style={{ color: '#1A1A2E' }}>#{analysisId}</strong>
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button size="sm" variant="secondary" loading={loading} onClick={generateReport}>
            보고서 미리보기
          </Button>
          <Button size="sm" variant="primary" loading={downloading} onClick={downloadPDF} disabled={!reportHtml}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            PDF 다운로드
          </Button>
        </div>
      </div>

      {error && (
        <div
          style={{
            padding: '12px 16px',
            backgroundColor: '#FEF2F2',
            border: '1px solid #FECACA',
            borderRadius: 8,
            color: '#B91C1C',
            fontSize: '0.875rem',
          }}
        >
          {error}
        </div>
      )}

      {reportHtml ? (
        <div
          style={{
            border: '1px solid #E1E5EB',
            borderRadius: 10,
            backgroundColor: '#FFFFFF',
            minHeight: 400,
            overflow: 'hidden',
          }}
        >
          <iframe
            srcDoc={reportHtml}
            style={{ width: '100%', height: '600px', border: 'none' }}
            title="보고서 미리보기"
          />
        </div>
      ) : (
        <div
          style={{
            border: '2px dashed #E1E5EB',
            borderRadius: 10,
            padding: '60px 20px',
            textAlign: 'center',
            color: '#9CA3AF',
            fontSize: '0.875rem',
            backgroundColor: '#FAFBFC',
          }}
        >
          "보고서 미리보기" 버튼을 클릭하면 보고서가 여기에 표시됩니다.
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main page                                                           */
/* ------------------------------------------------------------------ */

const TABS: TabItem[] = [
  { key: 'data', label: '1. 데이터 확인' },
  { key: 'template', label: '2. 템플릿 & AI 분석' },
  { key: 'report', label: '3. 보고서 & PDF' },
];

export default function IRPPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('data');
  const [currentAnalysis, setCurrentAnalysis] = useState<{ id: number } | null>(null);

  const stepIndex = TABS.findIndex((t) => t.key === activeTab);

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto' }}>
      {/* Page header */}
      <div style={{ marginBottom: 28 }}>
        <button
          onClick={() => router.push('/dashboard')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            marginBottom: 14,
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
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          대시보드로 돌아가기
        </button>

        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <div
              style={{
                width: 36,
                height: 4,
                borderRadius: 2,
                background: 'linear-gradient(90deg, #2E8B8B 0%, #1E3A5F 100%)',
                marginBottom: 12,
              }}
            />
            <h1
              style={{
                margin: 0,
                fontSize: '24px',
                fontWeight: 800,
                color: '#1A1A2E',
                letterSpacing: '-0.4px',
              }}
            >
              IRP 포트폴리오 수익률 관리기
            </h1>
            <p style={{ margin: '6px 0 0', fontSize: '0.875rem', color: '#6B7280' }}>
              IRP 포트폴리오 데이터를 불러오고 AI 리밸런싱 제안을 받아 보고서를 생성합니다.
            </p>
          </div>

          {/* Step indicators */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 0,
              flexShrink: 0,
            }}
          >
            {TABS.map((tab, i) => (
              <div key={tab.key} style={{ display: 'flex', alignItems: 'center' }}>
                <StepDot
                  active={activeTab === tab.key}
                  done={i < stepIndex}
                  label={String(i + 1)}
                />
                {i < TABS.length - 1 && (
                  <div
                    style={{
                      width: 28,
                      height: 2,
                      backgroundColor: i < stepIndex ? '#1E3A5F' : '#E1E5EB',
                      transition: 'background-color 0.2s ease',
                    }}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ marginBottom: 24 }}>
        <Tab items={TABS} activeKey={activeTab} onChange={setActiveTab} variant="underline" />
      </div>

      {/* Tab content */}
      <div>
        {activeTab === 'data' && (
          <DataTab
            onAnalysisCreated={(a) => {
              setCurrentAnalysis({ id: a.id });
              setActiveTab('template');
            }}
          />
        )}

        {activeTab === 'template' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {!currentAnalysis ? (
              <div
                style={{
                  padding: '48px 20px',
                  textAlign: 'center',
                  color: '#6B7280',
                  fontSize: '0.875rem',
                }}
              >
                탭 1에서 데이터를 먼저 불러오세요.
                <Button
                  size="sm"
                  variant="secondary"
                  style={{ marginLeft: 12 }}
                  onClick={() => setActiveTab('data')}
                >
                  데이터 확인으로 이동
                </Button>
              </div>
            ) : (
              <>
                {/* Template edit section */}
                <Card padding={20}>
                  <h2
                    style={{
                      margin: '0 0 16px',
                      fontSize: '1rem',
                      fontWeight: 700,
                      color: '#1A1A2E',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1E3A5F" strokeWidth="2" strokeLinecap="round">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                    포트폴리오 항목 편집
                  </h2>
                  <TemplateEditPanel analysisId={currentAnalysis.id} />
                </Card>

                {/* AI analysis section */}
                <Card padding={20}>
                  <h2
                    style={{
                      margin: '0 0 16px',
                      fontSize: '1rem',
                      fontWeight: 700,
                      color: '#1A1A2E',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2E8B8B" strokeWidth="2" strokeLinecap="round">
                      <circle cx="12" cy="12" r="10" />
                      <path d="M12 8v4l3 3" />
                    </svg>
                    AI 분석 & 리밸런싱 제안
                  </h2>
                  <AIAnalysisPanel analysisId={currentAnalysis.id} />
                </Card>

                {/* Next step */}
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <Button
                    variant="primary"
                    size="md"
                    onClick={() => setActiveTab('report')}
                  >
                    보고서 생성하기
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        {activeTab === 'report' && (
          <ReportTab analysisId={currentAnalysis?.id ?? null} />
        )}
      </div>
    </div>
  );
}
