/**
 * Authentication store using Zustand.
 */
'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User, LoginRequest, RegisterRequest, SessionInfo } from '@/types/auth';
import { authService } from '@/services/auth';
import { authLib } from '@/lib/auth';

interface AuthStore {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  error: string | null;
  /** 대행 로그인 상태 (docs/login_logic P3) — 배너·메뉴 분기의 단일 소스 */
  session: SessionInfo | null;

  // Actions
  login: (data: LoginRequest) => Promise<void>;
  googleLogin: (credential: string) => Promise<void>;
  register: (data: RegisterRequest) => Promise<void>;
  logout: () => Promise<void>;
  fetchUser: () => Promise<void>;
  clearError: () => void;
  initialize: () => void;
  fetchSession: () => Promise<void>;
  /** 대표 → 매니저 계정 전환 */
  impersonate: (userId: string) => Promise<void>;
  /** 대행 종료 → 대표 본인 계정 */
  exitImpersonation: () => Promise<void>;
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isLoading: false,
      error: null,
      session: null,

      initialize: () => {
        const token = authLib.getToken();
        if (token) {
          set({ token });
          get().fetchUser();
        }
      },

      login: async (data: LoginRequest) => {
        set({ isLoading: true, error: null });
        try {
          const response = await authService.login(data);
          set({ token: response.access_token });
          await get().fetchUser();
        } catch (error: any) {
          set({ error: error.message || 'Login failed' });
          throw error;
        } finally {
          set({ isLoading: false });
        }
      },

      googleLogin: async (credential: string) => {
        set({ isLoading: true, error: null });
        try {
          const response = await authService.googleLogin(credential);
          set({ token: response.access_token });
          await get().fetchUser();
        } catch (error: any) {
          set({ error: error.message || 'Google login failed' });
          throw error;
        } finally {
          set({ isLoading: false });
        }
      },

      register: async (data: RegisterRequest) => {
        set({ isLoading: true, error: null });
        try {
          await authService.register(data);
          await get().login({ email: data.email, password: data.password });
        } catch (error: any) {
          set({ error: error.message || 'Registration failed' });
          throw error;
        } finally {
          set({ isLoading: false });
        }
      },

      logout: async () => {
        set({ isLoading: true });
        try {
          await authService.logout();
        } finally {
          authLib.removeImpersonatorToken();
          set({ user: null, token: null, session: null, isLoading: false });
        }
      },

      fetchSession: async () => {
        try {
          const session = await authService.getSession();
          set({ session });
        } catch {
          set({ session: null });
        }
      },

      impersonate: async (userId: string) => {
        const ownerToken = authLib.getToken();
        if (!ownerToken) throw new Error('로그인이 필요합니다.');
        const res = await authService.impersonate(userId);
        // 대표 토큰은 보관 → 종료·만료 시 복귀용
        authLib.setImpersonatorToken(ownerToken);
        authLib.setToken(res.access_token);
        set({ token: res.access_token });
        await get().fetchUser();
      },

      exitImpersonation: async () => {
        let next: string | null = null;
        try {
          next = (await authService.exitImpersonation()).access_token;
        } catch {
          // 대행 토큰이 이미 만료됐으면 보관해 둔 대표 토큰으로
          next = authLib.getImpersonatorToken();
        }
        authLib.removeImpersonatorToken();
        if (!next) {
          authLib.clearAllAuth();
          set({ user: null, token: null, session: null });
          return;
        }
        authLib.setToken(next);
        set({ token: next });
        await get().fetchUser();
      },

      fetchUser: async () => {
        const token = get().token || authLib.getToken();
        if (!token) {
          set({ user: null });
          return;
        }

        set({ isLoading: true });
        try {
          const user = await authService.getCurrentUser();
          set({ user });
          await get().fetchSession();
        } catch (error) {
          // 대행 토큰 만료로 대표 토큰이 복원된 경우(fetchWithAuth·AuthFetchGuard) 그 토큰을 지우지 않는다
          const current = authLib.getToken();
          if (current && current !== token) {
            set({ token: current, session: null });
            return;
          }
          set({ user: null, token: null, session: null });
          authLib.removeToken();
        } finally {
          set({ isLoading: false });
        }
      },

      clearError: () => set({ error: null }),
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({ token: state.token }),
    }
  )
);

export default useAuthStore;
