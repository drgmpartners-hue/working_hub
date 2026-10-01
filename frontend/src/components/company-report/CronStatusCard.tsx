'use client';

/**
 * 발송 설정 > 자동 실행 상태 (Railway Cron).
 * Railway Cron 서비스가 배치를 돌릴 때마다 남긴 기록을 예정 시각과 비교해 보여 준다.
 * 화면의 [지금 만들기]·[지금 발송]은 여기 기록되지 않는다 — 이 카드가 초록이면 사람이 안 눌러도 자동으로 돈다는 뜻.
 */
import { Card } from '@/components/common/Card';
import { SectionTitle, fmtDate, mutedText } from '@/components/company-report/ui';

export interface CronJob {
  cmd: string;
  label: string;
  when: string;
  service: string;
  cron_utc: string;
  command: string;
  last_at: string | null;
  last_ok: boolean | null;
  last_note: string | null;
  expected_at: string | null;
  status: 'ok' | 'late' | 'failed' | 'never';
}

const BADGE: Record<CronJob['status'], { text: string; color: string; bg: string }> = {
  ok: { text: '정상', color: 'var(--success)', bg: 'var(--success-bg)' },
  late: { text: '멈춤 의심', color: 'var(--warning)', bg: 'var(--warning-bg)' },
  failed: { text: '마지막 실행 실패', color: 'var(--danger)', bg: 'var(--danger-bg)' },
  never: { text: '실행 기록 없음', color: 'var(--danger)', bg: 'var(--danger-bg)' },
};

const code: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 12,
  background: 'var(--bg-surface)',
  padding: '1px 6px',
  borderRadius: 4,
};

export function CronStatusCard({ jobs }: { jobs?: CronJob[] | null }) {
  if (!Array.isArray(jobs) || jobs.length === 0) return null;
  const bad = jobs.filter((j) => j.status !== 'ok');
  if (bad.length === 0) {
    // 모두 정상이면 한 줄만
    const last = jobs.map((j) => j.last_at).filter(Boolean).sort().pop();
    return (
      <Card padding={12}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 13 }}>
          <span
            style={{
              display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 12, fontWeight: 600,
              color: BADGE.ok.color, background: BADGE.ok.bg,
            }}
          >
            자동 실행 정상
          </span>
          <span style={mutedText}>
            Railway가 데일리 작성·발송, 월간 작성을 예정대로 실행하고 있습니다. (마지막 {fmtDate(last, true)})
          </span>
        </div>
      </Card>
    );
  }
  return (
    <Card padding={16}>
      <SectionTitle>자동 실행 상태 (Railway Cron)</SectionTitle>
      <div style={{ ...mutedText, marginBottom: 10 }}>
        예정 시각마다 Railway가 자동으로 실행한 기록입니다. 화면에서 직접 누른 [지금 만들기]·[지금 발송]은 포함되지 않습니다.
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--text-muted)' }}>
              <th style={{ padding: '6px 8px' }}>작업</th>
              <th style={{ padding: '6px 8px' }}>예정</th>
              <th style={{ padding: '6px 8px' }}>마지막 자동 실행</th>
              <th style={{ padding: '6px 8px' }}>상태</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => {
              const b = BADGE[j.status] || BADGE.never;
              return (
                <tr key={j.cmd} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '8px' }}>{j.label}</td>
                  <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>{j.when}</td>
                  <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>
                    {fmtDate(j.last_at, true)}
                    {j.status === 'failed' && j.last_note && (
                      <div style={{ fontSize: 12, color: 'var(--danger)', whiteSpace: 'normal' }}>{j.last_note}</div>
                    )}
                  </td>
                  <td style={{ padding: '8px' }}>
                    <span
                      style={{
                        display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 12, fontWeight: 600,
                        color: b.color, background: b.bg, whiteSpace: 'nowrap',
                      }}
                    >
                      {b.text}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {bad.length > 0 && (
        <div style={{ marginTop: 12, padding: 12, borderRadius: 8, background: 'var(--bg-surface)', fontSize: 13, lineHeight: 1.7 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Railway에서 확인할 것</div>
          <div style={mutedText}>
            Railway 프로젝트에 아래 이름의 서비스가 있는지 보고, 없으면 백엔드와 같은 GitHub 저장소로 새 서비스를 만듭니다.
            Settings에서 Config-as-code 경로는 <span style={code}>/backend/railway.cron.toml</span>, Root Directory는{' '}
            <span style={code}>/backend</span>, 환경변수는 백엔드 서비스와 같게(DATABASE_URL 등) 넣습니다.
          </div>
          <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
            {bad.map((j) => (
              <li key={j.cmd} style={{ marginBottom: 4 }}>
                <b>{j.service}</b> — Start Command <span style={code}>{j.command}</span>, Cron Schedule{' '}
                <span style={code}>{j.cron_utc}</span> (UTC, {j.when} KST)
              </li>
            ))}
          </ul>
          <div style={{ ...mutedText, marginTop: 6 }}>
            서비스가 이미 있는데 &lsquo;실행 기록 없음&rsquo;이면, 이 기능이 배포된 뒤 아직 예정 시각이 오지 않은 것일 수 있습니다. 다음 예정 시각 뒤에 다시 보세요.
          </div>
        </div>
      )}
    </Card>
  );
}
