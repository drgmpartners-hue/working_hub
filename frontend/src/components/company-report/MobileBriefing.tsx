'use client';

/**
 * 폰 전용 브리핑 화면(로그인 없음) — 카톡 [브리핑 보기] 버튼이 여는 화면.
 * 문장 끝 [1][2]를 누르면 바로 원문 기사. 서버가 수신자별 열쇠값(t)을 확인한다.
 */
import { CSSProperties, ReactNode, useEffect, useState } from 'react';
import { API_URL } from '@/lib/api-url';

type Refs = number[];
interface RefItem { n: number; url: string; title?: string; press?: string; date?: string }
interface Sent { text: string; refs: Refs }

interface DailyData {
  kind: 'daily';
  date: string;
  weekday?: string;
  weather?: string | null;
  markets: { name: string; market: string; close?: number | null; change_pct?: number | null; available?: boolean }[];
  company_count: number;
  article_count: number;
  caution_count: number;
  is_fallback?: boolean;
  overall: Sent[];
  companies: {
    name: string; article_count: number; caution_count: number; one_liner: string; refs: Refs;
    articles: { title: string; url: string; press?: string; tag?: string | null; summary?: string | null; published_at?: string | null; dart?: boolean }[];
  }[];
  refs: RefItem[];
}

interface MonthlyData {
  kind: 'monthly';
  month: string;
  article_count: number;
  caution_count: number;
  prev_article_count: number;
  company_with_news: number;
  summary: Sent[];
  highlights: (Sent & { name: string })[];
  cautions: { name: string; what: Sent | null; impact: Sent | null; check: Sent | null }[];
  checkpoints: (Sent & { name: string; when?: string })[];
  companies: {
    name: string; article_count: number; caution_count: number; summary: Sent[]; facts: (Sent & { date?: string })[];
    meaning: Sent | null; client_explain: Sent | null; qa: { q: string; a: string; refs: Refs }[];
  }[];
  refs: RefItem[];
}

const page: CSSProperties = { minHeight: '100vh', background: 'var(--bg-base, #0B1220)', color: 'var(--text-primary, #F1F5F9)' };
const wrap: CSSProperties = { maxWidth: 640, margin: '0 auto', padding: '16px 16px 40px', display: 'flex', flexDirection: 'column', gap: 14 };
const card: CSSProperties = { background: 'var(--bg-card, #16203A)', border: '1px solid var(--border, #243049)', borderRadius: 14, padding: 16 };
const h2: CSSProperties = { fontSize: 16, fontWeight: 800, margin: '0 0 10px' };
const muted: CSSProperties = { color: 'var(--text-muted, #AAB6C8)', fontSize: 13 };
const para: CSSProperties = { fontSize: 15.5, lineHeight: 1.75, margin: 0, wordBreak: 'keep-all' };

function useRefMap(refs: RefItem[]) {
  const m = new Map<number, RefItem>();
  refs.forEach((r) => m.set(r.n, r));
  return m;
}

/** [1] 누르면 원문 기사 */
function RefLinks({ refs, map }: { refs: Refs; map: Map<number, RefItem> }) {
  if (!refs?.length) return null;
  return (
    <>
      {refs.map((n) => {
        const r = map.get(n);
        if (!r) return null;
        return (
          <a
            key={n}
            href={r.url}
            target="_blank"
            rel="noreferrer"
            title={r.title}
            style={{
              display: 'inline-block', minWidth: 26, padding: '1px 7px', margin: '0 0 0 4px', borderRadius: 999,
              background: 'rgba(56,189,248,.15)', color: 'var(--cyan-400, #38BDF8)', fontSize: 13, fontWeight: 700,
              textAlign: 'center', textDecoration: 'none', lineHeight: '22px', verticalAlign: 'baseline',
            }}
          >
            {n}
          </a>
        );
      })}
    </>
  );
}

function Line({ s, map, prefix }: { s: Sent; map: Map<number, RefItem>; prefix?: ReactNode }) {
  return (
    <p style={para}>
      {prefix}
      {s.text}
      <RefLinks refs={s.refs} map={map} />
    </p>
  );
}

