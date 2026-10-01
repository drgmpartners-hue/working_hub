'use client';

/**
 * 기업 리포트 — 대표 전용 [담당자 선택] (docs/login_logic P9).
 * 전체 / 대표 목록 / 매니저별 목록을 고른다. 매니저(대행 중 포함)에게는 보이지 않는다.
 */
import { useEffect, useState } from 'react';
import { adminApi, type ManagerRow } from '@/app/(main)/admin/_lib/api';
import { setViewAs, useViewAs } from '@/lib/crViewAs';
import { useAuthStore } from '@/stores/auth';

export function ViewAsPicker() {
  const user = useAuthStore((s) => s.user);
  const viewAs = useViewAs();
  const [managers, setManagers] = useState<ManagerRow[]>([]);
  const isOwner = user?.role === 'owner';

  useEffect(() => {
    if (!isOwner) return;
    adminApi<ManagerRow[]>('/managers')
      .then((rows) => setManagers(rows.filter((m) => m.role === 'manager')))
      .catch(() => setManagers([]));
  }, [isOwner]);

  // 고른 매니저가 목록에 없으면(비활성·삭제) 전체로 되돌린다
  useEffect(() => {
    if (!isOwner || !viewAs || viewAs === 'company' || managers.length === 0) return;
    if (!managers.some((m) => m.id === viewAs)) setViewAs('');
  }, [isOwner, viewAs, managers]);

  if (!isOwner) return null;
  const picked = managers.find((m) => m.id === viewAs);
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-muted)' }}>
      담당자
      <select
        aria-label="담당자 선택"
        value={viewAs}
        onChange={(e) => setViewAs(e.target.value)}
        style={{
          height: 36, padding: '0 10px', borderRadius: 8, border: '1px solid var(--border-strong)',
          background: picked ? 'var(--warning-bg)' : 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 13,
        }}
      >
        <option value="">전체 (모든 담당자)</option>
        <option value="company">대표가 추가한 기업만</option>
        {managers.map((m) => (
          <option key={m.id} value={m.id}>
            {m.nickname} 화면{m.is_active ? '' : ' (비활성)'}
          </option>
        ))}
      </select>
    </label>
  );
}

/** 지금 어떤 화면을 보고 있는지 한 줄 안내 */
export function ViewAsNotice() {
  const user = useAuthStore((s) => s.user);
  const viewAs = useViewAs();
  if (!user) return null;
  let text: string;
  if (user.role !== 'owner') {
    text = '내가 추가한 기업만 보입니다. 내 브리핑(평일 08:30 내 휴대폰)에도 이 기업들만 담깁니다.';
  } else if (!viewAs) {
    text = '모든 기업을 보고 있습니다. 기업마다 추가한 사람이 표시됩니다.';
  } else if (viewAs === 'company') {
    text = '대표가 추가한 기업만 보고 있습니다.';
  } else {
    text = '선택한 매니저의 목록을 그대로 보고 있습니다. 여기서 추가한 기업은 그 매니저 목록에 들어갑니다.';
  }
  return <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{text}</div>;
}
