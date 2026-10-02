/**
 * 대표 전용 — 통합 현황 (docs/login_logic P4-4, 결정 D-3).
 * 매니저 계정으로 전환하지 않고 매니저별 고객·계좌·업무 자료를 한 화면에서 본다.
 */
'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { adminApi, cell, fmtDateTime, headCell, type Overview } from './_lib/api';
import { SecurityStatusCard } from './_lib/SecurityStatusCard';
import { SwitchButton } from './_lib/SwitchButton';

const KPIS: { key: keyof Overview['totals']; label: string }[] = [
  { key: 'managers', label: '활성 매니저' },
  { key: 'clients', label: '전체 고객' },
  { key: 'accounts', label: '전체 계좌' },
  { key: 'content_projects', label: '콘텐츠' },
];

export default function AdminOverviewPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  // 대행 시간이 끝나 자동 복귀한 경우 안내
  const [expired, setExpired] = useState(() =>
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('impersonation') === 'expired',
  );

  const load = useCallback(
    () =>
      adminApi<Overview>('/admin/overview')
        .then((d) => {
          setData(d);
          setError(null);
        })
        .catch((e) => setError(e instanceof Error ? e.message : '불러오지 못했습니다.')),
    [],
  );

  useEffect(() => {
    load();
  }, [load]);

  const rows = (data?.by_manager ?? []).filter((m) => showInactive || m.is_active);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <span className="section-tag">관리자</span>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: '6px 0 4px' }}>통합 현황</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: 0 }}>
            매니저별 담당 고객과 업무 자료를 한 화면에서 봅니다. 대표 계정에만 보입니다.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="wh-btn wh-btn-ghost wh-btn-sm" onClick={load}>새로고침</button>
          <Link className="wh-btn wh-btn-primary wh-btn-sm" href="/admin/managers">매니저 관리</Link>
        </div>
      </div>

      {expired && (
        <div style={{ padding: '12px 16px', borderRadius: 10, background: 'var(--warning-bg)', color: 'var(--warning)', fontSize: 14, display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <span>대행 세션이 끝나 대표 계정으로 돌아왔습니다. 계속하려면 다시 전환하세요.</span>
          <button className="wh-btn wh-btn-ghost wh-btn-sm" onClick={() => setExpired(false)}>닫기</button>
        </div>
      )}

      {error && (
        <div style={{ padding: 16, borderRadius: 10, background: 'var(--danger-bg)', color: 'var(--danger)' }}>{error}</div>
      )}

      <SecurityStatusCard />

      {!data && !error && (
        <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>불러오는 중...</div>
      )}

      {data && (
        <>
          <div className="kpi-grid">
            {KPIS.map((k) => (
              <div key={k.key} className="kpi">
                <div className="head">{k.label}</div>
                <div className="v">{data.totals[k.key].toLocaleString()}</div>
              </div>
            ))}
          </div>

          {data.unassigned_clients > 0 && (
            <div style={{ padding: '12px 16px', borderRadius: 10, background: 'var(--warning-bg)', color: 'var(--warning)', fontSize: 14 }}>
              비활성(퇴사) 계정에 남아 있는 고객이 {data.unassigned_clients}명 있습니다. 담당자 이관이 필요합니다.
            </div>
          )}

          <div className="dcard">
            <div className="dcard-head">
              <h4>매니저별 현황</h4>
              <label style={{ fontSize: 13, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
                비활성 계정 포함
              </label>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['이름', '역할', '고객', '계좌', '신규 고객(7일)', '문자(7일)', '콘텐츠', '포트폴리오 분석', '최근 로그인', ''].map((h) => (
                      <th key={h} style={headCell}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr><td colSpan={10} style={{ ...cell, textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>계정이 없습니다.</td></tr>
                  ) : rows.map((m) => (
                    <tr key={m.id} style={{ opacity: m.is_active ? 1 : 0.55 }}>
                      <td style={{ ...cell, fontWeight: 600 }}>
                        <Link href={`/admin/managers/${m.id}`} style={{ color: 'var(--text-primary)' }}>{m.nickname}</Link>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 400 }}>{m.email}</div>
                      </td>
                      <td style={cell}>
                        <span className={`wh-badge ${m.role === 'owner' ? 'info' : ''}`}>{m.role === 'owner' ? '대표' : '매니저'}</span>
                        {!m.is_active && <span className="wh-badge neg" style={{ marginLeft: 6 }}>비활성</span>}
                      </td>
                      <td style={cell}>{m.stats.clients}</td>
                      <td style={cell}>{m.stats.accounts}</td>
                      <td style={cell}>{m.stats.new_clients_7d}</td>
                      <td style={cell}>{m.stats.messages_7d}</td>
                      <td style={cell}>{m.stats.content_projects}</td>
                      <td style={cell}>{m.stats.portfolio_analyses}</td>
                      <td style={{ ...cell, whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>{fmtDateTime(m.last_login)}</td>
                      <td style={{ ...cell, whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <Link className="wh-btn wh-btn-ghost wh-btn-sm" href={`/customer-management?manager_id=${m.id}`}>고객 보기</Link>
                          <Link className="wh-btn wh-btn-ghost wh-btn-sm" href={`/admin/managers/${m.id}`}>상세</Link>
                          {m.role === 'manager' && m.is_active && <SwitchButton id={m.id} nickname={m.nickname} />}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
