'use client';

/**
 * 수집 현황 (기업 원장 탭 위쪽, P2-13)
 * 월별 기사 수 막대 · 출처별 건수 · 검증 ①~⑥ · 판정 · [과거 데이터 가져오기] · 샘플 검수 · 빈 달 확인 · 결과서
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Card } from '@/components/common/Card';
import { Modal } from '@/components/common/Modal';
import { crDownload, crGet, crPost } from '@/lib/companyReportApi';
import type { Article } from './types';
import { ErrorBox, SectionTitle, inputStyle, mutedText } from './ui';

interface Check {
  pass: boolean | null;
  note?: string;
  zero_months?: string[];
}
interface JobSummary {
  id: string;
  status: string;
  progress: number;
  stage?: string;
}
interface JobFull extends JobSummary {
  period_from: string;
  period_to: string;
  trigger: string;
  verdict: 'sufficient' | 'needs_more' | 'insufficient' | null;
  estimated_recall: number | null;
  reasons: string[];
  report_file_id: string | null;
  error: string | null;
  source_stats: Record<string, number> | null;
  checks: Record<string, Check>;
  confirmed_gaps: string[];
  key_events: { events?: { date?: string; title: string; found: boolean; by?: string[] }[]; recovered?: number };
  sample: { answers?: Record<string, boolean>; accuracy?: number | null };
  counts: { monthly: Record<string, number>; by_source: Record<string, number>; representative: number; zero_months: string[] };
}

const VERDICT: Record<string, { label: string; cls: string }> = {
  sufficient: { label: '충분', cls: 'pos' },
  needs_more: { label: '보완 필요', cls: 'warn' },
  insufficient: { label: '부족', cls: 'neg' },
};
const CHECKS: [string, string][] = [
  ['c1', '① 기간 커버리지'],
  ['c2', '② 출처 간 대조(수집률)'],
  ['c3', '③ 핵심 사건'],
  ['c4', '④ DART 대조'],
  ['c5', '⑤ 샘플 검수'],
  ['c6', '⑥ 사실 추출'],
];
const SOURCE_LABEL: Record<string, string> = { naver: '네이버', google_rss: '구글 뉴스', dart: 'DART', web: '웹', manual: '직접' };
const TRIGGER: Record<string, string> = { register: '등록 직후', manual: '수동', keyword_change: '키워드 변경', pre_report: '보고서 전' };

/** 월별 기사 수(단일 계열: 범례 없음). 0건인 달은 빈 칸 대신 '0' 표기, 막대마다 툴팁 */
function MonthBars({ monthly, confirmed }: { monthly: Record<string, number>; confirmed: string[] }) {
  const entries = Object.entries(monthly);
  if (!entries.length) return null;
  const max = Math.max(1, ...entries.map(([, n]) => n));
  const H = 90;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: H + 34, padding: '4px 0' }} role="img" aria-label={`월별 기사 수: ${entries.map(([m, n]) => `${m} ${n}건`).join(', ')}`}>
      {entries.map(([m, n]) => {
        const h = n ? Math.max(4, (n / max) * H) : 0;
        const gap = n === 0 && !confirmed.includes(m);
        return (
          <div key={m} title={`${m}: ${n}건`} style={{ flex: 1, minWidth: 18, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
            <span style={{ fontSize: 11, color: gap ? 'var(--warning)' : 'var(--text-secondary)' }}>{n}</span>
            <div style={{ width: '70%', maxWidth: 28, height: h, background: 'var(--cyan-400)', borderRadius: '4px 4px 0 0' }} />
            <div style={{ width: '100%', borderTop: '1px solid var(--border)' }} />
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{m.slice(2).replace('-', '.')}</span>
          </div>
        );
      })}
    </div>
  );
}

function CheckIcon({ pass }: { pass: boolean | null | undefined }) {
  if (pass === true) return <span className="wh-badge pos">통과</span>;
  if (pass === false) return <span className="wh-badge neg">미통과</span>;
  return <span className="wh-badge info">대기·해당 없음</span>;
}

