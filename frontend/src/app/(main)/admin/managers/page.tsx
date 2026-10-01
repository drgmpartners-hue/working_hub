/**
 * 대표 전용 — 매니저 관리 (docs/login_logic P4-4, 결정 D-1).
 * 공개 가입이 닫혀 있으므로 계정은 여기서만 만든다.
 * 임시 비밀번호는 발급 직후 이 화면에서 한 번만 보이고 서버에 평문으로 남지 않는다.
 */
'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { adminApi, cell, fmtDateTime, headCell, type ManagerRow } from '../_lib/api';
import { ProgramChecklist, programSummary } from '../_lib/ProgramChecklist';
import { PROGRAM_KEYS } from '@/lib/programs';

interface Issued {
  email: string;
  nickname: string;
  temp_password: string;
  reason: 'created' | 'reset';
}

const input: React.CSSProperties = {
  height: 38, padding: '0 12px', borderRadius: 8, border: '1px solid var(--border-strong)',
  background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: '0.875rem', minWidth: 0,
};

export default function AdminManagersPage() {
  const [rows, setRows] = useState<ManagerRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [issued, setIssued] = useState<Issued | null>(null);
  const [form, setForm] = useState({ email: '', nickname: '', phone: '' });
  // 사용 프로그램 (docs/login_logic P11): 새 매니저는 대표가 열어 준 것만
  const [newPrograms, setNewPrograms] = useState<string[]>([]);
  const [progEdit, setProgEdit] = useState<{ m: ManagerRow; value: string[] } | null>(null);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<{ id: string; nickname: string; phone: string } | null>(null);
  // 퇴사 처리: 고객 일괄 이관 (지시서 9.4 — 이관 → 담당 고객 0명 확인 → 비활성화)
  const [moving, setMoving] = useState<{ from: ManagerRow; to: string; reason: string } | null>(null);

  const load = useCallback(
    () =>
      adminApi<ManagerRow[]>('/managers')
        .then(setRows)
        .catch((e) => setError(e instanceof Error ? e.message : '불러오지 못했습니다.')),
    [],
  );

  useEffect(() => {
    load();
  }, [load]);

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    setNotice(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '요청을 처리하지 못했습니다.');
    }
  };

  const savePrograms = async () => {
    if (!progEdit) return;
    const { m, value } = progEdit;
    await run(async () => {
      await adminApi(`/managers/${m.id}`, { method: 'PATCH', body: JSON.stringify({ allowed_programs: value }) });
      setNotice(`${m.nickname}님의 사용 프로그램을 저장했습니다. 서버 권한은 바로 적용되고, 메뉴는 그 매니저가 새로고침하면 바뀝니다.`);
      setProgEdit(null);
    });
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.email.trim() || !form.nickname.trim()) {
      setError('이메일과 이름을 입력하세요.');
      return;
    }
    setSaving(true);
    await run(async () => {
      const res = await adminApi<{ email: string; nickname: string; temp_password: string }>('/managers', {
        method: 'POST',
        body: JSON.stringify({
          email: form.email.trim(), nickname: form.nickname.trim(), phone: form.phone.trim() || null,
          allowed_programs: newPrograms,
        }),
      });
      setIssued({ ...res, reason: 'created' });
      setForm({ email: '', nickname: '', phone: '' });
      setNewPrograms([]);
    });
    setSaving(false);
  };

  const toggleActive = (m: ManagerRow) =>
    run(async () => {
      if (m.is_active && !confirm(`${m.nickname} 계정을 비활성화할까요? 비활성 계정은 로그인할 수 없습니다.`)) return;
      await adminApi(`/managers/${m.id}`, { method: 'PATCH', body: JSON.stringify({ is_active: !m.is_active }) });
      setNotice(m.is_active ? `${m.nickname} 계정을 비활성화했습니다.` : `${m.nickname} 계정을 다시 활성화했습니다.`);
    });

  const resetPassword = (m: ManagerRow) =>
    run(async () => {
      if (!confirm(`${m.nickname} 계정의 비밀번호를 임시 비밀번호로 바꿀까요? 기존 비밀번호로는 더 이상 로그인할 수 없습니다.`)) return;
      const res = await adminApi<{ email: string; temp_password: string }>(`/managers/${m.id}/reset-password`, { method: 'POST' });
      setIssued({ email: res.email, nickname: m.nickname, temp_password: res.temp_password, reason: 'reset' });
    });

  const transferAll = () =>
    run(async () => {
      if (!moving) return;
      if (!moving.to) throw new Error('이관 받을 계정을 고르세요.');
      const res = await adminApi<{ moved: number }>(`/managers/${moving.from.id}/transfer-all`, {
        method: 'POST',
        body: JSON.stringify({ to_user_id: moving.to, reason: moving.reason.trim() || null }),
      });
      const toName = rows?.find((r) => r.id === moving.to)?.nickname ?? '';
      setNotice(`${moving.from.nickname}님의 고객 ${res.moved}명을 ${toName}님에게 이관했습니다. 이제 비활성화할 수 있습니다.`);
      setMoving(null);
    });

  const saveEdit = () =>
    run(async () => {
      if (!editing) return;
      await adminApi(`/managers/${editing.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ nickname: editing.nickname.trim(), phone: editing.phone.trim() || null }),
      });
      setEditing(null);
      setNotice('저장했습니다.');
    });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <span className="section-tag">관리자</span>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: '6px 0 4px' }}>매니저 관리</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: 0 }}>
            이 시스템은 내부 전용입니다. 새 계정은 여기서 매니저로 추가합니다.
          </p>
        </div>
        <Link className="wh-btn wh-btn-ghost wh-btn-sm" href="/admin">통합 현황</Link>
      </div>

      {error && <div style={{ padding: 14, borderRadius: 10, background: 'var(--danger-bg)', color: 'var(--danger)', fontSize: 14 }}>{error}</div>}
      {notice && <div style={{ padding: 14, borderRadius: 10, background: 'var(--success-bg)', color: 'var(--success)', fontSize: 14 }}>{notice}</div>}

      {issued && (
        <div className="dcard" style={{ borderColor: 'var(--warning)' }}>
          <div className="dcard-head">
            <h4>{issued.reason === 'created' ? '매니저 계정을 만들었습니다' : '임시 비밀번호를 발급했습니다'}</h4>
            <button className="wh-btn wh-btn-ghost wh-btn-sm" onClick={() => setIssued(null)}>확인했습니다</button>
          </div>
          <div style={{ padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 10, fontSize: 14 }}>
            <div>{issued.nickname} · {issued.email}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ color: 'var(--text-muted)' }}>임시 비밀번호</span>
              <code style={{ fontSize: 18, fontWeight: 700, padding: '6px 12px', borderRadius: 8, background: 'var(--bg-surface)', letterSpacing: '.04em' }}>
                {issued.temp_password}
              </code>
              <button
                className="wh-btn wh-btn-ghost wh-btn-sm"
                onClick={() => navigator.clipboard?.writeText(issued.temp_password).then(() => setNotice('임시 비밀번호를 복사했습니다.'))}
              >
                복사
              </button>
            </div>
            <div style={{ color: 'var(--warning)', fontSize: 13 }}>
              이 비밀번호는 지금 한 번만 보입니다. 매니저에게 전달하고, 첫 로그인 뒤 [프로필]에서 바꾸도록 안내하세요.
            </div>
          </div>
        </div>
      )}

      {moving && (
        <div className="dcard" style={{ borderColor: 'var(--blue-400)' }}>
          <div className="dcard-head">
            <h4>고객 일괄 이관 · {moving.from.nickname} (담당 고객 {moving.from.stats.clients}명)</h4>
            <button className="wh-btn wh-btn-ghost wh-btn-sm" onClick={() => setMoving(null)}>취소</button>
          </div>
          <div style={{ padding: '16px 24px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, alignItems: 'center' }}>
            <select style={input} value={moving.to} onChange={(e) => setMoving({ ...moving, to: e.target.value })}>
              <option value="">이관 받을 계정 선택</option>
              {(rows ?? []).filter((r) => r.is_active && r.id !== moving.from.id).map((r) => (
                <option key={r.id} value={r.id}>{r.nickname} ({r.role === 'owner' ? '대표' : '매니저'})</option>
              ))}
            </select>
            <input style={input} placeholder="사유 (예: 퇴사)" value={moving.reason} maxLength={300} onChange={(e) => setMoving({ ...moving, reason: e.target.value })} />
            <button className="wh-btn wh-btn-primary wh-btn-sm" onClick={transferAll}>전체 이관</button>
          </div>
          <div style={{ padding: '0 24px 16px', fontSize: 13, color: 'var(--text-muted)' }}>
            고객과 그 계좌·플랜·기록이 한 번에 넘어갑니다. 콘텐츠 같은 개인 자료는 원래 계정에 남습니다.
          </div>
        </div>
      )}

      <form className="dcard" onSubmit={create}>
        <div className="dcard-head"><h4>매니저 추가</h4></div>
        <div style={{ padding: '16px 24px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, alignItems: 'center' }}>
          <input style={input} type="email" placeholder="이메일 (로그인 아이디)" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <input style={input} placeholder="이름" value={form.nickname} onChange={(e) => setForm({ ...form, nickname: e.target.value })} />
          <input style={input} placeholder="휴대폰 (선택)" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <button className="wh-btn wh-btn-primary wh-btn-sm" type="submit" disabled={saving}>{saving ? '만드는 중...' : '계정 만들기'}</button>
        </div>
        <div style={{ padding: '0 24px 18px' }}>
          <ProgramChecklist value={newPrograms} onChange={setNewPrograms} />
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
            체크한 프로그램만 메뉴에 보이고 쓸 수 있습니다. 메인·대시보드·내 정보는 누구나 씁니다. 나중에 목록의 [프로그램]에서 바꿀 수 있습니다.
          </div>
        </div>
      </form>

      {progEdit && (
        <div className="dcard">
          <div className="dcard-head">
            <h4>사용 프로그램 · {progEdit.m.nickname}</h4>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="wh-btn wh-btn-primary wh-btn-sm" onClick={savePrograms}>저장</button>
              <button className="wh-btn wh-btn-ghost wh-btn-sm" onClick={() => setProgEdit(null)}>닫기</button>
            </div>
          </div>
          <div style={{ padding: '16px 24px' }}>
            <ProgramChecklist value={progEdit.value} onChange={(v) => setProgEdit({ ...progEdit, value: v })} />
          </div>
        </div>
      )}

      <div className="dcard">
        <div className="dcard-head"><h4>계정 목록</h4></div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['이름', '이메일', '휴대폰', '역할', '상태', '사용 프로그램', '담당 고객', '최근 로그인', '만든 날', ''].map((h) => (
                  <th key={h} style={headCell}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!rows ? (
                <tr><td colSpan={10} style={{ ...cell, textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>불러오는 중...</td></tr>
              ) : rows.map((m) => {
                const isEditing = editing?.id === m.id;
                const isOwnerRow = m.role === 'owner';
                return (
                  <tr key={m.id} style={{ opacity: m.is_active ? 1 : 0.6 }}>
                    <td style={{ ...cell, fontWeight: 600, whiteSpace: 'nowrap' }}>
                      {isEditing ? (
                        <input style={{ ...input, width: 140 }} value={editing.nickname} onChange={(e) => setEditing({ ...editing, nickname: e.target.value })} />
                      ) : (
                        <Link href={`/admin/managers/${m.id}`} style={{ color: 'var(--text-primary)' }}>{m.nickname}</Link>
                      )}
                    </td>
                    <td style={{ ...cell, color: 'var(--text-secondary)' }}>{m.email}</td>
                    <td style={{ ...cell, color: 'var(--text-secondary)' }}>
                      {isEditing ? (
                        <input style={{ ...input, width: 140 }} value={editing.phone} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} />
                      ) : (m.phone || '-')}
                    </td>
                    <td style={cell}><span className={`wh-badge ${isOwnerRow ? 'info' : ''}`}>{isOwnerRow ? '대표' : '매니저'}</span></td>
                    <td style={cell}>
                      <span className={`wh-badge ${m.is_active ? 'pos' : 'neg'}`}>{m.is_active ? '활성' : '비활성'}</span>
                    </td>
                    <td style={{ ...cell, whiteSpace: 'nowrap' }}>
                      {isOwnerRow ? (
                        <span style={{ color: 'var(--text-muted)' }}>전체</span>
                      ) : (
                        <button
                          className="wh-btn wh-btn-ghost wh-btn-sm"
                          title="이 매니저가 쓸 수 있는 프로그램 고르기"
                          onClick={() => setProgEdit({ m, value: m.allowed_programs ?? [...PROGRAM_KEYS] })}
                        >
                          {programSummary(m.allowed_programs, false)} ▾
                        </button>
                      )}
                    </td>
                    <td style={cell}>{m.stats.clients}</td>
                    <td style={{ ...cell, whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>{fmtDateTime(m.last_login)}</td>
                    <td style={{ ...cell, whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>{fmtDateTime(m.created_at)}</td>
                    <td style={{ ...cell, whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        {isEditing ? (
                          <>
                            <button className="wh-btn wh-btn-primary wh-btn-sm" onClick={saveEdit}>저장</button>
                            <button className="wh-btn wh-btn-ghost wh-btn-sm" onClick={() => setEditing(null)}>취소</button>
                          </>
                        ) : (
                          <>
                            <button className="wh-btn wh-btn-ghost wh-btn-sm" onClick={() => setEditing({ id: m.id, nickname: m.nickname, phone: m.phone || '' })}>수정</button>
                            {m.stats.clients > 0 && (
                              <button className="wh-btn wh-btn-ghost wh-btn-sm" onClick={() => setMoving({ from: m, to: '', reason: '' })}>
                                고객 일괄 이관
                              </button>
                            )}
                            {!isOwnerRow && (
                              <>
                                <button className="wh-btn wh-btn-ghost wh-btn-sm" onClick={() => resetPassword(m)}>비밀번호 재발급</button>
                                <button
                                  className="wh-btn wh-btn-ghost wh-btn-sm"
                                  onClick={() => toggleActive(m)}
                                  title={m.is_active && m.stats.clients > 0 ? '담당 고객을 먼저 다른 매니저에게 이관해야 합니다' : undefined}
                                >
                                  {m.is_active ? '비활성화' : '다시 활성화'}
                                </button>
                              </>
                            )}
                          </>
                        )}
                      </div>
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
