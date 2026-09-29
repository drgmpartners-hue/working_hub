'use client';

/** 기업 원장 탭 — 투자유치 표 · 사실 타임라인(자동 검증 결과·근거, 필요할 때만 확정/제외/수정). 수집 현황·공공데이터는 상단 슬롯 */
import { ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/common/Card';
import { Modal } from '@/components/common/Modal';
import { crGet, crPatch, crPost } from '@/lib/companyReportApi';
import { MonthlyDigestsCard } from './MonthlyDigestsCard';
import type { Fact, FactVerification, FundingRound, SourceRef } from './types';
import { FACT_STATUS, fmtEok } from './types';
import { ErrorBox, Field, SectionTitle, Spinner, inputStyle, mutedText } from './ui';

const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: 12, color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '10px', fontSize: 13, color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-soft)', verticalAlign: 'top' };

function Sources({ refs }: { refs: SourceRef[] }) {
  if (!refs?.length) return <span style={mutedText}>직접 입력</span>;
  return (
    <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
      {refs.slice(0, 4).map((r, i) => (
        <a key={i} href={r.url} target="_blank" rel="noreferrer" title={r.title} style={{ color: 'var(--cyan-400)', fontSize: 12 }}>
          [{i + 1}]
        </a>
      ))}
      {refs.length > 4 && <span style={{ ...mutedText, fontSize: 12 }}>외 {refs.length - 4}</span>}
    </span>
  );
}

const LEVEL_CLS: Record<string, string> = {
  official: 'pos', multi: 'pos', single: 'warn', conflict: 'neg', not_company: 'neg', not_in_source: 'neg', speculative: 'neg', error: 'warn',
};

/** 자동 검증 근거: 원문 인용 문장 + 판정 이유, [근거 더 보기]로 검색 교차 확인·고친 내용 */
function Evidence({ v }: { v: FactVerification }) {
  const [open, setOpen] = useState(false);
  const found = v.search?.sources || [];
  return (
    <div style={{ marginTop: 4, paddingLeft: 86, fontSize: 12, lineHeight: 1.6 }}>
      {v.quote && (
        <div style={{ color: 'var(--text-secondary)', borderLeft: '2px solid var(--border)', paddingLeft: 8, margin: '2px 0' }}>
          “{v.quote}”
        </div>
      )}
      <div style={{ color: 'var(--text-muted)' }}>
        {v.reason}
        {v.role ? ` · 회사 입장: ${v.role}` : ''}
        {v.original?.title ? ` · 원문에 맞게 고침(처음: ${v.original.title})` : ''}{' '}
        {(v.check_reason || found.length > 0 || (v.outlet_names || []).length > 0) && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            style={{ background: 'none', border: 'none', padding: 0, color: 'var(--cyan-400)', cursor: 'pointer', fontSize: 12 }}
          >
            {open ? '접기' : '근거 더 보기'}
          </button>
        )}
      </div>
      {open && (
        <div style={{ color: 'var(--text-muted)', marginTop: 2 }}>
          {v.check_reason && <div>원문 대조: {v.check_reason}</div>}
          {(v.outlet_names || []).length > 0 && <div>보도한 곳: {(v.outlet_names || []).join(', ')}</div>}
          {v.search?.verdict && (
            <div>
              검색 교차 확인({v.search.verdict === 'corroborated' ? '다른 출처도 같은 내용' : v.search.verdict === 'contradicted' ? '다른 출처와 어긋남' : '다른 출처 못 찾음'})
              {v.search.note ? `: ${v.search.note}` : ''}
              {found.map((x, i) =>
                x.url ? (
                  <a key={i} href={x.url} target="_blank" rel="noreferrer" style={{ color: 'var(--cyan-400)', marginLeft: 6 }}>
                    {x.press || x.title || '링크'}
                  </a>
                ) : null,
              )}
            </div>
          )}
          {v.checked_at && <div>검증 {v.checked_at.replace('T', ' ').slice(0, 16)}</div>}
        </div>
      )}
    </div>
  );
}

