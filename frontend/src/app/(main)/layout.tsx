/**
 * Layout for the (main) route group.
 * Renders the sticky Header at the top, wraps children in ProtectedRoute,
 * and constrains content to a 1280px max-width.
 */
'use client';

import { ProtectedRoute } from '@/components/ProtectedRoute';
import { Header } from '@/components/common/Header';

interface MainLayoutProps {
  children: React.ReactNode;
}

export default function MainLayout({ children }: MainLayoutProps) {
  return (
    <ProtectedRoute>
      <div style={{ minHeight: '100vh', backgroundColor: '#F5F7FA' }}>
        {/* Sticky top header */}
        <Header />

        {/* Page content */}
        <main
          style={{
            maxWidth: '1280px',
            margin: '0 auto',
            padding: '24px',
          }}
        >
          {children}
        </main>
      </div>
    </ProtectedRoute>
  );
}
