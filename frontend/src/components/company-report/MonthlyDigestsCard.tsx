'use client';

/** 기업 원장 탭 — 월간 요약 목록(월간 브리핑을 만들 때 기업별로 저장됨) */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Card } from '@/components/common/Card';
import { crGet } from '@/lib/companyReportApi';
import type { MonthlyDigest } from './types';
import { SectionTitle, Spinner, mutedText } from './ui';

export function MonthlyDigestsCard({ companyId }: { companyId: string }) {
  const [rows, setRows] = useState<MonthlyDigest[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    crGet<MonthlyDigest[]>(`/companies/${companyId}/digests`)
      .then((r) => alive && setRows(Array.isArray(r) ? r : []))
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [companyId]);

  return (
    <Card padding={16}>
      <SectionTitle right={<span style={mutedText}>매월 1일 자동</span>}>월간 요약</SectionTitle>
      {error ? (
        <div style={mutedText}>{error}</div>
      ) : rows === null ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <div style={{ ...mutedText, padding: '12px 0' }}>아직 월간 요약이 없습니다. 월간 브리핑을 만들 때 기업별로 함께 저장됩니다.</div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {rows.map((d) => {
            const c = d.content;
            const isOpen = open === d.month;
            return (
              <li key={d.month} style={{ padding: '10px 0', borderBottom: '1px solid var(--border-soft)' }}>
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : d.month)}
                  aria-expanded={isOpen}
                  style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', width: '100%', textAlign: 'left', fontFamily: 'inherit' }}
                >
                  <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                    <span style={{ width: 12, color: 'var(--text-muted)', fontSize: 11 }}>{isOpen ? '▾' : '▸'}</span>
                    <strong style={{ fontSize: 14, color: 'var(--text-primary)' }}>{d.month}</strong>
                    <span style={{ ...mutedText, fontSize: 12 }}>
                      기사 {d.article_count}건 · 긍정 {d.positive_count} · 주의 {d.caution_count}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, color: d.summary ? 'var(--text-secondary)' : 'var(--text-muted)', lineHeight: 1.6, marginTop: 4, paddingLeft: 20 }}>
                    {d.summary || (d.article_count ? '교차 검토를 통과한 요약 문장이 없습니다.' : '이 달은 정리할 기사가 없었습니다.')}
                  </div>
                </button>
                {isOpen && c && (
                  <div style={{ paddingLeft: 20, marginTop: 8, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                    {c.facts?.length > 0 && (
                      <ul style={{ margin: '0 0 6px', paddingLeft: 18, listStyle: 'disc' }}>
                        {c.facts.map((f, i) => (
                          <li key={i}>
                            {f.date ? `${f.date} · ` : ''}
                            {f.text}
                          </li>
                        ))}
                      </ul>
                    )}
                    {c.meaning && <div><span className="wh-badge info" style={{ marginRight: 6 }}>분석</span>{c.meaning.text}</div>}
                    {c.client_explain && <div><b>고객 설명</b> · {c.client_explain.text}</div>}
                    {c.caution && <div style={{ color: 'var(--danger)' }}><b>주의</b> · {c.caution.what.text}</div>}
                    <Link href={`/content/company-report/briefing?month=${d.month}`} style={{ fontSize: 12, color: 'var(--cyan-400)' }}>
                      {d.month} 월간 브리핑 보기 →
                    </Link>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

export default MonthlyDigestsCard;
