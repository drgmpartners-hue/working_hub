'use client';

/** 통합 검색 결과 — 종류별 탭·필터·강조·정렬 (기획 7-4, P2-10) */
import Link from 'next/link';
import { Fragment, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Card } from '@/components/common/Card';
import type { Company } from '@/components/company-report/types';
import { ErrorBox, SectionTitle, Spinner, inputStyle, mutedText } from '@/components/company-report/ui';
import { crGet, crPost } from '@/lib/companyReportApi';
import { useCrMe } from '@/lib/useCrMe';

interface Item {
  type: string;
  group: string;
  id: string;
  company_id: string | null;
  company_name: string | null;
  title: string;
  snippet: string;
  date: string | null;
  tags: string[];
  url: string | null;
}
interface Result {
  q: string;
  terms: string[];
  total: number;
  counts: Record<string, number>;
  items: Item[];
  page: number;
  size: number;
}

const GROUPS = [
  { key: 'all', label: '전체' },
  { key: 'company', label: '기업' },
  { key: 'article', label: '기사' },
  { key: 'ledger', label: '원장' },
  { key: 'briefing', label: '브리핑' },
  { key: 'report', label: '보고서' },
  { key: 'file', label: '자료' },
];
const TYPE_LABEL: Record<string, string> = {
  company: '기업', article: '기사', fact: '사실', funding: '투자유치', daily: '데일리', monthly: '월간', digest: '월간 요약',
  report_section: '보고서', file: '자료',
};
const TAG_LABEL: Record<string, string> = { caution: '주의', positive: '호재', neutral: '중립' };

