'use client';

/** 기사 아카이브 탭 — 달력(기사 있는 날 점, 주의 날 빨강) · 날짜/기간 기사 · 기간 요약 (P2-1·2) */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/common/Card';
import { crGet, crPatch, crPost } from '@/lib/companyReportApi';
import { ArticleList } from './ArticleList';
import type { Article } from './types';
import { ErrorBox, SectionTitle, Spinner, inputStyle, mutedText } from './ui';

interface DayStat {
  date: string;
  count: number;
  caution: number;
}

interface PeriodSummary {
  cached: boolean;
  stats: { articles: number; caution: number; positive: number };
  content: {
    overview?: string;
    key_events?: { date: string; text: string; source_ids: string[] }[];
    cautions?: { text: string; source_ids: string[] }[];
    stats_comment?: string;
  };
  sources?: { id: string; title: string; url: string; date: string | null }[];
}

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const TAGS = [
  { key: '', label: '전체' },
  { key: 'caution', label: '주의' },
  { key: 'positive', label: '호재' },
  { key: 'neutral', label: '중립' },
];

export function ArchiveTab({ companyId, initialDate }: { companyId: string; initialDate?: string | null }) {
  const today = new Date();
  const init = initialDate ? new Date(initialDate) : today;
  const [month, setMonth] = useState(`${init.getFullYear()}-${pad(init.getMonth() + 1)}`);
  const [days, setDays] = useState<DayStat[]>([]);
  const [mode, setMode] = useState<'date' | 'range'>(initialDate ? 'date' : 'range');
  const [selDate, setSelDate] = useState<string>(initialDate || ymd(today));
  const [from, setFrom] = useState(ymd(new Date(today.getTime() - 29 * 86400000)));
  const [to, setTo] = useState(ymd(today));
  const [tag, setTag] = useState('');
  const [showHidden, setShowHidden] = useState(false);
  const [articles, setArticles] = useState<Article[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<PeriodSummary | null>(null);
  const [sumLoading, setSumLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const SIZE = 50;

  useEffect(() => {
    crGet<DayStat[]>(`/companies/${companyId}/article-dates?month=${month}`)
      .then(setDays)
      .catch((e) => setError((e as Error).message));
  }, [companyId, month]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ page: String(page), size: String(SIZE) });
      if (mode === 'date') qs.set('date', selDate);
      else {
        qs.set('date_from', from);
        qs.set('date_to', to);
      }
      if (tag) qs.set('tag', tag);
      if (showHidden) qs.set('include_hidden', 'true');
      const r = await crGet<{ total: number; items: Article[] }>(`/companies/${companyId}/articles?${qs}`);
      setArticles(r.items);
      setTotal(r.total);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [companyId, mode, selDate, from, to, tag, showHidden, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const cells = useMemo(() => {
    const [y, m] = month.split('-').map(Number);
    const first = new Date(y, m - 1, 1);
    const last = new Date(y, m, 0).getDate();
    const out: (string | null)[] = Array(first.getDay()).fill(null);
    for (let d = 1; d <= last; d++) out.push(`${month}-${pad(d)}`);
    while (out.length % 7) out.push(null);
    return out;
  }, [month]);
  const stat = useMemo(() => new Map(days.map((d) => [d.date, d])), [days]);
  const monthTotal = days.reduce((a, d) => a + d.count, 0);

  const moveMonth = (delta: number) => {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setMonth(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`);
  };

  const pickDate = (d: string) => {
    setMode('date');
    setSelDate(d);
    setPage(1);
    setSummary(null);
  };

  const summarize = async (refresh = false) => {
    setSumLoading(true);
    setError(null);
    const range = mode === 'date' ? { date_from: selDate, date_to: selDate } : { date_from: from, date_to: to };
    try {
      setSummary(await crPost<PeriodSummary>(`/companies/${companyId}/period-summary`, { ...range, refresh }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSumLoading(false);
    }
  };

  const toggleHidden = async (a: Article) => {
    try {
      const u = await crPatch<Article>(`/articles/${a.id}`, { is_hidden: !a.is_hidden });
      setArticles((xs) => (showHidden ? xs.map((x) => (x.id === a.id ? u : x)) : xs.filter((x) => x.id !== a.id)));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const src = (id: string) => summary?.sources?.find((s) => s.id === id);
  const pages = Math.max(1, Math.ceil(total / SIZE));

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 340px) 1fr', gap: 16, alignItems: 'start' }} className="cr-archive">
      <style>{`@media (max-width: 860px){ .cr-archive{ grid-template-columns: 1fr !important; } }`}</style>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Card padding={14}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <button type="button" className="wh-btn wh-btn-ghost wh-btn-sm" onClick={() => moveMonth(-1)} aria-label="이전 달">
              ‹
            </button>
            <strong style={{ color: 'var(--text-primary)', fontSize: 15 }}>
              {month.replace('-', '년 ')}월 <span style={{ ...mutedText, fontWeight: 400 }}>{monthTotal}건</span>
            </strong>
            <button type="button" className="wh-btn wh-btn-ghost wh-btn-sm" onClick={() => moveMonth(1)} aria-label="다음 달">
              ›
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, textAlign: 'center' }}>
            {'일월화수목금토'.split('').map((w, i) => (
              <div key={w} style={{ fontSize: 11, color: i === 0 ? 'var(--danger)' : 'var(--text-muted)', padding: '2px 0' }}>
                {w}
              </div>
            ))}
            {cells.map((d, i) => {
              if (!d) return <div key={`e${i}`} />;
              const s = stat.get(d);
              const sel = mode === 'date' && d === selDate;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => pickDate(d)}
                  aria-label={`${d} 기사 ${s?.count || 0}건`}
                  style={{
                    padding: '6px 0 4px',
                    borderRadius: 8,
                    border: sel ? '1px solid var(--blue-400)' : '1px solid transparent',
                    background: sel ? 'rgba(59,130,246,.15)' : 'transparent',
                    color: s ? 'var(--text-primary)' : 'var(--text-muted)',
                    cursor: 'pointer',
                    fontSize: 13,
                  }}
                >
                  {Number(d.slice(8))}
                  <div style={{ height: 6, display: 'flex', justifyContent: 'center', marginTop: 2 }}>
                    {s && (
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: '50%',
                          background: s.caution ? 'var(--danger)' : 'var(--cyan-400)',
                        }}
                      />
                    )}
                  </div>
                </button>
              );
            })}
          </div>
          <div style={{ ...mutedText, fontSize: 11, marginTop: 8, display: 'flex', gap: 12 }}>
            <span>
              <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: 'var(--cyan-400)', marginRight: 4 }} />
              기사 있음
            </span>
            <span>
              <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: 'var(--danger)', marginRight: 4 }} />
              주의 기사
            </span>
          </div>
        </Card>

        <Card padding={14}>
          <SectionTitle>기간 선택</SectionTitle>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ ...inputStyle, width: 140 }} aria-label="시작일" />
            ~
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ ...inputStyle, width: 140 }} aria-label="종료일" />
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className={`wh-btn wh-btn-sm ${mode === 'range' ? 'wh-btn-primary' : 'wh-btn-ghost'}`}
              onClick={() => {
                setMode('range');
                setPage(1);
                setSummary(null);
              }}
            >
              이 기간 보기
            </button>
            <button type="button" className="wh-btn wh-btn-ghost wh-btn-sm" disabled={sumLoading} onClick={() => void summarize()}>
              {sumLoading ? '요약 중…' : '기간 요약'}
            </button>
          </div>
        </Card>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
        <ErrorBox message={error} />
        {summary && (
          <Card padding={16}>
            <SectionTitle
              right={
                <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={mutedText}>
                    기사 {summary.stats.articles} · 주의 {summary.stats.caution}
                    {summary.cached ? ' · 저장된 요약' : ''}
                  </span>
                  <button type="button" className="wh-btn wh-btn-ghost wh-btn-sm" disabled={sumLoading} onClick={() => void summarize(true)}>
                    다시 요약
                  </button>
                </span>
              }
            >
              기간 요약
            </SectionTitle>
            <p style={{ margin: '0 0 10px', fontSize: 14, lineHeight: 1.7, color: 'var(--text-primary)' }}>{summary.content.overview}</p>
            {!!summary.content.key_events?.length && (
              <>
                <div style={{ ...mutedText, fontSize: 12, marginBottom: 4 }}>주요 사건</div>
                <ul style={{ margin: '0 0 10px', paddingLeft: 18, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                  {summary.content.key_events.map((e, i) => (
                    <li key={i}>
                      <span style={mutedText}>{e.date}</span> {e.text}{' '}
                      {e.source_ids.map((sid) => {
                        const s = src(sid);
                        return s ? (
                          <a key={sid} href={s.url} target="_blank" rel="noreferrer" title={s.title} style={{ color: 'var(--cyan-400)', fontSize: 11, marginLeft: 2 }}>
                            [{sid}]
                          </a>
                        ) : null;
                      })}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {!!summary.content.cautions?.length && (
              <>
                <div style={{ fontSize: 12, marginBottom: 4, color: 'var(--danger)' }}>주의할 점</div>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                  {summary.content.cautions.map((e, i) => (
                    <li key={i}>{e.text}</li>
                  ))}
                </ul>
              </>
            )}
          </Card>
        )}

        <Card padding={16}>
          <SectionTitle right={<span style={mutedText}>{total}건</span>}>
            {mode === 'date' ? `${selDate} 기사` : `${from} ~ ${to} 기사`}
          </SectionTitle>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
            {TAGS.map((f) => (
              <button
                key={f.key}
                type="button"
                className={`wh-btn wh-btn-sm ${tag === f.key ? 'wh-btn-primary' : 'wh-btn-ghost'}`}
                aria-pressed={tag === f.key}
                onClick={() => {
                  setTag(f.key);
                  setPage(1);
                }}
              >
                {f.label}
              </button>
            ))}
            <label style={{ ...mutedText, display: 'flex', gap: 6, alignItems: 'center', marginLeft: 6, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={showHidden}
                onChange={(e) => {
                  setShowHidden(e.target.checked);
                  setPage(1);
                }}
              />
              숨긴 기사 보기
            </label>
          </div>
          {loading ? <Spinner /> : <ArticleList articles={articles} onToggleHidden={toggleHidden} groupByDate={mode === 'range'} />}
          {pages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: 8, alignItems: 'center', marginTop: 8 }}>
              <button type="button" className="wh-btn wh-btn-ghost wh-btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                이전
              </button>
              <span style={mutedText}>
                {page} / {pages}
              </span>
              <button type="button" className="wh-btn wh-btn-ghost wh-btn-sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                다음
              </button>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

export default ArchiveTab;
