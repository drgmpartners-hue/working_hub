'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/auth';

export function Header() {
  const router = useRouter();
  const { user, logout, isLoading } = useAuthStore();

  const handleLogout = async () => {
    await logout();
    router.push('/login');
  };

  const displayName = user?.nickname || user?.email || 'User';
  const initials = displayName
    .split(' ')
    .map((w: string) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <header
      style={{ backgroundColor: '#1E3A5F', height: '64px' }}
      className="w-full flex items-center px-6 shadow-md z-50 sticky top-0"
    >
      {/* Left: Logo + Home link */}
      <Link
        href="/dashboard"
        className="flex items-center gap-2 text-white no-underline group"
        style={{ textDecoration: 'none' }}
      >
        {/* Home Icon */}
        <span
          className="flex items-center justify-center rounded-lg"
          style={{
            width: 36,
            height: 36,
            backgroundColor: 'rgba(74,144,217,0.25)',
            flexShrink: 0,
          }}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5z" />
            <polyline points="9 22 9 12 15 12 15 22" />
          </svg>
        </span>

        <span
          style={{ fontWeight: 700, fontSize: '1.125rem', letterSpacing: '-0.01em' }}
          className="text-white group-hover:opacity-80 transition-opacity duration-150"
        >
          Working Hub
        </span>
      </Link>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Right: User info + Logout */}
      <div className="flex items-center gap-4">
        {/* User avatar + name */}
        {user && (
          <div className="flex items-center gap-2">
            <span
              className="flex items-center justify-center rounded-full text-xs font-bold"
              style={{
                width: 32,
                height: 32,
                backgroundColor: '#2E8B8B',
                color: 'white',
                flexShrink: 0,
              }}
            >
              {initials}
            </span>
            <span
              className="text-white hidden sm:block"
              style={{ fontSize: '0.875rem', fontWeight: 500, maxWidth: 180 }}
            >
              {displayName}
            </span>
          </div>
        )}

        {/* Settings button */}
        <button
          onClick={() => router.push('/settings')}
          className="flex items-center justify-center rounded-md transition-all duration-150"
          style={{
            width: 34,
            height: 34,
            backgroundColor: 'rgba(255,255,255,0.1)',
            border: '1px solid rgba(255,255,255,0.2)',
            cursor: 'pointer',
            color: 'white',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'rgba(255,255,255,0.2)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'rgba(255,255,255,0.1)';
          }}
          title="설정"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>

        {/* Logout button */}
        <button
          onClick={handleLogout}
          disabled={isLoading}
          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-all duration-150"
          style={{
            backgroundColor: 'rgba(255,255,255,0.1)',
            color: 'white',
            border: '1px solid rgba(255,255,255,0.2)',
            cursor: isLoading ? 'not-allowed' : 'pointer',
            opacity: isLoading ? 0.6 : 1,
          }}
          onMouseEnter={(e) => {
            if (!isLoading) {
              (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'rgba(255,255,255,0.2)';
            }
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'rgba(255,255,255,0.1)';
          }}
        >
          {isLoading ? (
            <span
              className="animate-spin rounded-full"
              style={{ width: 14, height: 14, border: '2px solid rgba(255,255,255,0.4)', borderTopColor: 'white', display: 'inline-block' }}
            />
          ) : (
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          )}
          <span>Logout</span>
        </button>
      </div>
    </header>
  );
}

export default Header;
