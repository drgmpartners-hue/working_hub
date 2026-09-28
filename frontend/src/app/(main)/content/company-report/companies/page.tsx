'use client';

/** 투자기업 관리 — 목록·등록·수집·비활성 (기획 4장 화면 ①) */
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/common/Card';
import { CompanyRegisterModal } from '@/components/company-report/CompanyRegisterModal';
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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await crGet<Company[]>(showInactive ? '/companies' : '/companies?active=true'));
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
          </div>
          <button type="button" className="wh-btn wh-btn-primary wh-btn-sm" onClick={() => setModal(true)}>
            + 투자기업 등록
          </button>
        </div>

        <div style={{ padding: '0 16px' }}>
          <ErrorBox message={error} />
          {notice && <div style={{ ...mutedText, marginBottom: 12, color: 'var(--success)' }}>{notice}</div>}
        </div>

        {loading ? (
          <Spinner />
        ) : shown.length === 0 ? (
          <div style={{ ...mutedText, padding: '32px 16px', textAlign: 'center' }}>
            {items.length === 0 ? '등록된 투자기업이 없습니다. [+ 투자기업 등록]으로 시작하세요.' : '조건에 맞는 기업이 없습니다.'}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
              <thead>
                <tr>
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
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

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
