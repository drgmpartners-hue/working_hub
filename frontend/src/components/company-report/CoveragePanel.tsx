'use client';

/** 수집 현황 — 최근 과거 데이터 구축 결과(P2-13에서 월별 막대·검증으로 확장) */
import { useEffect, useState } from 'react';
import { Card } from '@/components/common/Card';
import { crGet } from '@/lib/companyReportApi';
import { SectionTitle, mutedText } from './ui';

interface Job {
  id: string;
  period_from: string;
  period_to: string;
  status: string;
  progress: number;
  source_stats: { naver?: number; dart?: number; new?: number; excluded?: number } | null;
  coverage: { hit_limit_queries?: string[] } | null;
  error: string | null;
}

export function CoveragePanel({ companyId }: { companyId: string }) {
  const [job, setJob] = useState<Job | null>(null);
  useEffect(() => {
    crGet<Job[]>(`/companies/${companyId}/backfill-jobs`)
      .then((j) => setJob(j[0] || null))
      .catch(() => setJob(null));
  }, [companyId]);
  return (
    <Card padding={16}>
      <SectionTitle>수집 현황</SectionTitle>
      {job ? (
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
          <span className={`wh-badge ${job.status === 'done' ? 'pos' : job.status === 'failed' ? 'neg' : 'warn'}`}>
            {{ queued: '대기', running: `진행 ${job.progress}%`, done: '완료', failed: '실패' }[job.status] || job.status}
          </span>{' '}
          {job.period_from} ~ {job.period_to}
          {job.source_stats && (
            <div>
              뉴스 {job.source_stats.naver ?? 0} · 공시 {job.source_stats.dart ?? 0} → 저장 {job.source_stats.new ?? 0} (제외 {job.source_stats.excluded ?? 0})
            </div>
          )}
          {job.error && <div style={{ color: 'var(--danger)' }}>{job.error}</div>}
        </div>
      ) : (
        <span style={mutedText}>과거 데이터 구축 기록이 없습니다.</span>
      )}
    </Card>
  );
}

export default CoveragePanel;
