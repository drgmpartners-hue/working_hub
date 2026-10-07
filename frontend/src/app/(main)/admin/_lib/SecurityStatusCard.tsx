'use client';

/**
 * 보안 설정 점검 (수정_tasks P2-1) — 대표 화면.
 * 모두 정상이면 한 줄만, 문제가 있으면 무엇을 해야 하는지 펼쳐 보인다. 키 값은 서버가 내보내지 않는다.
 */
import { useEffect, useState } from 'react';
import { adminApi } from './api';

interface SecurityStatus {
  encryption_key_set: boolean;
  rotation_done: boolean;
  rotation: {
    rotated: number;
    kept: number;
    unreadable: number;
    at?: string;
  } | null;
  /** 지금 키로 열 수 없는 값(화면을 열 때마다 다시 셈) — 누구 계정의 어떤 키인지 */
  unreadable_items?: { kind: string; message: string }[];
  problems: string[];
  ok: boolean;
}

const code: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 12,
  background: 'var(--bg-surface)',
  padding: '1px 6px',
  borderRadius: 4,
};

export function SecurityStatusCard() {
  const [s, setS] = useState<SecurityStatus | null>(null);

  useEffect(() => {
    let alive = true;
    adminApi<SecurityStatus>('/admin/security-status')
      .then((d) => alive && setS(d))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  if (!s) return null;
  if (s.ok) {
    return (
      <div style={{ fontSize: 13, color: 'var(--text-muted)', display: 'flex', gap: 8, alignItems: 'center' }}>
        <span className="wh-badge pos">보안 설정 정상</span>
        저장 데이터(주민번호·API 키)는 암호화 전용 키로 보관 중입니다.
      </div>
    );
  }
  return (
    <div style={{ padding: '12px 16px', borderRadius: 10, background: 'var(--warning-bg)', fontSize: 13, lineHeight: 1.7 }}>
      <div style={{ fontWeight: 700, color: 'var(--warning)', marginBottom: 4 }}>보안 설정 확인 필요</div>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {s.problems.map((p) => (
          <li key={p}>{p}</li>
        ))}
        {s.encryption_key_set && !s.rotation_done && <li>새 암호화 키로 다시 암호화하는 중이거나 실패했습니다. 서버를 한 번 다시 시작해 보세요.</li>}
        {(s.unreadable_items ?? []).map((u) => (
          <li key={u.message}>예전 키를 잃어 읽을 수 없는 값: {u.message}</li>
        ))}
      </ul>
      {!s.encryption_key_set && (
        <div style={{ marginTop: 6, color: 'var(--text-secondary)' }}>
          Railway 백엔드 서비스(와 Cron 서비스들)의 Variables 에 <span style={code}>ENCRYPTION_KEY</span> 를 추가하세요(32자 이상 임의 문자열,
          SECRET_KEY 와 다른 값). 저장 후 다시 배포되면 기존 데이터가 자동으로 새 키로 다시 암호화됩니다. 이 값은 잃어버리면 안 됩니다.
        </div>
      )}
    </div>
  );
}

export default SecurityStatusCard;
