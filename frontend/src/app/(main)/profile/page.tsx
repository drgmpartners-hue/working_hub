/**
 * 내 정보 (프로필) — 상단 이름을 누르면 오는 화면.
 *
 * 공통 레이아웃(main) 안으로 옮겨 상단 메뉴·다크 테마·대행 배너가 그대로 적용된다.
 * - 역할(대표/매니저) 표시
 * - 이름·전화번호 수정, 비밀번호 변경
 * - 계정 삭제 버튼은 두지 않는다. 계정 정리(비활성화)는 대표가 관리자 > 매니저 관리에서 한다 (docs/login_logic)
 * - 대행 중에는 수정·비밀번호 변경을 숨긴다(서버도 403으로 막음)
 */
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/auth';
import { authService } from '@/services/auth';

const input: React.CSSProperties = {
  width: '100%', height: 40, padding: '0 12px', borderRadius: 8, border: '1px solid var(--border-strong)',
  background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: '0.875rem', boxSizing: 'border-box',
};

const label: React.CSSProperties = { display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 };

function Row({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
      <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{name}</span>
      <span style={{ fontSize: 14, color: 'var(--text-primary)' }}>{children}</span>
    </div>
  );
}

function translateError(msg: string | undefined, fallback: string): string {
  if (!msg) return fallback;
  if (/incorrect current password/i.test(msg)) return '현재 비밀번호가 맞지 않습니다.';
  if (/대행/.test(msg)) return msg;
  if (/failed|error/i.test(msg)) return fallback;
  return msg;
}