export function CoveragePanel({ companyId }: { companyId: string }) {
  const [job, setJob] = useState<JobFull | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [months, setMonths] = useState('6');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [sample, setSample] = useState<Article[] | null>(null);
  const [answers, setAnswers] = useState<Record<string, boolean>>({});
  const [gapSel, setGapSel] = useState<string[]>([]);
  const [showEvents, setShowEvents] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await crGet<JobSummary[]>(`/companies/${companyId}/backfill-jobs`);
      if (list[0]) {
        const full = await crGet<JobFull>(`/backfill-jobs/${list[0].id}`);
        setJob(full);
        if (full.status === 'running' || full.status === 'queued') {
          timer.current = setTimeout(() => void load(), 5000);
        }
      } else setJob(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoaded(true);
    }
  }, [companyId]);

  useEffect(() => {
    void load();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [load]);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = months === 'custom' ? { company_ids: [companyId], date_from: from, date_to: to } : { company_ids: [companyId], months: Number(months) };
      const r = await crPost<{ queued: number; skipped_running: number }>('/companies/backfill', body);
      if (!r.queued) setError('이미 진행 중인 작업이 있습니다.');
      setTimeout(() => void load(), 800);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const openSample = async () => {
    if (!job) return;
    try {
      const r = await crGet<{ items: Article[]; answers: Record<string, boolean> }>(`/backfill-jobs/${job.id}/sample`);
      setSample(r.items);
      setAnswers(r.answers || {});
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const submitSample = async () => {
    if (!job || !sample) return;
    try {
      const r = await crPost<JobFull>(`/backfill-jobs/${job.id}/sample-review`, { answers });
      setSample(null);
      setJob({ ...job, ...r });
      void load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const confirmGaps = async () => {
    if (!job || !gapSel.length) return;
    try {
      await crPost(`/backfill-jobs/${job.id}/confirm-gaps`, { months: gapSel });
      setGapSel([]);
      void load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const running = job && (job.status === 'running' || job.status === 'queued');
  const gaps = job ? (job.counts?.zero_months || []).filter((m) => !(job.confirmed_gaps || []).includes(m)) : [];
  const v = job?.verdict ? VERDICT[job.verdict] : null;
  const st = job?.source_stats || {};

  return (
    <Card padding={16}>
      <SectionTitle
        right={
          <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <select value={months} onChange={(e) => setMonths(e.target.value)} style={{ ...inputStyle, width: 'auto' }} aria-label="가져올 기간">
              <option value="3">최근 3개월</option>
              <option value="6">최근 6개월</option>
              <option value="12">최근 12개월</option>
              <option value="custom">기간 직접 선택</option>
            </select>
            {months === 'custom' && (
              <>
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ ...inputStyle, width: 140 }} aria-label="시작일" />
                <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ ...inputStyle, width: 140 }} aria-label="종료일" />
              </>
            )}
            <button type="button" className="wh-btn wh-btn-primary wh-btn-sm" disabled={busy || !!running} onClick={() => void start()}>
              과거 데이터 가져오기
            </button>
          </span>
        }
      >
        수집 현황
      </SectionTitle>
      <ErrorBox message={error} />
      {!loaded ? null : !job ? (
        <div style={mutedText}>과거 데이터 구축 기록이 없습니다. 기간을 골라 [과거 데이터 가져오기]를 누르세요.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 13, color: 'var(--text-secondary)' }}>
            {running ? (
              <>
                <span className="wh-badge warn">진행 {job.progress}%</span>
                <span>{job.stage || '준비 중'}…</span>
                <div style={{ flex: 1, minWidth: 120, height: 6, background: 'var(--bg-surface)', borderRadius: 3 }}>
                  <div style={{ width: `${job.progress}%`, height: 6, background: 'var(--blue-400)', borderRadius: 3, transition: 'width .4s' }} />
                </div>
              </>
            ) : job.status === 'failed' ? (
              <span className="wh-badge neg">실패</span>
            ) : (
              v && (
                <span className={`wh-badge ${v.cls}`} style={{ fontSize: 13 }}>
                  판정: {v.label}
                </span>
              )
            )}
            <span>
              {job.period_from} ~ {job.period_to} · {TRIGGER[job.trigger] || job.trigger}
            </span>
            {typeof job.estimated_recall === 'number' && <span>추정 수집률 {(job.estimated_recall * 100).toFixed(0)}%</span>}
            {job.report_file_id && (
              <button type="button" className="wh-btn wh-btn-ghost wh-btn-sm" onClick={() => void crDownload(`/db/files/${job.report_file_id}/download`, '수집검증.pdf')}>
                검증 결과서
              </button>
            )}
          </div>
          {job.error && <div style={{ color: 'var(--danger)', fontSize: 13 }}>{job.error}</div>}
          {!running && job.reasons?.length > 0 && (
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--warning)', lineHeight: 1.7 }}>
              {job.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}

          {job.counts && (
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 2fr) minmax(200px, 1fr)', gap: 12 }} className="cr-cov">
              <style>{`@media (max-width: 760px){ .cr-cov{ grid-template-columns: 1fr !important; } }`}</style>
              <div>
                <div style={{ ...mutedText, fontSize: 12 }}>월별 기사 수(대표 기사 {job.counts.representative}건)</div>
                <MonthBars monthly={job.counts.monthly} confirmed={job.confirmed_gaps || []} />
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                <div style={{ ...mutedText, fontSize: 12, marginBottom: 4 }}>출처별 저장</div>
                {Object.entries(job.counts.by_source).map(([k, n]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                    <span>{SOURCE_LABEL[k] || k}</span>
                    <span>{n}건</span>
                  </div>
                ))}
                <div style={{ ...mutedText, fontSize: 11, marginTop: 6 }}>
                  검색: 네이버 {st.naver_relevant ?? 0} · 구글 {st.google_relevant ?? 0} · 같은 기사 묶음 {st.attached ?? 0} · 제외 {st.excluded ?? 0}
                </div>
              </div>
            </div>
          )}

          {!running && job.checks && Object.keys(job.checks).length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 8 }}>
              {CHECKS.map(([k, label]) => {
                const c = job.checks[k] || { pass: null };
                return (
                  <div key={k} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', background: 'var(--bg-surface)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                      <strong style={{ fontSize: 13, color: 'var(--text-primary)' }}>{label}</strong>
                      <CheckIcon pass={c.pass} />
                    </div>
                    <div style={{ ...mutedText, fontSize: 12, marginTop: 4 }}>{c.note}</div>
                    {k === 'c5' && (
                      <button type="button" className="wh-btn wh-btn-ghost wh-btn-sm" style={{ marginTop: 6 }} onClick={() => void openSample()}>
                        {c.pass === null ? '샘플 20건 검수하기(약 3분)' : '다시 검수'}
                      </button>
                    )}
                    {k === 'c3' && (job.key_events?.events?.length || 0) > 0 && (
                      <button type="button" onClick={() => setShowEvents((x) => !x)} style={{ background: 'none', border: 'none', padding: 0, marginTop: 4, color: 'var(--cyan-400)', fontSize: 12, cursor: 'pointer' }}>
                        {showEvents ? '사건 목록 접기' : '사건 목록 보기'}
                      </button>
                    )}
                    {k === 'c1' && gaps.length > 0 && (
                      <div style={{ marginTop: 6, fontSize: 12 }}>
                        {gaps.map((m) => (
                          <label key={m} style={{ marginRight: 8, color: 'var(--text-secondary)', cursor: 'pointer' }}>
                            <input type="checkbox" checked={gapSel.includes(m)} onChange={(e) => setGapSel((s) => (e.target.checked ? [...s, m] : s.filter((x) => x !== m)))} /> {m}
                          </label>
                        ))}
                        <button type="button" className="wh-btn wh-btn-ghost wh-btn-sm" disabled={!gapSel.length} onClick={() => void confirmGaps()}>
                          실제로 기사 없음 확인
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {showEvents && (
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
              {(job.key_events.events || []).map((e, i) => (
                <li key={i}>
                  <span style={mutedText}>{e.date || '-'}</span> {e.title}{' '}
                  <span className={`wh-badge ${e.found ? 'pos' : 'neg'}`}>{e.found ? '수집됨' : '없음'}</span>{' '}
                  <span style={{ ...mutedText, fontSize: 11 }}>{(e.by || []).join('·')}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <Modal open={!!sample} onClose={() => setSample(null)} title="관련도 샘플 검수 — 이 회사 기사가 맞나요?" maxWidth={780}>
        {sample && (
          <div>
            <p style={{ ...mutedText, marginTop: 0 }}>무작위로 고른 기사입니다. 이 회사 이야기가 아니면 [틀림]을 누르세요. 틀림으로 고른 기사는 숨겨집니다.</p>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {sample.map((a) => (
                <li key={a.id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <a href={a.url} target="_blank" rel="noreferrer" style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: 13 }}>
                        {a.title}
                      </a>
                      <div style={{ ...mutedText, fontSize: 12 }}>
                        {a.press || a.source} · {a.published_at?.slice(0, 10)}
                      </div>
                      {a.summary && <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{a.summary}</div>}
                    </div>
                    <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                      <button type="button" className={`wh-btn wh-btn-sm ${answers[a.id] === true ? 'wh-btn-primary' : 'wh-btn-ghost'}`} aria-pressed={answers[a.id] === true} onClick={() => setAnswers({ ...answers, [a.id]: true })}>
                        맞음
                      </button>
                      <button type="button" className={`wh-btn wh-btn-sm ${answers[a.id] === false ? 'wh-btn-primary' : 'wh-btn-ghost'}`} aria-pressed={answers[a.id] === false} onClick={() => setAnswers({ ...answers, [a.id]: false })}>
                        틀림
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
              <span style={mutedText}>
                {Object.keys(answers).length}/{sample.length}건 확인 · 맞음 {Object.values(answers).filter(Boolean).length}
              </span>
              <button type="button" className="wh-btn wh-btn-primary wh-btn-sm" disabled={Object.keys(answers).length < sample.length} onClick={() => void submitSample()}>
                검수 완료
              </button>
            </div>
          </div>
        )}
      </Modal>
    </Card>
  );
}

export default CoveragePanel;
