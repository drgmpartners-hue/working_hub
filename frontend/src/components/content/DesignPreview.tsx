'use client';

import { useState } from 'react';
import { Button } from '@/components/common/Button';
import { Card } from '@/components/common/Card';
import { authLib } from '@/lib/auth';
import type { ContentProject, ContentVersion } from '@/types/content';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

interface DesignPreviewProps {
  project: ContentProject;
  version: ContentVersion;
}

export function DesignPreview({ project, version }: DesignPreviewProps) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const text = version.ai_text_content ?? '';

  // Split text: first paragraph = headline, rest = body
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const headline = paragraphs[0] ?? project.title;
  const bodyText = paragraphs.slice(1).join('\n\n');

  async function handleDownload() {
    setIsDownloading(true);
    setDownloadError(null);
    try {
      const res = await fetch(
        `${API_URL}/api/v1/content/${project.id}/versions/${version.id}/download`,
        { headers: authLib.getAuthHeader() }
      );
      if (!res.ok) throw new Error('다운로드에 실패했습니다.');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${project.title}_design.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      setDownloadError(e instanceof Error ? e.message : '다운로드 오류');
    } finally {
      setIsDownloading(false);
    }
  }

  return (
    <div>
      {/* Header */}
      <Card padding={20} style={{ marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ margin: '0 0 4px', fontSize: '16px', fontWeight: 700, color: '#1A1A2E' }}>
              표지 / 홍보페이지 미리보기
            </h2>
            <p style={{ margin: 0, fontSize: '13px', color: '#6B7280' }}>
              AI가 생성한 디자인 콘텐츠입니다.
            </p>
          </div>
          <Button
            variant="primary"
            size="md"
            loading={isDownloading}
            onClick={handleDownload}
            style={{ backgroundColor: '#1E3A5F' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            다운로드
          </Button>
        </div>
        {downloadError && (
          <div style={{ marginTop: '10px', padding: '8px 12px', backgroundColor: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '6px', color: '#DC2626', fontSize: '13px' }}>
            {downloadError}
          </div>
        )}
      </Card>

      {/* Design mockup */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        {/* Cover page */}
        <div
          style={{
            borderRadius: '12px',
            overflow: 'hidden',
            boxShadow: '0 8px 32px rgba(0,0,0,0.14)',
            aspectRatio: '3 / 4',
            position: 'relative',
            background: 'linear-gradient(150deg, #1E3A5F 0%, #0D2240 60%, #162d4a 100%)',
          }}
        >
          {/* Decorative circles */}
          <div
            style={{
              position: 'absolute',
              top: '-40px',
              right: '-40px',
              width: '180px',
              height: '180px',
              borderRadius: '50%',
              backgroundColor: 'rgba(212,168,71,0.18)',
            }}
          />
          <div
            style={{
              position: 'absolute',
              bottom: '60px',
              left: '-20px',
              width: '120px',
              height: '120px',
              borderRadius: '50%',
              backgroundColor: 'rgba(212,168,71,0.1)',
            }}
          />

          {/* Content */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'flex-end',
              padding: '32px 28px',
            }}
          >
            {/* Accent line */}
            <div
              style={{
                width: '40px',
                height: '3px',
                backgroundColor: '#D4A847',
                borderRadius: '2px',
                marginBottom: '16px',
              }}
            />
            <h2
              style={{
                margin: '0 0 12px',
                fontSize: '18px',
                fontWeight: 800,
                color: '#FFFFFF',
                lineHeight: 1.3,
                wordBreak: 'keep-all',
              }}
            >
              {headline}
            </h2>
            {project.topic && (
              <p
                style={{
                  margin: '0 0 16px',
                  fontSize: '12px',
                  color: 'rgba(255,255,255,0.65)',
                  lineHeight: 1.5,
                }}
              >
                {project.topic}
              </p>
            )}
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 14px',
                backgroundColor: '#D4A847',
                borderRadius: '20px',
                fontSize: '11px',
                fontWeight: 700,
                color: '#1A1A2E',
                alignSelf: 'flex-start',
                letterSpacing: '0.5px',
              }}
            >
              표지
            </div>
          </div>
        </div>

        {/* Promo page */}
        <div
          style={{
            borderRadius: '12px',
            overflow: 'hidden',
            boxShadow: '0 8px 32px rgba(0,0,0,0.10)',
            aspectRatio: '3 / 4',
            position: 'relative',
            backgroundColor: '#FBF6EA',
          }}
        >
          {/* Decorative element */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: '6px',
              background: 'linear-gradient(90deg, #D4A847 0%, #E8C55B 50%, #D4A847 100%)',
            }}
          />
          <div
            style={{
              position: 'absolute',
              bottom: 0,
              right: 0,
              width: '120px',
              height: '120px',
              borderRadius: '50% 0 0 0',
              backgroundColor: 'rgba(30,58,95,0.06)',
            }}
          />

          {/* Content */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              padding: '28px 24px',
              paddingTop: '34px',
            }}
          >
            <div
              style={{
                fontSize: '10px',
                letterSpacing: '2px',
                textTransform: 'uppercase',
                color: '#D4A847',
                fontWeight: 700,
                marginBottom: '10px',
              }}
            >
              Promotion
            </div>
            <h3
              style={{
                margin: '0 0 14px',
                fontSize: '16px',
                fontWeight: 800,
                color: '#1A1A2E',
                lineHeight: 1.3,
                wordBreak: 'keep-all',
              }}
            >
              {project.title}
            </h3>
            <div
              style={{
                width: '30px',
                height: '2px',
                backgroundColor: '#1E3A5F',
                borderRadius: '1px',
                marginBottom: '14px',
              }}
            />
            {bodyText ? (
              <p
                style={{
                  margin: 0,
                  fontSize: '12px',
                  color: '#374151',
                  lineHeight: '1.7',
                  overflow: 'hidden',
                  display: '-webkit-box',
                  WebkitLineClamp: 10,
                  WebkitBoxOrient: 'vertical',
                  wordBreak: 'keep-all',
                }}
              >
                {bodyText}
              </p>
            ) : (
              <p style={{ margin: 0, fontSize: '12px', color: '#6B7280', lineHeight: '1.7' }}>
                {text}
              </p>
            )}

            {/* Bottom badge */}
            <div style={{ marginTop: 'auto' }}>
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '5px 12px',
                  backgroundColor: '#1E3A5F',
                  borderRadius: '20px',
                  fontSize: '11px',
                  fontWeight: 600,
                  color: '#FFFFFF',
                  letterSpacing: '0.3px',
                }}
              >
                홍보 페이지
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Info card */}
      <Card padding={16} style={{ marginTop: '16px', backgroundColor: '#EEF2F7' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1E3A5F" strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0, marginTop: '1px' }}>
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <p style={{ margin: 0, fontSize: '13px', color: '#1E3A5F', lineHeight: 1.5 }}>
            실제 디자인 파일(이미지/PDF)은 다운로드 버튼을 통해 받을 수 있습니다. 위 미리보기는 콘텐츠 구성을 보여주는 프리뷰입니다.
          </p>
        </div>
      </Card>
    </div>
  );
}

export default DesignPreview;
