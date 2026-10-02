/**
 * 고객 포털 API 호출 (수정_tasks P2-9).
 * 포털 확인(JWT)이 만료·무효(401)면 'portal-auth-expired' 이벤트를 보내고, 포털 화면이 본인 확인 화면으로 돌아간다.
 * 다시 확인하면 주소(?suggest= 등)와 고른 계좌가 그대로라 보던 화면으로 돌아온다.
 */
import { API_URL } from '@/lib/api-url';

export const PORTAL_AUTH_EXPIRED = 'portal-auth-expired';

export async function portalFetch(path: string, jwt: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${API_URL}/api/v1/client-portal${path}`, {
    ...init,
    headers: { ...(init.headers || {}), Authorization: `Bearer ${jwt}` },
  });
  if (res.status === 401 && typeof window !== 'undefined') {
    window.dispatchEvent(new Event(PORTAL_AUTH_EXPIRED));
  }
  return res;
}
