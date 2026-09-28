'use client';

/** 투자기업 관리 — 목록·등록·수집·비활성 (기획 4장 화면 ①) */
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/common/Card';
import { CompanyRegisterModal } from '@/components/company-report/CompanyRegisterModal';
import { PurgeModal, TrashModal } from '@/components/company-report/CompanyDeleteModals';
import { useCrMe } from '@/lib/useCrMe';
import type { Company } from '@/components/company-report/types';
import { ErrorBox, Spinner, fmtDate, inputStyle, mutedText } from '@/components/company-report/ui';
import { crDelete, crGet, crPost, crPut } from '@/lib/companyReportApi';

const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '10px 12px',
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--text-muted)',
  borderBottom: '1px solid var(--border)',
  whiteSpace: 'nowrap',
  // 표 머리 고정: 목록만 스크롤
  position: 'sticky',
  top: 0,
  zIndex: 2,
  backgroundColor: 'var(--bg-card)',
  boxShadow: '0 1px 0 var(--border)',
};
const td: React.CSSProperties = {
  padding: '12px',
  fontSize: 14,
  color: 'var(--text-secondary)',
  borderBottom: '1px solid var(--border-soft)',
  verticalAlign: 'middle',
};
const num: React.CSSProperties = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };

export default function CompaniesPage() {
  const [items, setItems] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [modal, setModal] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [bfMonths, setBfMonths] = useState('6');
  const [trashView, setTrashView] = useState(false);
  const [trashed, setTrashed] = useState<Company[]>([]);
  const [trashTarget, setTrashTarget] = useState<{ id: string; name: string } | null>(null);
  const [purgeTarget, setPurgeTarget] = useState<{ id: string; name: string } | null>(null);
  const me = useCrMe();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, del] = await Promise.all([
        crGet<Company[]>(showInactive ? '/companies' : '/companies?active=true'),
        crGet<Company[]>('/companies?deleted=true'),
      ]);
      setItems(list);
      setTrashed(del);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [showInactive]);

  useEffect(() => {
    void load();
  }, [load]);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return items;
    return items.filter((c) =>
      [c.name, c.name_en, c.ceo_name, c.industry, ...(c.aliases || [])].some((v) => (v || '').toLowerCase().includes(q)),
    );
  }, [items, filter]);

  const totals = useMemo(
    () =>
      items
        .filter((c) => c.is_active)
        .reduce((a, c) => ({ today: a.today + c.stats.today, week: a.week + c.stats.week, caution: a.caution + c.stats.caution_week }), {
          today: 0,
          week: 0,
          caution: 0,
        }),
    [items],
  );

  const collect = async (c: Company) => {
    setBusy(c.id);
    setNotice(null);
    try {
      await crPost(`/companies/${c.id}/collect`);
      setNotice(`${c.name}: 수집을 시작했습니다. 잠시 후 새로고침하세요.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const bulkBackfill = async () => {
    if (!picked.length) return;
    if (!window.confirm(`선택한 ${picked.length}개 기업의 최근 ${bfMonths}개월 기사·공시를 다시 모으고 검증할까요? 기업당 수 분이 걸립니다.`)) return;
    try {
      const r = await crPost<{ queued: number; skipped_running: number }>('/companies/backfill', { company_ids: picked, months: Number(bfMonths) });
      setNotice(`${r.queued}개 기업 과거 데이터 구축을 시작했습니다${r.skipped_running ? `(진행 중 ${r.skipped_running}개 제외)` : ''}. 기업 상세 > 기업 원장에서 진행률을 볼 수 있습니다.`);
      setPicked([]);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const restore = async (c: Company) => {
    setBusy(c.id);
    try {
      await crPost(`/companies/${c.id}/restore`);
      setNotice(`${c.name}을(를) 복구했습니다. 수집이 다시 시작됩니다.`);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const toggleActive = async (c: Company) => {
    if (c.is_active && !window.confirm(`${c.name}을(를) 비활성으로 바꿀까요? 모은 기사는 그대로 남고 수집·발송만 멈춥니다.`)) return;
    setBusy(c.id);
    try {
      if (c.is_active) await crDelete(`/companies/${c.id}`);
      else await crPut(`/companies/${c.id}`, { is_active: true });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        {[
          { label: '관리 기업', value: items.filter((c) => c.is_active).length },
          { label: '오늘 기사', value: totals.today },
          { label: '최근 7일 기사', value: totals.week },
          { label: '7일 주의 이슈', value: totals.caution, tone: totals.caution ? 'var(--danger)' : undefined },
        ].map((s) => (
          <Card key={s.label} padding={16}>
            <div style={mutedText}>{s.label}</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: s.tone || 'var(--text-primary)', marginTop: 4 }}>{s.value}</div>
          </Card>
        ))}
      </div>

      <Card padding={0}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', padding: 16, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="기업명·대표자·업종 필터"
              aria-label="기업 목록 필터"
              style={{ ...inputStyle, width: 220 }}
            />
            <label style={{ ...mutedText, display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
              비활성 기업 포함
            </label>
            <button
              type="button"
              className={`wh-btn wh-btn-sm ${trashView ? 'wh-btn-primary' : 'wh-btn-ghost'}`}
              onClick={() => setTrashView((v) => !v)}
              aria-pressed={trashView}
            >
              삭제된 기업 {trashed.length}
            </button>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            {picked.length > 0 && (
              <>
                <select value={bfMonths} onChange={(e) => setBfMonths(e.target.value)} style={{ ...inputStyle, width: 'auto' }} aria-label="가져올 기간">
                  <option value="3">3개월</option>
                  <option value="6">6개월</option>
                  <option value="12">12개월</option>
                </select>
                <button type="button" className="wh-btn wh-btn-ghost wh-btn-sm" onClick={() => void bulkBackfill()}>
                  선택 {picked.length}곳 과거 데이터 가져오기
                </button>
              </>
            )}
            <button type="button" className="wh-btn wh-btn-primary wh-btn-sm" onClick={() => setModal(true)}>
              + 투자기업 등록
            </button>
          </div>
        </div>

        <div style={{ padding: '0 16px' }}>
          <ErrorBox message={error} />
          {notice && <div style={{ ...mutedText, marginBottom: 12, color: 'var(--success)' }}>{notice}</div>}
        </div>

        {trashView ? (
          trashed.length === 0 ? (
            <div style={{ ...mutedText, padding: '32px 16px', textAlign: 'center' }}>삭제된 기업이 없습니다.</div>
          ) : (
            <div style={{ overflow: 'auto', maxHeight: 'max(360px, calc(100vh - 380px))' }}>
              <div style={{ ...mutedText, fontSize: 12, padding: '0 16px 8px' }}>
                화면에서만 지운 기업입니다. 기사·원장·폴더 파일은 남아 있어 [복구]할 수 있습니다. [폴더까지 완전 삭제]는 관리자만, 되돌릴 수 없습니다.
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
                <thead>
                  <tr>
                    <th style={th}>기업</th>
                    <th style={th}>삭제한 날</th>
                    <th style={{ ...th, textAlign: 'right' }}>누적 기사</th>
                    <th style={{ ...th, textAlign: 'right' }}>작업</th>
                  </tr>
                </thead>
                <tbody>
                  {trashed.map((c) => (
                    <tr key={c.id}>
                      <td style={td}>
                        <Link href={`/content/company-report/companies/${c.id}`} style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>
                          {c.name}
                        </Link>
                      </td>
                      <td style={{ ...td, fontSize: 13 }}>{fmtDate(c.deleted_at, true)}</td>
                      <td style={num}>{c.stats.total}</td>
                      <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button type="button" className="wh-btn wh-btn-ghost wh-btn-sm" disabled={busy === c.id} onClick={() => void restore(c)}>
                          복구
                        </button>{' '}
                        {me?.is_admin && (
                          <button
                            type="button"
                            className="wh-btn wh-btn-ghost wh-btn-sm"
                            onClick={() => setPurgeTarget({ id: c.id, name: c.name })}
                            style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}
                          >
                            폴더까지 완전 삭제
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : loading ? (
          <Spinner />
        ) : shown.length === 0 ? (
          <div style={{ ...mutedText, padding: '32px 16px', textAlign: 'center' }}>
            {items.length === 0 ? '등록된 투자기업이 없습니다. [+ 투자기업 등록]으로 시작하세요.' : '조건에 맞는 기업이 없습니다.'}
          </div>
        ) : (
          <div style={{ overflow: 'auto', maxHeight: 'max(360px, calc(100vh - 380px))' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 800 }}>
              <thead>
                <tr>
                  <th style={{ ...th, width: 32 }}>
                    <input
                      type="checkbox"
                      aria-label="전체 선택"
                      checked={shown.filter((c) => c.is_active).length > 0 && shown.filter((c) => c.is_active).every((c) => picked.includes(c.id))}
                      onChange={(e) => setPicked(e.target.checked ? shown.filter((c) => c.is_active).map((c) => c.id) : [])}
                    />
                  </th>
                  <th style={th}>기업</th>
                  <th style={th}>대표 · 업종</th>
                  <th style={{ ...th, textAlign: 'right' }}>오늘</th>
                  <th style={{ ...th, textAlign: 'right' }}>7일</th>
                  <th style={{ ...th, textAlign: 'right' }}>7일 주의</th>
                  <th style={{ ...th, textAlign: 'right' }}>누적</th>
                  <th style={th}>최근 수집</th>
                  <th style={{ ...th, textAlign: 'right' }}>작업</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((c) => (
                  <tr key={c.id} style={{ opacity: c.is_active ? 1 : 0.55 }}>
                    <td style={td}>
                      <input
                        type="checkbox"
                        aria-label={`${c.name} 선택`}
                        disabled={!c.is_active}
                        checked={picked.includes(c.id)}
                        onChange={(e) => setPicked((p) => (e.target.checked ? [...p, c.id] : p.filter((x) => x !== c.id)))}
                      />
                    </td>
                    <td style={td}>
                      <Link href={`/content/company-report/companies/${c.id}`} style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                        {c.name}
                      </Link>
                      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                        <span className={`wh-badge ${c.is_listed ? 'info' : 'warn'}`}>{c.is_listed ? '상장' : '비상장'}</span>
                        {!c.is_active && <span className="wh-badge neg">비활성</span>}
                      </div>
                    </td>
                    <td style={td}>
                      {c.ceo_name || '-'}
                      <div style={{ ...mutedText, fontSize: 12 }}>{c.industry || ''}</div>
                    </td>
                    <td style={num}>{c.stats.today}</td>
                    <td style={num}>{c.stats.week}</td>
                    <td style={{ ...num, color: c.stats.caution_week ? 'var(--danger)' : td.color }}>{c.stats.caution_week}</td>
                    <td style={num}>{c.stats.total}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap', fontSize: 13 }}>{fmtDate(c.last_collected_at, true)}</td>
                    <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {c.is_active && (
                        <button
                          type="button"
                          className="wh-btn wh-btn-ghost wh-btn-sm"
                          disabled={busy === c.id}
                          onClick={() => void collect(c)}
                          style={{ marginRight: 6 }}
                        >
                          지금 수집
                        </button>
                      )}
                      <button type="button" className="wh-btn wh-btn-ghost wh-btn-sm" disabled={busy === c.id} onClick={() => void toggleActive(c)}>
                        {c.is_active ? '비활성' : '다시 활성'}
                      </button>{' '}
                      <button
                        type="button"
                        className="wh-btn wh-btn-ghost wh-btn-sm"
                        disabled={busy === c.id}
                        onClick={() => setTrashTarget({ id: c.id, name: c.name })}
                        style={{ color: 'var(--danger)' }}
                      >
                        삭제
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <TrashModal
        target={trashTarget}
        onClose={() => setTrashTarget(null)}
        onDone={(name) => {
          setNotice(`${name}을(를) 화면에서 삭제했습니다. [삭제된 기업]에서 복구하거나 완전 삭제할 수 있습니다.`);
          setPicked((p) => p.filter((x) => x !== trashTarget?.id));
          void load();
        }}
      />
      <PurgeModal
        target={purgeTarget}
        onClose={() => setPurgeTarget(null)}
        onDone={(name) => {
          setNotice(`${name}의 데이터와 폴더를 완전히 삭제했습니다.`);
          void load();
        }}
      />

      <CompanyRegisterModal
        open={modal}
        onClose={() => setModal(false)}
        onCreated={(c) => {
          setNotice(`${c.name}을(를) 등록했습니다. 과거 기사 수집·요약을 뒤에서 진행합니다.`);
          void load();
        }}
      />
    </div>
  );
}
