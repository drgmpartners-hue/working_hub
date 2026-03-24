'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/auth';
import { authService } from '@/services/auth';
import { authLib } from '@/lib/auth';
import { API_URL } from '@/lib/api-url';
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

/* ------------------------------------------------------------------ */
/*  API Provider definitions                                            */
/* ------------------------------------------------------------------ */

interface ProviderDef {
  key: string;
  label: string;
  description: string;
  icon: string;
  color: string;
  fields: { name: 'api_key' | 'api_secret'; label: string; placeholder: string }[];
  guide: { title: string; steps: string[] };
}

const API_PROVIDERS: ProviderDef[] = [
  {
    key: 'kiwoom',
    label: '키움증권 Open API',
    description: 'ETF/펀드 기준가 자동 조회에 사용됩니다.',
    icon: '📈',
    color: '#E8400A',
    fields: [
      { name: 'api_key', label: 'APP Key', placeholder: 'APP Key를 입력하세요' },
      { name: 'api_secret', label: 'APP Secret', placeholder: 'APP Secret를 입력하세요' },
    ],
    guide: {
      title: '키움증권 REST API 키 발급 방법',
      steps: [
        '키움증권 REST API 사이트(https://rest.kiwoom.com)에 접속합니다.',
        '키움증권 계좌가 있는 경우 로그인합니다. (없으면 계좌 개설 필요)',
        'API 신청 메뉴에서 서비스를 등록합니다.',
        '발급된 APP Key와 APP Secret을 복사합니다.',
        '실전투자/모의투자 구분에 유의하세요. 조회 전용은 모의투자도 가능합니다.',
      ],
    },
  },
  {
    key: 'claude',
    label: 'Claude API (Anthropic)',
    description: 'AI 분석 및 리포트 생성에 사용됩니다.',
    icon: '🤖',
    color: '#D97706',
    fields: [
      { name: 'api_key', label: 'API Key', placeholder: 'sk-ant-... 형식의 키를 입력하세요' },
    ],
    guide: {
      title: 'Claude API 키 발급 방법',
      steps: [
        'Anthropic Console(https://console.anthropic.com)에 접속합니다.',
        '회원가입 후 로그인합니다.',
        '좌측 메뉴에서 [API Keys] 를 클릭합니다.',
        '[Create Key] 버튼을 클릭하고 키 이름을 입력합니다.',
        '생성된 API 키(sk-ant-...)를 복사합니다. 이 키는 한 번만 표시됩니다.',
        '결제 수단을 등록해야 API 호출이 가능합니다. (Settings > Billing)',
      ],
    },
  },
  {
    key: 'gemini',
    label: 'Gemini API (Google)',
    description: 'AI 데이터 처리 및 이미지 분석에 사용됩니다.',
    icon: '💎',
    color: '#4285F4',
    fields: [
      { name: 'api_key', label: 'API Key', placeholder: 'AIza... 형식의 키를 입력하세요' },
    ],
    guide: {
      title: 'Gemini API 키 발급 방법',
      steps: [
        'Google AI Studio(https://aistudio.google.com)에 접속합니다.',
        'Google 계정으로 로그인합니다.',
        '좌측 메뉴에서 [API keys] 또는 상단 [Get API key] 를 클릭합니다.',
        '[Create API key] 버튼을 클릭합니다.',
        '기존 Google Cloud 프로젝트를 선택하거나 새로 생성합니다.',
        '생성된 API 키(AIza...)를 복사합니다.',
        '무료 할당량이 제공되며, 초과 시 Google Cloud 결제 설정이 필요합니다.',
      ],
    },
  },
  {
    key: 'solapi',
    label: '솔라피 (Solapi)',
    description: '카카오 알림톡 및 SMS 발송에 사용됩니다.',
    icon: '💬',
    color: '#FEE500',
    fields: [
      { name: 'api_key', label: 'API Key', placeholder: 'API Key를 입력하세요' },
      { name: 'api_secret', label: 'API Secret', placeholder: 'API Secret를 입력하세요' },
    ],
    guide: {
      title: '솔라피 API 키 발급 방법',
      steps: [
        '솔라피(https://solapi.com)에 접속하여 회원가입합니다.',
        '대시보드에서 [API Key 관리] 메뉴를 클릭합니다.',
        '[새 API Key 생성] 버튼을 클릭합니다.',
        '생성된 API Key와 API Secret을 복사합니다.',
        '카카오 알림톡 사용 시: [카카오톡 채널 관리] 에서 비즈니스 채널을 연동합니다.',
        '메시지 템플릿을 등록하고 카카오 심사를 받습니다 (1~2일 소요).',
        '알림톡 발송 실패 시 SMS로 자동 대체 발송됩니다.',
      ],
    },
  },
];

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

