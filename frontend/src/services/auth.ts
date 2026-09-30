/**
 * Authentication API service.
 */
import { authLib } from '@/lib/auth';
import type { AuthResponse, LoginRequest, RegisterRequest, User, PasswordChangeRequest, SessionInfo } from '@/types/auth';
import { API_URL } from '@/lib/api-url';

async function fetchWithAuth(url: string, options: RequestInit = {}) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...authLib.getAuthHeader(),
    ...(options.headers as Record<string, string>),
  };

  const response = await fetch(`${API_URL}${url}`, {
    ...options,
    headers,
  });

  if (response.status === 401) {
    // 대행 토큰 만료 → 대표 본인 계정으로 복귀 (docs/login_logic P3)
    if (authLib.restoreImpersonator()) {
      if (typeof window !== 'undefined') window.location.href = '/admin?impersonation=expired';
      return response;
    }
    authLib.clearAllAuth();   // access_token + auth-storage 모두 정리 (저장소 이원화 잔존 방지)
    if (typeof window !== 'undefined') {
      window.location.href = '/login';
    }
  }

  return response;
}

export const authService = {
  /**
   * Register a new user.
   */
  async register(data: RegisterRequest): Promise<User> {
    const response = await fetch(`${API_URL}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Registration failed');
    }

    return response.json();
  },

  /**
   * Login and get access token.
   */
  async login(data: LoginRequest): Promise<AuthResponse> {
    const response = await fetch(`${API_URL}/api/v1/auth/login/json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Login failed');
    }

    const result = await response.json();
    if (result.access_token) {
      authLib.setToken(result.access_token);
    }
    return result;
  },

  /**
   * Logout current user.
   */
  async logout(): Promise<void> {
    try {
      await fetchWithAuth('/api/v1/auth/logout', { method: 'POST' });
    } finally {
      authLib.removeToken();
    }
  },

  /**
   * Get current user profile.
   */
  async getCurrentUser(): Promise<User> {
    const response = await fetchWithAuth('/api/v1/users/me');

    if (!response.ok) {
      throw new Error('Failed to get user');
    }

    return response.json();
  },

  /**
   * Update current user profile.
   */
  async updateProfile(data: Partial<User>): Promise<User> {
    const response = await fetchWithAuth('/api/v1/users/me', {
      method: 'PATCH',
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Update failed');
    }

    return response.json();
  },

  /**
   * Change password.
   */
  async changePassword(data: PasswordChangeRequest): Promise<void> {
    const response = await fetchWithAuth('/api/v1/auth/password/change', {
      method: 'POST',
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Password change failed');
    }
  },

  /**
   * Login with Google OAuth token.
   */
  async googleLogin(credential: string): Promise<AuthResponse> {
    const response = await fetch(`${API_URL}/api/v1/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Google login failed');
    }

    const result = await response.json();
    if (result.access_token) {
      authLib.setToken(result.access_token);
    }
    return result;
  },

  /**
   * 세션 정보 — 실제 행위자·실효 사용자·대행 여부 (docs/login_logic P3).
   */
  async getSession(): Promise<SessionInfo> {
    const response = await fetchWithAuth('/api/v1/auth/session');
    if (!response.ok) throw new Error('Failed to get session');
    return response.json();
  },

  /**
   * 대표 → 매니저 계정 전환. 새 토큰을 돌려준다(저장은 스토어가 한다).
   */
  async impersonate(userId: string): Promise<{ access_token: string; expires_in: number }> {
    const response = await fetchWithAuth(`/api/v1/auth/impersonate/${encodeURIComponent(userId)}`, { method: 'POST' });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || '계정 전환에 실패했습니다.');
    }
    return response.json();
  },

  /**
   * 대행 종료 → 대표 본인 토큰.
   */
  async exitImpersonation(): Promise<AuthResponse> {
    const response = await fetchWithAuth('/api/v1/auth/impersonate/exit', { method: 'POST' });
    if (!response.ok) throw new Error('대행 종료에 실패했습니다.');
    return response.json();
  },

  /**
   * Delete current user account.
   */
  async deleteAccount(): Promise<void> {
    const response = await fetchWithAuth('/api/v1/users/me', {
      method: 'DELETE',
    });

    if (!response.ok) {
      throw new Error('Failed to delete account');
    }

    authLib.removeToken();
  },
};

export default authService;
