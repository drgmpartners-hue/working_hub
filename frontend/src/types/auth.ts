/**
 * Authentication type definitions.
 */

export interface User {
  id: string;
  email: string;
  nickname: string;
  phone: string | null;
  profile_image: string | null;
  is_active: boolean;
  /** 역할 — 판정은 서버(app/core/permissions.py)가 한다. 화면은 메뉴 표시용으로만 쓴다. */
  role: 'owner' | 'manager';
  created_at: string;
  updated_at: string;
}

/** GET /auth/session 응답 (대행 로그인 배너·메뉴 분기의 단일 소스, docs/login_logic P3) */
export interface SessionInfo {
  actor: User;
  effective: User;
  is_impersonating: boolean;
  impersonation_expires_at: string | null;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  nickname: string;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
}

export interface PasswordChangeRequest {
  current_password: string;
  new_password: string;
}

export interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}
