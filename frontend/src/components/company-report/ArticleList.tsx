'use client';

/** 기사 목록(날짜별 묶음) — 태그·공시 배지, 요약, '관련 없음' */
import type { Article } from './types';
import { TAG_BADGE } from './types';
import { fmtDate, mutedText } from './ui';

export function ArticleList({
  articles,
  onToggleHidden,
  groupByDate = true,
}: {
  articles: Article[];
  onToggleHidden?: (a: Article) => void;
  groupByDate?: boolean;
}) {
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
                    <a
                      href={a.url}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: 'var(--text-primary)', fontSize: 14, fontWeight: 600, flex: 1, minWidth: 200 }}
                    >
                      {a.title}
                    </a>
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