function Badge({ children, tone }: { children: ReactNode; tone: 'neg' | 'pos' | 'info' }) {
  const c = { neg: ['rgba(239,68,68,.15)', '#F87171'], pos: ['rgba(16,185,129,.15)', '#34D399'], info: ['rgba(59,130,246,.15)', '#93C5FD'] }[tone];
  return <span style={{ background: c[0], color: c[1], fontSize: 12, fontWeight: 700, padding: '2px 8px', borderRadius: 999, whiteSpace: 'nowrap' }}>{children}</span>;
}

function SourceList({ refs }: { refs: RefItem[] }) {
  if (!refs.length) return null;
  return (
    <section style={card}>
      <h2 style={h2}>원문 기사</h2>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {refs.map((r) => (
          <li key={r.n} style={{ display: 'flex', gap: 8 }}>
            <span style={{ color: 'var(--cyan-400, #38BDF8)', fontWeight: 700, minWidth: 22 }}>{r.n}</span>
            <a href={r.url} target="_blank" rel="noreferrer" style={{ color: 'var(--text-primary, #F1F5F9)', fontSize: 14.5, lineHeight: 1.5, textDecoration: 'none' }}>
              {r.title || r.url}
              <span style={{ ...muted, display: 'block', fontSize: 12 }}>{[r.press, r.date].filter(Boolean).join(' · ')}</span>
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Footer() {
  return (
    <div style={{ ...muted, fontSize: 12, textAlign: 'center', lineHeight: 1.7, marginTop: 6 }}>
      이 화면은 브리핑을 받은 분 전용 링크입니다(45일 동안 열림).
      <br />
      <a href="/login" style={{ color: 'var(--cyan-400, #38BDF8)' }}>Working Hub에서 전체 보기</a>
    </div>
  );
}

function Header({ title, sub, chips }: { title: string; sub: string; chips: ReactNode }) {
  return (
    <header style={{ padding: '6px 2px 0' }}>
      <div style={{ ...muted, fontSize: 12, fontWeight: 700, letterSpacing: 0.3 }}>Dr.GM · 사내 업무용</div>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: '4px 0 2px' }}>{title}</h1>
      <div style={muted}>{sub}</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>{chips}</div>
    </header>
  );
}

function pct(v?: number | null) {
  if (v === null || v === undefined) return '';
  return `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;
}

function CompanyArticles({ c }: { c: DailyData['companies'][number] }) {
  const [all, setAll] = useState(false);
  const list = all ? c.articles : c.articles.slice(0, 3);
  return (
    <ul style={{ listStyle: 'none', margin: '10px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {list.map((a, i) => (
        <li key={i} style={{ borderTop: '1px solid var(--border-soft, #1C2740)', paddingTop: 10 }}>
          <a href={a.url} target="_blank" rel="noreferrer" style={{ color: 'var(--text-primary, #F1F5F9)', fontSize: 14.5, fontWeight: 600, lineHeight: 1.5, textDecoration: 'none' }}>
            {a.tag === 'caution' && <span style={{ color: '#F87171' }}>[주의] </span>}
            {a.dart && <span style={{ color: '#FBBF24' }}>[공시] </span>}
            {a.title} <span style={{ color: 'var(--cyan-400, #38BDF8)' }}>↗</span>
          </a>
          {a.summary && <p style={{ ...muted, fontSize: 13.5, margin: '3px 0 0', lineHeight: 1.6 }}>{a.summary}</p>}
          <div style={{ ...muted, fontSize: 12, marginTop: 2 }}>
            {[a.press, (a.published_at || '').slice(5, 16).replace('T', ' ')].filter(Boolean).join(' · ')}
          </div>
        </li>
      ))}
      {c.articles.length > 3 && (
        <li>
          <button
            type="button"
            onClick={() => setAll((x) => !x)}
            style={{ width: '100%', padding: '10px 0', background: 'transparent', border: '1px solid var(--border, #243049)', borderRadius: 10, color: 'var(--text-secondary, #C4CDDB)', fontSize: 14 }}
          >
            {all ? '접기' : `기사 ${c.articles.length - 3}건 더 보기`}
          </button>
        </li>
      )}
    </ul>
  );
}

export function DailyMobile({ d }: { d: DailyData }) {
  const map = useRefMap(d.refs);
  const dt = `${Number(d.date.slice(5, 7))}월 ${Number(d.date.slice(8, 10))}일(${d.weekday || ''})`;
  const us = d.markets.filter((m) => m.market === 'US');
  const kr = d.markets.filter((m) => m.market === 'KR');
  return (
    <>
      <Header
        title="투자기업 데일리 브리핑"
        sub={`${dt}${d.weather ? ` · ${d.weather}` : ''}`}
        chips={
          <>
            <Badge tone="info">기업 {d.company_count}곳</Badge>
            <Badge tone="info">기사 {d.article_count}건</Badge>
            {d.caution_count > 0 && <Badge tone="neg">주의 {d.caution_count}건</Badge>}
          </>
        }
      />
      {d.markets.length > 0 && (
        <section style={{ ...card, padding: 12 }}>
          {[us, kr].map((rows, i) =>
            rows.length ? (
              <div key={i} style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', fontSize: 13.5, padding: '2px 0' }}>
                <span style={{ ...muted, fontSize: 12, width: 18 }}>{i === 0 ? '미' : '한'}</span>
                {rows.map((m) => (
                  <span key={m.name} style={{ whiteSpace: 'nowrap' }}>
                    {m.name}{' '}
                    {m.available === false ? (
                      <span style={muted}>조회 실패</span>
                    ) : (
                      <b style={{ color: (m.change_pct || 0) > 0 ? '#F87171' : (m.change_pct || 0) < 0 ? '#60A5FA' : 'inherit' }}>{pct(m.change_pct)}</b>
                    )}
                  </span>
                ))}
              </div>
            ) : null,
          )}
        </section>
      )}
      <section style={card}>
        <h2 style={h2}>종합브리핑</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {d.overall.length ? d.overall.map((s, i) => <Line key={i} s={s} map={map} prefix="· " />) : <p style={muted}>새 기사가 없습니다.</p>}
        </div>
        {d.is_fallback && <p style={{ ...muted, fontSize: 12, marginTop: 8 }}>오늘은 AI 교차 검토가 끝나지 않아 기사 요약만 모았습니다.</p>}
      </section>
      {d.companies.map((c, i) => (
        <section key={i} style={card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
            <h2 style={{ ...h2, margin: 0 }}>{c.name}</h2>
            <span style={{ display: 'flex', gap: 6 }}>
              {c.caution_count > 0 && <Badge tone="neg">주의 {c.caution_count}</Badge>}
              <Badge tone="info">{c.article_count}건</Badge>
            </span>
          </div>
          {c.one_liner && <div style={{ marginTop: 8 }}><Line s={{ text: c.one_liner, refs: c.refs }} map={map} /></div>}
          <CompanyArticles c={c} />
        </section>
      ))}
      <SourceList refs={d.refs} />
      <Footer />
    </>
  );
}

export function MonthlyMobile({ d }: { d: MonthlyData }) {
  const map = useRefMap(d.refs);
  const [y, m] = d.month.split('-');
  const diff = d.article_count - d.prev_article_count;
  return (
    <>
      <Header
        title={`${Number(m)}월 투자기업 월간 브리핑`}
        sub={`${y}년 ${Number(m)}월 · 기사가 있었던 기업 ${d.company_with_news}곳`}
        chips={
          <>
            <Badge tone="info">기사 {d.article_count}건({diff >= 0 ? '+' : ''}{diff})</Badge>
            {d.caution_count > 0 && <Badge tone="neg">주의 {d.caution_count}건</Badge>}
          </>
        }
      />
      <section style={card}>
        <h2 style={h2}>{Number(m)}월 요약</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {d.summary.map((s, i) => <Line key={i} s={s} map={map} prefix="· " />)}
        </div>
      </section>
      {d.highlights.length > 0 && (
        <section style={card}>
          <h2 style={h2}>주목할 기업</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {d.highlights.map((s, i) => <Line key={i} s={s} map={map} prefix={<b>{s.name}: </b>} />)}
          </div>
        </section>
      )}
      {d.cautions.length > 0 && (
        <section style={{ ...card, borderColor: 'rgba(239,68,68,.45)' }}>
          <h2 style={h2}>주의가 필요한 기업</h2>
          {d.cautions.map((c, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: i ? 10 : 0 }}>
              <b>{c.name}</b>
              {c.what && <Line s={c.what} map={map} prefix={<span style={muted}>무슨 일 · </span>} />}
              {c.impact && <Line s={c.impact} map={map} prefix={<span style={muted}>영향 · </span>} />}
              {c.check && <Line s={c.check} map={map} prefix={<span style={muted}>확인할 것 · </span>} />}
            </div>
          ))}
        </section>
      )}
      {d.checkpoints.length > 0 && (
        <section style={card}>
          <h2 style={h2}>다음 달 체크포인트</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {d.checkpoints.map((s, i) => (
              <Line key={i} s={s} map={map} prefix={<b>{s.when && s.when.length === 7 ? `${Number(s.when.slice(5))}월 ` : ''}{s.name}: </b>} />
            ))}
          </div>
        </section>
      )}
      {d.companies.map((c, i) => (
        <section key={i} style={card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
            <h2 style={{ ...h2, margin: 0 }}>{c.name}</h2>
            <span style={{ display: 'flex', gap: 6 }}>
              {c.caution_count > 0 && <Badge tone="neg">주의 {c.caution_count}</Badge>}
              <Badge tone="info">{c.article_count}건</Badge>
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
            {c.summary.map((s, j) => <Line key={j} s={s} map={map} />)}
            {c.facts.map((s, j) => (
              <Line key={`f${j}`} s={s} map={map} prefix={<span style={muted}>{s.date ? `${s.date.slice(5).replace('-', '/')} · ` : '· '}</span>} />
            ))}
            {c.meaning && <Line s={c.meaning} map={map} prefix={<Badge tone="info">분석</Badge>} />}
            {c.client_explain && (
              <div style={{ background: 'rgba(16,185,129,.08)', border: '1px solid rgba(16,185,129,.35)', borderRadius: 10, padding: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: '#34D399', marginBottom: 4 }}>고객에게 이렇게 설명하세요</div>
                <Line s={c.client_explain} map={map} />
              </div>
            )}
            {c.qa.map((q, j) => (
              <div key={`q${j}`} style={{ fontSize: 14.5, lineHeight: 1.7 }}>
                <div style={{ fontWeight: 700 }}>Q. {q.q}</div>
                <div>
                  A. {q.a}
                  <RefLinks refs={q.refs} map={map} />
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
      <SourceList refs={d.refs} />
      <Footer />
    </>
  );
}

/** 열쇠값으로 데이터를 불러와 보여준다 */
export function MobileBriefingPage({ kind, token }: { kind: 'daily' | 'monthly'; token: string }) {
  const [data, setData] = useState<DailyData | MonthlyData | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setErr('링크가 올바르지 않습니다.');
      return;
    }
    let alive = true;
    fetch(`${API_URL}/api/v1/company-report/m/${kind}?t=${encodeURIComponent(token)}`)
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error((j && j.detail) || '브리핑을 불러오지 못했습니다.');
        if (alive) setData(j);
      })
      .catch((e) => alive && setErr(e instanceof Error ? e.message : '브리핑을 불러오지 못했습니다.'));
    return () => {
      alive = false;
    };
  }, [kind, token]);

  return (
    <main style={page}>
      <div style={wrap}>
        {err ? (
          <div style={{ ...card, marginTop: 40, textAlign: 'center' }}>
            <p style={{ ...para, marginBottom: 12 }}>{err}</p>
            <a href="/login" style={{ color: 'var(--cyan-400, #38BDF8)' }}>Working Hub 로그인</a>
          </div>
        ) : !data ? (
          <div style={{ ...muted, textAlign: 'center', marginTop: 60 }}>브리핑을 불러오는 중…</div>
        ) : data.kind === 'daily' ? (
          <DailyMobile d={data} />
        ) : (
          <MonthlyMobile d={data} />
        )}
      </div>
    </main>
  );
}

export default MobileBriefingPage;
