'use client';

/**
 * 폰 전용 브리핑 화면(로그인 없음) — 카톡 [브리핑 보기] 버튼이 여는 화면.
 * 문장 끝 [1][2]를 누르면 바로 원문 기사. 서버가 수신자별 열쇠값(t)을 확인한다.
 */
import { CSSProperties, ReactNode, useEffect, useState } from 'react';
import { API_URL } from '@/lib/api-url';

type Refs = number[];
interface RefItem {
  n: number;
  url: string;
  title?: string;
  press?: string;
  date?: string;
}
interface Sent {
  text: string;
  refs: Refs;
}

interface DailyData {
  kind: 'daily';
  date: string;
  weekday?: string;
  weather?: string | null;
  markets: {
    name: string;
    market: string;
    close?: number | null;
    change_pct?: number | null;
    available?: boolean;
    unit?: string;
  }[];
  company_count: number;
  article_count: number;
  caution_count: number;
  is_fallback?: boolean;
  overall: Sent[];
  companies: {
    name: string;
    article_count: number;
    caution_count: number;
    one_liner: string;
    refs: Refs;
    articles: {
      title: string;
      url: string;
      press?: string;
      tag?: string | null;
      summary?: string | null;
      published_at?: string | null;
      dart?: boolean;
    }[];
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
    name: string;
    article_count: number;
    caution_count: number;
    summary: Sent[];
    facts: (Sent & { date?: string })[];
    meaning: Sent | null;
    client_explain: Sent | null;
    qa: { q: string; a: string; refs: Refs }[];
  }[];
  refs: RefItem[];
}