function Highlight({ text, terms }: { text: string; terms: string[] }) {
  if (!terms.length || !text) return <>{text}</>;
  const esc = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const parts = text.split(new RegExp(`(${esc})`, 'gi'));
  return (
    <>
      {parts.map((p, i) =>
        terms.some((t) => t.toLowerCase() === p.toLowerCase()) ? (
          <mark key={i} style={{ background: 'rgba(245,158,11,.3)', color: 'inherit', borderRadius: 3, padding: '0 1px' }}>
            {p}
          </mark>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  );
}

function SearchInner() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const me = useCrMe();
  const q = params.get('q') || '';
  const group = params.get('group') || 'all';
  const companies = params.getAll('company');
  const from = params.get('from') || '';
  const to = params.get('to') || '';
  const tag = params.get('tag') || '';
  const sort = params.get('sort') || 'relevance';
  const activeOnly = params.get('active') === '1';
  const page = Number(params.get('page') || 1);

  const [res, setRes] = useState<Result | null>(null);
  const [allCompanies, setAllCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const setParam = (changes: Record<string, string | string[] | null>) => {
    const p = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(changes)) {
      p.delete(k);
      if (Array.isArray(v)) v.forEach((x) => p.append(k, x));
      else if (v) p.set(k, v);
    }
    if (!('page' in changes)) p.delete('page');
    router.push(`${pathname}?${p}`);
  };

  const load = useCallback(async () => {
    if (!q) return;
    setLoading(true);
    setError(null);
    try {
      const p = new URLSearchParams({ q, sort, page: String(page), size: '20' });
      if (group !== 'all') p.set('group', group);
      companies.forEach((c) => p.append('company', c));
      if (from) p.set('date_from', from);
      if (to) p.set('date_to', to);
      if (tag) p.set('tag', tag);
      if (activeOnly) p.set('include_inactive', 'false');
      setRes(await crGet<Result>(`/search?${p}`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.toString()]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    crGet<Company[]>('/companies').then(setAllCompanies).catch(() => undefined);
  }, []);

  const pages = res ? Math.max(1, Math.ceil(res.total / res.size)) : 1;
  const companyName = useMemo(() => new Map(allCompanies.map((c) => [c.id, c.name])), [allCompanies]);

  const reindex = async () => {
    try {
      const r = await crPost<Record<string, number>>('/search/reindex');
      setNotice(`색인을 다시 만들었습니다: ${Object.entries(r).map(([k, v]) => `${TYPE_LABEL[k] || k} ${v}`).join(', ')}`);
      void load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (!q) {
    return (
      <Card padding={24}>
        <div style={{ ...mutedText, textAlign: 'center' }}>위 검색창에 기업명이나 키워드를 입력하세요. 여러 단어는 모두 포함된 결과를, &quot;따옴표&quot;는 정확히 일치하는 구절을 찾습니다.</div>
      </Card>
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 260px) 1fr', gap: 16, alignItems: 'start' }} className="cr-search">
      <style>{`@media (max-width: 860px){ .cr-search{ grid-template-columns: 1fr !important; } }`}</style>
      <Card padding={14}>
        <SectionTitle>필터</SectionTitle>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13 }}>
          <div>
            <div style={{ ...mutedText, fontSize: 12, marginBottom: 4 }}>기업</div>
            <select
              multiple
              value={companies}
              onChange={(e) => setParam({ company: Array.from(e.target.selectedOptions).map((o) => o.value) })}
              style={{ ...inputStyle, height: 120 }}
              aria-label="기업 필터(여러 개 선택)"
            >
              {allCompanies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.is_active ? '' : ' (비활성)'}
                </option>
              ))}
            </select>
            {companies.length > 0 && (
              <button type="button" onClick={() => setParam({ company: null })} style={{ background: 'none', border: 'none', color: 'var(--cyan-400)', fontSize: 12, cursor: 'pointer', padding: 0, marginTop: 4 }}>
                기업 필터 지우기
              </button>
            )}
          </div>
          <div>
            <div style={{ ...mutedText, fontSize: 12, marginBottom: 4 }}>기간</div>
            <input type="date" value={from} onChange={(e) => setParam({ from: e.target.value })} style={{ ...inputStyle, marginBottom: 4 }} aria-label="시작일" />
            <input type="date" value={to} onChange={(e) => setParam({ to: e.target.value })} style={inputStyle} aria-label="종료일" />
          </div>
          <div>
            <div style={{ ...mutedText, fontSize: 12, marginBottom: 4 }}>기사 태그</div>
            <select value={tag} onChange={(e) => setParam({ tag: e.target.value })} style={inputStyle}>
              <option value="">전체</option>
              <option value="caution">주의</option>
              <option value="positive">호재</option>
              <option value="neutral">중립</option>
            </select>
          </div>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <input type="checkbox" checked={activeOnly} onChange={(e) => setParam({ active: e.target.checked ? '1' : null })} />
            활성 기업만
          </label>
          {me?.is_admin && (
            <button type="button" className="wh-btn wh-btn-ghost wh-btn-sm" onClick={() => void reindex()}>
              색인 다시 만들기
            </button>
          )}
        </div>
      </Card>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {GROUPS.map((g) => (
              <button
                key={g.key}
                type="button"
                className={`wh-btn wh-btn-sm ${group === g.key ? 'wh-btn-primary' : 'wh-btn-ghost'}`}
                onClick={() => setParam({ group: g.key === 'all' ? null : g.key })}
              >
                {g.label} {res?.counts?.[g.key] ?? 0}
              </button>
            ))}
          </div>
          <select value={sort} onChange={(e) => setParam({ sort: e.target.value === 'relevance' ? null : e.target.value })} style={{ ...inputStyle, width: 'auto' }} aria-label="정렬">
            <option value="relevance">관련도순</option>
            <option value="recent">최신순</option>
          </select>
        </div>
        <div style={mutedText}>
          &quot;{q}&quot; 검색 결과 {res?.total ?? 0}건
          {companies.length > 0 && ` · ${companies.map((c) => companyName.get(c) || '기업').join(', ')}`}
        </div>
        <ErrorBox message={error} />
        {notice && <div style={{ ...mutedText, color: 'var(--success)' }}>{notice}</div>}
        {loading ? (
          <Spinner />
        ) : !res || res.items.length === 0 ? (
          <Card padding={24}>
            <div style={{ ...mutedText, textAlign: 'center' }}>결과가 없습니다. 단어를 줄이거나 필터를 풀어 보세요.</div>
          </Card>
        ) : (
          res.items.map((it) => (
            <Card key={`${it.type}-${it.id}`} padding={14}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
                <span className="wh-badge info">{TYPE_LABEL[it.type] || it.type}</span>
                {it.company_name && it.type !== 'company' && <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{it.company_name}</span>}
                {it.tags
                  .filter((t) => TAG_LABEL[t])
                  .map((t) => (
                    <span key={t} className={`wh-badge ${t === 'caution' ? 'neg' : t === 'positive' ? 'pos' : 'info'}`}>
                      {TAG_LABEL[t]}
                    </span>
                  ))}
                {it.tags.includes('inactive') && <span className="wh-badge neg">비활성</span>}
                <span style={{ ...mutedText, fontSize: 12, marginLeft: 'auto' }}>{it.date || ''}</span>
              </div>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>
                {it.url ? (
                  <Link href={it.url} style={{ color: 'inherit' }}>
                    <Highlight text={it.title} terms={res.terms} />
                  </Link>
                ) : (
                  <Highlight text={it.title} terms={res.terms} />
                )}
              </div>
              {it.snippet && (
                <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                  <Highlight text={it.snippet} terms={res.terms} />
                </p>
              )}
            </Card>
          ))
        )}
        {pages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, alignItems: 'center' }}>
            <button type="button" className="wh-btn wh-btn-ghost wh-btn-sm" disabled={page <= 1} onClick={() => setParam({ page: String(page - 1) })}>
              이전
            </button>
            <span style={mutedText}>
              {page} / {pages}
            </span>
            <button type="button" className="wh-btn wh-btn-ghost wh-btn-sm" disabled={page >= pages} onClick={() => setParam({ page: String(page + 1) })}>
              다음
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <SearchInner />
    </Suspense>
  );
}
