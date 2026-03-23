'use client';

import { useState } from 'react';
import { Button } from '@/components/common/Button';
import { Card } from '@/components/common/Card';
import { authLib } from '@/lib/auth';
import type { ContentProject, ContentVersion } from '@/types/content';
import { API_URL } from '@/lib/api-url';

// Placeholder for project title when there are no headings
const PROJECT_TITLE_PLACEHOLDER = '보고서 내용';

interface ReportPreviewProps {
  project: ContentProject;
  version: ContentVersion;
}

// Parse text into report sections (heading + body)
function parseSections(text: string): Array<{ heading: string; body: string }> {
  const lines = text.split('\n');
  const sections: Array<{ heading: string; body: string }> = [];
  let current: { heading: string; body: string } | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Detect heading: starts with # or is all-caps short line or ends with ':'
    const isHeading =
      trimmed.startsWith('#') ||
      (trimmed.length < 50 && trimmed === trimmed.toUpperCase() && trimmed.length > 2) ||
      (trimmed.endsWith(':') && trimmed.length < 60);

    if (isHeading) {
      if (current) sections.push(current);
      current = { heading: trimmed.replace(/^#+\s*/, '').replace(/:$/, ''), body: '' };
    } else {
      if (!current) {
        current = { heading: '개요', body: '' };
      }
      current.body += (current.body ? '\n' : '') + trimmed;
    }
  }

  if (current) sections.push(current);

  // If no sections were detected, create one big section
  if (sections.length === 0) {
    sections.push({ heading: PROJECT_TITLE_PLACEHOLDER, body: text });
  }

  return sections.slice(0, 8);
}

export function ReportPreview({ project, version }: ReportPreviewProps) {
  const rawText = version.ai_text_content ?? '';
  const [sections, setSections] = useState(() =>
    parseSections(rawText).length > 0
      ? parseSections(rawText)
      : [{ heading: project.title, body: rawText }]
  );
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingHeading, setEditingHeading] = useState('');
  const [editingBody, setEditingBody] = useState('');
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  function startEdit(index: number) {
    setEditingIndex(index);
    setEditingHeading(sections[index].heading);
    setEditingBody(sections[index].body);
  }

  function saveEdit() {
    if (editingIndex === null) return;
    const updated = [...sections];
    updated[editingIndex] = { heading: editingHeading, body: editingBody };
    setSections(updated);
    setEditingIndex(null);
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
      a.download = `${project.title}_report.pdf`;
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
      {/* Report header card */}
      <Card padding={0} style={{ marginBottom: '20px', overflow: 'hidden' }}>
        {/* Cover band */}
        <div
          style={{
            background: 'linear-gradient(135deg, #1E3A5F 0%, #2D5586 100%)',
            padding: '32px 36px',
            position: 'relative',
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              width: '180px',
              height: '100%',
              background: 'linear-gradient(135deg, transparent 40%, rgba(212,168,71,0.15) 100%)',
            }}
          />
          <div
            style={{
              fontSize: '11px',
              letterSpacing: '2px',
              textTransform: 'uppercase',
              color: '#D4A847',
              fontWeight: 600,
              marginBottom: '8px',
            }}
          >
            Report
          </div>
          <h1 style={{ margin: '0 0 8px', fontSize: '22px', fontWeight: 800, color: '#FFFFFF', lineHeight: 1.2 }}>
            {project.title}
          </h1>
          {project.topic && (
            <p style={{ margin: 0, fontSize: '14px', color: 'rgba(255,255,255,0.7)' }}>
              {project.topic}
            </p>
          )}
        </div>

        {/* Actions bar */}
        <div style={{ padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid #E1E5EB' }}>
          <p style={{ margin: 0, fontSize: '13px', color: '#6B7280' }}>
            각 섹션 헤더를 클릭하여 내용을 수정하세요.
          </p>
          <Button
            variant="primary"
            size="sm"
            loading={isDownloading}
            onClick={handleDownload}
            style={{ backgroundColor: '#1E3A5F' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            다운로드
          </Button>
        </div>
      </Card>

      {downloadError && (
        <div style={{ marginBottom: '16px', padding: '10px 14px', backgroundColor: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '8px', color: '#DC2626', fontSize: '13px' }}>
          {downloadError}
        </div>
      )}

      {/* Sections */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {sections.map((section, index) => {
          const isEditing = editingIndex === index;
          return (
            <Card
              key={index}
              padding={0}
              style={{ overflow: 'hidden', cursor: isEditing ? 'default' : 'pointer' }}
            >
              {/* Section heading */}
              <div
                onClick={() => !isEditing && startEdit(index)}
                style={{
                  padding: '14px 20px',
                  backgroundColor: '#EEF2F7',
                  borderBottom: '1px solid #E1E5EB',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  transition: 'background-color 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  if (!isEditing)
                    (e.currentTarget as HTMLDivElement).style.backgroundColor = '#E4EBF4';
                }}
                onMouseLeave={(e) => {
                  if (!isEditing)
                    (e.currentTarget as HTMLDivElement).style.backgroundColor = '#EEF2F7';
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '22px',
                      height: '22px',
                      borderRadius: '50%',
                      backgroundColor: '#1E3A5F',
                      color: '#FFFFFF',
                      fontSize: '11px',
                      fontWeight: 700,
                      flexShrink: 0,
                    }}
                  >
                    {index + 1}
                  </span>
                  {isEditing ? (
                    <input
                      autoFocus
                      value={editingHeading}
                      onChange={(e) => setEditingHeading(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        fontSize: '14px',
                        fontWeight: 600,
                        color: '#1A1A2E',
                        border: '1px solid #1E3A5F',
                        borderRadius: '4px',
                        padding: '2px 8px',
                        outline: 'none',
                        background: '#FFFFFF',
                      }}
                    />
                  ) : (
                    <span style={{ fontSize: '14px', fontWeight: 600, color: '#1A1A2E' }}>
                      {section.heading}
                    </span>
                  )}
                </div>
                {!isEditing && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="2.5">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                )}
              </div>

              {/* Section body */}
              <div style={{ padding: '16px 20px' }}>
                {isEditing ? (
                  <>
                    <textarea
                      value={editingBody}
                      onChange={(e) => setEditingBody(e.target.value)}
                      style={{
                        width: '100%',
                        minHeight: '120px',
                        padding: '10px 12px',
                        fontSize: '14px',
                        color: '#1A1A2E',
                        backgroundColor: '#FAFBFC',
                        border: '1px solid #1E3A5F',
                        borderRadius: '6px',
                        outline: 'none',
                        resize: 'vertical',
                        lineHeight: '1.7',
                        fontFamily: 'inherit',
                        boxSizing: 'border-box',
                        marginBottom: '12px',
                      }}
                    />
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <Button variant="primary" size="sm" onClick={saveEdit} style={{ backgroundColor: '#1E3A5F' }}>
                        저장
                      </Button>
                      <Button variant="secondary" size="sm" onClick={() => setEditingIndex(null)}>
                        취소
                      </Button>
                    </div>
                  </>
                ) : (
                  <p style={{ margin: 0, fontSize: '14px', color: '#374151', lineHeight: '1.7', whiteSpace: 'pre-wrap', wordBreak: 'keep-all' }}>
                    {section.body}
                  </p>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

export default ReportPreview;
