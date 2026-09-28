'use client';

import { useEffect } from 'react';

/** 기업 리포트 화면에서 예기치 못한 오류가 나도 앱 전체가 멈추지 않도록 이 영역만 대체 화면을 보여준다. */
export default function CompanyReportError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[company-report]', error);
  }, [error]);

  return (
    <div style={{ padding: 24, background: "var(--bg-card)", borderRadius: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>이 화면을 여는 중 문제가 생겼습니다.</div>
      <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
        서버가 막 업데이트되는 중이면 잠시 후 다시 열면 정상으로 돌아옵니다. 계속되면 아래 내용을 알려주세요.
        <br />
        <code style={{ fontSize: 12 }}>{error?.message || '알 수 없는 오류'}</code>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="wh-btn wh-btn-primary wh-btn-sm" onClick={() => reset()}>다시 시도</button>
        <button className="wh-btn wh-btn-ghost wh-btn-sm" onClick={() => window.location.reload()}>새로고침</button>
      </div>
    </div>
  );
}
