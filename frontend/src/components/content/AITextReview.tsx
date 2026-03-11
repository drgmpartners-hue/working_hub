'use client';

import { useState } from 'react';
import { Button } from '@/components/common/Button';
import { Card } from '@/components/common/Card';
import { authLib } from '@/lib/auth';
import type { ContentProject, ContentVersion, AIProvider } from '@/types/content';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

interface AITextReviewProps {
  project: ContentProject;
  currentVersion: ContentVersion;
  versions: ContentVersion[];
  onApprove: (version: ContentVersion) => void;
  onRegenerate: (newVersion: ContentVersion) => void;
}

export function AITextReview({
  project,
  currentVersion,
  versions,
  onApprove,
  onRegenerate,
}: AITextReviewProps) {
  const [editedText, setEditedText] = useState(currentVersion.ai_text_content ?? '');
  const [isApproving, setIsApproving] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState(currentVersion.id);

  // Sync textarea when user picks a different version from history
  function handleSelectVersion(vId: number) {
    const v = versions.find((x) => x.id === vId);
    if (v) {
      setSelectedVersionId(vId);
      setEditedText(v.ai_text_content ?? '');
    }
  }

  const activeVersion = versions.find((v) => v.id === selectedVersionId) ?? currentVersion;

  async function handleApprove() {
    setIsApproving(true);
    setError(null);
    try {
      // Update the version with edited text if changed, then mark approved
      const body: Record<string, unknown> = { status: 'approved' };
      if (editedText !== activeVersion.ai_text_content) {
        body.ai_text_content = editedText;
      }
      const res = await fetch(
        `${API_URL}/api/v1/content/${project.id}/versions/${activeVersion.id}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
          body: JSON.stringify(body),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail ?? '승인에 실패했습니다.');
      }
      const updated: ContentVersion = await res.json();
      onApprove(updated);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '오류가 발생했습니다.');
    } finally {
      setIsApproving(false);
    }
  }

  async function handleRegenerate() {
    setIsRegenerating(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/v1/content/${project.id}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
        body: JSON.stringify({
          ai_provider: activeVersion.ai_provider as AIProvider,
          content_input: project.content_input ?? undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail ?? '재생성에 실패했습니다.');
      }
      const newVersion: ContentVersion = await res.json();
      setEditedText(newVersion.ai_text_content ?? '');
      setSelectedVersionId(newVersion.id);
      onRegenerate(newVersion);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '오류가 발생했습니다.');
    } finally {
      setIsRegenerating(false);
    }
  }

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: '13px',
    fontWeight: 600,
    color: '#1A1A2E',
    marginBottom: '6px',
  };

  return (
    <Card padding={28}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#1A1A2E' }}>
          AI 생성 텍스트 검토
        </h2>
        {/* Version history pill */}
        {versions.length > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '12px', color: '#6B7280', fontWeight: 500 }}>버전:</span>
            <div style={{ display: 'flex', gap: '4px' }}>
              {versions.map((v) => (
                <button
                  key={v.id}
                  onClick={() => handleSelectVersion(v.id)}
                  style={{
                    padding: '3px 10px',
                    borderRadius: '20px',
                    border: '1px solid',
                    borderColor: selectedVersionId === v.id ? '#1E3A5F' : '#E1E5EB',
                    backgroundColor: selectedVersionId === v.id ? '#1E3A5F' : 'transparent',
                    color: selectedVersionId === v.id ? '#FFFFFF' : '#6B7280',
                    fontSize: '12px',
                    fontWeight: 500,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  v{v.version_number}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Provider badge */}
      <div style={{ marginBottom: '14px', display: 'flex', gap: '8px', alignItems: 'center' }}>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '5px',
            padding: '3px 10px',
            borderRadius: '20px',
            backgroundColor: activeVersion.ai_provider === 'claude' ? '#EEF2F7' : '#E8F5E9',
            color: activeVersion.ai_provider === 'claude' ? '#1E3A5F' : '#2E7D32',
            fontSize: '12px',
            fontWeight: 600,
          }}
        >
          {activeVersion.ai_provider === 'claude' ? 'Claude' : 'Gemini'} 생성
        </span>
        <span style={{ fontSize: '12px', color: '#6B7280' }}>
          버전 {activeVersion.version_number} &bull; {new Date(activeVersion.created_at).toLocaleDateString('ko-KR')}
        </span>
      </div>

      {/* Editable text area */}
      <div style={{ marginBottom: '20px' }}>
        <label style={labelStyle}>생성된 텍스트 (수정 가능)</label>
        <textarea
          value={editedText}
          onChange={(e) => setEditedText(e.target.value)}
          style={{
            width: '100%',
            minHeight: '240px',
            padding: '12px 14px',
            fontSize: '14px',
            color: '#1A1A2E',
            backgroundColor: '#FAFBFC',
            border: '1px solid #E1E5EB',
            borderRadius: '8px',
            outline: 'none',
            resize: 'vertical',
            lineHeight: '1.7',
            fontFamily: 'inherit',
            boxSizing: 'border-box',
            transition: 'border-color 0.15s ease',
          }}
          onFocus={(e) => ((e.target as HTMLTextAreaElement).style.borderColor = '#1E3A5F')}
          onBlur={(e) => ((e.target as HTMLTextAreaElement).style.borderColor = '#E1E5EB')}
          placeholder="AI가 생성한 텍스트가 여기에 표시됩니다."
        />
        <p style={{ margin: '6px 0 0', fontSize: '12px', color: '#6B7280' }}>
          텍스트를 직접 수정한 후 승인하거나, AI로 다시 생성할 수 있습니다.
        </p>
      </div>

      {/* Error */}
      {error && (
        <div
          style={{
            padding: '10px 14px',
            marginBottom: '16px',
            backgroundColor: '#FEF2F2',
            border: '1px solid #FECACA',
            borderRadius: '8px',
            color: '#DC2626',
            fontSize: '13px',
          }}
        >
          {error}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: '10px' }}>
        <Button
          variant="secondary"
          size="md"
          loading={isRegenerating}
          onClick={handleRegenerate}
          style={{ flex: 1 }}
        >
          재생성
        </Button>
        <Button
          variant="primary"
          size="md"
          loading={isApproving}
          onClick={handleApprove}
          style={{ flex: 2, backgroundColor: '#D4A847', borderColor: '#D4A847', color: '#1A1A2E', fontWeight: 700 }}
        >
          승인 후 디자인 생성
        </Button>
      </div>
    </Card>
  );
}

export default AITextReview;
