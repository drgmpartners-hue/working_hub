'use client';

/**
 * 자료함 — 반기 보고서 재료 (기획 6장 '자료 읽기', P4-2).
 * 기업DB 03_자료에 올린 문서를 시스템이 읽어 글·그림을 꺼내고 AI 가 종류·요약·핵심 사실을 적는다.
 * 담당자는 보고서에 쓸지, 공개 자료(부록에 링크)인지 정한다.
 * 자료 날짜(2026-10-08): AI 가 문서 속 작성일·기준일을 찾아 채우고 담당자가 고친다. 반기 보고서는 자료 날짜
 * (없으면 올린 날)가 그 반기 끝 이전인 자료만 쓴다.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Card } from '@/components/common/Card';
import {
  ErrorBox,
  SectionTitle,
  Spinner,
  fmtDate,
  inputStyle,
  mutedText,
} from '@/components/company-report/ui';
import { crBlob, crGet, crPatch, crPost, crUpload } from '@/lib/companyReportApi';
import { halfLabel, halfOf } from '@/lib/halfPeriod';

interface Doc {
  id: string;
  file_id: string;
  filename: string;
  display_name: string | null;
  file_type: string;
  size: number;
  page_count: number | null;
  extract_status: 'pending' | 'done' | 'failed' | 'unsupported';
  extract_method: string | null;
  extract_error: string | null;
  text_chars: number;
  image_count: number;
  doc_type: string | null;
  doc_type_label: string | null;
  ai_memo: string | null;
  ai_facts: string[];
  has_personal_investment: boolean;
  use_in_report: boolean;
  is_public: boolean;
  /** 자료 날짜(YYYY-MM-DD) — AI 가 찾았거나(ai) 담당자가 고친 값(manual). 없으면 올린 날 기준 */
  doc_date?: string | null;
  doc_date_source?: 'ai' | 'manual' | null;
  created_at: string | null;
}

/** 이 자료가 어느 반기 자료로 쓰이는지(자료 날짜, 없으면 올린 날) */
function docPeriod(d: Doc): { date: string; label: string; guessed: boolean } {
  const date = d.doc_date || (d.created_at || '').slice(0, 10);
  const h = halfOf(date);
  return { date, label: h ? `${halfLabel(h.year, h.half)} 자료` : '', guessed: !d.doc_date };
}

const STATUS: Record<Doc['extract_status'], { label: string; cls: string }> = {
  pending: { label: '읽는 중', cls: 'info' },
  done: { label: '읽기 완료', cls: 'pos' },
  failed: { label: '읽기 실패', cls: 'neg' },
  unsupported: { label: '지원 안 함', cls: 'warn' },
};
const ACCEPT = '.pdf,.docx,.pptx,.hwpx,.hwp,.ppt,.xlsx,.csv,.md,.txt';

function kb(n: number) {
  return n >= 1024 * 1024
    ? `${(n / 1024 / 1024).toFixed(1)}MB`
    : `${Math.max(1, Math.round(n / 1024))}KB`;
}