interface FactForm {
  id?: string;
  fact_type: string;
  fact_date: string;
  title: string;
}
interface RoundForm {
  id?: string;
  round_date: string;
  round_name: string;
  amount_eok: string;
  investors: string;
  is_follow_on: boolean;
}

export function LedgerTab({ companyId, top }: { companyId: string; top?: ReactNode }) {
  const [facts, setFacts] = useState<Fact[]>([]);
  const [types, setTypes] = useState<Record<string, string>>({});
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [rounds, setRounds] = useState<FundingRound[]>([]);
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'open' | 'candidate' | 'confirmed' | 'rejected'>('open');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [factForm, setFactForm] = useState<FactForm | null>(null);
  const [roundForm, setRoundForm] = useState<RoundForm | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = statusFilter === 'open' ? '' : `?status=${statusFilter}`;
      const [f, r] = await Promise.all([
        crGet<{ items: Fact[]; counts: Record<string, number>; types: Record<string, string> }>(`/companies/${companyId}/facts${qs}`),
        crGet<FundingRound[]>(`/companies/${companyId}/funding-rounds`),
      ]);
      setFacts(f.items);
      setCounts(f.counts);
      setTypes(f.types);
      setRounds(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [companyId, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const shown = useMemo(() => facts.filter((f) => !typeFilter || f.fact_type === typeFilter), [facts, typeFilter]);
  const typeCounts = useMemo(() => {
    const m: Record<string, number> = {};
    facts.forEach((f) => (m[f.fact_type] = (m[f.fact_type] || 0) + 1));
    return m;
  }, [facts]);

  const setFactStatus = async (f: Fact, status: string) => {
    try {
      await crPatch(`/facts/${f.id}`, { status });
      void load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const saveFact = async () => {
    if (!factForm || !factForm.title.trim()) return;
    const body = { fact_type: factForm.fact_type, fact_date: factForm.fact_date || null, title: factForm.title.trim() };
    try {
      if (factForm.id) await crPatch(`/facts/${factForm.id}`, body);
      else await crPost(`/companies/${companyId}/facts`, body);
      setFactForm(null);
      void load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const setRoundStatus = async (r: FundingRound, status: string) => {
    try {
      await crPatch(`/funding-rounds/${r.id}`, { status });
      void load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const saveRound = async () => {
    if (!roundForm) return;
    const amt = roundForm.amount_eok.trim() ? Math.round(Number(roundForm.amount_eok) * 1e8) : null;
    const investors = roundForm.investors
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
      .map((name) => ({ name: name.replace(/\(리드\)$/, '').trim(), lead: /\(리드\)$/.test(name) }));
    const body = {
      round_date: roundForm.round_date || null,
      round_name: roundForm.round_name || '기타',
      amount: amt,
      investors,
      is_follow_on: roundForm.is_follow_on,
    };
    try {
      if (roundForm.id) await crPatch(`/funding-rounds/${roundForm.id}`, body);
      else await crPost(`/companies/${companyId}/funding-rounds`, body);
      setRoundForm(null);
      void load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const verifyNow = async () => {
    try {
      await crPost(`/companies/${companyId}/verify-facts`);
      setNotice('남은 후보를 자동 검증하는 중입니다(원문 대조·출처 확인). 몇 분 뒤 새로고침하세요.');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const reextract = async () => {
    try {
      await crPost(`/companies/${companyId}/extract-facts`);
      setNotice('기사에서 사실 후보를 다시 찾는 중입니다. 잠시 후 새로고침하세요.');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const totalFunding = rounds.filter((r) => r.status === 'confirmed').reduce((a, r) => a + (r.amount || 0), 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {top}
      <ErrorBox message={error} />
      {notice && <div style={{ ...mutedText, color: 'var(--success)' }}>{notice}</div>}

      <Card padding={16}>
        <SectionTitle
          right={
            <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={mutedText}>확정 누적 {fmtEok(totalFunding)}</span>
              <button
                type="button"
                className="wh-btn wh-btn-ghost wh-btn-sm"
                onClick={() => setRoundForm({ round_date: '', round_name: '', amount_eok: '', investors: '', is_follow_on: false })}
              >
                + 투자유치 추가
              </button>
            </span>
          }
        >
          투자유치 기록
        </SectionTitle>
        {loading ? (
          <Spinner />
        ) : rounds.length === 0 ? (
          <div style={{ ...mutedText, padding: '12px 0' }}>기록이 없습니다. 기사에서 투자유치가 확인되면 후보로 올라옵니다.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
              <thead>
                <tr>
                  {['날짜', '라운드', '금액', '투자사', '출처', '상태', ''].map((h) => (
                    <th key={h} style={th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rounds.map((r) => (
                  <tr key={r.id}>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{r.round_date || '-'}</td>
                    <td style={{ ...td, color: 'var(--text-primary)', fontWeight: 600 }}>
                      {r.round_name || '-'}
                      {r.is_follow_on && <span className="wh-badge info" style={{ marginLeft: 6 }}>후속</span>}
                    </td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmtEok(r.amount)}</td>
                    <td style={td}>
                      {r.investors.map((i) => `${i.name}${i.lead ? '(리드)' : ''}`).join(', ') || '-'}
                    </td>
                    <td style={td}>
                      <Sources refs={r.source_refs} />
                    </td>
                    <td style={td}>
                      <span className={`wh-badge ${FACT_STATUS[r.status]?.cls}`}>{FACT_STATUS[r.status]?.label}</span>
                    </td>
                    <td style={{ ...td, whiteSpace: 'nowrap', textAlign: 'right' }}>
                      {r.status === 'candidate' && (
                        <>
                          <button type="button" className="wh-btn wh-btn-primary wh-btn-sm" onClick={() => void setRoundStatus(r, 'confirmed')}>
                            확정
                          </button>{' '}
                          <button type="button" className="wh-btn wh-btn-ghost wh-btn-sm" onClick={() => void setRoundStatus(r, 'rejected')}>
                            제외
                          </button>{' '}
                        </>
                      )}
                      <button
                        type="button"
                        className="wh-btn wh-btn-ghost wh-btn-sm"
                        onClick={() =>
                          setRoundForm({
                            id: r.id,
                            round_date: r.round_date || '',
                            round_name: r.round_name || '',
                            amount_eok: r.amount ? String(r.amount / 1e8) : '',
                            investors: r.investors.map((i) => `${i.name}${i.lead ? '(리드)' : ''}`).join(', '),
                            is_follow_on: r.is_follow_on,
                          })
                        }
                      >
                        수정
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card padding={16}>
        <SectionTitle
          right={
            <span style={{ display: 'flex', gap: 6 }}>
              <button type="button" className="wh-btn wh-btn-ghost wh-btn-sm" onClick={() => void verifyNow()}>
                자동 검증
              </button>
              <button type="button" className="wh-btn wh-btn-ghost wh-btn-sm" onClick={() => void reextract()}>
                사실 다시 찾기
              </button>
              <button
                type="button"
                className="wh-btn wh-btn-ghost wh-btn-sm"
                onClick={() => setFactForm({ fact_type: 'other', fact_date: '', title: '' })}
              >
                + 사실 추가
              </button>
            </span>
          }
        >
          사실 원장
        </SectionTitle>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          {(
            [
              ['open', `후보·확정 (${(counts.candidate || 0) + (counts.confirmed || 0)})`],
              ['candidate', `확인 필요 (${counts.candidate || 0})`],
              ['confirmed', `확정만 (${counts.confirmed || 0})`],
              ['rejected', `제외됨 (${counts.rejected || 0})`],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              className={`wh-btn wh-btn-sm ${statusFilter === k ? 'wh-btn-primary' : 'wh-btn-ghost'}`}
              onClick={() => setStatusFilter(k)}
            >
              {label}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          <button type="button" className={`wh-badge ${typeFilter === '' ? 'info' : ''}`} style={{ cursor: 'pointer', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)' }} onClick={() => setTypeFilter('')}>
            전체 유형
          </button>
          {Object.entries(types).map(([k, label]) =>
            typeCounts[k] ? (
              <button
                key={k}
                type="button"
                className="wh-badge"
                style={{
                  cursor: 'pointer',
                  border: `1px solid ${typeFilter === k ? 'var(--blue-400)' : 'var(--border)'}`,
                  background: typeFilter === k ? 'rgba(59,130,246,.15)' : 'transparent',
                  color: 'var(--text-secondary)',
                }}
                onClick={() => setTypeFilter(k)}
              >
                {label} {typeCounts[k]}
              </button>
            ) : null,
          )}
        </div>
        {loading ? (
          <Spinner />
        ) : shown.length === 0 ? (
          <div style={{ ...mutedText, padding: '12px 0' }}>해당하는 사실이 없습니다.</div>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, borderLeft: '2px solid var(--border)', marginLeft: 6 }}>
            {shown.map((f) => (
              <li key={f.id} style={{ position: 'relative', padding: '8px 0 12px 16px' }}>
                <span
                  style={{
                    position: 'absolute',
                    left: -6,
                    top: 13,
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    background: f.status === 'confirmed' ? 'var(--success)' : f.status === 'rejected' ? 'var(--danger)' : 'var(--warning)',
                  }}
                />
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <span style={{ ...mutedText, fontSize: 12, width: 78 }}>{f.fact_date || '날짜 미상'}</span>
                  <span className="wh-badge info">{f.type_label}</span>
                  <strong style={{ color: 'var(--text-primary)', fontSize: 14 }}>{f.title}</strong>
                  <span className={`wh-badge ${FACT_STATUS[f.status]?.cls}`}>
                    {f.auto && f.status !== 'candidate' ? `자동 ${FACT_STATUS[f.status]?.label}` : f.status === 'candidate' && f.verification ? '확인 필요' : FACT_STATUS[f.status]?.label}
                  </span>
                  {f.verify_label && <span className={`wh-badge ${LEVEL_CLS[f.verification?.level || ''] || 'info'}`}>{f.verify_label}</span>}
                  <Sources refs={f.source_refs} />
                  <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                    {f.status === 'candidate' && (
                      <>
                        <button type="button" className="wh-btn wh-btn-primary wh-btn-sm" onClick={() => void setFactStatus(f, 'confirmed')}>
                          확정
                        </button>
                        <button type="button" className="wh-btn wh-btn-ghost wh-btn-sm" onClick={() => void setFactStatus(f, 'rejected')}>
                          제외
                        </button>
                      </>
                    )}
                    {f.status === 'rejected' && (
                      <button type="button" className="wh-btn wh-btn-ghost wh-btn-sm" onClick={() => void setFactStatus(f, 'candidate')}>
                        되돌리기
                      </button>
                    )}
                    {f.status === 'confirmed' && (
                      <button type="button" className="wh-btn wh-btn-ghost wh-btn-sm" onClick={() => void setFactStatus(f, 'rejected')}>
                        제외
                      </button>
                    )}
                    {f.status !== 'rejected' && (
                      <button
                        type="button"
                        className="wh-btn wh-btn-ghost wh-btn-sm"
                        onClick={() => setFactForm({ id: f.id, fact_type: f.fact_type, fact_date: f.fact_date || '', title: f.title })}
                      >
                        수정
                      </button>
                    )}
                  </span>
                </div>
                {Object.keys(f.detail || {}).length > 0 && (
                  <div style={{ ...mutedText, fontSize: 12, marginTop: 2, paddingLeft: 86 }}>
                    {Object.entries(f.detail)
                      .filter(([, v]) => v !== null && typeof v !== 'object')
                      .map(([k, v]) => `${k}: ${v}`)
                      .join(' · ')}
                  </div>
                )}
                {f.verification && <Evidence v={f.verification} />}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <MonthlyDigestsCard companyId={companyId} />

      <Modal open={!!factForm} onClose={() => setFactForm(null)} title={factForm?.id ? '사실 수정(새 판으로 저장)' : '사실 추가'}>
        {factForm && (
          <div style={{ display: 'grid', gap: 10 }}>
            <Field label="유형">
              <select style={inputStyle} value={factForm.fact_type} onChange={(e) => setFactForm({ ...factForm, fact_type: e.target.value })}>
                {Object.entries(types).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="날짜">
              <input type="date" style={inputStyle} value={factForm.fact_date} onChange={(e) => setFactForm({ ...factForm, fact_date: e.target.value })} />
            </Field>
            <Field label="내용(한 줄)">
              <input style={inputStyle} value={factForm.title} onChange={(e) => setFactForm({ ...factForm, title: e.target.value })} maxLength={300} />
            </Field>
            {factForm.id && <p style={{ ...mutedText, margin: 0, fontSize: 12 }}>수정하면 이전 내용은 이력으로 남고, 새 내용이 확정 상태로 저장됩니다.</p>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="wh-btn wh-btn-ghost wh-btn-sm" onClick={() => setFactForm(null)}>
                취소
              </button>
              <button type="button" className="wh-btn wh-btn-primary wh-btn-sm" onClick={() => void saveFact()}>
                저장
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!roundForm} onClose={() => setRoundForm(null)} title={roundForm?.id ? '투자유치 수정' : '투자유치 추가'}>
        {roundForm && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="날짜">
              <input type="date" style={inputStyle} value={roundForm.round_date} onChange={(e) => setRoundForm({ ...roundForm, round_date: e.target.value })} />
            </Field>
            <Field label="라운드">
              <input style={inputStyle} list="cr-rounds" value={roundForm.round_name} onChange={(e) => setRoundForm({ ...roundForm, round_name: e.target.value })} />
              <datalist id="cr-rounds">
                {['시드', '프리A', '시리즈A', '시리즈B', '시리즈C', '시리즈D', '프리IPO', '브릿지', '정책자금', '기타'].map((x) => (
                  <option key={x} value={x} />
                ))}
              </datalist>
            </Field>
            <Field label="금액(억 원, 비공개면 비움)">
              <input style={inputStyle} inputMode="decimal" value={roundForm.amount_eok} onChange={(e) => setRoundForm({ ...roundForm, amount_eok: e.target.value })} />
            </Field>
            <Field label="후속 투자">
              <select style={inputStyle} value={roundForm.is_follow_on ? 'Y' : 'N'} onChange={(e) => setRoundForm({ ...roundForm, is_follow_on: e.target.value === 'Y' })}>
                <option value="N">아니오</option>
                <option value="Y">예(기존 투자사 참여)</option>
              </select>
            </Field>
            <Field label="투자사(쉼표로 구분, 리드는 끝에 (리드))" span={2}>
              <input style={inputStyle} value={roundForm.investors} onChange={(e) => setRoundForm({ ...roundForm, investors: e.target.value })} placeholder="한빛벤처스(리드), 가나캐피탈" />
            </Field>
            <div style={{ gridColumn: 'span 2', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="wh-btn wh-btn-ghost wh-btn-sm" onClick={() => setRoundForm(null)}>
                취소
              </button>
              <button type="button" className="wh-btn wh-btn-primary wh-btn-sm" onClick={() => void saveRound()}>
                저장(확정)
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

export default LedgerTab;
