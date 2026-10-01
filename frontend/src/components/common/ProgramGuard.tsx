'use client';

/**
 * 주소로 직접 들어와도 열지 않은 프로그램 화면은 보여 주지 않는다 (docs/login_logic P11).
 * 서버도 그 프로그램 전용 API 를 403 으로 막는다.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { canUse, programForPath, programLabel } from '@/lib/programs';
import { useAuthStore } from '@/stores/auth';

export function ProgramGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '';
  const user = useAuthStore((st) => st.user);
  const key = programForPath(pathname);
  if (!user || canUse(user, key)) return <>{children}</>;
  return (
    <div className="dcard" style={{ maxWidth: 560, margin: '60px auto', padding: '32px 28px', textAlign: 'center' }}>
      <h2 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>사용 권한이 없는 프로그램입니다</h2>
      <p style={{ margin: '0 0 20px', fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.6 }}>
        &apos;{programLabel(key as string)}&apos;은(는) 아직 열려 있지 않습니다. 필요하면 대표에게 사용 권한을 요청하세요.
      </p>
      <Link href="/home" className="wh-btn wh-btn-primary wh-btn-sm">메인으로</Link>
    </div>
  );
}

export default ProgramGuard;
