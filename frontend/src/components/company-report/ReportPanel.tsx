'use client';

/**
 * 기업 상세 > 반기 보고서 (기획 6장, P4-5 화면 1차).
 * [보고서 만들기] → 진행 상황 → 본문(한 장 요약·10개 항목·부록), 문장별 출처 번호, 검토에서 '확인 필요'로 남은 문장,
 * 그림(차트·자료 그림), 영업 대화 노트(내부용). 편집·버전 비교·PDF/DOCX 출력·고객 발송은 다음 단계(P4-7·9·10).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card } from '@/components/common/Card';
import {
  ErrorBox,
  SectionTitle,
  Spinner,
  fmtDate,
  inputStyle,
  mutedText,
} from '@/components/company-report/ui';
import { crBlob, crGet, crPost } from '@/lib/companyReportApi';

interface Sent {
  id: string;
  text: string;
  source_ids: string[];
  kind?: 'fact' | 'analysis';
  date?: string;
  disputed?: boolean;
  review_note?: string;
}
interface Row {
  id: string;
  cells: string[];
  source_ids: string[];
  note?: string;
  disputed?: boolean;
  review_note?: string;
}
type Block =
  | { type: 'para'; items: Sent[] }
  | { type: 'timeline'; items: Sent[] }
  | { type: 'table'; columns: string[]; rows: Row[] };
interface Section {
  no: number;
  title: string;
  blocks: Block[];
}
interface Source {
  no: number;
  title?: string;
  url?: string | null;
  date?: string;
  press?: string;
  type?: string;
}
interface Img {
  id: string;
  section_no: number | null;
  kind: string;
  caption: string | null;
  source_label: string | null;
  rights_note: string | null;
  selected: boolean;
}
interface Brief {
  id: string;
  period_year: number;
  period_half: number;
  period_label: string;
  version: number;
  status: 'generating' | 'draft' | 'final' | 'failed';
  progress: number;
  progress_step: string | null;
  owner_name: string | null;
  error: string | null;
  as_of_date: string | null;
  created_at: string | null;
}
interface Full extends Brief {
  content: {
    cover: { company: string; period: string; as_of: string; brand: string };
    summary: {
      three_lines: Sent[];
      changes: Sent[];
      stage: string | null;
      stage_note: Sent | null;
    };
    sections: Section[];
    appendix: {
      citations: {
        no: number;
        id: string;
        title?: string;
        press?: string;
        date?: string;
        url?: string | null;
      }[];
      articles: { title: string; press?: string; date?: string; url?: string }[];
      dart: { title: string; date?: string; url?: string }[];
      funding_sources: {
        round?: string;
        date?: string;
        links: { title?: string; url: string }[];
      }[];
      documents: { name: string; type?: string; is_public: boolean }[];
      glossary: { term: string; desc: string }[];
      verification: {
        total?: number;
        removed?: number;
        disputed?: number;
        review_ok?: boolean;
        source_count?: number;
        as_of?: string;
      };
      disclaimer: string;
    };
  } | null;
  sources: Record<string, Source> | null;
  review: {
    summary?: { total: number; removed: number; disputed: number; review_ok: boolean };
  } | null;
  sales_note: { key_messages: string[]; qa: { q: string; a: string }[]; careful: string[] } | null;
  images: Img[];
}

const STAGES = ['개발', '출시', '매출 발생', '흑자', '상장 준비', '상장'];
const STATUS: Record<Brief['status'], { label: string; cls: string }> = {
  generating: { label: '만드는 중', cls: 'info' },
  draft: { label: '검토 중', cls: 'warn' },
  final: { label: '검토 완료', cls: 'pos' },
  failed: { label: '실패', cls: 'neg' },
};

function halves(): { year: number; half: number; label: string }[] {
  const now = new Date();
  const y = now.getFullYear();
  const out = [];
  // 가장 최근에 끝난 반기부터 4개
  let cy = now.getMonth() >= 6 ? y : y - 1;
  let ch = now.getMonth() >= 6 ? 1 : 2;
  for (let i = 0; i < 4; i++) {
    out.push({ year: cy, half: ch, label: `${cy}년 ${ch === 1 ? '상반기' : '하반기'}` });
    if (ch === 1) {
      cy -= 1;
      ch = 2;
    } else ch = 1;
  }
  return out;
}

function Cite({ ids, sources }: { ids: string[]; sources: Record<string, Source> }) {
  const nums = ids.map((i) => sources[i]).filter(Boolean) as Source[];
  if (!nums.length) return null;
  return (
    <sup style={{ marginLeft: 2, fontSize: 10, color: 'var(--text-muted)' }}>
      {nums.map((s, k) => (
        <span key={k} title={[s.title, s.press, s.date].filter(Boolean).join(' · ')}>
          {s.url ? (
            <a href={s.url} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>
              [{s.no}]
            </a>
          ) : (
            `[${s.no}]`
          )}
        </span>
      ))}
    </sup>
  );
}

const disputedStyle: React.CSSProperties = {
  background: 'var(--warning-bg)',
  borderRadius: 4,
  padding: '0 3px',
};

function SentText({ s, sources }: { s: Sent; sources: Record<string, Source> }) {
  return (
    <span
      style={s.disputed ? disputedStyle : undefined}
      title={s.disputed ? `확인 필요: ${s.review_note || '교차 검토 의견 불일치'}` : undefined}
    >
      {s.kind === 'analysis' && (
        <span className="wh-badge" style={{ fontSize: 10, marginRight: 4, padding: '0 6px' }}>
          분석
        </span>
      )}
      {s.text}
      <Cite ids={s.source_ids} sources={sources} />
    </span>
  );
}

function useImageUrls(images: Img[]) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const made = useRef<string[]>([]);
  const key = images.map((i) => i.id).join(',');
  useEffect(() => {
    let alive = true;
    (async () => {
      const out: Record<string, string> = {};
      for (const im of images) {
        try {
          const { blob } = await crBlob(`/report-images/${im.id}/file`);
          out[im.id] = URL.createObjectURL(blob);
        } catch {
          /* 건너뜀 */
        }
      }
      made.current = Object.values(out);
      if (alive) setUrls(out);
    })();
    return () => {
      alive = false;
      made.current.forEach((u) => URL.revokeObjectURL(u));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return urls;
}

