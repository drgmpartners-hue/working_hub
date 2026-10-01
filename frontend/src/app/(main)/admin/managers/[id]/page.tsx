/**
 * 대표 전용 — 매니저 상세 (docs/login_logic P4-6, 결정 D-3).
 * 한 매니저의 담당 고객 전체와 콘텐츠·포트폴리오 분석·문자 최근 항목을 모아 본다. (수당정산은 2026-10-01 삭제)
 */
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { adminApi, cell, fmtDate, fmtDateTime, headCell, type ManagerSummary } from '../../_lib/api';
import { SwitchButton } from '../../_lib/SwitchButton';

function Section({ title, empty, children }: { title: string; empty: boolean; children: React.ReactNode }) {
  return (
    <div className="dcard">
      <div className="dcard-head"><h4>{title}</h4></div>
      {empty ? <div style={{ padding: 20, color: 'var(--text-muted)', fontSize: 14 }}>없음</div> : children}
    </div>
  );
}

export default function AdminManagerDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [data, setData] = useState<ManagerSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    adminApi<ManagerSummary>(`/managers/${id}/summary`)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : '불러오지 못했습니다.'));
  }, [id]);

  if (error) return <div style={{ padding: 16, borderRadius: 10, background: 'var(--danger-bg)', color: 'var(--danger)' }}>{error}</div>;
  if (!data) return <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>불러오는 중...</div>;

  const m = data.manager;
  const s = data.stats;
  const kpis = [
    ['담당 고객', s.clients],
    ['계좌', s.accounts],
    ['콘텐츠', s.content_projects],
    ['문자(7일)', s.messages_7d],
  ] as const;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <span className="section-tag">관리자 · 매니저 상세</span>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: '6px 0 4px' }}>
            {m.nickname}{' '}
            <span className={`wh-badge ${m.role === 'owner' ? 'info' : ''}`} style={{ verticalAlign: 'middle' }}>{m.role === 'owner' ? '대표' : '매니저'}</span>{' '}
            {!m.is_active && <span className="wh-badge neg" style={{ verticalAlign: 'middle' }}>비활성</span>}
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: 0 }}>
            {m.email}{m.phone ? ` · ${m.phone}` : ''} · 최근 로그인 {fmtDateTime(m.last_login)}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link className="wh-btn wh-btn-ghost wh-btn-sm" href="/admin">통합 현황</Link>
          <Link className="wh-btn wh-btn-ghost wh-btn-sm" href={`/customer-management?manager_id=${m.id}`}>고객 관리에서 보기</Link>
          {m.role === 'manager' && m.is_active && <SwitchButton id={m.id} nickname={m.nickname} primary />}
        </div>
      </div>

      <div className="kpi-grid">
        {kpis.map(([label, v]) => (
          <div key={label} className="kpi"><div className="head">{label}</div><div className="v">{v.toLocaleString()}</div></div>
        ))}
      </div>

      <Section title={`담당 고객 (${data.clients.length}명)`} empty={data.clients.length === 0}>
        <div style={{ overflowX: 'auto', maxHeight: 420 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{['고객명', '고유번호', '계좌', '등록일'].map((h) => <th key={h} style={headCell}>{h}</th>)}</tr></thead>
            <tbody>
              {data.clients.map((c) => (
                <tr key={c.id}>
                  <td style={{ ...cell, fontWeight: 600 }}>{c.name}</td>
                  <td style={{ ...cell, fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{c.unique_code || '-'}</td>
                  <td style={cell}>{c.accounts}</td>
                  <td style={{ ...cell, color: 'var(--text-secondary)' }}>{fmtDate(c.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 20 }}>
        <Section title="최근 문자 발송" empty={data.recent_messages.length === 0}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {data.recent_messages.map((r) => (
                <tr key={r.id}>
                  <td style={{ ...cell, whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>{fmtDateTime(r.sent_at)}</td>
                  <td style={cell}>{r.client_name}</td>
                  <td style={{ ...cell, color: 'var(--text-secondary)' }}>{r.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
        <Section title="최근 콘텐츠" empty={data.recent_content_projects.length === 0}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {data.recent_content_projects.map((r) => (
                <tr key={r.id}>
                  <td style={{ ...cell, whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>{fmtDateTime(r.created_at)}</td>
                  <td style={cell}>{r.title}</td>
                  <td style={{ ...cell, color: 'var(--text-secondary)' }}>{r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
        <Section title="최근 포트폴리오 분석" empty={data.recent_portfolio_analyses.length === 0}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {data.recent_portfolio_analyses.map((r) => (
                <tr key={r.id}>
                  <td style={{ ...cell, whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>{fmtDateTime(r.created_at)}</td>
                  <td style={cell}>{r.data_source}</td>
                  <td style={{ ...cell, color: 'var(--text-secondary)' }}>{r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      </div>
    </div>
  );
}
