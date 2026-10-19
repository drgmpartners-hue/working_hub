'use client';

/**
 * 기사 제보 화면의 오른쪽 패널 (2026-10-19) — 화면을 옮기지 않고 그 기업의 정보·수집 키워드를 보고 바로 고친다.
 * Claude 제안([적용])을 누르면 편집 중인 키워드에 반영되고, [저장]하면 기존 기업 수정 API(PUT)로 적용된다
 * (바뀐 키워드로 최근 6개월을 백그라운드에서 다시 모은다). [기존 기사 다시 점검]은 지금 제외어에 걸리는
 * 기사를 찾아 보여 주고, 확인하면 숨긴다.
 */
import { useEffect, useState } from 'react';
import { crGet, crPost, crPut } from '@/lib/companyReportApi';
import type { Company, KeywordSet } from '@/components/company-report/types';

export interface KwAction {
  type: 'add_exclude' | 'remove_required' | 'add_required' | 'remove_boost' | 'add_boost';
  keyword: string;
  why?: string;
}

const KIND: { key: keyof KeywordSet; label: string; help: string; color: string }[] = [
  { key: 'required', label: '필수어', help: '기사에 꼭 들어가야 하는 말(하나 이상)', color: 'var(--blue-400)' },
  { key: 'boost', label: '보조어', help: '있으면 관련도 점수를 올리는 말', color: 'var(--cyan-400)' },
  { key: 'exclude', label: '제외어', help: '있으면 그 기사는 버리는 말(동명 회사·동명이인 등)', color: 'var(--danger)' },
];
const ACTION_LABEL: Record<KwAction['type'], string> = {
  add_exclude: '제외어 추가',
  remove_required: '필수어 빼기',
  add_required: '필수어 추가',
  remove_boost: '보조어 빼기',
  add_boost: '보조어 추가',
};

function applied(kw: KeywordSet, a: KwAction): boolean {
  switch (a.type) {
    case 'add_exclude':
      return kw.exclude.includes(a.keyword);
    case 'add_required':
      return kw.required.includes(a.keyword);
    case 'add_boost':
      return kw.boost.includes(a.keyword);
    case 'remove_required':
      return !kw.required.includes(a.keyword);
    case 'remove_boost':
      return !kw.boost.includes(a.keyword);
  }
}

function apply(kw: KeywordSet, a: KwAction): KeywordSet {
  const add = (xs: string[]) => (xs.includes(a.keyword) ? xs : [...xs, a.keyword]);
  const rm = (xs: string[]) => xs.filter((x) => x !== a.keyword);
  switch (a.type) {
    case 'add_exclude':
      return { ...kw, exclude: add(kw.exclude) };
    case 'add_required':
      return { ...kw, required: add(kw.required) };
    case 'add_boost':
      return { ...kw, boost: add(kw.boost) };
    case 'remove_required':
      return { ...kw, required: rm(kw.required) };
    case 'remove_boost':
      return { ...kw, boost: rm(kw.boost) };
  }
}

const same = (a: KeywordSet, b: KeywordSet) =>
  (['required', 'boost', 'exclude'] as const).every((k) => [...a[k]].sort().join('|') === [...b[k]].sort().join('|'));

interface Recheck {
  matched: number;
  hidden: number;
  samples: { title: string; reason: string; published_at: string | null }[];
  note?: string;
}