function Figure({ im, url }: { im: Img; url?: string }) {
  return (
    <figure style={{ margin: '12px 0', textAlign: 'center' }}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={im.caption || '그림'}
          style={{ maxWidth: '100%', maxHeight: 360, borderRadius: 6, background: '#fff' }}
        />
      ) : (
        <Spinner />
      )}
      <figcaption style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
        {im.caption} {im.source_label ? `· 출처: ${im.source_label}` : ''}
        {im.rights_note ? ` · ${im.rights_note}` : ''}
      </figcaption>
    </figure>
  );
}

function ReportView({ r }: { r: Full }) {
  const c = r.content!;
  const sources = r.sources || {};
  const selected = r.images.filter((i) => i.selected);
  const urls = useImageUrls(selected);
  const imgsBy = useMemo(() => {
    const m: Record<number, Img[]> = {};
    selected.forEach((i) => {
      const k = i.section_no || 0;
      (m[k] = m[k] || []).push(i);
    });
    return m;
  }, [selected]);
  const [showNote, setShowNote] = useState(false);
  const rs = r.review?.summary;
  const stageIdx = c.summary.stage ? STAGES.indexOf(c.summary.stage) : -1;
  const th: React.CSSProperties = {
    textAlign: 'left',
    padding: '6px 8px',
    fontSize: 12,
    color: 'var(--text-muted)',
    borderBottom: '1px solid var(--border)',
  };
  const td: React.CSSProperties = {
    padding: '6px 8px',
    fontSize: 13,
    borderBottom: '1px solid var(--border-soft)',
    verticalAlign: 'top',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {rs && (
        <div
          role="status"
          style={{
            padding: '10px 14px',
            borderRadius: 10,
            border: '1px solid var(--border)',
            fontSize: 13,
            color: 'var(--text-secondary)',
          }}
        >
          교차 검토: 문장 {rs.total}개 중 삭제 {rs.removed}개 ·{' '}
          <b style={{ color: rs.disputed ? 'var(--warning)' : undefined }}>
            확인 필요 {rs.disputed}개
          </b>
          {rs.disputed ? ' (노란색 표시 — 마우스를 올리면 검토 의견이 보입니다)' : ''}
          {rs.review_ok === false ? ' · 2차 검토가 끝나지 않은 묶음이 있습니다' : ''}
        </div>
      )}

      <Card padding={20}>
        <div style={{ ...mutedText, fontSize: 12 }}>{c.cover.brand}</div>
        <h3 style={{ margin: '4px 0', fontSize: 20, color: 'var(--text-primary)' }}>
          {c.cover.company} {c.cover.period} 기업 종합보고서
        </h3>
        <div style={{ ...mutedText, fontSize: 12 }}>
          기준일 {c.cover.as_of} · v{r.version}
        </div>
        <div style={{ marginTop: 14 }}>
          <SectionTitle>한 장 요약</SectionTitle>
          <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.8 }}>
            {c.summary.three_lines.map((s) => (
              <li key={s.id}>
                <SentText s={s} sources={sources} />
              </li>
            ))}
          </ul>
          {c.summary.changes.length > 0 && (
            <>
              <div style={{ ...mutedText, marginTop: 10, fontWeight: 600 }}>
                지난 보고서 이후 달라진 점
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.8 }}>
                {c.summary.changes.map((s) => (
                  <li key={s.id}>
                    <SentText s={s} sources={sources} />
                  </li>
                ))}
              </ul>
            </>
          )}
          {stageIdx >= 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {STAGES.map((st, i) => (
                  <span
                    key={st}
                    className={`wh-badge ${i === stageIdx ? 'pos' : ''}`}
                    style={{ opacity: i <= stageIdx ? 1 : 0.45 }}
                  >
                    {st}
                  </span>
                ))}
              </div>
              {c.summary.stage_note && (
                <div style={{ fontSize: 13, marginTop: 6 }}>
                  <SentText s={c.summary.stage_note} sources={sources} />
                </div>
              )}
            </div>
          )}
        </div>
      </Card>

      {c.sections.map((sec) => (
        <Card key={sec.no} padding={20}>
          <SectionTitle>
            {sec.no}. {sec.title}
          </SectionTitle>
          {sec.blocks.length === 0 && !(imgsBy[sec.no] || []).length && (
            <div style={mutedText}>이 항목은 확인된 자료가 없어 쓰지 않았습니다.</div>
          )}
          {sec.blocks.map((blk, bi) =>
            blk.type === 'para' ? (
              <p key={bi} style={{ margin: '0 0 10px', lineHeight: 1.85, fontSize: 14 }}>
                {blk.items.map((s) => (
                  <span key={s.id}>
                    <SentText s={s} sources={sources} />{' '}
                  </span>
                ))}
              </p>
            ) : blk.type === 'timeline' ? (
              <ul
                key={bi}
                style={{ margin: '0 0 10px', paddingLeft: 18, lineHeight: 1.8, fontSize: 14 }}
              >
                {blk.items.map((s) => (
                  <li key={s.id}>
                    <b style={{ marginRight: 6, color: 'var(--text-muted)' }}>{s.date}</b>
                    <SentText s={s} sources={sources} />
                  </li>
                ))}
              </ul>
            ) : (
              <div key={bi} style={{ overflowX: 'auto', marginBottom: 10 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      {blk.columns.map((col) => (
                        <th key={col} style={th}>
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {blk.rows.map((row) => (
                      <tr
                        key={row.id}
                        style={row.disputed ? { background: 'var(--warning-bg)' } : undefined}
                        title={row.review_note || undefined}
                      >
                        {row.cells.map((cell, ci) => (
                          <td key={ci} style={td}>
                            {cell}
                            {ci === row.cells.length - 1 && (
                              <Cite ids={row.source_ids} sources={sources} />
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {blk.rows.some((x) => x.note) && (
                  <div style={{ ...mutedText, fontSize: 11, marginTop: 4 }}>
                    {blk.rows
                      .filter((x) => x.note)
                      .map((x) => x.note)
                      .join(' · ')}
                  </div>
                )}
              </div>
            ),
          )}
          {(imgsBy[sec.no] || []).map((im) => (
            <Figure key={im.id} im={im} url={urls[im.id]} />
          ))}
        </Card>
      ))}

      <Card padding={20}>
        <SectionTitle>부록</SectionTitle>
        <div style={{ fontSize: 13, lineHeight: 1.8 }}>
          <b>1. 출처 목록</b>
          <ol style={{ margin: '4px 0 10px', paddingLeft: 4, listStyle: 'none' }}>
            {c.appendix.citations.map((x) => (
              <li key={x.id} value={x.no}>
                <span style={{ ...mutedText, marginRight: 4 }}>[{x.no}]</span>
                {x.url ? (
                  <a href={x.url} target="_blank" rel="noreferrer">
                    {x.title}
                  </a>
                ) : (
                  x.title
                )}
                <span style={mutedText}> {[x.press, x.date].filter(Boolean).join(' · ')}</span>
              </li>
            ))}
          </ol>
          {c.appendix.articles.length > 0 && (
            <>
              <b>2. 이번 반기 주요 기사</b>
              <ul style={{ margin: '4px 0 10px', paddingLeft: 18 }}>
                {c.appendix.articles.map((a, i) => (
                  <li key={i}>
                    <span style={mutedText}>{a.date} </span>
                    {a.url ? (
                      <a href={a.url} target="_blank" rel="noreferrer">
                        {a.title}
                      </a>
                    ) : (
                      a.title
                    )}{' '}
                    <span style={mutedText}>{a.press}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {c.appendix.dart.length > 0 && (
            <>
              <b>3. DART 공시</b>
              <ul style={{ margin: '4px 0 10px', paddingLeft: 18 }}>
                {c.appendix.dart.map((a, i) => (
                  <li key={i}>
                    <span style={mutedText}>{a.date} </span>
                    {a.url ? (
                      <a href={a.url} target="_blank" rel="noreferrer">
                        {a.title}
                      </a>
                    ) : (
                      a.title
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
          {c.appendix.documents.length > 0 && (
            <>
              <b>5. 참고 자료</b>
              <ul style={{ margin: '4px 0 10px', paddingLeft: 18 }}>
                {c.appendix.documents.map((d, i) => (
                  <li key={i}>
                    {d.name}{' '}
                    <span style={mutedText}>
                      {d.is_public ? '공개 자료' : '회사 제공 자료(비공개)'}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {c.appendix.glossary.length > 0 && (
            <>
              <b>6. 용어 풀이</b>
              <ul style={{ margin: '4px 0 10px', paddingLeft: 18 }}>
                {c.appendix.glossary.map((g) => (
                  <li key={g.term}>
                    <b>{g.term}</b>: {g.desc}
                  </li>
                ))}
              </ul>
            </>
          )}
          <b>7. 검증 요약</b>
          <div style={{ margin: '4px 0 10px' }}>
            문장 {c.appendix.verification.total ?? '-'}개 · 출처{' '}
            {c.appendix.verification.source_count ?? '-'}개 · 교차 검토(Gemini → Claude) 후 삭제{' '}
            {c.appendix.verification.removed ?? 0}개 · 확인 필요{' '}
            {c.appendix.verification.disputed ?? 0}개 · 기준일 {c.appendix.verification.as_of}
          </div>
          <b>8. 면책 문구</b>
          <div style={{ ...mutedText, margin: '4px 0 0' }}>{c.appendix.disclaimer}</div>
        </div>
      </Card>

      {r.sales_note && (
        <Card padding={20}>
          <SectionTitle
            right={
              <button
                type="button"
                className="wh-btn wh-btn-ghost wh-btn-sm"
                onClick={() => setShowNote((v) => !v)}
              >
                {showNote ? '접기' : '펼치기'}
              </button>
            }
          >
            영업 대화 노트 (내부용 — 고객에게 보내지 않음)
          </SectionTitle>
          {showNote && (
            <div style={{ fontSize: 13, lineHeight: 1.8 }}>
              <b>핵심 메시지</b>
              <ol style={{ margin: '4px 0 10px', paddingLeft: 20 }}>
                {r.sales_note.key_messages.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ol>
              <b>예상 질문과 답</b>
              <ul style={{ margin: '4px 0 10px', paddingLeft: 18 }}>
                {r.sales_note.qa.map((q) => (
                  <li key={q.q}>
                    <b>Q.</b> {q.q}
                    <br />
                    <b>A.</b> {q.a}
                  </li>
                ))}
              </ul>
              <b>조심할 표현</b>
              <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                {r.sales_note.careful.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

export function ReportPanel({ companyId }: { companyId: string }) {
  const [list, setList] = useState<Brief[] | null>(null);
  const [selId, setSelId] = useState<string>('');
  const [full, setFull] = useState<Full | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const options = useMemo(halves, []);
  const [pick, setPick] = useState(`${options[0].year}-${options[0].half}`);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let alive = true;
    crGet<Brief[]>(`/companies/${companyId}/reports`)
      .then((rows) => {
        if (!alive) return;
        setList(rows);
        setSelId((cur) => (cur && rows.some((x) => x.id === cur) ? cur : rows[0]?.id || ''));
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [companyId, tick]);

  const sel = list?.find((x) => x.id === selId) || null;
  useEffect(() => {
    if (!sel || sel.status === 'generating' || sel.status === 'failed') return;
    let alive = true;
    crGet<Full>(`/reports/${sel.id}`)
      .then((r) => alive && setFull(r))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [sel?.id, sel?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // 만드는 중이면 5초마다 진행 상황을 다시 본다
  const generating = (list || []).some((x) => x.status === 'generating');
  useEffect(() => {
    if (!generating) return;
    const t = setTimeout(reload, 5000);
    return () => clearTimeout(t);
  }, [generating, list, reload]);

  const create = async () => {
    const [year, half] = pick.split('-').map(Number);
    if (
      !window.confirm(
        `${year}년 ${half === 1 ? '상반기' : '하반기'} 보고서를 만들까요? 자료 수집·웹 확인·교차 검토까지 수 분 걸리고 AI 비용이 듭니다.`,
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      const r = await crPost<Brief>(`/companies/${companyId}/reports`, { year, half });
      setSelId(r.id);
      reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Card padding={16}>
        <SectionTitle
          right={
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <select
                aria-label="반기 선택"
                value={pick}
                onChange={(e) => setPick(e.target.value)}
                style={{ ...inputStyle, width: 'auto', padding: '6px 10px' }}
              >
                {options.map((o) => (
                  <option key={`${o.year}-${o.half}`} value={`${o.year}-${o.half}`}>
                    {o.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="wh-btn wh-btn-primary wh-btn-sm"
                disabled={busy || generating}
                onClick={() => void create()}
              >
                {generating ? '만드는 중…' : '보고서 만들기'}
              </button>
            </div>
          }
        >
          반기 기업 종합보고서
        </SectionTitle>
        <div style={{ ...mutedText, fontSize: 12, marginTop: -4 }}>
          자료함·기업 원장·투자유치·월간 요약·기사·웹 검색으로 10개 항목과 부록을 쓰고, Gemini 와
          Claude 가 문장마다 출처와 대조합니다. 검토에서 의견이 갈린 문장은 노란색으로 남겨 담당자가
          확인합니다. 대표 승인 없이 담당자가 검토·출력합니다.
        </div>
        <ErrorBox message={error} />
        {list && list.length > 0 && (
          <div
            style={{
              display: 'flex',
              gap: 8,
              alignItems: 'center',
              flexWrap: 'wrap',
              marginTop: 10,
            }}
          >
            <select
              aria-label="보고서 버전"
              value={selId}
              onChange={(e) => setSelId(e.target.value)}
              style={{ ...inputStyle, width: 'auto', padding: '6px 10px' }}
            >
              {list.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.period_label} v{x.version}
                  {x.owner_name ? ` (${x.owner_name} 수정본)` : ''} · {STATUS[x.status]?.label}
                </option>
              ))}
            </select>
            {sel && (
              <span className={`wh-badge ${STATUS[sel.status]?.cls}`}>
                {STATUS[sel.status]?.label}
              </span>
            )}
            {sel && (
              <span style={{ ...mutedText, fontSize: 12 }}>{fmtDate(sel.created_at, true)}</span>
            )}
          </div>
        )}
      </Card>

      {list === null ? (
        <Spinner />
      ) : list.length === 0 ? (
        <Card padding={24}>
          <div style={{ ...mutedText, textAlign: 'center' }}>
            아직 만든 보고서가 없습니다. 반기를 고르고 [보고서 만들기]를 누르세요.
          </div>
        </Card>
      ) : sel?.status === 'generating' ? (
        <Card padding={20}>
          <div style={{ fontSize: 14, marginBottom: 8 }}>{sel.progress_step || '준비 중'}…</div>
          <div
            style={{
              height: 8,
              background: 'var(--bg-surface)',
              borderRadius: 4,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${sel.progress}%`,
                height: '100%',
                background: 'var(--accent, #3b82f6)',
                transition: 'width .5s',
              }}
            />
          </div>
          <div style={{ ...mutedText, fontSize: 12, marginTop: 6 }}>
            {sel.progress}% · 다른 화면으로 가도 계속 만들어집니다.
          </div>
        </Card>
      ) : sel?.status === 'failed' ? (
        <Card padding={20}>
          <div style={{ color: 'var(--danger)', fontSize: 14 }}>
            보고서를 만들지 못했습니다: {sel.error}
          </div>
        </Card>
      ) : full && full.id === selId && full.content ? (
        <ReportView r={full} />
      ) : (
        <Spinner />
      )}
    </div>
  );
}

export default ReportPanel;