interface ApiKeyData {
  id: string;
  provider: string;
  api_key_masked: string;
  api_secret_masked: string | null;
  is_active: boolean;
  last_verified_at: string | null;
  created_at: string;
  updated_at: string;
}

type Tab = 'profile' | 'api';

/* ------------------------------------------------------------------ */
/*  Page Component                                                      */
/* ------------------------------------------------------------------ */

export default function SettingsPage() {
  const router = useRouter();
  const { user, fetchUser } = useAuthStore();
  const [activeTab, setActiveTab] = useState<Tab>('profile');

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

  /* API keys */
  const [apiKeys, setApiKeys] = useState<ApiKeyData[]>([]);
  const [apiLoading, setApiLoading] = useState(false);
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{ api_key: string; api_secret: string }>({ api_key: '', api_secret: '' });
  const [apiSaving, setApiSaving] = useState(false);
  const [apiMsg, setApiMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [apiTesting, setApiTesting] = useState<string | null>(null); /* provider key being tested */
  const [testResult, setTestResult] = useState<{ provider: string; success: boolean; message: string } | null>(null);
  const [expandedGuide, setExpandedGuide] = useState<string | null>(null);

  /* ---- Profile handlers ---- */

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

  /* ---- API key handlers ---- */

  const loadApiKeys = useCallback(async () => {
    setApiLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/user-api-keys`, {
        headers: { ...authLib.getAuthHeader() },
      });
      if (res.ok) {
        setApiKeys(await res.json());
      }
    } catch {
      /* silent */
    } finally {
      setApiLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'api') {
      loadApiKeys();
    }
  }, [activeTab, loadApiKeys]);

  function startEdit(providerKey: string) {
    setEditingProvider(providerKey);
    setEditForm({ api_key: '', api_secret: '' });
    setApiMsg(null);
  }

  function cancelEdit() {
    setEditingProvider(null);
    setEditForm({ api_key: '', api_secret: '' });
    setApiMsg(null);
  }

  async function handleApiSave(providerKey: string) {
    if (!editForm.api_key.trim()) {
      setApiMsg({ type: 'error', text: 'API Key를 입력해주세요.' });
      return;
    }
    setApiSaving(true);
    setApiMsg(null);

    const existing = apiKeys.find((k) => k.provider === providerKey);

    try {
      let res: Response;
      if (existing) {
        // Update
        const body: Record<string, string> = { api_key: editForm.api_key };
        if (editForm.api_secret) body.api_secret = editForm.api_secret;
        res = await fetch(`${API_URL}/api/v1/user-api-keys/${providerKey}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
          body: JSON.stringify(body),
        });
      } else {
        // Create
        res = await fetch(`${API_URL}/api/v1/user-api-keys`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
          body: JSON.stringify({
            provider: providerKey,
            api_key: editForm.api_key,
            api_secret: editForm.api_secret || undefined,
          }),
        });
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setApiMsg({ type: 'error', text: err?.detail || '저장에 실패했습니다.' });
        return;
      }

      setApiMsg({ type: 'success', text: 'API 키가 저장되었습니다.' });
      setEditingProvider(null);
      setEditForm({ api_key: '', api_secret: '' });
      await loadApiKeys();
    } catch {
      setApiMsg({ type: 'error', text: '저장 중 오류가 발생했습니다.' });
    } finally {
      setApiSaving(false);
    }
  }

  async function handleApiDelete(providerKey: string) {
    if (!window.confirm('이 API 키를 삭제하시겠습니까?')) return;
    try {
      const res = await fetch(`${API_URL}/api/v1/user-api-keys/${providerKey}`, {
        method: 'DELETE',
        headers: { ...authLib.getAuthHeader() },
      });
      if (!res.ok && res.status !== 204) {
        const err = await res.json().catch(() => ({}));
        setApiMsg({ type: 'error', text: err?.detail || '삭제에 실패했습니다.' });
        return;
      }
      setApiMsg({ type: 'success', text: 'API 키가 삭제되었습니다.' });
      await loadApiKeys();
    } catch {
      setApiMsg({ type: 'error', text: '삭제 중 오류가 발생했습니다.' });
    }
  }

  async function handleApiToggle(providerKey: string, currentActive: boolean) {
    try {
      await fetch(`${API_URL}/api/v1/user-api-keys/${providerKey}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
        body: JSON.stringify({ is_active: !currentActive }),
      });
      await loadApiKeys();
    } catch {
      /* silent */
    }
  }

  async function handleApiTest(providerKey: string) {
    if (!editForm.api_key.trim()) {
      setTestResult({ provider: providerKey, success: false, message: 'API Key를 입력해주세요.' });
      return;
    }
    setApiTesting(providerKey);
    setTestResult(null);
    try {
      const res = await fetch(`${API_URL}/api/v1/user-api-keys/test/${providerKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
        body: JSON.stringify({
          provider: providerKey,
          api_key: editForm.api_key,
          api_secret: editForm.api_secret || undefined,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setTestResult({ provider: providerKey, success: data.success, message: data.message });
      } else {
        setTestResult({ provider: providerKey, success: false, message: '테스트 요청 실패' });
      }
    } catch {
      setTestResult({ provider: providerKey, success: false, message: '테스트 중 네트워크 오류' });
    } finally {
      setApiTesting(null);
    }
  }

  /* ---- Helpers ---- */

  function formatDate(dateStr?: string) {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }

  /* ---- Tab styles ---- */

  const tabStyle = (isActive: boolean): React.CSSProperties => ({
    padding: '10px 20px',
    fontSize: '0.875rem',
    fontWeight: isActive ? 700 : 500,
    color: isActive ? '#1E3A5F' : '#6B7280',
    borderBottom: isActive ? '2px solid #1E3A5F' : '2px solid transparent',
    background: 'none',
    border: 'none',
    borderBottomWidth: 2,
    borderBottomStyle: 'solid',
    borderBottomColor: isActive ? '#1E3A5F' : 'transparent',
    cursor: 'pointer',
    transition: 'all 0.15s',
  });

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

      <h1 style={{ margin: '0 0 16px', fontSize: '1.5rem', fontWeight: 700, color: '#1E3A5F' }}>
        설정
      </h1>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #E1E5EB', marginBottom: 20 }}>
        <button style={tabStyle(activeTab === 'profile')} onClick={() => setActiveTab('profile')}>
          개인정보
        </button>
        <button style={tabStyle(activeTab === 'api')} onClick={() => setActiveTab('api')}>
          API 관리
        </button>
      </div>

      {/* ============================================================ */}
      {/* Tab: 개인정보                                                  */}
      {/* ============================================================ */}
      {activeTab === 'profile' && (
        <>
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
        </>
      )}

      {/* ============================================================ */}
      {/* Tab: API 관리                                                  */}
      {/* ============================================================ */}
      {activeTab === 'api' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <p style={{ margin: 0, fontSize: '0.8125rem', color: '#6B7280' }}>
            외부 서비스 API 키를 등록하면 기준가 자동 조회, AI 분석 등의 기능을 사용할 수 있습니다.
            API 키는 암호화되어 안전하게 저장됩니다.
          </p>

          {apiMsg && (
            <div
              style={{
                padding: '10px 14px',
                borderRadius: 8,
                fontSize: '0.8125rem',
                backgroundColor: apiMsg.type === 'success' ? '#F0FDF4' : '#FEF2F2',
                border: `1px solid ${apiMsg.type === 'success' ? '#BBF7D0' : '#FECACA'}`,
                color: apiMsg.type === 'success' ? '#15803D' : '#DC2626',
              }}
            >
              {apiMsg.text}
            </div>
          )}

          {apiLoading ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#9CA3AF' }}>로딩 중...</div>
          ) : (
            API_PROVIDERS.map((provider) => {
              const saved = apiKeys.find((k) => k.provider === provider.key);
              const isEditing = editingProvider === provider.key;

              return (
                <Card key={provider.key} style={{ border: saved ? `1px solid ${provider.color}22` : undefined }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                    {/* Icon */}
                    <div
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 10,
                        backgroundColor: `${provider.color}15`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '1.25rem',
                        flexShrink: 0,
                      }}
                    >
                      {provider.icon}
                    </div>

                    {/* Content */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <h3 style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 700, color: '#1A1A2E' }}>
                          {provider.label}
                        </h3>
                        {saved && (
                          <span
                            style={{
                              fontSize: '0.6875rem',
                              fontWeight: 600,
                              padding: '2px 8px',
                              borderRadius: 10,
                              backgroundColor: saved.is_active ? '#F0FDF4' : '#FEF2F2',
                              color: saved.is_active ? '#15803D' : '#DC2626',
                            }}
                          >
                            {saved.is_active ? '활성' : '비활성'}
                          </span>
                        )}
                      </div>
                      <p style={{ margin: '0 0 8px', fontSize: '0.8125rem', color: '#6B7280' }}>
                        {provider.description}
                      </p>

                      {/* Saved key display */}
                      {saved && !isEditing && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {provider.fields.map((f) => {
                            const val = f.name === 'api_key' ? saved.api_key_masked : saved.api_secret_masked;
                            if (!val) return null;
                            return (
                              <div key={f.name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#6B7280', minWidth: 80 }}>
                                  {f.label}:
                                </span>
                                <code
                                  style={{
                                    fontSize: '0.8125rem',
                                    fontFamily: 'monospace',
                                    color: '#374151',
                                    backgroundColor: '#F5F7FA',
                                    padding: '2px 8px',
                                    borderRadius: 4,
                                  }}
                                >
                                  {val}
                                </code>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Edit form */}
                      {isEditing && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
                          {provider.fields.map((f) => (
                            <div key={f.name}>
                              <label style={{ ...labelStyle, marginBottom: 3 }}>{f.label}</label>
                              <input
                                type="password"
                                value={editForm[f.name]}
                                onChange={(e) => setEditForm((prev) => ({ ...prev, [f.name]: e.target.value }))}
                                style={inputStyle}
                                placeholder={f.placeholder}
                                autoFocus={f.name === 'api_key'}
                              />
                            </div>
                          ))}

                          {/* Test result */}
                          {testResult && testResult.provider === provider.key && (
                            <div
                              style={{
                                padding: '10px 14px',
                                borderRadius: 8,
                                fontSize: '0.8125rem',
                                backgroundColor: testResult.success ? '#F0FDF4' : '#FEF2F2',
                                border: `1px solid ${testResult.success ? '#BBF7D0' : '#FECACA'}`,
                                color: testResult.success ? '#15803D' : '#DC2626',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                              }}
                            >
                              <span style={{ fontSize: '1rem' }}>{testResult.success ? '\u2705' : '\u274C'}</span>
                              {testResult.message}
                            </div>
                          )}

                          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                            <button
                              onClick={cancelEdit}
                              style={{
                                padding: '7px 16px',
                                fontSize: '0.8125rem',
                                fontWeight: 600,
                                color: '#6B7280',
                                backgroundColor: '#F3F4F6',
                                border: '1px solid #E1E5EB',
                                borderRadius: 7,
                                cursor: 'pointer',
                              }}
                            >
                              취소
                            </button>
                            <button
                              onClick={() => handleApiTest(provider.key)}
                              disabled={apiTesting === provider.key}
                              style={{
                                padding: '7px 16px',
                                fontSize: '0.8125rem',
                                fontWeight: 600,
                                color: '#059669',
                                backgroundColor: '#F0FDF4',
                                border: '1px solid #BBF7D0',
                                borderRadius: 7,
                                cursor: apiTesting === provider.key ? 'not-allowed' : 'pointer',
                              }}
                            >
                              {apiTesting === provider.key ? '테스트 중...' : '연결 테스트'}
                            </button>
                            <button
                              onClick={() => handleApiSave(provider.key)}
                              disabled={apiSaving}
                              style={{
                                padding: '7px 16px',
                                fontSize: '0.8125rem',
                                fontWeight: 700,
                                color: '#fff',
                                backgroundColor: apiSaving ? '#9CA3AF' : '#1E3A5F',
                                border: 'none',
                                borderRadius: 7,
                                cursor: apiSaving ? 'not-allowed' : 'pointer',
                              }}
                            >
                              {apiSaving ? '저장 중...' : '저장'}
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Guide (collapsible) */}
                      <div style={{ marginTop: isEditing ? 12 : 8 }}>
                        <button
                          onClick={() => setExpandedGuide(expandedGuide === provider.key ? null : provider.key)}
                          style={{
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            padding: 0,
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            color: '#6B7280',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                          }}
                        >
                          <svg
                            width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                            style={{ transform: expandedGuide === provider.key ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}
                          >
                            <polyline points="9 18 15 12 9 6" />
                          </svg>
                          {provider.guide.title}
                        </button>
                        {expandedGuide === provider.key && (
                          <ol style={{ margin: '8px 0 0', paddingLeft: 20, fontSize: '0.8125rem', color: '#374151', lineHeight: 1.7 }}>
                            {provider.guide.steps.map((step, i) => (
                              <li key={i} style={{ marginBottom: 4 }}>{step}</li>
                            ))}
                          </ol>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    {!isEditing && (
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                        {saved ? (
                          <>
                            <button
                              onClick={() => handleApiToggle(provider.key, saved.is_active)}
                              title={saved.is_active ? '비활성화' : '활성화'}
                              style={{
                                padding: '6px 10px',
                                fontSize: '0.75rem',
                                fontWeight: 600,
                                color: saved.is_active ? '#D97706' : '#059669',
                                backgroundColor: saved.is_active ? '#FFFBEB' : '#F0FDF4',
                                border: `1px solid ${saved.is_active ? '#FDE68A' : '#BBF7D0'}`,
                                borderRadius: 6,
                                cursor: 'pointer',
                              }}
                            >
                              {saved.is_active ? 'OFF' : 'ON'}
                            </button>
                            <button
                              onClick={() => startEdit(provider.key)}
                              style={{
                                padding: '6px 10px',
                                fontSize: '0.75rem',
                                fontWeight: 600,
                                color: '#1E3A5F',
                                backgroundColor: '#EEF2F7',
                                border: '1px solid #C7D2E2',
                                borderRadius: 6,
                                cursor: 'pointer',
                              }}
                            >
                              수정
                            </button>
                            <button
                              onClick={() => handleApiDelete(provider.key)}
                              style={{
                                padding: '6px 10px',
                                fontSize: '0.75rem',
                                fontWeight: 600,
                                color: '#DC2626',
                                backgroundColor: '#FEF2F2',
                                border: '1px solid #FECACA',
                                borderRadius: 6,
                                cursor: 'pointer',
                              }}
                            >
                              삭제
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => startEdit(provider.key)}
                            style={{
                              padding: '6px 14px',
                              fontSize: '0.8125rem',
                              fontWeight: 700,
                              color: '#fff',
                              backgroundColor: provider.color,
                              border: 'none',
                              borderRadius: 7,
                              cursor: 'pointer',
                            }}
                          >
                            등록
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </Card>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
