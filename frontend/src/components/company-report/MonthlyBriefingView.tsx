'use client';

/** 월간 브리핑 본문 — ① 이달의 요약 ② 포트폴리오 동향(차트) ③ 기업별 월간 정리 ④ 주의 기업 ⑤ 다음 달 체크포인트 */
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card } from '@/components/common/Card';
import type { MSentence, MSource, MStatRow, MonthlyBriefing } from './types';
import { SectionTitle, mutedText } from './ui';

// 긍정·중립·주의(양극 + 중립 회색). 다크 카드(#16203A) 기준 대비·색각 이상 구분 확인함
const TONE = { positive: '#16A34A', neutral: '#64748B', caution: '#EF4444' };
const TONE_LABEL = { positive: '긍정', neutral: '중립', caution: '주의' };

type Numbering = Map<string, number>;

function numbering(mb: MonthlyBriefing): Numbering {
  const m: Numbering = new Map();
  const add = (ids?: string[]) => (ids || []).forEach((id) => !m.has(id) && m.set(id, m.size + 1));
  const c = mb.content;
  (c.summary || []).forEach((s) => add(s.source_ids));
  (c.highlights || []).forEach((s) => add(s.source_ids));
  for (const sec of c.companies || []) {
    sec.summary.forEach((s) => add(s.source_ids));
    sec.facts.forEach((s) => add(s.source_ids));
    add(sec.meaning?.source_ids);
    add(sec.client_explain?.source_ids);
    sec.qa.forEach((s) => add(s.source_ids));
    add(sec.caution?.what.source_ids);
    add(sec.caution?.impact?.source_ids);
    add(sec.caution?.check?.source_ids);
    sec.checkpoints.forEach((s) => add(s.source_ids));
  }
  return m;
}

function Refs({ ids, nums, sources }: { ids?: string[]; nums: Numbering; sources: Record<string, MSource> }) {
  if (!ids?.length) return null;
  return (
    <>
      {ids.map((id) => {
        const s = sources[id];
        const n = nums.get(id);
        if (!s || !n) return null;
        const label = `${s.type === 'article' ? '' : '원장 · '}${s.title}${s.date ? ` (${s.date})` : ''}${s.press ? ` · ${s.press}` : ''}`;
        const style = { fontSize: 11, color: 'var(--cyan-400)', marginLeft: 3, verticalAlign: 'super', textDecoration: 'none' } as const;
        return s.type === 'article' && s.url ? (
          <a key={id} href={s.url} target="_blank" rel="noreferrer" title={label} style={style}>
            [{n}]
          </a>
        ) : (
          <Link key={id} href={`/content/company-report/companies/${s.company_id}?tab=ledger`} title={label} style={style}>
            [{n}]
          </Link>
        );
      })}
    </>
  );
}

function Line({ s, nums, sources, style }: { s: MSentence; nums: Numbering; sources: Record<string, MSource>; style?: React.CSSProperties }) {
  return (
    <span style={style}>
      {s.text}
      <Refs ids={s.source_ids} nums={nums} sources={sources} />
    </span>
  );
}

