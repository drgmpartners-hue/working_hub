'use client';

/**
 * 환경 배지 + 배포 버전 (수정_tasks P1-4) — 화면 오른쪽 아래 작은 글씨.
 * - 로컬/미리보기면 색 배지로 운영과 구분
 * - 화면(Vercel)과 서버(Railway)의 커밋을 함께 보여 줘 '방금 올린 게 반영됐나'를 바로 확인
 *   (Vercel 은 NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA·NEXT_PUBLIC_VERCEL_ENV 를 자동으로 넣는다 — 프로젝트 설정의
 *    'Automatically expose System Environment Variables' 가 켜져 있어야 함, 기본값 켜짐)
 */
import { useEffect, useState } from 'react';
import { API_URL } from '@/lib/api-url';

const FRONT_SHA = (process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || '').slice(0, 7);
const FRONT_ENV = process.env.NEXT_PUBLIC_VERCEL_ENV || 'local'; // production | preview | development | local

interface ServerVersion {
  env: string;
  commit: string | null;
  branch: string | null;
}

export function EnvBadge() {
  const [server, setServer] = useState<ServerVersion | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`${API_URL}/api/v1/version`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && d && setServer(d))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const label = FRONT_ENV === 'production' ? '운영' : FRONT_ENV === 'preview' ? '미리보기' : '로컬';
  const prod = FRONT_ENV === 'production';
  const mismatch = !!(FRONT_SHA && server?.commit && FRONT_SHA !== server.commit);
  const title = [
    `화면: ${label}${FRONT_SHA ? ` ${FRONT_SHA}` : ''}`,
    `서버: ${server ? `${server.env === 'production' ? '운영' : '로컬'}${server.commit ? ` ${server.commit}` : ''}` : '확인 중'}`,
    mismatch ? '화면과 서버 커밋이 다릅니다(한쪽 배포가 아직 끝나지 않았을 수 있음)' : '',
  ]
    .filter(Boolean)
    .join('\n');

  return (
    <div
      className="no-print"
      title={title}
      aria-label={title}
      style={{
        position: 'fixed',
        right: 10,
        bottom: 8,
        zIndex: 40,
        display: 'flex',
        gap: 6,
        alignItems: 'center',
        fontSize: 10.5,
        color: 'var(--text-muted, #8A96A8)',
        opacity: prod && !mismatch ? 0.55 : 0.95,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        pointerEvents: 'auto',
      }}
    >
      {!prod && (
        <span
          style={{
            padding: '1px 7px',
            borderRadius: 999,
            fontWeight: 700,
            color: '#fff',
            background: FRONT_ENV === 'preview' ? '#7C3AED' : '#D97706',
            fontFamily: 'inherit',
          }}
        >
          {label}
        </span>
      )}
      <span>
        화면 {FRONT_SHA || '-'} · 서버 {server?.commit || '-'}
      </span>
      {mismatch && <span style={{ color: '#F59E0B' }}>· 반영 중</span>}
    </div>
  );
}

export default EnvBadge;
