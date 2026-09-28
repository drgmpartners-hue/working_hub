'use client';

/**
 * 투자기업 등록 모달 (기획 3장 F1)
 * 1) 검색 → 후보 카드 → [반영] / [다시 찾기] / [직접 등록]
 * 2) 기본 정보 확인 → 키워드(AI 제안) → 미리보기 → 내부 정보 → 과거 데이터 기간 → 저장
 */
import { useState } from 'react';
import { Modal } from '@/components/common/Modal';
import { crPost } from '@/lib/companyReportApi';
import type { Candidate, Company, KeywordSet, PreviewResult } from './types';
import { ChipEditor, ErrorBox, Field, SectionTitle, Spinner, inputStyle, mutedText } from './ui';

type Step = 'search' | 'form';

interface FormState {
  name: string;
  name_en: string;
  ceo_name: string;
  industry: string;
  established_at: string;
  homepage: string;
  address: string;
  is_listed: boolean;
  stock_code: string;
  corp_code: string;
  biz_reg_no: string;
  profile_source: string;
  invested_at: string;
  invest_type: string;
  memo: string;
}

const EMPTY: FormState = {
  name: '',
  name_en: '',
  ceo_name: '',
  industry: '',
  established_at: '',
  homepage: '',
  address: '',
  is_listed: false,
  stock_code: '',
  corp_code: '',
  biz_reg_no: '',
  profile_source: 'manual',
  invested_at: '',
  invest_type: '',
  memo: '',
};

const nz = (v: string) => (v.trim() ? v.trim() : null);

