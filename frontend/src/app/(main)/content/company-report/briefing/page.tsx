'use client';

/** 브리핑 — 데일리(날짜별)·월간 탭. 알림톡 버튼이 여는 화면: ?date=YYYY-MM-DD / ?month=YYYY-MM */
import { Suspense, useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Card } from '@/components/common/Card';
import { DailyBriefingView } from '@/components/company-report/DailyBriefingView';
import { MonthlyPanel } from '@/components/company-report/MonthlyPanel';
import type { BriefingListItem, DailyBriefing } from '@/components/company-report/types';
import { ErrorBox, Spinner, inputStyle, mutedText } from '@/components/company-report/ui';
import { ApiError, crGet, crPost } from '@/lib/companyReportApi';
import { useCrMe } from '@/lib/useCrMe';

const STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: '승인 대기', cls: 'warn' },
  approved: { label: '발송 예정', cls: 'info' },
  sent: { label: '발송 완료', cls: 'pos' },
  failed: { label: '발송 실패', cls: 'neg' },
  skipped: { label: '건너뜀', cls: 'info' },
};

function BriefingInner() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const me = useCrMe();
  const tab = params.get('month') ? 'monthly' : params.get('tab') === 'monthly' ? 'monthly' : 'daily';
  const date = params.get('date') || '';
  const month = params.get('month') || '';

  const [b, setB] = useState<DailyBriefing | null>(null);
  const [list, setList] = useState<BriefingListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toolbarEl, setToolbarEl] = useState<HTMLDivElement | null>(null);

  // 탭을 바꾸면 이전 탭의 안내·오류는 지운다(데일리 테스트 발송 문구가 월간에 남지 않게)
  useEffect(() => {
    setNotice(null);
    setError(null);
  }, [tab]);

  const go = (q: Record<string, string>) => router.push(`${pathname}?${new URLSearchParams(q)}`);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [one, l] = await Promise.all([
        crGet<DailyBriefing>(`/briefings/daily${date ? `?date=${date}` : ''}`).catch((e) => {
          if (e instanceof ApiError && e.status === 404) return null;
          throw e;
        }),
        crGet<BriefingListItem[]>('/briefings/daily/list?limit=30'),
      ]);
      setB(one);
      setList(l);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    if (tab === 'daily') void load();
  }, [load, tab]);

  const approve = async () => {
    if (!b) return;
    setBusy(true);
    try {
      setB(await crPost<DailyBriefing>(`/briefings/daily/${b.id}/approve`));
      setNotice('승인했습니다. 08:30 발송 배치가 보냅니다.');
      void load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const testSend = async () => {
    if (!b) return;
    setBusy(true);
    try {
      const r = await crPost<{ channel: string }>(`/briefings/daily/${b.id}/test-send`);
      setNotice(`내 휴대폰으로 테스트 발송했습니다(${r.channel === 'alimtalk' ? '알림톡' : 'LMS'}).`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const rebuild = async () => {
    if (!window.confirm('브리핑을 지금 다시 만들까요? 수집·요약·교차 검토까지 몇 분 걸립니다.')) return;
    setBusy(true);
    try {
      await crPost('/briefings/daily/build', { briefing_date: date || null, collect: true });
      setNotice('다시 만드는 중입니다. 몇 분 뒤 새로고침하세요.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" className={`wh-btn wh-btn-sm ${tab === 'daily' ? 'wh-btn-primary' : 'wh-btn-ghost'}`} onClick={() => go({})}>
            데일리
          </button>
          <button type="button" className={`wh-btn wh-btn-sm ${tab === 'monthly' ? 'wh-btn-primary' : 'wh-btn-ghost'}`} onClick={() => go({ tab: 'monthly' })}>
            월간
          </button>
        </div>
        {tab === 'monthly' && <div ref={setToolbarEl} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }} />}
        {tab === 'daily' && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              aria-label="브리핑 날짜"
              value={b?.briefing_date || date}
              onChange={(e) => go(e.target.value ? { date: e.target.value } : {})}
              style={{ ...inputStyle, width: 'auto' }}
            >
              {!list.some((x) => x.briefing_date === (b?.briefing_date || date)) && <option value={date}>{date || '최근'}</option>}
              {list.map((x) => (
                <option key={x.id} value={x.briefing_date}>
                  {x.briefing_date} · {STATUS[x.status]?.label || x.status} · {x.article_count}건
                </option>
              ))}
            </select>
            {b && <span className={`wh-badge ${STATUS[b.status]?.cls || 'info'}`}>{STATUS[b.status]?.label || b.status}</span>}
            {me?.is_admin && b?.status === 'draft' && (
              <button type="button" className="wh-btn wh-btn-primary wh-btn-sm" disabled={busy} onClick={() => void approve()}>
                승인
              </button>
            )}
            {b && (
              <button type="button" className="wh-btn wh-btn-ghost wh-btn-sm" disabled={busy} onClick={() => void testSend()}>
                나에게 테스트 발송
              </button>
            )}
            {me?.is_admin && b?.status !== 'sent' && (
              <button type="button" className="wh-btn wh-btn-ghost wh-btn-sm" disabled={busy} onClick={() => void rebuild()}>
                다시 만들기
              </button>
            )}
          </div>
        )}
      </div>

      <ErrorBox message={error} />
      {notice && <div style={{ ...mutedText, color: 'var(--success)' }}>{notice}</div>}

      {tab === 'monthly' ? (
        <MonthlyPanel month={month} isAdmin={!!me?.is_admin} toolbarEl={toolbarEl} onMonth={(m) => go(m ? { month: m } : { tab: 'monthly' })} />
      ) : loading ? (
        <Spinner />
      ) : b ? (
        <DailyBriefingView b={b} />
      ) : (
        <Card padding={24}>
          <div style={{ ...mutedText, textAlign: 'center' }}>
            {date ? `${date} 브리핑이 없습니다.` : '아직 만들어진 브리핑이 없습니다. 평일 07:00에 자동으로 만들어집니다.'}
            {me?.is_admin && (
              <div style={{ marginTop: 12 }}>
                <button type="button" className="wh-btn wh-btn-primary wh-btn-sm" disabled={busy} onClick={() => void rebuild()}>
                  지금 만들기
                </button>
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}

export default function BriefingPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <BriefingInner />
    </Suspense>
  );
}
