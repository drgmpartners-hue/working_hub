'use client';

/** 데일리 브리핑 본문 — ① 기본정보 ② 종합브리핑 ③ 기업별 브리핑 & 링크 (모바일 우선) */
import Link from 'next/link';
import { useState } from 'react';
import { ArticleBody } from './ArticleList';
import { Card } from '@/components/common/Card';
import type { DailyBriefing, MarketRow } from './types';
import { TAG_BADGE } from './types';
import { SectionTitle, mutedText } from './ui';

const n2 = (v: number | null | undefined) =>
  v === null || v === undefined ? '-' : v.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function tone(v: number | null | undefined) {
  if (!v) return 'var(--text-secondary)';
  // 한국 관례: 상승 빨강, 하락 파랑
  return v > 0 ? 'var(--danger)' : 'var(--blue-400)';
}

function ToggleTitle({ id, title, open, onToggle }: { id: string; title: string; open: boolean; onToggle: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onToggle(id)}
      aria-expanded={open}
      title={open ? '본문 접기' : '본문 펼쳐 보기'}
      style={{ background: 'none', border: 'none', padding: 0, textAlign: 'left', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'inherit' }}
    >
      <span style={{ display: 'inline-block', width: 12, color: 'var(--text-muted)', fontSize: 10 }}>{open ? '▾' : '▸'}</span>
      {title}
    </button>
  );
}

function MarketTable({ rows }: { rows: MarketRow[] }) {
  const cell: React.CSSProperties = { padding: '8px 6px', fontSize: 13, textAlign: 'right', fontVariantNumeric: 'tabular-nums', borderBottom: '1px solid var(--border-soft)' };
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 420 }}>
        <thead>
          <tr>
            {['지표', '시가', '종가', '변동', '%'].map((h, i) => (
              <th key={h} style={{ ...cell, textAlign: i ? 'right' : 'left', color: 'var(--text-muted)', fontWeight: 600, fontSize: 12 }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td style={{ ...cell, textAlign: 'left', color: 'var(--text-primary)' }}>
                <span style={{ ...mutedText, fontSize: 11, marginRight: 6 }}>{({ US: '미국', KR: '한국', CMD: '원자재', FX: '환율' } as Record<string, string>)[r.market] || ''}</span>
                {r.name}
                {r.available && r.trade_date && <span style={{ ...mutedText, fontSize: 11, marginLeft: 6 }}>{r.trade_date.slice(5).replace('-', '/')}</span>}
              </td>
              {r.available ? (
                <>
                  <td style={{ ...cell, color: 'var(--text-secondary)' }}>{n2(r.open)}</td>
                  <td style={{ ...cell, color: 'var(--text-primary)', fontWeight: 600 }}>
                    {r.unit === '$' ? '$' : ''}
                    {n2(r.close)}
                    {r.unit && r.unit !== '$' ? r.unit : ''}
                  </td>
                  <td style={{ ...cell, color: tone(r.change) }}>
                    {r.change !== null && r.change !== undefined && r.change > 0 ? '+' : ''}
                    {n2(r.change)}
                  </td>
                  <td style={{ ...cell, color: tone(r.change_pct) }}>
                    {r.change_pct !== null && r.change_pct !== undefined && r.change_pct > 0 ? '+' : ''}
                    {n2(r.change_pct)}%
                  </td>
                </>
              ) : (
                <td colSpan={4} style={{ ...cell, color: 'var(--text-muted)' }}>
                  조회 실패
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DailyBriefingView({ b }: { b: DailyBriefing }) {
  const info = b.basic_info || {};
  const w = info.weather;
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Card padding={16}>
        <SectionTitle>① 기본 정보</SectionTitle>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 14, color: 'var(--text-secondary)', marginBottom: 12 }}>
          <span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>
            {b.briefing_date} ({info.weekday || ''})
          </span>
          <span>
            {w?.region || '서울'} {w?.available ? w.text : '날씨 조회 실패'}
          </span>
          <span>
            기업 {info.company_with_news ?? 0}/{info.company_total ?? 0}곳 · 기사 {b.article_count}건
            {b.caution_count > 0 && <strong style={{ color: 'var(--danger)', marginLeft: 6 }}>주의 {b.caution_count}건</strong>}
          </span>
        </div>
        {info.markets && info.markets.length > 0 && <MarketTable rows={info.markets} />}
      </Card>

      <Card padding={16}>
        <SectionTitle right={b.is_fallback ? <span className="wh-badge warn">단순 브리핑</span> : <span className="wh-badge pos">교차 검토 완료</span>}>
          ② 종합 브리핑
        </SectionTitle>
        <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {b.overall.map((s, i) => (
            <li key={i} style={{ fontSize: 15, lineHeight: 1.65, color: 'var(--text-primary)' }}>
              {s.text}
            </li>
          ))}
        </ul>
        {b.is_fallback && b.review_summary?.fallback_reason && (
          <p style={{ ...mutedText, fontSize: 12, margin: '8px 0 0' }}>AI 브리핑 대신 기사 요약만 담았습니다 ({b.review_summary.fallback_reason}).</p>
        )}
      </Card>

      <div>
        <SectionTitle>③ 기업별 브리핑 & 링크</SectionTitle>
        {b.company_summaries.length === 0 && <div style={{ ...mutedText, padding: '12px 0' }}>새 기사가 있는 기업이 없습니다.</div>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
          {b.company_summaries.map((c) => (
            <Card key={c.company_id} padding={16}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <strong style={{ fontSize: 15, color: 'var(--text-primary)' }}>{c.name}</strong>
                <span style={{ display: 'flex', gap: 6 }}>
                  {c.caution_count > 0 && <span className="wh-badge neg">주의 {c.caution_count}</span>}
                  <span className="wh-badge info">{c.article_count}건</span>
                </span>
              </div>
              {c.one_liner && <p style={{ margin: '8px 0 10px', fontSize: 14, lineHeight: 1.6, color: 'var(--text-secondary)' }}>{c.one_liner}</p>}
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {c.articles
                  .filter((a) => !a.more)
                  .map((a) => {
                    const t = a.tag ? TAG_BADGE[a.tag] : null;
                    return (
                      <li key={a.id} style={{ borderTop: '1px solid var(--border-soft)', paddingTop: 8 }}>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                          {t && <span className={`wh-badge ${t.cls}`}>{t.label}</span>}
                          <ToggleTitle id={a.id} title={a.title} open={openIds.has(a.id)} onToggle={toggle} />
                        </div>
                        {a.summary && <p style={{ margin: '4px 0 0', fontSize: 13, lineHeight: 1.55, color: 'var(--text-secondary)' }}>{a.summary}</p>}
                        <div style={{ ...mutedText, fontSize: 11, marginTop: 2 }}>
                          {a.source_type === 'dart' ? 'DART 공시' : a.press || ''} {a.published_at ? a.published_at.slice(5, 16).replace('T', ' ') : ''}
                        </div>
                        {openIds.has(a.id) && <ArticleBody article={a} />}
                      </li>
                    );
                  })}
              </ul>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
                <span style={{ ...mutedText, fontSize: 12 }}>
                  {c.articles.filter((a) => a.more).length > 0 ? `외 ${c.articles.filter((a) => a.more).length}건` : ''}
                </span>
                <Link href={`/content/company-report/companies/${c.company_id}`} style={{ fontSize: 12, color: 'var(--cyan-400)' }}>
                  기업 상세 보기 →
                </Link>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

export default DailyBriefingView;
