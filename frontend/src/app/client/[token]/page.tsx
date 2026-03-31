'use client';

import { useState, useEffect, use } from 'react';
import { PortalAuthForm } from '@/components/client-portal/PortalAuthForm';
import { PortalReportView } from '@/components/client-portal/PortalReportView';
import { SuggestionPanel } from '@/components/client-portal/SuggestionPanel';
import { API_URL } from '@/lib/api-url';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

interface AccountSnapshot {
  account_id: string;
  account_type: string;
  account_number: string;
  dates: string[];
}

type PageState = 'loading' | 'auth' | 'report' | 'error';

/* ------------------------------------------------------------------ */
/*  Page                                                                */
/* ------------------------------------------------------------------ */

export default function ClientPortalPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ suggest?: string }>;
}) {
  const { token } = use(params);
  const { suggest: suggestId } = use(searchParams);

  const [pageState, setPageState] = useState<PageState>('loading');
  const [maskedName, setMaskedName] = useState('');
  const [portalJwt, setPortalJwt] = useState('');
  const [snapshots, setSnapshots] = useState<AccountSnapshot[]>([]);
  const [initError, setInitError] = useState('');

  // 초기: 토큰 유효성 + 이름 마스킹 조회
  useEffect(() => {
    const init = async () => {
      // sessionStorage에 기존 JWT 있으면 재사용 시도
      const savedJwt = sessionStorage.getItem(`portal_jwt_${token}`);
      if (savedJwt) {
        const ok = await tryLoadSnapshots(savedJwt);
        if (ok) {
          setPortalJwt(savedJwt);
          setPageState('report');
          return;
        }
        sessionStorage.removeItem(`portal_jwt_${token}`);
      }

      // 이름 마스킹 조회
      try {
        const res = await fetch(`${API_URL}/api/v1/client-portal/${token}`);
        if (res.ok) {
          const data = await res.json();
          setMaskedName(data.masked_name);
          setPageState('auth');
        } else if (res.status === 404) {
          setInitError('유효하지 않은 링크입니다.');
          setPageState('error');
        } else {
          setInitError('서버 오류가 발생했습니다.');
          setPageState('error');
        }
      } catch {
        setInitError('네트워크 오류가 발생했습니다.');
        setPageState('error');
      }
    };

    init();
  }, [token]);

  const tryLoadSnapshots = async (jwt: string): Promise<boolean> => {
    try {
      const res = await fetch(`${API_URL}/api/v1/client-portal/${token}/snapshots`, {
        headers: { Authorization: `Bearer ${jwt}` },
      });
      if (res.ok) {
        const data = await res.json();
        setSnapshots(data.accounts ?? []);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  const handleAuthSuccess = async (jwt: string) => {
    sessionStorage.setItem(`portal_jwt_${token}`, jwt);
    setPortalJwt(jwt);
    await tryLoadSnapshots(jwt);
    setPageState('report');
  };

  /* ------------------------------------------------------------------ */
  /*  Render                                                              */
  /* ------------------------------------------------------------------ */

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#F5F7FA',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}
    >
      {/* 모바일 컨테이너 */}
      <div
        style={{
          width: '100%',
          maxWidth: 480,
          minHeight: '100vh',
          backgroundColor: '#fff',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* 상단 헤더 */}
        <div
          style={{
            padding: '20px 24px 16px',
            borderBottom: '1px solid #F3F4F6',
            backgroundColor: '#fff',
            position: 'sticky',
            top: 0,
            zIndex: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 32,
                height: 32,
                backgroundColor: '#1E3A5F',
                borderRadius: 8,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <span style={{ color: '#fff', fontSize: 14, fontWeight: 700 }}>W</span>
            </div>
            <div>
              <p style={{ fontSize: 15, fontWeight: 700, color: '#111827', lineHeight: 1.2 }}>
                포트폴리오 확인
              </p>
              <p style={{ fontSize: 11, color: '#9CA3AF' }}>Working Hub Manager</p>
            </div>
          </div>
        </div>

        {/* 콘텐츠 영역 */}
        <div style={{ flex: 1, padding: '24px 20px', overflowY: 'auto' }}>
          {/* 로딩 */}
          {pageState === 'loading' && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                height: 300,
                gap: 16,
              }}
            >
              <div
                style={{
                  width: 40,
                  height: 40,
                  border: '3px solid #E5E7EB',
                  borderTopColor: '#1E3A5F',
                  borderRadius: '50%',
                  animation: 'spin 0.8s linear infinite',
                }}
              />
              <p style={{ fontSize: 14, color: '#9CA3AF' }}>로딩 중...</p>
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </div>
          )}

          {/* 에러 */}
          {pageState === 'error' && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                height: 300,
                gap: 16,
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: 48 }}>🔗</div>
              <p style={{ fontSize: 16, fontWeight: 700, color: '#374151' }}>링크 오류</p>
              <p style={{ fontSize: 14, color: '#9CA3AF', lineHeight: 1.6 }}>{initError}</p>
            </div>
          )}

          {/* 인증 화면 */}
          {pageState === 'auth' && (
            <PortalAuthForm
              token={token}
              maskedName={maskedName}
              onSuccess={handleAuthSuccess}
            />
          )}

          {/* 보고서 화면 */}
          {pageState === 'report' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              {snapshots.length === 0 ? (
                <div
                  style={{
                    backgroundColor: '#F9FAFB',
                    borderRadius: 14,
                    padding: 32,
                    textAlign: 'center',
                    color: '#9CA3AF',
                    fontSize: 14,
                    border: '1px solid #E5E7EB',
                  }}
                >
                  아직 등록된 포트폴리오 데이터가 없습니다.
                </div>
              ) : (
                <PortalReportView
                  token={token}
                  portalJwt={portalJwt}
                  snapshots={snapshots}
                />
              )}

              {/* 제안 패널 (suggest 파라미터 있을 때만) */}
              {suggestId && (
                <SuggestionPanel
                  token={token}
                  suggestId={suggestId}
                  portalJwt={portalJwt}
                />
              )}
            </div>
          )}
        </div>

        {/* 하단 푸터 */}
        <div
          style={{
            padding: '16px 24px',
            borderTop: '1px solid #F3F4F6',
            textAlign: 'center',
          }}
        >
          <p style={{ fontSize: 11, color: '#D1D5DB' }}>
            본 페이지는 고객 전용 보안 페이지입니다.
          </p>
        </div>
      </div>
    </div>
  );
}
