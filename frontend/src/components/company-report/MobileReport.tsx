'use client';

/**
 * 고객용 반기 보고서 폰 화면(로그인 없음) — 카톡·문자 [보고서 보기] 링크가 여는 화면 (P4-10).
 * 서버가 열쇠값(t: 보고서·고객·만료일·서명)을 확인하고, 내부 표시(확인 필요·검토 의견·영업 노트)를 뺀 본문만 준다.
 * 고객은 Working Hub 사용자가 아니므로 앱 테마가 아니라 보고서와 같은 밝은 Dr.GM 색(남색·금색)으로 그린다.
 */
import { CSSProperties, useEffect, useMemo, useState } from 'react';
import { API_URL } from '@/lib/api-url';

interface Sent {
  id: string;
  text: string;
  source_ids: string[];
  kind?: string;
  date?: string;
}
interface Row {
  id: string;
  cells: string[];
  source_ids: string[];
  note?: string;
}
type Block =
  | { type: 'para'; items: Sent[] }
  | { type: 'timeline'; items: Sent[] }
  | { type: 'table'; columns: string[]; rows: Row[] };
interface Data {
  client_name: string;
  company_name: string;
  period_label: string;
  /** 대상 기간 — 예: 2026.01.01 ~ 2026.06.30 */
  period_range?: string;
  as_of_date: string | null;
  contact: string;
  content: {
    summary: {
      three_lines: Sent[];
      changes: Sent[];
      stage: string | null;
      stage_note: Sent | null;
    };
    sections: { no: number; title: string; blocks: Block[] }[];
    appendix: {
      citations: {
        no: number;
        id: string;
        title?: string;
        press?: string;
        date?: string;
        url?: string | null;
      }[];
      glossary: { term: string; desc: string }[];
      disclaimer: string;
    };
  };
  images: {
    id: string;
    section_no: number | null;
    caption: string | null;
    source_label: string | null;
  }[];
}

const NAVY = '#1F2A44';
const GOLD = '#B8975A';
const STAGES = ['개발', '출시', '매출 발생', '흑자', '상장 준비', '상장'];
const page: CSSProperties = {
  minHeight: '100vh',
  background: '#F5F3EE',
  color: '#1F2937',
  fontFamily: "'Pretendard', 'Noto Sans KR', system-ui, sans-serif",
  colorScheme: 'light',
};
const wrap: CSSProperties = { maxWidth: 640, margin: '0 auto', padding: '0 14px 40px' };
const card: CSSProperties = {
  background: '#fff',
  borderRadius: 14,
  padding: '18px 16px',
  marginTop: 12,
  boxShadow: '0 1px 2px rgba(0,0,0,.06)',
};
const h2: CSSProperties = { fontSize: 16, fontWeight: 700, color: NAVY, margin: '0 0 10px' };
const para: CSSProperties = {
  fontSize: 15,
  lineHeight: 1.8,
  margin: '0 0 8px',
  wordBreak: 'keep-all',
};
const muted: CSSProperties = { color: '#6B7280', fontSize: 12.5 };