function TrendChart({ rows }: { rows: MStatRow[] }) {
  const data = rows.filter((r) => r.total > 0 || r.prev_total > 0).slice(0, 15);
  if (!data.length) return <div style={{ ...mutedText, padding: '12px 0' }}>이번 달 기사가 없습니다.</div>;
  const h = Math.max(160, data.length * 30 + 60);
  return (
    <div style={{ width: '100%', height: h }} role="img" aria-label="기업별 기사 수(긍정·중립·주의)">
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }} barCategoryGap={8}>
          <CartesianGrid horizontal={false} stroke="#243049" />
          <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#AAB6C8' }} />
          <YAxis type="category" dataKey="name" width={96} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: '#DCE3EE' }} />
          <Tooltip
            cursor={{ fill: 'rgba(255,255,255,0.04)' }}
            contentStyle={{ background: '#0F172A', border: '1px solid #243049', borderRadius: 8, fontSize: 12 }}
            labelStyle={{ color: '#F1F5F9', fontWeight: 700 }}
            itemStyle={{ color: '#DCE3EE' }}
            formatter={(v, n) => [`${v}건`, n]}
            labelFormatter={(label, payload) => {
              const r = payload?.[0]?.payload as MStatRow | undefined;
              return r ? `${label} · 전월 ${r.prev_total}건 (${r.change >= 0 ? '+' : ''}${r.change})` : String(label);
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12, color: '#AAB6C8' }} itemSorter={null} />
          {(['positive', 'neutral', 'caution'] as const).map((k, i, arr) => (
            <Bar
              key={k}
              dataKey={k}
              name={TONE_LABEL[k]}
              stackId="t"
              fill={TONE[k]}
              stroke="#16203A"
              strokeWidth={2}
              radius={i === arr.length - 1 ? [0, 4, 4, 0] : 0}
              maxBarSize={18}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function TrendTable({ rows }: { rows: MStatRow[] }) {
  const cell: React.CSSProperties = { padding: '6px 6px', fontSize: 12, textAlign: 'right', borderBottom: '1px solid var(--border-soft)', fontVariantNumeric: 'tabular-nums' };
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 420 }}>
        <thead>
          <tr style={{ color: 'var(--text-muted)' }}>
            <th style={{ ...cell, textAlign: 'left' }}>기업</th>
            <th style={cell}>이번 달</th>
            <th style={cell}>긍정</th>
            <th style={cell}>주의</th>
            <th style={cell}>전월</th>
            <th style={cell}>변화</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.company_id} style={{ color: 'var(--text-secondary)' }}>
              <td style={{ ...cell, textAlign: 'left', color: 'var(--text-primary)' }}>{r.name}</td>
              <td style={cell}>{r.total}</td>
              <td style={cell}>{r.positive}</td>
              <td style={{ ...cell, color: r.caution ? 'var(--danger)' : undefined }}>{r.caution}</td>
              <td style={cell}>{r.prev_total}</td>
              <td style={cell}>{r.change > 0 ? `+${r.change}` : r.change}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MonthlyBriefingView({ mb }: { mb: MonthlyBriefing }) {
  const nums = useMemo(() => numbering(mb), [mb]);
  const [showTable, setShowTable] = useState(false);
  const c = mb.content || {};
  const st = mb.stats || {};
  const src = c.sources || {};
  const label = `${Number(mb.month.slice(5, 7))}월`;
  const diff = (st.article_count || 0) - (st.prev_article_count || 0);
  const box: React.CSSProperties = { padding: '10px 12px', borderRadius: 8, background: 'var(--bg-card-2)', fontSize: 14, lineHeight: 1.7 };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Card padding={16}>
        <SectionTitle right={<span style={mutedText}>{mb.month}</span>}>① {label} 요약</SectionTitle>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <span className="wh-badge info">기사 {st.article_count ?? 0}건 (전월 대비 {diff >= 0 ? '+' : ''}{diff})</span>
          <span className="wh-badge pos">긍정 {st.positive_count ?? 0}</span>
          <span className="wh-badge neg">주의 {st.caution_count ?? 0}</span>
          <span className="wh-badge info">기사 있는 기업 {st.company_with_news ?? 0}/{st.company_total ?? 0}</span>
        </div>
        {(c.summary || []).length ? (
          <ul style={{ margin: 0, paddingLeft: 18, listStyle: 'disc', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {(c.summary || []).map((s, i) => (
              <li key={i} style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--text-primary)' }}>
                <Line s={s} nums={nums} sources={src} />
              </li>
            ))}
          </ul>
        ) : (
          <div style={mutedText}>요약 문장이 없습니다.</div>
        )}
        {(c.highlights || []).length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>주목할 기업</div>
            {(c.highlights || []).map((h, i) => (
              <div key={i} style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                <strong style={{ color: 'var(--text-primary)' }}>{h.name}</strong> · <Line s={h} nums={nums} sources={src} />
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card padding={16}>
        <SectionTitle
          right={
            <button type="button" className="wh-btn wh-btn-ghost wh-btn-sm" onClick={() => setShowTable((v) => !v)}>
              {showTable ? '차트로 보기' : '표로 보기'}
            </button>
          }
        >
          ② 포트폴리오 동향
        </SectionTitle>
        {showTable ? <TrendTable rows={st.companies || []} /> : <TrendChart rows={st.companies || []} />}
        {(st.coverage_alerts || []).length > 0 && (
          <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
            <span className="wh-badge warn" style={{ marginRight: 6 }}>수집 점검</span>
            {(st.coverage_alerts || []).map((a) => `${a.name}(이번 달 ${a.total}건, 직전 3개월 평균 ${a.avg3}건)`).join(', ')} — 기사가 크게 줄었습니다. 검색어·수집 상태를 확인하세요.
          </div>
        )}
      </Card>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <SectionTitle>③ 기업별 월간 정리</SectionTitle>
        {(c.companies || []).length === 0 && (
          <Card padding={16}>
            <div style={mutedText}>정리할 기업이 없습니다.</div>
          </Card>
        )}
        {(c.companies || []).map((sec) => (
          <Card key={sec.company_id} padding={16}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <strong style={{ fontSize: 15, color: 'var(--text-primary)' }}>{sec.name}</strong>
              <span style={{ display: 'flex', gap: 6 }}>
                {sec.caution && <span className="wh-badge neg">주의</span>}
                <span className="wh-badge info">{sec.article_count}건</span>
              </span>
            </div>
            {sec.summary.map((s, i) => (
              <p key={i} style={{ margin: '0 0 6px', fontSize: 14, lineHeight: 1.7, color: 'var(--text-primary)' }}>
                <Line s={s} nums={nums} sources={src} />
              </p>
            ))}
            {sec.facts.length > 0 && (
              <ul style={{ margin: '6px 0', paddingLeft: 18, listStyle: 'disc' }}>
                {sec.facts.map((f, i) => (
                  <li key={i} style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--text-secondary)' }}>
                    {f.date && <span style={{ ...mutedText, fontSize: 12, marginRight: 6 }}>{f.date.slice(5).replace('-', '/')}</span>}
                    <Line s={f} nums={nums} sources={src} />
                  </li>
                ))}
              </ul>
            )}
            {sec.meaning && (
              <div style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--text-secondary)', margin: '6px 0' }}>
                <span className="wh-badge info" style={{ marginRight: 6 }}>분석</span>
                <Line s={sec.meaning} nums={nums} sources={src} />
              </div>
            )}
            {sec.client_explain && (
              <div style={{ ...box, borderLeft: '3px solid var(--cyan-400)', margin: '8px 0' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--cyan-400)', marginBottom: 2 }}>고객에게 이렇게 설명하세요</div>
                <Line s={sec.client_explain} nums={nums} sources={src} style={{ color: 'var(--text-primary)' }} />
              </div>
            )}
            {sec.qa.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
                {sec.qa.map((q, i) => (
                  <div key={i} style={{ fontSize: 13, lineHeight: 1.6 }}>
                    <div style={{ color: 'var(--text-primary)', fontWeight: 600 }}>Q. {q.q}</div>
                    <div style={{ color: 'var(--text-secondary)' }}>
                      A. {q.a}
                      <Refs ids={q.source_ids} nums={nums} sources={src} />
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div style={{ marginTop: 10, textAlign: 'right' }}>
              <Link href={`/content/company-report/companies/${sec.company_id}`} style={{ fontSize: 12, color: 'var(--cyan-400)' }}>
                기업 상세 보기 →
              </Link>
            </div>
          </Card>
        ))}
      </div>

      <Card padding={16}>
        <SectionTitle>④ 주의가 필요한 기업</SectionTitle>
        {(c.cautions || []).length === 0 ? (
          <div style={mutedText}>이번 달 주의가 필요한 기업이 없습니다.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {(c.cautions || []).map((x) => (
              <div key={x.company_id} style={{ ...box, borderLeft: '3px solid var(--danger)' }}>
                <strong style={{ color: 'var(--text-primary)' }}>{x.name}</strong>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                  <b>무슨 일</b> · <Line s={x.what} nums={nums} sources={src} />
                </div>
                {x.impact && (
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                    <b>영향</b> · <Line s={x.impact} nums={nums} sources={src} />
                  </div>
                )}
                {x.check && (
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                    <b>회사에 확인할 것</b> · <Line s={x.check} nums={nums} sources={src} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card padding={16}>
        <SectionTitle>⑤ 다음 달 체크포인트</SectionTitle>
        {(c.checkpoints || []).length === 0 ? (
          <div style={mutedText}>기사·공시에 나온 예정 일정이 없습니다.</div>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18, listStyle: 'disc' }}>
            {(c.checkpoints || []).map((p, i) => (
              <li key={i} style={{ fontSize: 13, lineHeight: 1.8, color: 'var(--text-secondary)' }}>
                {p.when && <span style={{ ...mutedText, fontSize: 12, marginRight: 6 }}>{p.when}</span>}
                <strong style={{ color: 'var(--text-primary)' }}>{p.name}</strong> · <Line s={p} nums={nums} sources={src} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      {nums.size > 0 && (
        <Card padding={16}>
          <SectionTitle>출처</SectionTitle>
          <ol style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {Array.from(nums.entries()).map(([id, n]) => {
              const s = src[id];
              if (!s) return null;
              return (
                <li key={id} style={{ fontSize: 12, lineHeight: 1.7, color: 'var(--text-muted)' }}>
                  <span style={{ display: 'inline-block', minWidth: 28, color: 'var(--cyan-400)' }}>[{n}]</span>
                  {s.type === 'article' && s.url ? (
                    <a href={s.url} target="_blank" rel="noreferrer" style={{ color: 'var(--text-secondary)' }}>
                      {s.title}
                    </a>
                  ) : (
                    <span style={{ color: 'var(--text-secondary)' }}>원장 · {s.title}</span>
                  )}
                  {s.date ? ` · ${s.date}` : ''}
                  {s.press ? ` · ${s.press}` : ''}
                </li>
              );
            })}
          </ol>
        </Card>
      )}
    </div>
  );
}

export default MonthlyBriefingView;