const page: CSSProperties = {
  minHeight: '100vh',
  background: 'var(--bg-base, #0B1220)',
  color: 'var(--text-primary, #F1F5F9)',
};
const wrap: CSSProperties = {
  maxWidth: 640,
  margin: '0 auto',
  padding: '16px 16px 40px',
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
};
const card: CSSProperties = {
  background: 'var(--bg-card, #16203A)',
  border: '1px solid var(--border, #243049)',
  borderRadius: 14,
  padding: 16,
};
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
              display: 'inline-block',
              minWidth: 22,
              padding: '0 6px',
              margin: '0 0 0 4px',
              borderRadius: 999,
              background: 'rgba(56,189,248,.15)',
              color: 'var(--cyan-400, #38BDF8)',
              fontSize: 12,
              fontWeight: 700,
              textAlign: 'center',
              textDecoration: 'none',
              lineHeight: '20px',
              verticalAlign: 'baseline',
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
  const c = {
    neg: ['rgba(239,68,68,.15)', '#F87171'],
    pos: ['rgba(16,185,129,.15)', '#34D399'],
    info: ['rgba(59,130,246,.15)', '#93C5FD'],
  }[tone];
  return (
    <span
      style={{
        background: c[0],
        color: c[1],
        fontSize: 12,
        fontWeight: 700,
        padding: '2px 8px',
        borderRadius: 999,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

function Footer() {
  return (
    <div style={{ ...muted, fontSize: 12, textAlign: 'center', lineHeight: 1.7, marginTop: 6 }}>
      이 화면은 브리핑을 받은 분 전용 링크입니다(45일 동안 열림).
      <br />
      <a href="/login" style={{ color: 'var(--cyan-400, #38BDF8)' }}>
        Working Hub에서 전체 보기
      </a>
    </div>
  );
}

function Header({ title, sub, chips }: { title: string; sub: string; chips: ReactNode }) {
  return (
    <header style={{ padding: '6px 2px 0' }}>
      <div style={{ ...muted, fontSize: 12, fontWeight: 700, letterSpacing: 0.3 }}>
        Dr.GM · 사내 업무용
      </div>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: '4px 0 2px' }}>{title}</h1>
      <div style={muted}>{sub}</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>{chips}</div>
    </header>
  );
}

/** 번호 목록 → 그 자료들의 날짜 범위 'M/D~M/D' */
function refRange(nums: number[], map: Map<number, RefItem>): string {
  const ds = nums
    .map((n) => map.get(n)?.date || '')
    .filter((x) => /^\d{4}-\d{2}-\d{2}/.test(x))
    .map((x) => x.slice(0, 10))
    .sort();
  if (!ds.length) return '';
  const f = (x: string) => `${Number(x.slice(5, 7))}/${Number(x.slice(8, 10))}`;
  return ds[0] === ds[ds.length - 1] ? f(ds[0]) : `${f(ds[0])}~${f(ds[ds.length - 1])}`;
}

function pct(v?: number | null) {
  if (v === null || v === undefined) return '';
  return `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;
}

function CompanyArticles({ c }: { c: DailyData['companies'][number] }) {
  const [all, setAll] = useState(false);
  const list = all ? c.articles : c.articles.slice(0, 3);
  return (
    <ul
      style={{
        listStyle: 'none',
        margin: '10px 0 0',
        padding: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      {list.map((a, i) => (
        <li key={i} style={{ borderTop: '1px solid var(--border-soft, #1C2740)', paddingTop: 10 }}>
          <a
            href={a.url}
            target="_blank"
            rel="noreferrer"
            style={{
              color: 'var(--text-primary, #F1F5F9)',
              fontSize: 14.5,
              fontWeight: 600,
              lineHeight: 1.5,
              textDecoration: 'none',
            }}
          >
            {a.tag === 'caution' && <span style={{ color: '#F87171' }}>[주의] </span>}
            {a.dart && <span style={{ color: '#FBBF24' }}>[공시] </span>}
            {a.title} <span style={{ color: 'var(--cyan-400, #38BDF8)' }}>↗</span>
          </a>
          {a.summary && (
            <p style={{ ...muted, fontSize: 13.5, margin: '3px 0 0', lineHeight: 1.6 }}>
              {a.summary}
            </p>
          )}
          <div style={{ ...muted, fontSize: 12, marginTop: 2 }}>
            {[a.press, (a.published_at || '').slice(5, 16).replace('T', ' ')]
              .filter(Boolean)
              .join(' · ')}
          </div>
        </li>
      ))}
      {c.articles.length > 3 && (
        <li>
          <button
            type="button"
            onClick={() => setAll((x) => !x)}
            style={{
              width: '100%',
              padding: '10px 0',
              background: 'transparent',
              border: '1px solid var(--border, #243049)',
              borderRadius: 10,
              color: 'var(--text-secondary, #C4CDDB)',
              fontSize: 14,
            }}
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
        <section style={{ ...card, padding: '10px 14px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 14px' }}>
            {d.markets.map((m) => (
              <div
                key={m.name}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 6,
                  fontSize: 13.5,
                  whiteSpace: 'nowrap',
                }}
              >
                <span style={{ color: 'var(--text-secondary, #C4CDDB)' }}>{m.name}</span>
                {m.available === false ? (
                  <span style={muted}>조회 실패</span>
                ) : (
                  <span>
                    <span style={{ ...muted, fontSize: 12, marginRight: 4 }}>
                      {m.unit === '$' ? '$' : ''}
                      {m.close !== null && m.close !== undefined
                        ? m.close.toLocaleString('ko-KR', { maximumFractionDigits: 1 })
                        : ''}
                      {m.unit && m.unit !== '$' ? m.unit : ''}
                    </span>
                    <b
                      style={{
                        color:
                          (m.change_pct || 0) > 0
                            ? '#F87171'
                            : (m.change_pct || 0) < 0
                              ? '#60A5FA'
                              : 'inherit',
                      }}
                    >
                      {pct(m.change_pct)}
                    </b>
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
      <section style={card}>
        <h2 style={h2}>종합브리핑</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {d.overall.length ? (
            d.overall.map((s, i) => <Line key={i} s={s} map={map} prefix="· " />)
          ) : (
            <p style={muted}>새 기사가 없습니다.</p>
          )}
        </div>
        {d.is_fallback && (
          <p style={{ ...muted, fontSize: 12, marginTop: 8 }}>
            오늘은 AI 교차 검토가 끝나지 않아 기사 요약만 모았습니다.
          </p>
        )}
      </section>
      {d.companies.map((c, i) => (
        <section key={i} style={card}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              justifyContent: 'space-between',
            }}
          >
            <h2
              style={{
                ...h2,
                margin: 0,
                fontSize: 18,
                borderLeft: `4px solid ${c.caution_count > 0 ? '#F87171' : '#38BDF8'}`,
                paddingLeft: 10,
              }}
            >
              {shortCo(c.name)}
            </h2>
            <span style={{ display: 'flex', gap: 6 }}>
              {c.caution_count > 0 && <Badge tone="neg">주의 {c.caution_count}</Badge>}
              <Badge tone="info">{c.article_count}건</Badge>
            </span>
          </div>
          {c.one_liner && (
            <div style={{ marginTop: 8 }}>
              <Line s={{ text: c.one_liner, refs: c.refs }} map={map} />
            </div>
          )}
          <CompanyArticles c={c} />
        </section>
      ))}
      <Footer />
    </>
  );
}

/** '주식회사'·'(주)'를 뺀 짧은 회사명(폰 화면 제목용) */
function shortCo(name?: string | null): string {
  const s = (name || '')
    .replace(/주식회사|\(주\)|㈜|\(유\)|유한회사/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return s || name || '';
}

const ACCENT = { cyan: '#38BDF8', red: '#F87171', amber: '#FBBF24', green: '#34D399' };

/** 회사 하나 = 한 덩어리: 왼쪽 색 막대 + 회사명(제목 줄) + 내용(아래 줄) */
function CoBlock({
  name,
  accent,
  tag,
  children,
}: {
  name: string;
  accent: string;
  tag?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        background: 'rgba(255,255,255,.035)',
        border: '1px solid var(--border-soft, #1C2740)',
        borderLeft: `4px solid ${accent}`,
        borderRadius: 10,
        padding: '12px 12px 12px 14px',
      }}
    >
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}
      >
        <span
          style={{
            fontSize: 16,
            fontWeight: 800,
            color: 'var(--text-primary, #F1F5F9)',
            letterSpacing: -0.2,
          }}
        >
          {name}
        </span>
        {tag}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{children}</div>
    </div>
  );
}

/** 내용 한 덩어리: 작은 라벨(윗줄) + 문장(아랫줄) */
function Labeled({
  label,
  color,
  s,
  map,
}: {
  label: string;
  color: string;
  s: Sent;
  map: Map<number, RefItem>;
}) {
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 800, color, marginBottom: 2 }}>{label}</div>
      <p style={{ ...para, fontSize: 15, color: 'var(--text-secondary, #C4CDDB)' }}>
        {s.text}
        <RefLinks refs={s.refs} map={map} />
      </p>
    </div>
  );
}

function Body({ s, map }: { s: Sent; map: Map<number, RefItem> }) {
  return (
    <p style={{ ...para, fontSize: 15, color: 'var(--text-secondary, #C4CDDB)' }}>
      {s.text}
      <RefLinks refs={s.refs} map={map} />
    </p>
  );
}

/** 월간 기업별 정리 카드 — 접힌 상태가 기본, 제목을 누르면 펼침 */
function MonthlyCompanyCard({
  c,
  map,
}: {
  c: MonthlyData['companies'][number];
  map: Map<number, RefItem>;
}) {
  const [open, setOpen] = useState(false);
  const range = refRange(
    [
      ...c.summary,
      ...c.facts,
      ...(c.meaning ? [c.meaning] : []),
      ...c.qa,
      ...(c.client_explain ? [c.client_explain] : []),
    ].flatMap((x) => x.refs || []),
    map,
  );
  return (
    <section style={card}>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          justifyContent: 'space-between',
          cursor: 'pointer',
        }}
      >
        <h2
          style={{
            ...h2,
            margin: 0,
            fontSize: 18,
            borderLeft: `4px solid ${c.caution_count > 0 ? ACCENT.red : ACCENT.cyan}`,
            paddingLeft: 10,
          }}
        >
          {shortCo(c.name)}
          <span style={{ color: 'var(--text-muted, #AAB6C8)', fontSize: 13, marginLeft: 6 }}>
            {open ? '▾' : '▸'}
          </span>
        </h2>
        <span style={{ display: 'flex', gap: 6 }}>
          {c.caution_count > 0 && <Badge tone="neg">주의 {c.caution_count}</Badge>}
          <Badge tone="info">{c.article_count}건</Badge>
        </span>
      </div>
      {!open && c.summary[0] && (
        <div
          onClick={() => setOpen(true)}
          style={{
            ...muted,
            fontSize: 13.5,
            marginTop: 8,
            lineHeight: 1.6,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {c.summary[0].text}
        </div>
      )}
      {open && (
        <>
          {range && (
            <div style={{ ...muted, fontSize: 12, marginTop: 4, textAlign: 'right' }}>
              참고 자료 {range}
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
            {c.summary.map((s, j) => (
              <Line key={j} s={s} map={map} />
            ))}
            {c.facts.map((s, j) => (
              <Line
                key={`f${j}`}
                s={s}
                map={map}
                prefix={
                  <span style={muted}>
                    {s.date ? `${s.date.slice(5).replace('-', '/')} · ` : '· '}
                  </span>
                }
              />
            ))}
            {c.meaning && <Line s={c.meaning} map={map} prefix={<Badge tone="info">분석</Badge>} />}
            {c.qa.map((q, j) => (
              <div key={`q${j}`} style={{ fontSize: 14.5, lineHeight: 1.7 }}>
                <div style={{ fontWeight: 700 }}>Q. {q.q}</div>
                <div>
                  A. {q.a}
                  <RefLinks refs={q.refs} map={map} />
                </div>
              </div>
            ))}
            {c.client_explain && (
              <div
                style={{
                  marginTop: 16,
                  background: 'rgba(16,185,129,.08)',
                  border: '1px solid rgba(16,185,129,.35)',
                  borderRadius: 10,
                  padding: 12,
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 800, color: '#34D399', marginBottom: 4 }}>
                  고객에게 이렇게 설명하세요
                </div>
                <Line s={c.client_explain} map={map} />
              </div>
            )}
          </div>
        </>
      )}
    </section>
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
        sub={`자료 기간 ${Number(m)}/1~${Number(m)}/${new Date(Number(y), Number(m), 0).getDate()} · 기사가 있었던 기업 ${d.company_with_news}곳`}
        chips={
          <>
            <Badge tone="info">
              기사 {d.article_count}건({diff >= 0 ? '+' : ''}
              {diff})
            </Badge>
            {d.caution_count > 0 && <Badge tone="neg">주의 {d.caution_count}건</Badge>}
          </>
        }
      />
      <section style={card}>
        <h2 style={h2}>{Number(m)}월 요약</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {d.summary.map((s, i) => (
            <Line key={i} s={s} map={map} prefix="· " />
          ))}
        </div>
      </section>
      {d.highlights.length > 0 && (
        <section style={card}>
          <h2 style={h2}>주목할 기업</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {d.highlights.map((s, i) => (
              <CoBlock key={i} name={shortCo(s.name)} accent={ACCENT.cyan}>
                <Body s={s} map={map} />
              </CoBlock>
            ))}
          </div>
        </section>
      )}
      {d.cautions.length > 0 && (
        <section style={{ ...card, borderColor: 'rgba(239,68,68,.45)' }}>
          <h2 style={h2}>주의가 필요한 기업</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {d.cautions.map((c, i) => (
              <CoBlock key={i} name={shortCo(c.name)} accent={ACCENT.red}>
                {c.what && <Labeled label="무슨 일" color={ACCENT.red} s={c.what} map={map} />}
                {c.impact && <Labeled label="영향" color={ACCENT.amber} s={c.impact} map={map} />}
                {c.check && <Labeled label="확인할 것" color={ACCENT.cyan} s={c.check} map={map} />}
              </CoBlock>
            ))}
          </div>
        </section>
      )}
      {d.checkpoints.length > 0 && (
        <section style={card}>
          <h2 style={h2}>다음 달 체크포인트</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {d.checkpoints.map((s, i) => (
              <CoBlock
                key={i}
                name={shortCo(s.name)}
                accent={ACCENT.amber}
                tag={
                  s.when && s.when.length === 7 ? (
                    <Badge tone="info">{Number(s.when.slice(5))}월</Badge>
                  ) : undefined
                }
              >
                <Body s={s} map={map} />
              </CoBlock>
            ))}
          </div>
        </section>
      )}
      {d.companies.length > 0 && (
        <h2 style={{ ...h2, margin: '6px 2px 0' }}>
          기업별 월간 정리{' '}
          <span style={{ ...muted, fontSize: 12, fontWeight: 400 }}>
            회사명을 누르면 펼쳐집니다
          </span>
        </h2>
      )}
      {d.companies.map((c, i) => (
        <MonthlyCompanyCard key={i} c={c} map={map} />
      ))}
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
      .catch(
        (e) => alive && setErr(e instanceof Error ? e.message : '브리핑을 불러오지 못했습니다.'),
      );
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
            <a href="/login" style={{ color: 'var(--cyan-400, #38BDF8)' }}>
              Working Hub 로그인
            </a>
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
