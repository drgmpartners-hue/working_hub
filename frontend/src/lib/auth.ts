/**
 * Authentication utility functions.
 */

const TOKEN_KEY = 'access_token';

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
