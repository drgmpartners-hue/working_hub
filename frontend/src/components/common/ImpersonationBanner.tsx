'use client';

/**
 * 대행 로그인 배너 (docs/login_logic P3-4, 지시서 7.4).
 *
 * - 대표가 매니저 계정으로 전환해 있는 동안 모든 화면 최상단에 고정으로 뜬다.
 * - 시간제한·카운트다운 없음 (결정 D-4). 대표가 [내 계정으로 돌아가기]를 누를 때까지 유지.
 * - "남의 계정에 들어와 있는 줄 모르고 작업하는" 사고를 막는 것이 목적이다.
 *   배너 없이 대행 기능만 배포하지 말 것 (지시서 15장).
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/auth';

export function ImpersonationBanner() {
  const router = useRouter();
  const session = useAuthStore((st) => st.session);
  const exitImpersonation = useAuthStore((st) => st.exitImpersonation);
  const [leaving, setLeaving] = useState(false);

  if (!session?.is_impersonating) return null;

  const goBack = async () => {
    setLeaving(true);
    try {
      await exitImpersonation();
      router.push('/admin');
    } finally {
      setLeaving(false);
    }
  };

  return (
    <div
      role="alert"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        flexWrap: 'wrap',
        padding: '9px 20px',
        background: '#B45309',
        color: '#FFFFFF',
        fontSize: 14,
        fontWeight: 600,
        boxShadow: '0 2px 10px rgba(0,0,0,.35)',
      }}
    >
      <span>
        ⚠ {session.effective.nickname} 계정으로 작업 중입니다 (대행: {session.actor.nickname}) · 모든 수정 기록에 대행 사실이 함께 남습니다
      </span>
      <button
        onClick={goBack}
        disabled={leaving}
        style={{
          padding: '5px 14px',
          borderRadius: 8,
          border: '1px solid rgba(255,255,255,.7)',
          background: 'rgba(255,255,255,.15)',
          color: '#FFFFFF',
          fontWeight: 700,
          cursor: 'pointer',
        }}
      >
        {leaving ? '돌아가는 중...' : '내 계정으로 돌아가기'}
      </button>
    </div>
  );
}

export default ImpersonationBanner;
