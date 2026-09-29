'use client';

/** 기사 목록(날짜별 묶음) — 태그·공시 배지, 요약, '관련 없음'. 제목을 누르면 아래에 본문이 펼쳐진다. */
import { useEffect, useState } from 'react';
import { crGet } from '@/lib/companyReportApi';
import type { Article } from './types';
import { TAG_BADGE } from './types';
import { fmtDate, mutedText } from './ui';

type ArticleContent = { ok: boolean; url: string; source_url: string; title?: string; paragraphs?: string[]; error?: string };

// 한 번 읽은 본문은 페이지를 옮겨 다녀도 다시 받지 않는다
const contentCache = new Map<string, ArticleContent>();

export function ArticleBody({ article }: { article: Pick<Article, 'id' | 'url'> }) {
  const [c, setC] = useState<ArticleContent | null>(contentCache.get(article.id) || null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (c) return;
    let alive = true;
    crGet<ArticleContent>(`/articles/${article.id}/content`)
      .then((r) => {
        if (r.ok) contentCache.set(article.id, r);
        if (alive) setC(r);
      })
      .catch((e) => alive && setErr((e as Error).message));
    return () => {
      alive = false;
    };
  }, [article.id, c]);

  const link = c?.url || article.url;
  return (
    <div
      style={{
        margin: '10px 0 4px',
        padding: '14px 16px',
        background: 'var(--bg-elevated, rgba(255,255,255,0.03))',
        border: '1px solid var(--border)',
        borderRadius: 10,
      }}
    >
      {!c && !err && <div style={{ ...mutedText, fontSize: 13 }}>본문을 불러오는 중…</div>}
      {(err || (c && !c.ok)) && (
        <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          {err || c?.error || '본문을 가져오지 못했습니다.'} 원문 사이트에서 확인해 주세요.
        </div>
      )}
      {c?.ok && (
        <div style={{ maxHeight: 520, overflowY: 'auto', paddingRight: 6 }}>
          {(c.paragraphs || []).map((p, i) => (
            <p key={i} style={{ margin: '0 0 10px', fontSize: 14, lineHeight: 1.8, color: 'var(--text-primary)', wordBreak: 'keep-all' }}>
              {p}
            </p>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, gap: 8 }}>
        <span style={{ ...mutedText, fontSize: 12 }}>{c?.ok ? '광고·메뉴를 뺀 본문만 보여줍니다. 표·사진은 원문에서 확인하세요.' : ''}</span>
        <a href={link} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: 'var(--cyan-400)', whiteSpace: 'nowrap' }}>
          원문 새 창에서 보기 ↗
        </a>
      </div>
    </div>
  );
}

export function ArticleList({
  articles,
  onToggleHidden,
  groupByDate = true,
}: {
  articles: Article[];
  onToggleHidden?: (a: Article) => void;
  groupByDate?: boolean;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const groups = new Map<string, Article[]>();
  for (const a of articles) {
    const d = groupByDate ? (a.published_at ? fmtDate(a.published_at) : '날짜 미상') : '';
    groups.set(d, [...(groups.get(d) || []), a]);
  }
  if (!articles.length) return <div style={{ ...mutedText, padding: '20px 0', textAlign: 'center' }}>기사가 없습니다.</div>;
  return (
    <div>
      {Array.from(groups.entries()).map(([d, list]) => (
        <div key={d || 'all'} style={{ marginBottom: 14 }}>
          {groupByDate && (
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
              {d} <span style={{ ...mutedText, fontWeight: 400 }}>{list.length}건</span>
            </div>
          )}
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {list.map((a) => {
              const t = a.tag ? TAG_BADGE[a.tag] : null;
              return (
                <li key={a.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--border-soft)', opacity: a.is_hidden ? 0.5 : 1 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                    {t && <span className={`wh-badge ${t.cls}`}>{t.label}</span>}
                    {a.source_type === 'dart' && <span className="wh-badge warn">공시</span>}
                    {a.issue_type && <span style={{ ...mutedText, fontSize: 12 }}>{a.issue_type}</span>}
                    <button
                      type="button"
                      onClick={() => toggle(a.id)}
                      aria-expanded={open.has(a.id)}
                      title={open.has(a.id) ? '본문 접기' : '본문 펼쳐 보기'}
                      style={{
                        background: 'none',
                        border: 'none',
                        padding: 0,
                        textAlign: 'left',
                        cursor: 'pointer',
                        color: 'var(--text-primary)',
                        fontSize: 14,
                        fontWeight: 600,
                        flex: 1,
                        minWidth: 200,
                        fontFamily: 'inherit',
                      }}
                    >
                      <span style={{ display: 'inline-block', width: 14, color: 'var(--text-muted)', fontSize: 11 }}>{open.has(a.id) ? '▾' : '▸'}</span>
                      {a.title}
                    </button>
                    <span style={{ ...mutedText, fontSize: 12 }}>
                      {a.press || a.source} {a.published_at ? a.published_at.slice(11, 16) : ''}
                    </span>
                    {onToggleHidden && (
                      <button
                        type="button"
                        onClick={() => onToggleHidden(a)}
                        style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer', textDecoration: 'underline' }}
                      >
                        {a.is_hidden ? '다시 보이기' : '관련 없음'}
                      </button>
                    )}
                  </div>
                  {a.summary && <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{a.summary}</p>}
                  {open.has(a.id) && <ArticleBody article={a} />}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

export default ArticleList;
