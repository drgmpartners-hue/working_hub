'use client';

/**
 * 기존 기사 한 번에 정리 — 모든 기업의 보이는 기사를 지금 규칙으로 다시 본다.
 * (제목·첫머리에 기업명 없는 '단순 언급', 제외어) 미리 보기 → 숨기기. 지우지 않는다.
 */
import { useState } from 'react';
import { crPost } from '@/lib/companyReportApi';
import { fmtDate } from '@/components/company-report/ui';

type Result = {
  matched: number;
  hidden: number;
  reasons: Record<string, number>;
  companies: { company_id: string; name: string; matched: number }[];
  samples: { title: string; reason: string; url?: string; published_at: string | null; company?: string }[];
};

const box: React.CSSProperties = {
  padding: 14,
  borderRadius: 12,
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};

export function CleanupBox({ onDone }: { onDone?: () => void }) {
  const [res, setRes] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);

  const run = async (apply: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const r = await crPost<Result>('/article-reports/cleanup', { apply });
      if (apply) {
        setDone(r.hidden);
        setRes(null);
        onDone?.();
      } else {
        setRes(r);
        setDone(null);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section style={box} aria-label="기존 기사 정리">
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 320px', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          <b style={{ color: 'var(--text-primary)' }}>기존 기사 정리</b> — 이제 새 기사는 제목이나 첫 문장에 기업명이 없으면(단순 언급) 모으지 않습니다.
          이미 모인 기사도 같은 기준으로 한 번에 정리할 수 있습니다. 숨기기만 하고 지우지 않습니다.
        </div>
        <button type="button" className="wh-btn wh-btn-ghost wh-btn-sm" disabled={busy} onClick={() => void run(false)}>
          {busy && !res ? '찾는 중…' : '걸리는 기사 미리 보기'}
        </button>
      </div>

      {error && <div style={{ fontSize: 13, color: 'var(--danger)' }}>{error}</div>}
      {done !== null && (
        <div style={{ fontSize: 13, color: 'var(--success)' }}>✓ {done}건을 숨겼습니다. 다음 브리핑부터 나오지 않습니다.</div>
      )}

      {res && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {res.matched === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>정리할 기사가 없습니다.</div>
          ) : (
            <>
              <div style={{ fontSize: 13, color: 'var(--text-primary)' }}>
                모두 <b>{res.matched}건</b>
                {Object.entries(res.reasons).map(([k, n]) => ` · ${k} ${n}건`).join('')}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                기업별: {res.companies.slice(0, 12).map((c) => `${c.name} ${c.matched}`).join(', ')}
                {res.companies.length > 12 ? ` 외 ${res.companies.length - 12}곳` : ''}
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.7, color: 'var(--text-secondary)', maxHeight: 260, overflowY: 'auto' }}>
                {res.samples.map((s, i) => (
                  <li key={i}>
                    <span style={{ color: 'var(--text-muted)' }}>[{s.company}] {s.published_at ? fmtDate(s.published_at) : ''} </span>
                    {s.url ? (
                      <a href={s.url} target="_blank" rel="noreferrer" style={{ color: 'var(--text-primary)' }}>
                        {s.title}
                      </a>
                    ) : (
                      s.title
                    )}
                    <span style={{ color: 'var(--text-muted)' }}> — {s.reason}</span>
                  </li>
                ))}
              </ul>
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="button" className="wh-btn wh-btn-sm" disabled={busy} onClick={() => void run(true)}
                  style={{ background: 'var(--danger)', color: '#fff', border: 'none' }}>
                  {busy ? '숨기는 중…' : `${res.matched}건 숨기기`}
                </button>
                <button type="button" className="wh-btn wh-btn-ghost wh-btn-sm" disabled={busy} onClick={() => setRes(null)}>
                  닫기
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
