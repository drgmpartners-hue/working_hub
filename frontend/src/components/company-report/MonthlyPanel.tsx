'use client';

/** 브리핑 > 월간 탭 — 월 선택, 상태, 관리자 동작(발송 허용·보류·지금 발송·다시 만들기), 테스트 발송 */
import { useCallback, useEffect, useState } from 'react';
import { Card } from '@/components/common/Card';
import { MonthlyBriefingView } from './MonthlyBriefingView';
import type { MonthlyBriefing, MonthlyListItem } from './types';
import { ErrorBox, Spinner, inputStyle, mutedText } from './ui';
import { ApiError, crGet, crPost } from '@/lib/companyReportApi';

const M_STATUS: Record<string, { label: string; cls: string }> = {
  generating: { label: '만드는 중', cls: 'info' },
  ready: { label: '발송 예정', cls: 'info' },
  held: { label: '보류(확인 필요)', cls: 'warn' },
  sent: { label: '발송 완료', cls: 'pos' },
  failed: { label: '발송 실패', cls: 'neg' },
};

export function MonthlyPanel({ month, isAdmin, onMonth }: { month: string; isAdmin: boolean; onMonth: (m: string) => void }) {
  const [mb, setMb] = useState<MonthlyBriefing | null>(null);
  const [list, setList] = useState<MonthlyListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [one, l] = await Promise.all([
        crGet<MonthlyBriefing>(`/briefings/monthly${month ? `?month=${month}` : ''}`).catch((e) => {
          if (e instanceof ApiError && e.status === 404) return null;
          throw e;
        }),
        crGet<MonthlyListItem[]>('/briefings/monthly/list'),
      ]);
      setMb(one);
      setList(Array.isArray(l) ? l : []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setNotice(msg);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const rebuild = () => {
    const target = mb?.month || month || '';
    if (!window.confirm(`${target || '지난 달'} 월간 브리핑을 지금 ${mb ? '다시 ' : ''}만들까요? 기업 수에 따라 5~20분 걸립니다.`)) return;
    void act(() => crPost('/briefings/monthly/build', { month: target || null }), '만드는 중입니다. 몇 분 뒤 새로고침하세요.');
  };

  const sendNow = () => {
    if (!mb || !window.confirm(`${mb.month} 월간 브리핑을 수신자 전원에게 지금 보낼까요?`)) return;
    void act(async () => {
      const r = await crPost<{ success?: boolean; skipped?: string; held?: string; error?: string }>(`/briefings/monthly/${mb.id}/send-now`);
      if (!r.success) throw new Error(r.skipped || r.held || r.error || '발송하지 못했습니다.');
    }, '발송했습니다.');
  };

  const cur = mb ? M_STATUS[mb.status] : null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          aria-label="월간 브리핑 월"
          value={mb?.month || month}
          onChange={(e) => onMonth(e.target.value)}
          style={{ ...inputStyle, width: 'auto' }}
        >
          {!list.some((x) => x.month === (mb?.month || month)) && <option value={month}>{month || '최근'}</option>}
          {list.map((x) => (
            <option key={x.id} value={x.month}>
              {x.month} · {M_STATUS[x.status]?.label || x.status} · 기사 {x.article_count}건
            </option>
          ))}
        </select>
        {cur && <span className={`wh-badge ${cur.cls}`}>{cur.label}</span>}
        {isAdmin && mb?.status === 'held' && (
          <button type="button" className="wh-btn wh-btn-primary wh-btn-sm" disabled={busy}
            onClick={() => void act(() => crPost(`/briefings/monthly/${mb.id}/release`), '발송을 허용했습니다. 다음 영업일 08:30 배치가 보냅니다(10일까지).')}>
            내용 확인 · 발송 허용
          </button>
        )}
        {isAdmin && mb?.status === 'ready' && (
          <button type="button" className="wh-btn wh-btn-ghost wh-btn-sm" disabled={busy}
            onClick={() => void act(() => crPost(`/briefings/monthly/${mb.id}/hold`, {}), '보류했습니다.')}>
            보류
          </button>
        )}
        {isAdmin && (mb?.status === 'ready' || mb?.status === 'failed') && (
          <button type="button" className="wh-btn wh-btn-ghost wh-btn-sm" disabled={busy} onClick={sendNow}>
            지금 발송
          </button>
        )}
        {mb && mb.status !== 'generating' && (
          <button type="button" className="wh-btn wh-btn-ghost wh-btn-sm" disabled={busy}
            onClick={() => void act(() => crPost(`/briefings/monthly/${mb.id}/test-send`), '내 휴대폰으로 테스트 발송했습니다.')}>
            나에게 테스트 발송
          </button>
        )}
        {isAdmin && mb && mb.status !== 'sent' && mb.status !== 'generating' && (
          <button type="button" className="wh-btn wh-btn-ghost wh-btn-sm" disabled={busy} onClick={rebuild}>
            다시 만들기
          </button>
        )}
      </div>

      <ErrorBox message={error} />
      {notice && <div style={{ ...mutedText, color: 'var(--success)' }}>{notice}</div>}

      {mb?.status === 'held' && (
        <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(245,158,11,.10)', border: '1px solid rgba(245,158,11,.35)', fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.6 }}>
          <b>보류된 이유</b> · {mb.hold_reason || '관리자 확인이 필요합니다.'}
          {typeof mb.review_summary?.removed_ratio === 'number' && (
            <span style={mutedText}> (교차 검토 문장 {mb.review_summary.total ?? 0}개 중 {mb.review_summary.removed ?? 0}개 삭제)</span>
          )}
          <div style={mutedText}>아래 내용을 확인한 뒤 [내용 확인 · 발송 허용]을 누르거나, [다시 만들기]로 새로 만드세요.</div>
        </div>
      )}
      {mb?.status === 'generating' && (
        <div style={{ ...mutedText }}>지금 만드는 중입니다. 기업 수에 따라 5~20분 걸립니다. 잠시 뒤 새로고침하세요.</div>
      )}

      {loading ? (
        <Spinner />
      ) : mb && mb.status !== 'generating' ? (
        <MonthlyBriefingView mb={mb} />
      ) : !mb ? (
        <Card padding={24}>
          <div style={{ ...mutedText, textAlign: 'center', lineHeight: 1.7 }}>
            {month ? `${month} 월간 브리핑이 없습니다.` : '아직 만들어진 월간 브리핑이 없습니다.'}
            <br />
            매월 1일 03:00에 지난 달 브리핑이 자동으로 만들어지고, 그날(휴일이면 다음 영업일) 08:30에 데일리와 함께 발송됩니다.
            {isAdmin && (
              <div style={{ marginTop: 12 }}>
                <button type="button" className="wh-btn wh-btn-primary wh-btn-sm" disabled={busy} onClick={rebuild}>
                  {month ? `${month} 지금 만들기` : '지난 달 지금 만들기'}
                </button>
              </div>
            )}
          </div>
        </Card>
      ) : null}
    </div>
  );
}

export default MonthlyPanel;