export function CompanyKeywordPanel({
  companyId,
  suggestions,
  onClose,
  onSaved,
}: {
  companyId: string;
  suggestions: KwAction[];
  onClose: () => void;
  onSaved?: () => void;
}) {
  const [co, setCo] = useState<Company | null>(null);
  const [kw, setKw] = useState<KeywordSet>({ required: [], boost: [], exclude: [] });
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rc, setRc] = useState<Recheck | null>(null);

  useEffect(() => {
    let alive = true;
    crGet<Company>(`/companies/${companyId}`)
      .then((c) => {
        if (!alive) return;
        setCo(c);
        setKw(c.keywords);
        setErr(null);
      })
      .catch((e: Error) => alive && setErr(e.message));
    return () => {
      alive = false;
    };
  }, [companyId]);

  const dirty = !!co && !same(co.keywords, kw);

  const save = async () => {
    if (!kw.required.length) {
      setErr('필수어는 하나 이상 있어야 합니다.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const c = await crPut<Company>(`/companies/${companyId}`, { keywords: kw });
      setCo(c);
      setKw(c.keywords);
      setNotice('저장했습니다. 바뀐 키워드로 최근 6개월 기사를 백그라운드에서 다시 모읍니다. 아래 [기존 기사 다시 점검]으로 이미 모인 기사도 정리하세요.');
      setRc(null);
      onSaved?.();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const recheck = async (doApply: boolean) => {
    setBusy(true);
    setErr(null);
    try {
      setRc(await crPost<Recheck>(`/companies/${companyId}/recheck-articles`, { apply: doApply }));
      if (doApply) onSaved?.();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const addKw = (k: keyof KeywordSet) => {
    const v = (inputs[k] || '').trim();
    if (!v) return;
    setKw((x) => (x[k].includes(v) ? x : { ...x, [k]: [...x[k], v] }));
    setInputs((i) => ({ ...i, [k]: '' }));
  };

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 60 }} />
      <aside
        role="dialog"
        aria-label="기업 키워드"
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: 'min(460px, 100vw)',
          background: 'var(--bg-card)',
          borderLeft: '1px solid var(--border)',
          zIndex: 61,
          overflowY: 'auto',
          padding: 18,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          boxShadow: '-8px 0 24px rgba(0,0,0,.3)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)' }}>{co?.name || '불러오는 중…'}</div>
            {co && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.6 }}>
                {[co.is_listed ? `상장 ${co.stock_code || ''}` : '비상장', co.industry, co.ceo_name && `대표 ${co.ceo_name}`]
                  .filter(Boolean)
                  .join(' · ')}
                {co.aliases?.length ? <div>이전 사명·약칭: {co.aliases.join(', ')}</div> : null}
                {co.homepage && (
                  <div>
                    <a href={co.homepage} target="_blank" rel="noreferrer" style={{ color: 'var(--cyan-400)' }}>
                      {co.homepage}
                    </a>
                  </div>
                )}
              </div>
            )}
          </div>
          <button type="button" className="wh-btn wh-btn-ghost wh-btn-sm" onClick={onClose} aria-label="패널 닫기">
            닫기 ✕
          </button>
        </div>

        {suggestions.length > 0 && (
          <section style={{ padding: 12, borderRadius: 10, background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>Claude 제안</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {suggestions.map((a, i) => {
                const done = applied(kw, a);
                return (
                  <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
                    <span style={{ flex: 1, color: 'var(--text-secondary)' }}>
                      <b>{ACTION_LABEL[a.type]}</b> &lsquo;{a.keyword}&rsquo;
                      {a.why && <span style={{ color: 'var(--text-muted)', fontSize: 12 }}> — {a.why}</span>}
                    </span>
                    <button
                      type="button"
                      className={`wh-btn wh-btn-sm ${done ? 'wh-btn-ghost' : 'wh-btn-primary'}`}
                      disabled={done}
                      onClick={() => setKw((x) => apply(x, a))}
                    >
                      {done ? '반영됨' : '적용'}
                    </button>
                  </div>
                );
              })}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>[적용]은 아래 키워드에만 반영됩니다. [저장]을 눌러야 실제로 바뀝니다.</div>
          </section>
        )}

        {KIND.map((k) => (
          <section key={k.key}>
            <div style={{ fontSize: 13, fontWeight: 700, color: k.color }}>
              {k.label} <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--text-muted)' }}>{k.help}</span>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
              {kw[k.key].map((x) => (
                <span key={x} className="wh-badge" style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                  {x}
                  <button
                    type="button"
                    aria-label={`${k.label} ${x} 빼기`}
                    onClick={() => setKw((v) => ({ ...v, [k.key]: v[k.key].filter((y) => y !== x) }))}
                    style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0 }}
                  >
                    ✕
                  </button>
                </span>
              ))}
              {!kw[k.key].length && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>(없음)</span>}
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <input
                value={inputs[k.key] || ''}
                onChange={(e) => setInputs((i) => ({ ...i, [k.key]: e.target.value }))}
                onKeyDown={(e) => e.key === 'Enter' && addKw(k.key)}
                placeholder={`${k.label} 입력 후 Enter`}
                aria-label={`${k.label} 추가`}
                style={{
                  flex: 1,
                  padding: '6px 8px',
                  fontSize: 13,
                  borderRadius: 6,
                  border: '1px solid var(--border-strong)',
                  background: 'var(--bg-surface)',
                  color: 'var(--text-primary)',
                }}
              />
              <button type="button" className="wh-btn wh-btn-ghost wh-btn-sm" onClick={() => addKw(k.key)}>
                추가
              </button>
            </div>
          </section>
        ))}

        {err && <div style={{ fontSize: 13, color: 'var(--danger)' }}>{err}</div>}
        {notice && <div style={{ fontSize: 13, color: 'var(--success)', lineHeight: 1.6 }}>{notice}</div>}

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button type="button" className="wh-btn wh-btn-primary wh-btn-sm" disabled={busy || !dirty} onClick={() => void save()}>
            {busy ? '처리 중…' : dirty ? '키워드 저장' : '바뀐 것 없음'}
          </button>
          {dirty && (
            <button type="button" className="wh-btn wh-btn-ghost wh-btn-sm" disabled={busy} onClick={() => co && setKw(co.keywords)}>
              되돌리기
            </button>
          )}
          <a
            href={`/content/company-report/companies/${companyId}`}
            target="_blank"
            rel="noreferrer"
            style={{ fontSize: 12, color: 'var(--cyan-400)', alignSelf: 'center', marginLeft: 'auto' }}
          >
            기업 상세 새 창 ↗
          </a>
        </div>

        <section style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>기존 기사 다시 점검</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 8px', lineHeight: 1.6 }}>
            이미 모인 기사 중 저장된 제외어에 걸리거나, 제목·첫 문장에 기업명이 없는(단순 언급) 기사를 찾습니다. 먼저 몇 건인지 보고 숨길지 정합니다.
          </div>
          <button type="button" className="wh-btn wh-btn-ghost wh-btn-sm" disabled={busy || dirty} onClick={() => void recheck(false)}>
            {dirty ? '먼저 키워드를 저장하세요' : '걸리는 기사 찾기'}
          </button>
          {rc && (
            <div style={{ marginTop: 8, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              {rc.note ? (
                rc.note
              ) : rc.hidden ? (
                <span style={{ color: 'var(--success)' }}>{rc.hidden}건을 숨겼습니다. 이후 브리핑·보고서에서 빠집니다.</span>
              ) : rc.matched ? (
                <>
                  걸리는 기사 <b>{rc.matched}건</b>
                  <ul style={{ margin: '4px 0', paddingLeft: 18, fontSize: 12 }}>
                    {rc.samples.map((x, i) => (
                      <li key={i}>
                        {x.title} <span style={{ color: 'var(--text-muted)' }}>({x.reason})</span>
                      </li>
                    ))}
                  </ul>
                  <button type="button" className="wh-btn wh-btn-primary wh-btn-sm" disabled={busy} onClick={() => void recheck(true)}>
                    {rc.matched}건 숨기기
                  </button>
                </>
              ) : (
                '걸리는 기사가 없습니다.'
              )}
            </div>
          )}
        </section>
      </aside>
    </>
  );
}

export default CompanyKeywordPanel;
