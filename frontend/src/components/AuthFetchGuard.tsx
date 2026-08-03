'use client';

/**
 * 전역 401 감지 가드.
 *
 * 업무 화면들의 fetch 호출(약 50곳)이 401을 개별 처리하지 않고 침묵 catch로
 * 흡수해 "빈 화면, 새로고침하면 됨" 증상을 만들던 문제의 중앙 해결책.
 * window.fetch를 1회 패치해 API 응답이 401이면 토큰을 정리하고 로그인으로 보낸다.
 * (로그인/회원가입 등 auth 엔드포인트의 401은 자격증명 오류이므로 제외)
 */
import { useEffect } from 'react';
import { authLib } from '@/lib/auth';

let patched = false;

export function AuthFetchGuard() {
  useEffect(() => {
    if (patched || typeof window === 'undefined') return;
    patched = true;
    const origFetch = window.fetch.bind(window);
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const res = await origFetch(...args);
      try {
        if (res.status === 401) {
          const input = args[0];
          const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
          const isApi = url.includes('/api/v1/');
          const isAuthEndpoint = url.includes('/api/v1/auth/');
          // 토큰이 있는데 401 = 만료/무효. (토큰 정리 후 도착하는 뒤따른 401들은 중복 처리 안 함)
          if (isApi && !isAuthEndpoint && authLib.getToken()) {
            authLib.clearAllAuth();
            alert('세션이 만료되었습니다. 다시 로그인해주세요.');
            window.location.href = '/login';
          }
        }
      } catch { /* 가드 자체 오류는 응답 처리에 영향 주지 않음 */ }
      return res;
    };
  }, []);
  return null;
}

export default AuthFetchGuard;
