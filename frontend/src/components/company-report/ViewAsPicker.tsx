'use client';

/**
 * 기업 리포트 — 대표 전용 [담당자 선택] (docs/login_logic P9).
 * 전체 / 회사 공통 / 매니저별 화면을 고른다. 매니저(대행 중 포함)에게는 보이지 않는다.
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
        <option value="company">회사 공통만</option>
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
    text = '회사 공통 기업과 내가 추가한 기업이 보입니다. 공통 기업은 [숨기기]로 내 화면·브리핑에서 뺄 수 있고, 고치기는 대표만 합니다.';
  } else if (!viewAs) {
    text = '모든 담당자의 기업을 보고 있습니다. 매니저가 추가한 기업에는 담당자 이름이 붙습니다.';
  } else if (viewAs === 'company') {
    text = '회사 공통 기업만 보고 있습니다. 회사 수신자 명단은 이 기업들의 브리핑을 받습니다.';
  } else {
    text = '선택한 매니저의 화면을 그대로 보고 있습니다. 여기서 등록한 기업·수신자는 그 매니저 것으로 들어갑니다.';
  }
  return <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{text}</div>;
}