export function CompanyRegisterModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (c: Company) => void;
}) {
  const [step, setStep] = useState<Step>('search');
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [kw, setKw] = useState<KeywordSet>({ required: [], boost: [], exclude: [] });
  const [kwNote, setKwNote] = useState('');
  const [kwLoading, setKwLoading] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [backfill, setBackfill] = useState(6);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setStep('search');
    setQuery('');
    setSearched(false);
    setCandidates([]);
    setForm(EMPTY);
    setKw({ required: [], boost: [], exclude: [] });
    setKwNote('');
    setPreview(null);
    setBackfill(6);
    setError(null);
  };

  const close = () => {
    reset();
    onClose();
  };

  const search = async () => {
    if (!query.trim()) return;
    setSearching(true);
    setError(null);
    try {
      const res = await crPost<{ candidates: Candidate[]; notice?: string | null }>('/companies/search-candidates', { query: query.trim() });
      setCandidates(res.candidates || []);
      if (res.notice) setError(res.notice);
      setSearched(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSearching(false);
    }
  };

  const suggest = async (f: FormState) => {
    if (!f.name.trim()) return;
    setKwLoading(true);
    try {
      const res = await crPost<KeywordSet & { notes?: string }>('/companies/keyword-suggest', {
        name: f.name.trim(),
        name_en: nz(f.name_en),
        ceo_name: nz(f.ceo_name),
        industry: nz(f.industry),
      });
      setKw({ required: res.required || [], boost: res.boost || [], exclude: res.exclude || [] });
      setKwNote(res.notes || '');
      setPreview(null);
    } catch (e) {
      setKw({ required: [f.name.trim()], boost: f.ceo_name ? [f.ceo_name] : [], exclude: [] });
      setKwNote(`AI 제안 실패: ${(e as Error).message}`);
    } finally {
      setKwLoading(false);
    }
  };

  const apply = (c: Candidate | null) => {
    const f: FormState = c
      ? {
          ...EMPTY,
          name: c.name || '',
          name_en: c.name_en || '',
          ceo_name: c.ceo_name || '',
          industry: c.industry || '',
          established_at: c.established_at || '',
          homepage: c.homepage || '',
          address: c.address || '',
          is_listed: !!c.is_listed,
          stock_code: c.stock_code || '',
          corp_code: c.corp_code || '',
          biz_reg_no: c.biz_reg_no || '',
          profile_source: c.source,
        }
      : { ...EMPTY, name: query.trim() };
    setForm(f);
    setStep('form');
    setError(null);
    if (f.name) void suggest(f);
  };

  const runPreview = async () => {
    if (!kw.required.length) {
      setError('필수어를 1개 이상 넣어 주세요.');
      return;
    }
    setPreviewLoading(true);
    setError(null);
    try {
      setPreview(await crPost<PreviewResult>('/companies/preview-search', { ...kw, days: 7 }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPreviewLoading(false);
    }
  };

  const save = async () => {
    if (!form.name.trim()) {
      setError('기업명을 입력해 주세요.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body = {
        name: form.name.trim(),
        name_en: nz(form.name_en),
        ceo_name: nz(form.ceo_name),
        industry: nz(form.industry),
        established_at: nz(form.established_at),
        homepage: nz(form.homepage),
        address: nz(form.address),
        is_listed: form.is_listed,
        stock_code: nz(form.stock_code),
        corp_code: nz(form.corp_code),
        biz_reg_no: nz(form.biz_reg_no),
        profile_source: form.profile_source,
        search_query: nz(query),
        invested_at: nz(form.invested_at),
        invest_type: nz(form.invest_type),
        memo: nz(form.memo),
        keywords: kw.required.length ? kw : { ...kw, required: [form.name.trim()] },
        backfill_months: backfill,
      };
      const created = await crPost<Company>('/companies', body);
      onCreated(created);
      close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Modal open={open} onClose={close} title="투자기업 등록" maxWidth={760}>
      <ErrorBox message={error} />

      {step === 'search' && (
        <div>
          <p style={{ ...mutedText, marginTop: 0 }}>
            회사명·제품명·대표자명 중 아는 것을 입력하세요. 공시(DART)와 웹에서 후보를 찾아 드립니다.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void search();
            }}
            style={{ display: 'flex', gap: 8, marginBottom: 16 }}
          >
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="예) 뉴로리온, 홍길동 대표"
              aria-label="기업 검색어"
              style={inputStyle}
            />
            <button type="submit" className="wh-btn wh-btn-primary wh-btn-sm" disabled={searching} style={{ flexShrink: 0 }}>
              {searching ? '찾는 중…' : searched ? '다시 찾기' : '찾기'}
            </button>
          </form>

          {searching && <Spinner label="공시·뉴스·웹에서 후보를 찾고 있어요 (공시에 없는 회사는 웹 검색까지 최대 1분)" />}

          {!searching && searched && candidates.length === 0 && (
            <div style={{ ...mutedText, padding: '12px 0' }}>
              후보를 찾지 못했습니다. 검색어를 바꿔 다시 찾거나 직접 등록하세요.
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {candidates.map((c, i) => (
              <div
                key={`${c.corp_code || c.name}-${i}`}
                style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 14, background: 'var(--bg-surface)' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <strong style={{ color: 'var(--text-primary)', fontSize: 15 }}>{c.name}</strong>
                      {c.name_en && <span style={mutedText}>{c.name_en}</span>}
                      <span className={`wh-badge ${c.source === 'dart' ? 'pos' : 'warn'}`}>
                        {c.source === 'dart' ? 'DART 확인' : '웹 검색'}
                      </span>
                      {c.market && <span className="wh-badge info">{c.market}</span>}
                    </div>
                    <div style={{ ...mutedText, marginTop: 6, lineHeight: 1.7 }}>
                      대표 {c.ceo_name || '-'} · 설립 {c.established_at || '-'}
                      {c.stock_code ? ` · 종목코드 ${c.stock_code}` : ''}
                      <br />
                      {c.address || '주소 미확인'}
                      {c.homepage ? ` · ${c.homepage}` : ''}
                    </div>
                    {c.evidence?.length > 0 && (
                      <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12, color: 'var(--text-secondary)' }}>
                        {c.evidence.map((ev) => (
                          <li key={ev.url}>
                            <a href={ev.url} target="_blank" rel="noreferrer" style={{ color: 'var(--cyan-400)' }}>
                              {ev.title}
                            </a>
                            {ev.date ? ` (${ev.date})` : ''}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <button type="button" className="wh-btn wh-btn-primary wh-btn-sm" onClick={() => apply(c)} style={{ flexShrink: 0 }}>
                    반영
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
            <button type="button" className="wh-btn wh-btn-ghost wh-btn-sm" onClick={() => apply(null)}>
              직접 등록
            </button>
          </div>
        </div>
      )}

      {step === 'form' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <section>
            <SectionTitle
              right={
                <button type="button" className="wh-btn wh-btn-ghost wh-btn-sm" onClick={() => setStep('search')}>
                  ← 후보 다시 고르기
                </button>
              }
            >
              기본 정보
            </SectionTitle>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
              <Field label="기업명 *">
                <input style={inputStyle} value={form.name} onChange={(e) => set('name', e.target.value)} />
              </Field>
              <Field label="영문명">
                <input style={inputStyle} value={form.name_en} onChange={(e) => set('name_en', e.target.value)} />
              </Field>
              <Field label="대표자">
                <input style={inputStyle} value={form.ceo_name} onChange={(e) => set('ceo_name', e.target.value)} />
              </Field>
              <Field label="업종">
                <input style={inputStyle} value={form.industry} onChange={(e) => set('industry', e.target.value)} />
              </Field>
              <Field label="설립일">
                <input type="date" style={inputStyle} value={form.established_at} onChange={(e) => set('established_at', e.target.value)} />
              </Field>
              <Field label="홈페이지">
                <input style={inputStyle} value={form.homepage} onChange={(e) => set('homepage', e.target.value)} />
              </Field>
              <Field label="주소" span={2}>
                <input style={inputStyle} value={form.address} onChange={(e) => set('address', e.target.value)} />
              </Field>
              <Field label="상장 여부">
                <select
                  style={inputStyle}
                  value={form.is_listed ? 'Y' : 'N'}
                  onChange={(e) => set('is_listed', e.target.value === 'Y')}
                >
                  <option value="N">비상장</option>
                  <option value="Y">상장</option>
                </select>
              </Field>
              {form.is_listed && (
                <Field label="종목코드">
                  <input style={inputStyle} value={form.stock_code} onChange={(e) => set('stock_code', e.target.value)} />
                </Field>
              )}
            </div>
          </section>

          <section>
            <SectionTitle
              right={
                <button
                  type="button"
                  className="wh-btn wh-btn-ghost wh-btn-sm"
                  disabled={kwLoading}
                  onClick={() => void suggest(form)}
                >
                  {kwLoading ? 'AI 제안 중…' : 'AI로 다시 제안'}
                </button>
              }
            >
              뉴스 검색 키워드
            </SectionTitle>
            {kwNote && <p style={{ ...mutedText, marginTop: 0 }}>{kwNote}</p>}
            <ChipEditor label="필수어" hint="기사에 하나 이상 있어야 수집" values={kw.required} onChange={(v) => setKw({ ...kw, required: v })} tone="info" />
            <ChipEditor label="보조어" hint="있으면 관련도 가점(대표자·제품명)" values={kw.boost} onChange={(v) => setKw({ ...kw, boost: v })} tone="pos" />
            <ChipEditor label="제외어" hint="있으면 제외(동명 회사·동명이인)" values={kw.exclude} onChange={(v) => setKw({ ...kw, exclude: v })} tone="neg" />
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button type="button" className="wh-btn wh-btn-ghost wh-btn-sm" disabled={previewLoading} onClick={() => void runPreview()}>
                {previewLoading ? '확인 중…' : '최근 7일 미리보기'}
              </button>
              {preview && (
                <span style={mutedText}>
                  검색 {preview.count_total}건 중 <strong style={{ color: 'var(--text-primary)' }}>{preview.count_passed}건</strong> 수집 예정
                  {preview.warning ? ` · ${preview.warning}` : ''}
                </span>
              )}
            </div>
            {preview && preview.samples.length > 0 && (
              <ul style={{ listStyle: 'none', padding: 0, margin: '10px 0 0', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {preview.samples.map((s) => (
                  <li key={s.url} style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 13 }}>
                    <span className={`wh-badge ${s.passed ? 'pos' : 'neg'}`}>{s.passed ? '수집' : '제외'}</span>
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}
                      title={s.reason}
                    >
                      {s.title}
                    </a>
                    <span style={{ ...mutedText, fontSize: 12, flexShrink: 0 }}>
                      {s.press || ''} {s.date?.slice(5, 10) || ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <SectionTitle>내부 정보 (선택 · 고객용 보고서에는 쓰지 않음)</SectionTitle>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
              <Field label="투자일">
                <input type="date" style={inputStyle} value={form.invested_at} onChange={(e) => set('invested_at', e.target.value)} />
              </Field>
              <Field label="투자 형태">
                <input style={inputStyle} value={form.invest_type} placeholder="보통주, RCPS, CB …" onChange={(e) => set('invest_type', e.target.value)} />
              </Field>
              <Field label="메모" span={2}>
                <textarea style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }} value={form.memo} onChange={(e) => set('memo', e.target.value)} />
              </Field>
            </div>
          </section>

          <section>
            <SectionTitle>과거 데이터 가져오기</SectionTitle>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {[0, 3, 6, 12].map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`wh-btn wh-btn-sm ${backfill === m ? 'wh-btn-primary' : 'wh-btn-ghost'}`}
                  onClick={() => setBackfill(m)}
                  aria-pressed={backfill === m}
                >
                  {m === 0 ? '안 함' : `${m}개월`}
                </button>
              ))}
              <span style={mutedText}>저장 후 뒤에서 기사·공시를 모으고 요약합니다(수 분 소요).</span>
            </div>
          </section>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
            <button type="button" className="wh-btn wh-btn-ghost wh-btn-sm" onClick={close}>
              취소
            </button>
            <button type="button" className="wh-btn wh-btn-primary wh-btn-sm" disabled={saving} onClick={() => void save()}>
              {saving ? '저장 중…' : '저장'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

export default CompanyRegisterModal;
