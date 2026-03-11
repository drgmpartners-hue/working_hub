/**
 * Home page — redirects to /dashboard if authenticated, otherwise to /login.
 */
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/auth';

export default function HomePage() {
  const router = useRouter();
  const { token, user } = useAuthStore();

  useEffect(() => {
    if (token && user) {
      router.replace('/dashboard');
    } else {
      router.replace('/login');
    }
  }, [token, user, router]);

  // Blank screen while redirecting
  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ backgroundColor: '#F5F7FA' }}
    >
      <svg
        className="animate-spin"
        width="32"
        height="32"
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-label="Loading"
      >
        <circle cx="16" cy="16" r="12" stroke="#E1E5EB" strokeWidth="3" />
        <path
          d="M16 4a12 12 0 0 1 12 12"
          stroke="#1E3A5F"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}
