'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/auth';
import { authService } from '@/services/auth';
import { Button } from '@/components/common/Button';
import { Card } from '@/components/common/Card';

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.75rem',
  fontWeight: 600,
  color: '#6B7280',
  marginBottom: 4,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  fontSize: '0.875rem',
  border: '1px solid #E1E5EB',
  borderRadius: 8,
  outline: 'none',
  color: '#1A1A2E',
  backgroundColor: '#FFFFFF',
  boxSizing: 'border-box',
};

const readonlyStyle: React.CSSProperties = {
  ...inputStyle,
  backgroundColor: '#F5F7FA',
  color: '#6B7280',
  cursor: 'default',
};

export default function SettingsPage() {
  const router = useRouter();
  const { user, fetchUser } = useAuthStore();

  /* Profile edit */
  const [nickname, setNickname] = useState(user?.nickname || '');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  /* Password change */
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  async function handleProfileSave() {
    if (!nickname.trim()) {
      setProfileMsg({ type: 'error', text: '닉네임을 입력해주세요.' });
      return;
    }
    setProfileSaving(true);
    setProfileMsg(null);
    try {
      await authService.updateProfile({ nickname: nickname.trim() });
      await fetchUser();
      setProfileMsg({ type: 'success', text: '프로필이 수정되었습니다.' });
    } catch (e) {
      setProfileMsg({ type: 'error', text: e instanceof Error ? e.message : '수정에 실패했습니다.' });
    } finally {
      setProfileSaving(false);
    }
  }

  async function handlePasswordChange() {
    setPwMsg(null);
    if (!currentPassword || !newPassword) {
      setPwMsg({ type: 'error', text: '현재 비밀번호와 새 비밀번호를 입력해주세요.' });
      return;
    }
    if (newPassword.length < 6) {
      setPwMsg({ type: 'error', text: '새 비밀번호는 6자 이상이어야 합니다.' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwMsg({ type: 'error', text: '새 비밀번호가 일치하지 않습니다.' });
      return;
    }
    setPwSaving(true);
    try {
      await authService.changePassword({
        current_password: currentPassword,
        new_password: newPassword,
      });
      setPwMsg({ type: 'success', text: '비밀번호가 변경되었습니다.' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (e) {
      setPwMsg({ type: 'error', text: e instanceof Error ? e.message : '비밀번호 변경에 실패했습니다.' });
    } finally {
      setPwSaving(false);
    }
  }

  function formatDate(dateStr?: string) {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }

  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      {/* Back */}
      <button
        onClick={() => router.push('/dashboard')}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          marginBottom: 12,
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: '#6B7280',
          fontSize: '0.8125rem',
          padding: 0,
        }}
        onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = '#1A1A2E')}
        onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = '#6B7280')}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        대시보드로 돌아가기
      </button>

      <h1 style={{ margin: '0 0 24px', fontSize: '1.5rem', fontWeight: 700, color: '#1E3A5F' }}>
        설정
      </h1>

      {/* Section 1: Profile */}
      <Card style={{ marginBottom: 20 }}>
        <h2 style={{ margin: '0 0 16px', fontSize: '1rem', fontWeight: 700, color: '#1A1A2E' }}>
          개인정보
        </h2>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={labelStyle}>이메일</label>
            <input type="text" value={user?.email || ''} readOnly style={readonlyStyle} />
          </div>

          <div>
            <label style={labelStyle}>닉네임</label>
            <input
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              style={inputStyle}
              placeholder="닉네임을 입력하세요"
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>가입일</label>
              <input type="text" value={formatDate(user?.created_at)} readOnly style={readonlyStyle} />
            </div>
            <div>
              <label style={labelStyle}>최근 수정일</label>
              <input type="text" value={formatDate(user?.updated_at)} readOnly style={readonlyStyle} />
            </div>
          </div>

          {profileMsg && (
            <div
              style={{
                padding: '10px 14px',
                borderRadius: 8,
                fontSize: '0.8125rem',
                backgroundColor: profileMsg.type === 'success' ? '#F0FDF4' : '#FEF2F2',
                border: `1px solid ${profileMsg.type === 'success' ? '#BBF7D0' : '#FECACA'}`,
                color: profileMsg.type === 'success' ? '#15803D' : '#DC2626',
              }}
            >
              {profileMsg.text}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button variant="primary" size="md" loading={profileSaving} onClick={handleProfileSave}>
              프로필 저장
            </Button>
          </div>
        </div>
      </Card>

      {/* Section 2: Password */}
      <Card>
        <h2 style={{ margin: '0 0 16px', fontSize: '1rem', fontWeight: 700, color: '#1A1A2E' }}>
          비밀번호 변경
        </h2>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={labelStyle}>현재 비밀번호</label>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              style={inputStyle}
              placeholder="현재 비밀번호 입력"
            />
          </div>

          <div>
            <label style={labelStyle}>새 비밀번호</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              style={inputStyle}
              placeholder="새 비밀번호 (6자 이상)"
            />
          </div>

          <div>
            <label style={labelStyle}>새 비밀번호 확인</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              style={inputStyle}
              placeholder="새 비밀번호 다시 입력"
            />
          </div>

          {pwMsg && (
            <div
              style={{
                padding: '10px 14px',
                borderRadius: 8,
                fontSize: '0.8125rem',
                backgroundColor: pwMsg.type === 'success' ? '#F0FDF4' : '#FEF2F2',
                border: `1px solid ${pwMsg.type === 'success' ? '#BBF7D0' : '#FECACA'}`,
                color: pwMsg.type === 'success' ? '#15803D' : '#DC2626',
              }}
            >
              {pwMsg.text}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button variant="primary" size="md" loading={pwSaving} onClick={handlePasswordChange}>
              비밀번호 변경
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
