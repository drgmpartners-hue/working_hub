'use client';

import { useState } from 'react';
import { Button } from '@/components/common/Button';
import { Card } from '@/components/common/Card';
import { authLib } from '@/lib/auth';
import type { ContentProject, ContentVersion } from '@/types/content';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

interface CardNewsPreviewProps {
  project: ContentProject;
  version: ContentVersion;
}

// Splits AI text into card slides (one per paragraph, max 6)
function splitIntoSlides(text: string): string[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  return paragraphs.slice(0, 6);
}

export function CardNewsPreview({ project, version }: CardNewsPreviewProps) {
  const [slides, setSlides] = useState<string[]>(() =>
    splitIntoSlides(version.ai_text_content ?? '')
  );
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingText, setEditingText] = useState('');
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  function startEdit(index: number) {
    setEditingIndex(index);
    setEditingText(slides[index]);
  }

  function saveEdit() {
    if (editingIndex === null) return;
    const updated = [...slides];
    updated[editingIndex] = editingText;
    setSlides(updated);
    setEditingIndex(null);
  }

  function cancelEdit() {
    setEditingIndex(null);
    setEditingText('');
  }

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
      a.download = `${project.title}_card_news.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      setDownloadError(e instanceof Error ? e.message : '다운로드 오류');
    } finally {
      setIsDownloading(false);
    }
  }

  // Card colors for each slide
  const cardColors = [
    { bg: '#1E3A5F', text: '#FFFFFF', accent: '#D4A847' },
    { bg: '#D4A847', text: '#1A1A2E', accent: '#1E3A5F' },
    { bg: '#EEF2F7', text: '#1A1A2E', accent: '#1E3A5F' },
    { bg: '#1A1A2E', text: '#FFFFFF', accent: '#D4A847' },
    { bg: '#FBF6EA', text: '#1A1A2E', accent: '#D4A847' },
    { bg: '#E8EFF7', text: '#1A1A2E', accent: '#1E3A5F' },
  ];

  return (
    <div>
      {/* Header */}
      <Card padding={24} style={{ marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ margin: '0 0 4px', fontSize: '16px', fontWeight: 700, color: '#1A1A2E' }}>
              카드뉴스 미리보기
            </h2>
            <p style={{ margin: 0, fontSize: '13px', color: '#6B7280' }}>
              각 카드를 클릭하여 텍스트를 수정할 수 있습니다.
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

      {/* Slides grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
          gap: '16px',
        }}
      >
        {slides.map((slide, index) => {
          const colors = cardColors[index % cardColors.length];
          const isEditing = editingIndex === index;

          return (
            <div
              key={index}
              style={{
                position: 'relative',
                borderRadius: '12px',
                overflow: 'hidden',
                boxShadow: '0 4px 16px rgba(0,0,0,0.10)',
                cursor: isEditing ? 'default' : 'pointer',
                transition: 'transform 0.18s ease, box-shadow 0.18s ease',
              }}
              onMouseEnter={(e) => {
                if (!isEditing) {
                  (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-3px)';
                  (e.currentTarget as HTMLDivElement).style.boxShadow = '0 8px 28px rgba(0,0,0,0.15)';
                }
              }}
              onMouseLeave={(e) => {
                if (!isEditing) {
                  (e.currentTarget as HTMLDivElement).style.transform = 'translateY(0)';
                  (e.currentTarget as HTMLDivElement).style.boxShadow = '0 4px 16px rgba(0,0,0,0.10)';
                }
              }}
              onClick={() => !isEditing && startEdit(index)}
            >
              {/* Card background */}
              <div
                style={{
                  backgroundColor: colors.bg,
                  padding: '24px 20px',
                  minHeight: '200px',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                }}
              >
                {/* Slide number */}
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '28px',
                    height: '28px',
                    borderRadius: '50%',
                    backgroundColor: colors.accent,
                    color: colors.bg,
                    fontSize: '12px',
                    fontWeight: 700,
                    flexShrink: 0,
                    alignSelf: 'flex-start',
                  }}
                >
                  {index + 1}
                </div>

                {/* Content */}
                {isEditing ? (
                  <textarea
                    autoFocus
                    value={editingText}
                    onChange={(e) => setEditingText(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      width: '100%',
                      minHeight: '100px',
                      backgroundColor: 'rgba(255,255,255,0.15)',
                      border: `1px solid ${colors.accent}`,
                      borderRadius: '6px',
                      color: colors.text,
                      fontSize: '13px',
                      lineHeight: '1.6',
                      padding: '8px',
                      resize: 'none',
                      outline: 'none',
                      fontFamily: 'inherit',
                      marginTop: '12px',
                      boxSizing: 'border-box',
                    }}
                  />
                ) : (
                  <p
                    style={{
                      margin: '12px 0 0',
                      fontSize: '13px',
                      lineHeight: '1.65',
                      color: colors.text,
                      wordBreak: 'keep-all',
                    }}
                  >
                    {slide}
                  </p>
                )}

                {/* Edit controls */}
                {isEditing && (
                  <div
                    style={{ display: 'flex', gap: '8px', marginTop: '12px' }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      onClick={saveEdit}
                      style={{
                        flex: 1,
                        padding: '6px',
                        borderRadius: '6px',
                        border: 'none',
                        backgroundColor: colors.accent,
                        color: colors.bg,
                        fontSize: '12px',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      저장
                    </button>
                    <button
                      onClick={cancelEdit}
                      style={{
                        flex: 1,
                        padding: '6px',
                        borderRadius: '6px',
                        border: `1px solid ${colors.accent}`,
                        backgroundColor: 'transparent',
                        color: colors.text,
                        fontSize: '12px',
                        fontWeight: 500,
                        cursor: 'pointer',
                      }}
                    >
                      취소
                    </button>
                  </div>
                )}
              </div>

              {/* Edit hint overlay */}
              {!isEditing && (
                <div
                  style={{
                    position: 'absolute',
                    bottom: '8px',
                    right: '10px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontSize: '11px',
                    color: colors.text,
                    opacity: 0.6,
                  }}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                  수정
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default CardNewsPreview;
