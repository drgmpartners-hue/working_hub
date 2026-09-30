'use client';

/**
 * [이 매니저로 전환] — 대행 로그인 시작 (docs/login_logic P3, 지시서 8.3).
 * 전환하면 그 매니저가 보는 화면 그대로 작업하게 되며, 상단에 대행 배너가 뜬다.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/auth';

export function SwitchButton({ id, nickname, primary = false }: { id: string; nickname: string; primary?: boolean }) {
  const router = useRouter();
  const impersonate = useAuthStore((st) => st.impersonate);
  const [busy, setBusy] = useState(false);

  const go = async () => {
    if (!confirm(`${nickname} 계정으로 전환할까요?\n\n${nickname}님이 보는 화면 그대로 작업하게 됩니다. 상단 배너의 [내 계정으로 돌아가기]를 누를 때까지 유지되며, 모든 수정 기록에는 대표가 대행했다는 사실이 함께 남습니다.`)) return;
    setBusy(true);
    try {
      await impersonate(id);
      router.push('/home');
    } catch (e) {
      alert(e instanceof Error ? e.message : '계정 전환에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <button className={`wh-btn ${primary ? 'wh-btn-primary' : 'wh-btn-ghost'} wh-btn-sm`} onClick={go} disabled={busy}>
      {busy ? '전환 중...' : '이 매니저로 전환'}
    </button>
  );
}

export default SwitchButton;