export function MobileReportPage({ token }: { token: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const q = `t=${encodeURIComponent(token)}`;

  useEffect(() => {
    if (!token) return;
    let alive = true;
    fetch(`${API_URL}/api/v1/company-report/m/report?${q}`)
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error((j && j.detail) || '보고서를 불러오지 못했습니다.');
        if (alive) setData(j);
      })
      .catch(
        (e) => alive && setErr(e instanceof Error ? e.message : '보고서를 불러오지 못했습니다.'),
      );
    return () => {
      alive = false;
    };
  }, [token, q]);

  const cites = useMemo(() => {
    const m: Record<string, { no: number; url?: string | null; title?: string }> = {};
    (data?.content.appendix.citations || []).forEach((c) => (m[c.id] = c));
    return m;
  }, [data]);

  const Cite = ({ ids }: { ids: string[] }) => {
    const list = ids.map((i) => cites[i]).filter(Boolean);
    if (!list.length) return null;
    return (
      <sup style={{ fontSize: 10, color: '#6B7280', marginLeft: 1 }}>
        {list.map((c) =>
          c.url ? (
            <a
              key={c.no}
              href={c.url}
              target="_blank"
              rel="noreferrer"
              style={{ color: GOLD, textDecoration: 'none' }}
            >
              [{c.no}]
            </a>
          ) : (
            <span key={c.no}>[{c.no}]</span>
          ),
        )}
      </sup>
    );
  };

  const shownErr = token ? err : '링크가 올바르지 않습니다.';
  if (shownErr)
    return (
      <main style={page}>
        <div style={{ ...wrap, paddingTop: 60 }}>
          <div style={{ ...card, textAlign: 'center' }}>
            <p style={para}>{shownErr}</p>
          </div>
        </div>
      </main>
    );
  if (!data)
    return (
      <main style={page}>
        <div style={{ ...wrap, ...muted, textAlign: 'center', paddingTop: 80 }}>
          보고서를 불러오는 중…
        </div>
      </main>
    );

  const c = data.content;
  const stageIdx = c.summary.stage ? STAGES.indexOf(c.summary.stage) : -1;
  const imgs = (no: number) => data.images.filter((i) => (i.section_no || 0) === no);

  return (
    <main style={page}>
      <header style={{ background: NAVY, color: '#fff', padding: '22px 16px 20px' }}>
        <div style={{ maxWidth: 640, margin: '0 auto' }}>
          <div style={{ color: GOLD, fontSize: 12, letterSpacing: 1 }}>Dr.GM Family Office</div>
          <h1 style={{ fontSize: 21, margin: '6px 0 4px', lineHeight: 1.35 }}>
            {data.company_name}
            <br />
            {data.period_label} 기업 종합보고서
          </h1>
          <div style={{ fontSize: 13, opacity: 0.85 }}>
            {data.client_name} 고객님
          </div>
          <div style={{ fontSize: 12, opacity: 0.85, marginTop: 2 }}>
            대상 기간 {data.period_range || data.period_label} · 작성일 {data.as_of_date || '-'}
          </div>
        </div>
      </header>
      <div style={wrap}>
        <section style={card}>
          <h2 style={h2}>한 장 요약</h2>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {c.summary.three_lines.map((s) => (
              <li key={s.id} style={para}>
                {s.text}
                <Cite ids={s.source_ids} />
              </li>
            ))}
          </ul>
          {c.summary.changes.length > 0 && (
            <>
              <div style={{ ...muted, fontWeight: 700, margin: '10px 0 4px' }}>
                지난 보고서 이후 달라진 점
              </div>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {c.summary.changes.map((s) => (
                  <li key={s.id} style={para}>
                    {s.text}
                    <Cite ids={s.source_ids} />
                  </li>
                ))}
              </ul>
            </>
          )}
          {stageIdx >= 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ display: 'flex', gap: 3 }}>
                {STAGES.map((st, i) => (
                  <div
                    key={st}
                    style={{
                      flex: 1,
                      textAlign: 'center',
                      fontSize: 10.5,
                      padding: '5px 0',
                      borderRadius: 4,
                      background: i === stageIdx ? GOLD : i < stageIdx ? '#E8DFCC' : '#EEF0F3',
                      color: i === stageIdx ? '#fff' : '#4B5563',
                      fontWeight: i === stageIdx ? 700 : 400,
                    }}
                  >
                    {st}
                  </div>
                ))}
              </div>
              {c.summary.stage_note && (
                <p style={{ ...para, fontSize: 14, marginTop: 8 }}>{c.summary.stage_note.text}</p>
              )}
            </div>
          )}
        </section>

        {c.sections
          .filter((sec) => sec.blocks.length || imgs(sec.no).length)
          .map((sec) => (
            <section key={sec.no} style={card}>
              <h2 style={h2}>
                <span style={{ color: GOLD, marginRight: 6 }}>{sec.no}</span>
                {sec.title}
              </h2>
              {sec.blocks.map((blk, bi) =>
                blk.type === 'para' ? (
                  <p key={bi} style={para}>
                    {blk.items.map((s) => (
                      <span key={s.id}>
                        {s.text}
                        <Cite ids={s.source_ids} />{' '}
                      </span>
                    ))}
                  </p>
                ) : blk.type === 'timeline' ? (
                  <div
                    key={bi}
                    style={{
                      borderLeft: `2px solid ${GOLD}`,
                      paddingLeft: 12,
                      margin: '4px 0 10px',
                    }}
                  >
                    {blk.items.map((s) => (
                      <div key={s.id} style={{ marginBottom: 8 }}>
                        <div style={{ ...muted, fontWeight: 700 }}>{s.date}</div>
                        <div style={{ ...para, margin: 0 }}>
                          {s.text}
                          <Cite ids={s.source_ids} />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div key={bi} style={{ margin: '4px 0 10px' }}>
                    {blk.rows.map((row) =>
                      blk.columns.length === 2 ? (
                        // 항목·내용 두 칸 표는 '이름  값' 한 줄로
                        <div
                          key={row.id}
                          style={{
                            display: 'flex',
                            gap: 10,
                            padding: '7px 0',
                            borderBottom: '1px solid #EEF0F3',
                            fontSize: 14,
                            lineHeight: 1.6,
                          }}
                        >
                          <span style={{ ...muted, fontSize: 13, minWidth: 84, flexShrink: 0 }}>
                            {row.cells[0]}
                          </span>
                          <span>
                            {row.cells[1]}
                            <Cite ids={row.source_ids} />
                          </span>
                        </div>
                      ) : (
                        <div
                          key={row.id}
                          style={{
                            padding: '8px 0',
                            borderBottom: '1px solid #EEF0F3',
                            fontSize: 14,
                          }}
                        >
                          {row.cells.map((cell, ci) => (
                            <div key={ci} style={{ display: 'flex', gap: 8, lineHeight: 1.6 }}>
                              <span style={{ ...muted, minWidth: 72, flexShrink: 0 }}>
                                {blk.columns[ci]}
                              </span>
                              <span>
                                {cell}
                                {ci === row.cells.length - 1 && <Cite ids={row.source_ids} />}
                              </span>
                            </div>
                          ))}
                        </div>
                      ),
                    )}
                  </div>
                ),
              )}
              {imgs(sec.no).map((im) => (
                <figure key={im.id} style={{ margin: '10px 0 0' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`${API_URL}/api/v1/company-report/m/report/image/${im.id}?${q}`}
                    alt={im.caption || '그림'}
                    loading="lazy"
                    style={{ width: '100%', borderRadius: 8, background: '#fff' }}
                  />
                  <figcaption style={{ ...muted, marginTop: 4 }}>
                    {im.caption}
                    {im.source_label ? ` · 출처: ${im.source_label}` : ''}
                  </figcaption>
                </figure>
              ))}
            </section>
          ))}

        {c.appendix.citations.length > 0 && (
          <section style={card}>
            <h2 style={h2}>출처</h2>
            <ol
              style={{
                margin: 0,
                paddingLeft: 0,
                listStyle: 'none',
                fontSize: 13,
                lineHeight: 1.7,
              }}
            >
              {c.appendix.citations.map((x) => (
                <li key={x.id}>
                  <span style={{ color: GOLD, marginRight: 4 }}>[{x.no}]</span>
                  {x.url ? (
                    <a href={x.url} target="_blank" rel="noreferrer" style={{ color: NAVY }}>
                      {x.title}
                    </a>
                  ) : (
                    x.title
                  )}
                  <span style={muted}> {[x.press, x.date].filter(Boolean).join(' · ')}</span>
                </li>
              ))}
            </ol>
          </section>
        )}
        {c.appendix.glossary.length > 0 && (
          <section style={card}>
            <h2 style={h2}>용어 풀이</h2>
            {c.appendix.glossary.map((g) => (
              <p key={g.term} style={{ ...para, fontSize: 14 }}>
                <b>{g.term}</b> — {g.desc}
              </p>
            ))}
          </section>
        )}

        <section style={{ ...card, background: NAVY, color: '#fff' }}>
          <div style={{ fontSize: 14, lineHeight: 1.7 }}>
            궁금하신 점은 담당자에게 편하게 연락 주세요.
            <div style={{ color: GOLD, marginTop: 4 }}>{data.contact || 'Dr.GM Family Office'}</div>
          </div>
          <a
            href={`${API_URL}/api/v1/company-report/m/report/pdf?${q}`}
            style={{
              display: 'block',
              textAlign: 'center',
              marginTop: 14,
              padding: '11px 0',
              borderRadius: 10,
              background: GOLD,
              color: '#fff',
              fontWeight: 700,
              textDecoration: 'none',
            }}
          >
            PDF로 저장하기
          </a>
        </section>
        <p style={{ ...muted, fontSize: 11, lineHeight: 1.6, marginTop: 14 }}>
          {c.appendix.disclaimer}
        </p>
      </div>
    </main>
  );
}

export default MobileReportPage;