export default function ProfilePage() {
  const router = useRouter();
  const user = useAuthStore((st) => st.user);
  const session = useAuthStore((st) => st.session);
  const logout = useAuthStore((st) => st.logout);
  const fetchUser = useAuthStore((st) => st.fetchUser);

  const [editing, setEditing] = useState(false);
  const [changingPw, setChangingPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [form, setForm] = useState({ name: '', phone: '' });
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });

  const impersonating = !!session?.is_impersonating;

  useEffect(() => {
    if (user && !editing) setForm({ name: user.nickname || '', phone: user.phone || '' });
  }, [user, editing]);

  if (!user) {
    return <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>불러오는 중...</div>;
  }

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setMsg({ type: 'err', text: '이름을 입력하세요.' });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await authService.updateProfile({ nickname: form.name.trim(), phone: form.phone.trim() || null });
      await fetchUser();
      setEditing(false);
      setMsg({ type: 'ok', text: '내 정보를 저장했습니다.' });
    } catch (err) {
      setMsg({ type: 'err', text: translateError(err instanceof Error ? err.message : undefined, '저장하지 못했습니다.') });
    } finally {
      setBusy(false);
    }
  };

  const savePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    if (pw.next.length < 8) {
      setMsg({ type: 'err', text: '새 비밀번호는 8자 이상이어야 합니다.' });
      return;
    }
    if (pw.next !== pw.confirm) {
      setMsg({ type: 'err', text: '새 비밀번호가 서로 다릅니다.' });
      return;
    }
    setBusy(true);
    try {
      await authService.changePassword({ current_password: pw.current, new_password: pw.next });
      setChangingPw(false);
      setPw({ current: '', next: '', confirm: '' });
      setMsg({ type: 'ok', text: '비밀번호를 바꿨습니다.' });
    } catch (err) {
      setMsg({ type: 'err', text: translateError(err instanceof Error ? err.message : undefined, '비밀번호를 바꾸지 못했습니다.') });
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    await logout();
    router.push('/login');
  };

  const isOwner = user.role === 'owner';

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <span className="section-tag">내 정보</span>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: '6px 0 4px' }}>
          {user.nickname}{' '}
          <span className={`wh-badge ${isOwner ? 'info' : ''}`} style={{ verticalAlign: 'middle' }}>{isOwner ? '대표' : '매니저'}</span>
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: 0 }}>로그인 계정 정보와 비밀번호를 관리합니다.</p>
      </div>

      {impersonating && (
        <div style={{ padding: '12px 16px', borderRadius: 10, background: 'var(--warning-bg)', color: 'var(--warning)', fontSize: 14 }}>
          지금은 {session?.actor.nickname}님이 대행 중이라 이 계정의 정보·비밀번호는 바꿀 수 없습니다.
        </div>
      )}

      {msg && (
        <div
          style={{
            padding: '12px 16px', borderRadius: 10, fontSize: 14,
            background: msg.type === 'ok' ? 'var(--success-bg)' : 'var(--danger-bg)',
            color: msg.type === 'ok' ? 'var(--success)' : 'var(--danger)',
          }}
        >
          {msg.text}
        </div>
      )}

      <div className="dcard">
        <div className="dcard-head">
          <h4>계정 정보</h4>
          {!editing && !impersonating && (
            <button className="wh-btn wh-btn-ghost wh-btn-sm" onClick={() => { setEditing(true); setMsg(null); }}>수정</button>
          )}
        </div>
        <div style={{ padding: '8px 24px 20px' }}>
          {editing ? (
            <form onSubmit={saveProfile} style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 12 }}>
              <div>
                <label style={label} htmlFor="p-name">이름</label>
                <input id="p-name" style={input} value={form.name} maxLength={50} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <label style={label} htmlFor="p-phone">전화번호 (알림 수신용)</label>
                <input id="p-phone" style={input} type="tel" placeholder="010-0000-0000" value={form.phone} maxLength={20} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="wh-btn wh-btn-primary wh-btn-sm" type="submit" disabled={busy}>{busy ? '저장 중...' : '저장'}</button>
                <button className="wh-btn wh-btn-ghost wh-btn-sm" type="button" onClick={() => setEditing(false)}>취소</button>
              </div>
            </form>
          ) : (
            <>
              <Row name="이메일(아이디)">{user.email}</Row>
              <Row name="이름">{user.nickname || '-'}</Row>
              <Row name="전화번호">{user.phone || <span style={{ color: 'var(--text-muted)' }}>미등록</span>}</Row>
              <Row name="역할">{isOwner ? '대표 — 전체 고객·관리자 메뉴' : '매니저 — 담당 고객만'}</Row>
              <Row name="가입일">{new Date(user.created_at).toLocaleDateString('ko-KR')}</Row>
            </>
          )}
        </div>
      </div>

      {!impersonating && (
        <div className="dcard">
          <div className="dcard-head">
            <h4>비밀번호</h4>
            {!changingPw && (
              <button className="wh-btn wh-btn-ghost wh-btn-sm" onClick={() => { setChangingPw(true); setMsg(null); }}>비밀번호 변경</button>
            )}
          </div>
          <div style={{ padding: '12px 24px 20px' }}>
            {changingPw ? (
              <form onSubmit={savePassword} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label style={label} htmlFor="pw-cur">현재 비밀번호</label>
                  <input id="pw-cur" style={input} type="password" autoComplete="current-password" required value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
                </div>
                <div>
                  <label style={label} htmlFor="pw-new">새 비밀번호 (8자 이상)</label>
                  <input id="pw-new" style={input} type="password" autoComplete="new-password" required value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
                </div>
                <div>
                  <label style={label} htmlFor="pw-cf">새 비밀번호 확인</label>
                  <input id="pw-cf" style={input} type="password" autoComplete="new-password" required value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="wh-btn wh-btn-primary wh-btn-sm" type="submit" disabled={busy}>{busy ? '변경 중...' : '비밀번호 변경'}</button>
                  <button className="wh-btn wh-btn-ghost wh-btn-sm" type="button" onClick={() => { setChangingPw(false); setPw({ current: '', next: '', confirm: '' }); }}>취소</button>
                </div>
              </form>
            ) : (
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
                대표에게 받은 임시 비밀번호로 처음 로그인했다면 여기서 바꿔 주세요.
              </p>
            )}
          </div>
        </div>
      )}

      <div className="dcard">
        <div className="dcard-head"><h4>로그아웃</h4></div>
        <div style={{ padding: '12px 24px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            계정을 없애야 할 때는 대표가 관리자 &gt; 매니저 관리에서 비활성화합니다.
          </span>
          <button className="wh-btn wh-btn-ghost wh-btn-sm" onClick={signOut}>로그아웃</button>
        </div>
      </div>
    </div>
  );
}
