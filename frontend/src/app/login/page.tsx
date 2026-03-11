/**
 * Login page component.
 * Design: Centered card on Surface background, Navy primary color scheme.
 */
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/auth';

export default function LoginPage() {
  const router = useRouter();
  const { login, isLoading, error, clearError } = useAuthStore();

  const [formData, setFormData] = useState({
    email: '',
    password: '',
  });

  const [fieldErrors, setFieldErrors] = useState({
    email: '',
    password: '',
  });

  const validate = (): boolean => {
    const errors = { email: '', password: '' };
    let valid = true;

    if (!formData.email.trim()) {
      errors.email = '이메일을 입력해주세요';
      valid = false;
    }
    if (!formData.password.trim()) {
      errors.password = '비밀번호를 입력해주세요';
      valid = false;
    }

    setFieldErrors(errors);
    return valid;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();

    if (!validate()) return;

    try {
      await login(formData);
      router.push('/dashboard');
    } catch {
      // Error is handled by store
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (fieldErrors[name as keyof typeof fieldErrors]) {
      setFieldErrors((prev) => ({ ...prev, [name]: '' }));
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8"
      style={{ backgroundColor: '#F5F7FA' }}
    >
      <div className="w-full max-w-md">
        {/* Card */}
        <div
          className="rounded-2xl shadow-lg px-8 pt-10 pb-8"
          style={{ backgroundColor: '#FFFFFF', border: '1px solid #E1E5EB' }}
        >
          {/* Header */}
          <div className="mb-8 text-center">
            {/* Logo mark */}
            <div
              className="mx-auto mb-4 flex items-center justify-center rounded-xl"
              style={{
                width: 52,
                height: 52,
                backgroundColor: '#1E3A5F',
              }}
            >
              <svg
                width="28"
                height="28"
                viewBox="0 0 28 28"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
              >
                <rect x="4" y="10" width="20" height="14" rx="2" fill="#4A90D9" />
                <rect x="9" y="6" width="10" height="6" rx="1.5" fill="#FFFFFF" opacity="0.9" />
                <rect x="11" y="14" width="6" height="5" rx="1" fill="#FFFFFF" />
              </svg>
            </div>

            <h1
              className="text-2xl font-bold tracking-tight"
              style={{ color: '#1A1A2E', fontFamily: 'system-ui, -apple-system, sans-serif' }}
            >
              Working Hub Manager
            </h1>
            <p className="mt-1 text-sm" style={{ color: '#6B7280' }}>
              계정에 로그인하세요
            </p>
          </div>

          {/* API Error */}
          {error && (
            <div
              className="mb-5 rounded-lg px-4 py-3 text-sm"
              style={{ backgroundColor: '#FEF2F2', color: '#EF4444', border: '1px solid #FECACA' }}
              role="alert"
            >
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate>
            {/* Email */}
            <div className="mb-4">
              <label
                htmlFor="email"
                className="block text-sm font-medium mb-1.5"
                style={{ color: '#1A1A2E' }}
              >
                이메일
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                value={formData.email}
                onChange={handleChange}
                placeholder="name@company.com"
                className="w-full rounded-lg px-3.5 py-2.5 text-sm outline-none transition-all"
                style={{
                  border: fieldErrors.email ? '1.5px solid #EF4444' : '1.5px solid #E1E5EB',
                  color: '#1A1A2E',
                  backgroundColor: '#FFFFFF',
                }}
                onFocus={(e) => {
                  if (!fieldErrors.email) {
                    e.currentTarget.style.border = '1.5px solid #4A90D9';
                    e.currentTarget.style.boxShadow = '0 0 0 3px rgba(74,144,217,0.15)';
                  }
                }}
                onBlur={(e) => {
                  if (!fieldErrors.email) {
                    e.currentTarget.style.border = '1.5px solid #E1E5EB';
                    e.currentTarget.style.boxShadow = 'none';
                  }
                }}
              />
              {fieldErrors.email && (
                <p className="mt-1.5 text-xs" style={{ color: '#EF4444' }}>
                  {fieldErrors.email}
                </p>
              )}
            </div>

            {/* Password */}
            <div className="mb-6">
              <label
                htmlFor="password"
                className="block text-sm font-medium mb-1.5"
                style={{ color: '#1A1A2E' }}
              >
                비밀번호
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={formData.password}
                onChange={handleChange}
                placeholder="비밀번호를 입력하세요"
                className="w-full rounded-lg px-3.5 py-2.5 text-sm outline-none transition-all"
                style={{
                  border: fieldErrors.password ? '1.5px solid #EF4444' : '1.5px solid #E1E5EB',
                  color: '#1A1A2E',
                  backgroundColor: '#FFFFFF',
                }}
                onFocus={(e) => {
                  if (!fieldErrors.password) {
                    e.currentTarget.style.border = '1.5px solid #4A90D9';
                    e.currentTarget.style.boxShadow = '0 0 0 3px rgba(74,144,217,0.15)';
                  }
                }}
                onBlur={(e) => {
                  if (!fieldErrors.password) {
                    e.currentTarget.style.border = '1.5px solid #E1E5EB';
                    e.currentTarget.style.boxShadow = 'none';
                  }
                }}
              />
              {fieldErrors.password && (
                <p className="mt-1.5 text-xs" style={{ color: '#EF4444' }}>
                  {fieldErrors.password}
                </p>
              )}
            </div>

            {/* Submit button */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold text-white transition-all"
              style={{
                backgroundColor: isLoading ? '#4A90D9' : '#1E3A5F',
                cursor: isLoading ? 'not-allowed' : 'pointer',
                letterSpacing: '0.01em',
              }}
              onMouseEnter={(e) => {
                if (!isLoading) e.currentTarget.style.backgroundColor = '#2a4f82';
              }}
              onMouseLeave={(e) => {
                if (!isLoading) e.currentTarget.style.backgroundColor = '#1E3A5F';
              }}
            >
              {isLoading ? (
                <>
                  {/* Spinner */}
                  <svg
                    className="animate-spin"
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                    aria-hidden="true"
                  >
                    <circle
                      cx="8"
                      cy="8"
                      r="6"
                      stroke="rgba(255,255,255,0.3)"
                      strokeWidth="2"
                    />
                    <path
                      d="M8 2a6 6 0 0 1 6 6"
                      stroke="#FFFFFF"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  </svg>
                  로그인 중...
                </>
              ) : (
                '로그인'
              )}
            </button>
          </form>

          {/* Register link */}
          <p className="mt-6 text-center text-sm" style={{ color: '#6B7280' }}>
            계정이 없으신가요?{' '}
            <Link
              href="/register"
              className="font-semibold transition-colors"
              style={{ color: '#2E8B8B' }}
              onMouseEnter={(e) => (e.currentTarget.style.color = '#1E3A5F')}
              onMouseLeave={(e) => (e.currentTarget.style.color = '#2E8B8B')}
            >
              회원가입
            </Link>
          </p>
        </div>

        {/* Footer note */}
        <p className="mt-6 text-center text-xs" style={{ color: '#6B7280' }}>
          &copy; {new Date().getFullYear()} Working Hub Manager. All rights reserved.
        </p>
      </div>
    </div>
  );
}
