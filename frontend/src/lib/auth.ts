/**
 * Authentication utility functions.
 */

const TOKEN_KEY = 'access_token';
/** 대행 로그인 중 보관하는 대표 본인 토큰 (docs/login_logic P3). 대행 만료 시 이 토큰으로 복귀한다. */
const IMPERSONATOR_KEY = 'impersonator_token';

export const authLib = {
  /**
   * Get stored token (client-side only).
   */
  getToken(): string | null {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(TOKEN_KEY);
  },

  /**
   * Store token.
   */
  setToken(token: string): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem(TOKEN_KEY, token);
  },

  /**
   * Remove stored token.
   */
  removeToken(): void {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(TOKEN_KEY);
  },

  /**
   * 토큰 저장소 전체 정리 — access_token + zustand persist(auth-storage).
   * 두 저장소가 어긋나 "화면은 뜨는데 API만 401"인 상태를 방지한다.
   */
  clearAllAuth(): void {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem('auth-storage');
    localStorage.removeItem(IMPERSONATOR_KEY);
  },

  /** 대행 시작 전 대표 토큰 보관 */
  getImpersonatorToken(): string | null {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(IMPERSONATOR_KEY);
  },

  setImpersonatorToken(token: string): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem(IMPERSONATOR_KEY, token);
  },

  removeImpersonatorToken(): void {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(IMPERSONATOR_KEY);
  },

  /**
   * 대행 토큰이 만료·무효일 때 보관해 둔 대표 토큰으로 되돌린다.
   * 되돌렸으면 true (호출부는 로그아웃 대신 관리 화면으로 이동).
   */
  restoreImpersonator(): boolean {
    if (typeof window === 'undefined') return false;
    const saved = localStorage.getItem(IMPERSONATOR_KEY);
    if (!saved) return false;
    localStorage.setItem(TOKEN_KEY, saved);
    localStorage.setItem('auth-storage', JSON.stringify({ state: { token: saved }, version: 0 }));
    localStorage.removeItem(IMPERSONATOR_KEY);
    return true;
  },

  /**
   * Check if user is authenticated.
   */
  isAuthenticated(): boolean {
    return !!this.getToken();
  },

  /**
   * Get authorization header.
   */
  getAuthHeader(): Record<string, string> {
    const token = this.getToken();
    if (!token) return {};
    return { Authorization: `Bearer ${token}` };
  },
};

export default authLib;
