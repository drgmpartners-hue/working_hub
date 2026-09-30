/**
 * 대표 전용 — 감사 로그 (docs/login_logic P6-4, 결정 D-5).
 * 로그인한 사용자의 모든 등록·수정·삭제와 대행 시작·종료가 남는다.
 * 매니저는 본인 기록도 볼 수 없다(서버에서 403).
 */
'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ACTION_LABEL,
  RESOURCE_LABEL,
  adminApi,
  cell,
  fmtDateTime,
  headCell,
  type AuditItem,
  type ManagerRow,
} from '../_lib/api';

const PAGE = 50;

const ctl: React.CSSProperties = {
  height: 36, padding: '0 10px', borderRadius: 8, border: '1px solid var(--border-strong)',
  background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: '0.8125rem',
};

export default function AuditLogsPage() {
  const [filters, setFilters] = useState({ date_from: '', date_to: '', user_id: '', action: '', impersonated: '' });
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<{ total: number; items: AuditItem[] } | null>(null);
  const [people, setPeople] = useState<ManagerRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    (f: typeof filters, off: number) => {
      const qs = new URLSearchParams();
      Object.entries(f).forEach(([k, v]) => { if (v) qs.set(k, v); });
      qs.set('limit', String(PAGE));
      qs.set('offset', String(off));
      return adminApi<{ total: number; items: AuditItem[] }>(`/admin/audit-logs?${qs}`)
        .then((d) => { setData(d); setError(null); })
        .catch((e) => setError(e instanceof Error ? e.message : '불러오지 못했습니다.'));
    },
    [],
  );

  useEffect(() => {
    load(filters, offset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset, load]);

  useEffect(() => {
    adminApi<ManagerRow[]>('/managers').then(setPeople).catch(() => setPeople([]));
  }, []);

  const search = () => {
    setOffset(0);
    load(filters, 0);
  };

  const who = (it: AuditItem) =>
    it.is_impersonated ? (
      <>
        <span>{it.actor ?? '-'}</span>
        <span className="wh-badge warn" style={{ marginLeft: 6 }}>대행</span>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>→ {it.effective ?? '-'} 계정으로</div>
      </>
    ) : (
      <span>{it.actor ?? '-'}</span>
    );

  const total = data?.total ?? 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <span className="section-tag">관리자</span>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: '6px 0 4px' }}>감사 로그</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: 0 }}>
            누가 언제 무엇을 등록·수정·삭제했는지와 대행 기록을 봅니다. 대표 계정에만 보입니다.
          </p>
        </div>
        <Link className="wh-btn wh-btn-ghost wh-btn-sm" href="/admin">통합 현황</Link>
      </div>

      <div className="dcard">
        <div style={{ padding: '14px 20px', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input type="date" style={ctl} value={filters.date_from} onChange={(e) => setFilters({ ...filters, date_from: e.target.value })} />
          <span style={{ color: 'var(--text-muted)' }}>~</span>
          <input type="date" style={ctl} value={filters.date_to} onChange={(e) => setFilters({ ...filters, date_to: e.target.value })} />
          <select style={ctl} value={filters.user_id} onChange={(e) => setFilters({ ...filters, user_id: e.target.value })}>
            <option value="">사람 전체</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.nickname} ({p.email})</option>)}
          </select>
          <select style={ctl} value={filters.action} onChange={(e) => setFilters({ ...filters, action: e.target.value })}>
            <option value="">동작 전체</option>
            {Object.entries(ACTION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select style={ctl} value={filters.impersonated} onChange={(e) => setFilters({ ...filters, impersonated: e.target.value })}>
            <option value="">대행 여부 전체</option>
            <option value="true">대행 기록만</option>
            <option value="false">본인 작업만</option>
          </select>
          <button className="wh-btn wh-btn-primary wh-btn-sm" onClick={search}>조회</button>
        </div>
      </div>

      {error && <div style={{ padding: 14, borderRadius: 10, background: 'var(--danger-bg)', color: 'var(--danger)', fontSize: 14 }}>{error}</div>}

      <div className="dcard">
        <div className="dcard-head">
          <h4>기록 {total.toLocaleString()}건</h4>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, color: 'var(--text-muted)' }}>
            {total > 0 && <span>{offset + 1}–{Math.min(offset + PAGE, total)}</span>}
            <button className="wh-btn wh-btn-ghost wh-btn-sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>이전</button>
            <button className="wh-btn wh-btn-ghost wh-btn-sm" disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>다음</button>
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>{['시각', '누가', '동작', '메뉴', '고객', '결과'].map((h) => <th key={h} style={headCell}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {!data ? (
                <tr><td colSpan={6} style={{ ...cell, textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>불러오는 중...</td></tr>
              ) : data.items.length === 0 ? (
                <tr><td colSpan={6} style={{ ...cell, textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>기록이 없습니다.</td></tr>
              ) : data.items.map((it) => {
                const ok = it.status_code === null || (it.status_code >= 200 && it.status_code < 400);
                return (
                  <tr key={it.id}>
                    <td style={{ ...cell, whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>{fmtDateTime(it.created_at)}</td>
                    <td style={cell}>{who(it)}</td>
                    <td style={cell}>{ACTION_LABEL[it.action] ?? it.action}</td>
                    <td style={cell} title={it.path ?? undefined}>
                      {RESOURCE_LABEL[it.resource_type ?? ''] ?? it.resource_type ?? '-'}
                    </td>
                    <td style={cell}>{it.client_name ?? (it.client_id ? '(삭제된 고객)' : '-')}</td>
                    <td style={cell}>
                      <span className={`wh-badge ${ok ? 'pos' : 'neg'}`}>{ok ? '성공' : `실패 ${it.status_code}`}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
