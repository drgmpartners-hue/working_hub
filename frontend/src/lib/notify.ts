/**
 * 화면 공통 오류 알림 (수정_tasks P2-2).
 * 예전엔 저장·삭제·불러오기가 실패해도 catch 에서 조용히 넘어가 '된 줄 알거나 빈 화면'이 됐다.
 * notifyError('…') 를 부르면 화면 오른쪽 위에 알림이 뜬다(ErrorToaster, (main) 레이아웃에 1개).
 */
export const NOTIFY_EVENT = 'wh-notify';

export interface NotifyDetail {
  message: string;
  kind: 'error' | 'info';
}

export function notifyError(message: string, err?: unknown): void {
  if (err) console.warn('[notify]', message, err);
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<NotifyDetail>(NOTIFY_EVENT, { detail: { message, kind: 'error' } }));
}

/** 오류는 아니지만 꼭 알아야 할 안내(예: 캡처 날짜로 저장일이 바뀜). */
export function notifyInfo(message: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<NotifyDetail>(NOTIFY_EVENT, { detail: { message, kind: 'info' } }));
}

/** fetch 응답이 실패면 서버 메시지(detail)를 붙여 알림. 성공이면 true. */
export async function okOrNotify(res: Response, what: string): Promise<boolean> {
  if (res.ok) return true;
  let detail = '';
  try {
    const b = await res.clone().json();
    detail = typeof b?.detail === 'string' ? b.detail : typeof b?.detail?.message === 'string' ? b.detail.message : '';
  } catch {
    /* 본문 없음 */
  }
  notifyError(`${what} 실패 (${res.status})${detail ? `: ${detail}` : ''}`);
  return false;
}
