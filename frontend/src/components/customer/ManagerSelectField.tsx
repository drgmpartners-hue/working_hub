'use client';

/**
 * 고객 추가 — 담당자 (docs/login_logic P10).
 * - 대표: 활성 계정(대표 본인 + 매니저) 중에서 반드시 고른다.
 * - 매니저(대표의 대행 중 포함): 본인 이름으로 고정, 바꿀 수 없다. 서버도 본인으로 고정한다.
 * 부모는 value(선택한 계정 id)를 받아 POST /clients 의 manager_id 로 보낸다.
 */
import { useEffect, useState } from 'react';
import { API_URL } from '@/lib/api-url';
import { authLib } from '@/lib/auth';
import { useAuthStore } from '@/stores/auth';

interface Account {
  id: string;
  nickname: string;
  role: 'owner' | 'manager';
  is_active: boolean;
}

const defaultLabel: React.CSSProperties = {
  display: 'block', marginBottom: 6, fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-secondary)',
};
const defaultInput: React.CSSProperties = {
  width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border-strong)', fontSize: '0.875rem',
  color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box', background: 'var(--bg-card)',
};

/** 대표인지(대행 중이면 매니저로 본다) */
export function useIsOwner(): boolean {
  return useAuthStore((st) => st.user?.role === 'owner');
}

/** 저장 전 확인: 대표인데 담당자를 안 골랐으면 안내 문구, 아니면 null */
export function managerMissing(isOwner: boolean, value: string): string | null {
  return isOwner && !value ? '담당자를 선택하세요.' : null;
}

export function ManagerSelectField({
  value,
  onChange,
  labelStyle = defaultLabel,
  inputStyle = defaultInput,
  style,
}: {
  value: string;
  onChange: (id: string) => void;
  labelStyle?: React.CSSProperties;
  inputStyle?: React.CSSProperties;
  style?: React.CSSProperties;
}) {
  const user = useAuthStore((st) => st.user);
  const isOwner = user?.role === 'owner';
  const [accounts, setAccounts] = useState<Account[]>([]);

  useEffect(() => {
    if (!isOwner) return;
    fetch(`${API_URL}/api/v1/managers`, { headers: authLib.getAuthHeader() })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: Account[]) => setAccounts(Array.isArray(rows) ? rows.filter((a) => a.is_active) : []))
      .catch(() => setAccounts([]));
  }, [isOwner]);

  if (!user) return null;
  const owners = accounts.filter((a) => a.role === 'owner');
  const managers = accounts.filter((a) => a.role === 'manager');

  return (
    <div style={{ marginBottom: 16, ...style }}>
      <label style={labelStyle}>
        담당자 {isOwner && <span style={{ color: 'var(--danger)' }}>*</span>}
      </label>
      {isOwner ? (
        <select
          aria-label="담당자 선택"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{ ...inputStyle, cursor: 'pointer' }}
        >
          <option value="">담당자 선택</option>
          {managers.map((m) => (
            <option key={m.id} value={m.id}>{m.nickname}</option>
          ))}
          {owners.map((o) => (
            <option key={o.id} value={o.id}>{o.nickname} (대표)</option>
          ))}
        </select>
      ) : (
        <div
          aria-label="담당자"
          style={{ ...inputStyle, background: 'var(--bg-surface)', color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
        >
          <span>{user.nickname}</span>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>본인 담당으로 등록</span>
        </div>
      )}
    </div>
  );
}

export default ManagerSelectField;