function Images({ doc }: { doc: Doc }) {
  const [urls, setUrls] = useState<string[] | null>(null);
  const made = useRef<string[]>([]);
  useEffect(() => {
    let alive = true;
    (async () => {
      const out: string[] = [];
      for (let i = 0; i < Math.min(doc.image_count, 12); i++) {
        try {
          const { blob } = await crBlob(`/documents/${doc.id}/images/${i}`);
          out.push(URL.createObjectURL(blob));
        } catch {
          /* 한 장 실패는 건너뜀 */
        }
      }
      made.current = out;
      if (alive) setUrls(out);
    })();
    return () => {
      alive = false;
      made.current.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [doc.id, doc.image_count]);
  if (!urls) return <Spinner label="그림 불러오는 중" />;
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
      {urls.map((u, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={u}
          src={u}
          alt={`${doc.filename} 그림 ${i + 1}`}
          style={{ height: 90, borderRadius: 6, border: '1px solid var(--border)' }}
        />
      ))}
      {doc.image_count > 12 && <span style={mutedText}>외 {doc.image_count - 12}장</span>}
    </div>
  );
}

export function DocumentsPanel({ companyId }: { companyId: string }) {
  const [items, setItems] = useState<Doc[] | null>(null);
  const [types, setTypes] = useState<Record<string, string>>({});
  const [canEdit, setCanEdit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [open, setOpen] = useState<Record<string, 'text' | 'images' | undefined>>({});
  const [texts, setTexts] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  // tick 을 올리면 다시 불러온다(올리기·다시 읽기 뒤, 읽는 중일 때 4초마다)
  const [tick, setTick] = useState(0);
  const load = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let alive = true;
    crGet<{ items: Doc[]; doc_types: Record<string, string>; can_edit: boolean }>(
      `/companies/${companyId}/documents`,
    )
      .then((r) => {
        if (!alive) return;
        setItems(r.items);
        setTypes(r.doc_types || {});
        setCanEdit(!!r.can_edit);
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [companyId, tick]);

  const pending = (items || []).some((d) => d.extract_status === 'pending');
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(load, 4000);
    return () => clearTimeout(t);
  }, [pending, items, load]);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    setError(null);
    let ok = 0;
    for (const f of Array.from(files)) {
      const form = new FormData();
      form.append('file', f);
      form.append('company_id', companyId);
      form.append('folder', 'docs');
      try {
        await crUpload('/db/files', form);
        ok++;
      } catch (e) {
        setError(`${f.name}: ${(e as Error).message}`);
      }
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = '';
    if (ok) {
      setNotice(`${ok}개 자료를 올렸습니다. 글·그림을 읽고 AI 메모를 다는 데 몇십 초 걸립니다.`);
      load();
    }
  };

  const patch = async (
    d: Doc,
    body: Partial<Pick<Doc, 'use_in_report' | 'is_public' | 'doc_type' | 'doc_date'>>,
  ) => {
    try {
      const u = await crPatch<Doc>(`/documents/${d.id}`, body);
      setItems((xs) => (xs || []).map((x) => (x.id === d.id ? { ...x, ...u } : x)));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const reparse = async (d: Doc) => {
    try {
      await crPost(`/documents/${d.id}/reparse`);
      setItems((xs) =>
        (xs || []).map((x) => (x.id === d.id ? { ...x, extract_status: 'pending' } : x)),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const toggle = async (d: Doc, what: 'text' | 'images') => {
    const next = open[d.id] === what ? undefined : what;
    setOpen((o) => ({ ...o, [d.id]: next }));
    if (next === 'text' && texts[d.id] === undefined) {
      try {
        const r = await crGet<{ text: string }>(`/documents/${d.id}/text`);
        setTexts((t) => ({ ...t, [d.id]: r.text }));
      } catch (e) {
        setError((e as Error).message);
      }
    }
  };

  const used = (items || []).filter((d) => d.use_in_report && d.extract_status === 'done').length;

  return (
    <Card padding={16}>
      <SectionTitle
        right={
          canEdit && (
            <>
              <input
                ref={fileRef}
                type="file"
                multiple
                accept={ACCEPT}
                hidden
                onChange={(e) => void upload(e.target.files)}
              />
              <button
                type="button"
                className="wh-btn wh-btn-primary wh-btn-sm"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
              >
                {uploading ? '올리는 중…' : '+ 자료 올리기'}
              </button>
            </>
          )
        }
      >
        자료함 — 보고서 재료 {items ? `(${used}/${items.length} 사용)` : ''}
      </SectionTitle>
      <div style={{ ...mutedText, fontSize: 12, marginTop: -4, marginBottom: 10, lineHeight: 1.7 }}>
        IR 자료·재무제표·주주명부·투자사 보고서 등을 올리면 글과 그림을 읽어 반기 보고서에 씁니다.
        기업 폴더의 03_자료와 같은 곳입니다.
        <br />
        읽는 형식: PDF·워드(docx)·파워포인트(pptx·ppt)·한글(hwpx·hwp)·엑셀(xlsx)·csv·md·txt. 옛
        워드(doc)·엑셀(xls)은 새 형식으로 저장해 올려 주세요. 한글(hwp)·옛 파워포인트(ppt)는 글자
        위주로 읽으니, 표·그림이 중요하면 PDF 나 hwpx·pptx 로 올리는 편이 정확합니다.
        <br />
        고객 개인의 투자 금액·지분이 담긴 자료는 표시가 붙고, 보고서에는 그 내용을 쓰지 않습니다.
        <br />
        <b>자료 날짜</b>: 반기 보고서는 자료 날짜가 그 반기 끝 이전인 자료만 씁니다(예: 2026 상반기 보고서 → 6/30 이전 자료).
        AI 가 문서 속 작성일·기준일을 찾아 채우고, 못 찾으면 올린 날로 보니 &lsquo;확인 필요&rsquo; 자료는 날짜를 넣어 주세요.
      </div>
      <ErrorBox message={error} />
      {notice && (
        <div style={{ ...mutedText, color: 'var(--success)', marginBottom: 8 }}>{notice}</div>
      )}
      {!items ? (
        <Spinner />
      ) : items.length === 0 ? (
        <div style={{ ...mutedText, padding: '20px 0', textAlign: 'center' }}>
          아직 올린 자료가 없습니다.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {items.map((d) => {
            const st = STATUS[d.extract_status] || STATUS.pending;
            return (
              <div
                key={d.id}
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: 10,
                  padding: 12,
                  opacity: d.use_in_report ? 1 : 0.6,
                }}
              >
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <strong style={{ fontSize: 14, color: 'var(--text-primary)' }}>
                    {d.filename}
                  </strong>
                  <span className={`wh-badge ${st.cls}`}>{st.label}</span>
                  {d.doc_type_label && <span className="wh-badge">{d.doc_type_label}</span>}
                  {d.has_personal_investment && (
                    <span
                      className="wh-badge warn"
                      title="고객 개인의 투자 금액·지분이 들어 있어 보고서에는 그 부분을 쓰지 않습니다"
                    >
                      고객 개인 투자 정보 포함
                    </span>
                  )}
                  <span style={{ ...mutedText, fontSize: 12 }}>
                    {d.file_type.toUpperCase()} · {kb(d.size)}
                    {d.page_count
                      ? ` · ${d.page_count}${d.file_type === 'pptx' || d.file_type === 'ppt' ? '장' : d.file_type === 'xlsx' ? '시트' : '쪽'}`
                      : ''}
                    {d.extract_status === 'done'
                      ? ` · 글 ${d.text_chars.toLocaleString()}자 · 그림 ${d.image_count}장`
                      : ''}
                    {d.extract_method === 'claude_pdf' ? ' · 스캔본(AI 로 읽음)' : ''} ·{' '}
                    {fmtDate(d.created_at)}
                  </span>
                </div>
                {d.extract_status !== 'pending' && (() => {
                  const p = docPeriod(d);
                  return (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 6, fontSize: 12 }}>
                      <span style={{ color: 'var(--text-secondary)' }}>자료 날짜</span>
                      {canEdit ? (
                        <input
                          type="date"
                          aria-label={`${d.filename} 자료 날짜`}
                          value={d.doc_date || ''}
                          max={new Date().toISOString().slice(0, 10)}
                          onChange={(e) => void patch(d, { doc_date: e.target.value || null })}
                          style={{ ...inputStyle, width: 'auto', padding: '2px 6px', fontSize: 12 }}
                        />
                      ) : (
                        <b>{d.doc_date || '-'}</b>
                      )}
                      {p.label && <span className="wh-badge">{p.label}</span>}
                      {p.guessed ? (
                        <span className="wh-badge warn" title="문서에서 날짜를 찾지 못해 올린 날로 봅니다. 문서의 작성일·기준일을 넣어 주세요">
                          확인 필요 · 올린 날({p.date}) 기준
                        </span>
                      ) : (
                        <span style={{ ...mutedText, fontSize: 11 }}>
                          {d.doc_date_source === 'manual' ? '담당자 입력' : 'AI 가 문서에서 찾음'}
                        </span>
                      )}
                    </div>
                  );
                })()}
                {d.extract_error && (
                  <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 6 }}>
                    {d.extract_error}
                  </div>
                )}
                {d.ai_memo && (
                  <div
                    style={{
                      fontSize: 13,
                      color: 'var(--text-secondary)',
                      marginTop: 8,
                      whiteSpace: 'pre-line',
                    }}
                  >
                    {d.ai_memo}
                  </div>
                )}
                {d.ai_facts.length > 0 && (
                  <ul
                    style={{
                      margin: '6px 0 0',
                      paddingLeft: 18,
                      fontSize: 12,
                      color: 'var(--text-muted)',
                    }}
                  >
                    {d.ai_facts.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                )}
                <div
                  style={{
                    display: 'flex',
                    gap: 10,
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    marginTop: 10,
                    fontSize: 13,
                  }}
                >
                  {(d.extract_status === 'done' || d.extract_status === 'pending') && (
                    <>
                      <label
                        style={{
                          display: 'flex',
                          gap: 4,
                          alignItems: 'center',
                          cursor: canEdit ? 'pointer' : 'default',
                        }}
                      >
                        <input
                          type="checkbox"
                          disabled={!canEdit}
                          checked={d.use_in_report}
                          onChange={(e) => void patch(d, { use_in_report: e.target.checked })}
                        />
                        보고서에 사용
                      </label>
                      <label
                        style={{
                          display: 'flex',
                          gap: 4,
                          alignItems: 'center',
                          cursor: canEdit ? 'pointer' : 'default',
                        }}
                        title="공개 자료면 보고서 부록에 이름과 함께 실립니다. 내부 자료는 이름만 적습니다"
                      >
                        <input
                          type="checkbox"
                          disabled={!canEdit}
                          checked={d.is_public}
                          onChange={(e) => void patch(d, { is_public: e.target.checked })}
                        />
                        공개 자료
                      </label>
                    </>
                  )}
                  {canEdit && (
                    <select
                      aria-label="자료 종류"
                      value={d.doc_type || ''}
                      onChange={(e) => void patch(d, { doc_type: e.target.value })}
                      style={{ ...inputStyle, width: 'auto', padding: '4px 8px', fontSize: 12 }}
                    >
                      <option value="" disabled>
                        종류 선택
                      </option>
                      {Object.entries(types).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  )}
                  <span style={{ flex: 1 }} />
                  {d.text_chars > 0 && (
                    <button
                      type="button"
                      className="wh-btn wh-btn-ghost wh-btn-sm"
                      onClick={() => void toggle(d, 'text')}
                    >
                      {open[d.id] === 'text' ? '글 닫기' : '읽은 글 보기'}
                    </button>
                  )}
                  {d.image_count > 0 && (
                    <button
                      type="button"
                      className="wh-btn wh-btn-ghost wh-btn-sm"
                      onClick={() => void toggle(d, 'images')}
                    >
                      {open[d.id] === 'images' ? '그림 닫기' : `그림 ${d.image_count}장`}
                    </button>
                  )}
                  {canEdit &&
                    d.extract_status !== 'pending' &&
                    d.extract_status !== 'unsupported' && (
                      <button
                        type="button"
                        className="wh-btn wh-btn-ghost wh-btn-sm"
                        onClick={() => void reparse(d)}
                      >
                        다시 읽기
                      </button>
                    )}
                </div>
                {open[d.id] === 'text' && (
                  <pre
                    style={{
                      marginTop: 8,
                      maxHeight: 280,
                      overflow: 'auto',
                      whiteSpace: 'pre-wrap',
                      fontSize: 12,
                      lineHeight: 1.6,
                      background: 'var(--bg-surface)',
                      padding: 10,
                      borderRadius: 8,
                      color: 'var(--text-secondary)',
                    }}
                  >
                    {texts[d.id] ?? '불러오는 중…'}
                  </pre>
                )}
                {open[d.id] === 'images' && <Images doc={d} />}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

export default DocumentsPanel;
