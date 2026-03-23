'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/common/Button';
import { ExcelUpload, UploadResult } from './ExcelUpload';
import { authLib } from '@/lib/auth';
import { Table, TableColumn } from '@/components/common/Table';
import { API_URL } from '@/lib/api-url';

type DataSource = 'crawling' | 'excel';

export interface CrawlingJob {
  id: number;
  source_type: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  created_at: string;
  completed_at?: string;
  result_count?: number;
  error_message?: string;
}

export interface RawDataRow {
  [key: string]: unknown;
}

interface DataSourceSelectorProps {
  onDataReady: (data: { source: DataSource; filePath?: string; crawlingJobId?: number; rows?: RawDataRow[] }) => void;
  sourceType?: string;
}

const STATUS_LABELS: Record<string, string> = {
  pending: '대기 중',
  running: '수집 중...',
  completed: '완료',
  failed: '실패',
};

const STATUS_COLORS: Record<string, string> = {
  pending: '#6B7280',
  running: '#4A90D9',
  completed: '#10B981',
  failed: '#EF4444',
};

export function DataSourceSelector({ onDataReady, sourceType = 'securities' }: DataSourceSelectorProps) {
  const [selected, setSelected] = useState<DataSource>('crawling');
  const [crawlingJob, setCrawlingJob] = useState<CrawlingJob | null>(null);
  const [crawlLoading, setCrawlLoading] = useState(false);
  const [crawlError, setCrawlError] = useState<string | null>(null);
  const [pollingActive, setPollingActive] = useState(false);

  /* Poll crawling status */
  useEffect(() => {
    if (!pollingActive || !crawlingJob) return;
    if (crawlingJob.status === 'completed' || crawlingJob.status === 'failed') return;

    const interval = setInterval(async () => {
      try {
        const resp = await fetch(`${API_URL}/api/v1/crawling/${crawlingJob.id}/status`, {
          headers: authLib.getAuthHeader(),
        });
        if (!resp.ok) return;
        const updated: CrawlingJob = await resp.json();
        setCrawlingJob(updated);

        if (updated.status === 'completed') {
          setPollingActive(false);
          onDataReady({ source: 'crawling', crawlingJobId: updated.id });
        } else if (updated.status === 'failed') {
          setPollingActive(false);
          setCrawlError(updated.error_message || '크롤링에 실패했습니다.');
        }
      } catch {
        // ignore transient poll errors
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [pollingActive, crawlingJob, onDataReady]);

  const handleStartCrawling = async () => {
    setCrawlLoading(true);
    setCrawlError(null);
    setCrawlingJob(null);

    try {
      const resp = await fetch(`${API_URL}/api/v1/crawling/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authLib.getAuthHeader(),
        },
        body: JSON.stringify({ source_type: sourceType }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.detail || `크롤링 시작 실패 (${resp.status})`);
      }

      const job: CrawlingJob = await resp.json();
      setCrawlingJob(job);
      setPollingActive(true);
    } catch (err) {
      setCrawlError(err instanceof Error ? err.message : '크롤링 시작 중 오류가 발생했습니다.');
    } finally {
      setCrawlLoading(false);
    }
  };

  const handleUploadSuccess = (result: UploadResult) => {
    onDataReady({ source: 'excel', filePath: result.file_path });
  };

  const statusColumns: TableColumn<{ label: string; value: string }>[] = [
    { key: 'label', header: '항목', width: 120 },
    { key: 'value', header: '값' },
  ];

  const crawlingStatusRows = crawlingJob
    ? [
        { label: '작업 ID', value: String(crawlingJob.id) },
        { label: '상태', value: STATUS_LABELS[crawlingJob.status] ?? crawlingJob.status },
        { label: '시작 시간', value: new Date(crawlingJob.created_at).toLocaleString('ko-KR') },
        ...(crawlingJob.completed_at
          ? [{ label: '완료 시간', value: new Date(crawlingJob.completed_at).toLocaleString('ko-KR') }]
          : []),
        ...(crawlingJob.result_count != null
          ? [{ label: '수집 건수', value: `${crawlingJob.result_count}건` }]
          : []),
      ]
    : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Source toggle */}
      <div>
        <p style={{ margin: '0 0 10px', fontSize: '0.875rem', fontWeight: 500, color: '#1A1A2E' }}>
          데이터 수집 방법
        </p>
        <div style={{ display: 'flex', gap: 10 }}>
          {(['crawling', 'excel'] as DataSource[]).map((src) => {
            const isActive = selected === src;
            return (
              <button
                key={src}
                onClick={() => setSelected(src)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '10px 20px',
                  borderRadius: 10,
                  border: isActive ? '2px solid #1E3A5F' : '2px solid #E1E5EB',
                  backgroundColor: isActive ? 'rgba(30,58,95,0.04)' : '#FFFFFF',
                  cursor: 'pointer',
                  fontSize: '0.875rem',
                  fontWeight: isActive ? 600 : 400,
                  color: isActive ? '#1E3A5F' : '#6B7280',
                  transition: 'all 0.15s ease',
                }}
              >
                {src === 'crawling' ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                    <path d="M3 3v5h5" />
                    <path d="M12 7v5l4 2" />
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                )}
                {src === 'crawling' ? '크롤링 수집' : '엑셀 업로드'}
              </button>
            );
          })}
        </div>
      </div>

      {/* Crawling section */}
      {selected === 'crawling' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Button
              onClick={handleStartCrawling}
              loading={crawlLoading}
              disabled={pollingActive}
              size="md"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
              </svg>
              크롤링 시작
            </Button>
            {crawlingJob && (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: '0.8125rem',
                  color: STATUS_COLORS[crawlingJob.status] ?? '#6B7280',
                  fontWeight: 500,
                }}
              >
                {crawlingJob.status === 'running' && (
                  <span
                    style={{
                      width: 12,
                      height: 12,
                      border: '2px solid currentColor',
                      borderTopColor: 'transparent',
                      borderRadius: '50%',
                      display: 'inline-block',
                      animation: 'spin 0.7s linear infinite',
                    }}
                  />
                )}
                {STATUS_LABELS[crawlingJob.status] ?? crawlingJob.status}
              </span>
            )}
          </div>

          {crawlError && (
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
              {crawlError}
            </div>
          )}

          {crawlingJob && crawlingStatusRows.length > 0 && (
            <Table
              columns={statusColumns}
              data={crawlingStatusRows}
              rowKey="label"
            />
          )}
        </div>
      )}

      {/* Excel upload section */}
      {selected === 'excel' && (
        <ExcelUpload
          label="증권사 데이터 엑셀 업로드"
          onUploadSuccess={handleUploadSuccess}
        />
      )}
    </div>
  );
}

export default DataSourceSelector;
