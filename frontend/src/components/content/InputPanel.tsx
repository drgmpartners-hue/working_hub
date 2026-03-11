'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/common/Button';
import { Card } from '@/components/common/Card';
import { authLib } from '@/lib/auth';
import type {
  ContentType,
  AIProvider,
  BrandSetting,
  ContentProject,
  ContentVersion,
} from '@/types/content';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

interface InputPanelProps {
  contentType: ContentType;
  onComplete: (project: ContentProject, version: ContentVersion) => void;
}

export function InputPanel({ contentType, onComplete }: InputPanelProps) {
  const [title, setTitle] = useState('');
  const [topic, setTopic] = useState('');
  const [contentInput, setContentInput] = useState('');
  const [aiProvider, setAiProvider] = useState<AIProvider>('claude');
  const [brandSettingId, setBrandSettingId] = useState<number | undefined>();
  const [brandSettings, setBrandSettings] = useState<BrandSetting[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchBrandSettings();
  }, []);

  async function fetchBrandSettings() {
    try {
      const res = await fetch(`${API_URL}/api/v1/brand`, {
        headers: authLib.getAuthHeader(),
      });
      if (res.ok) {
        const data = await res.json();
        const list: BrandSetting[] = Array.isArray(data) ? data : (data.items ?? []);
        setBrandSettings(list);
        if (list.length > 0) setBrandSettingId(list[0].id);
      }
    } catch {
      // brand fetch is optional — silently ignore
    }
  }

  async function handleGenerate() {
    if (!title.trim()) {
      setError('제목을 입력하세요.');
      return;
    }
    setError(null);
    setIsLoading(true);

    try {
      // Step 1: create project
      const createRes = await fetch(`${API_URL}/api/v1/content`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
        body: JSON.stringify({
          content_type: contentType,
          title: title.trim(),
          topic: topic.trim() || undefined,
          content_input: contentInput.trim() || undefined,
          brand_setting_id: brandSettingId,
        }),
      });
      if (!createRes.ok) {
        const err = await createRes.json().catch(() => ({}));
        throw new Error(err.detail ?? '프로젝트 생성에 실패했습니다.');
      }
      const project: ContentProject = await createRes.json();

      // Step 2: create version (AI generation)
      const versionRes = await fetch(`${API_URL}/api/v1/content/${project.id}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
        body: JSON.stringify({
          ai_provider: aiProvider,
          content_input: contentInput.trim() || undefined,
        }),
      });
      if (!versionRes.ok) {
        const err = await versionRes.json().catch(() => ({}));
        throw new Error(err.detail ?? 'AI 텍스트 생성에 실패했습니다.');
      }
      const version: ContentVersion = await versionRes.json();

      onComplete(project, version);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '오류가 발생했습니다.');
    } finally {
      setIsLoading(false);
    }
  }

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: '13px',
    fontWeight: 600,
    color: '#1A1A2E',
    marginBottom: '6px',
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '9px 12px',
    fontSize: '14px',
    color: '#1A1A2E',
    backgroundColor: '#FFFFFF',
    border: '1px solid #E1E5EB',
    borderRadius: '8px',
    outline: 'none',
    transition: 'border-color 0.15s ease',
    boxSizing: 'border-box',
  };

  const selectStyle: React.CSSProperties = {
    ...inputStyle,
    cursor: 'pointer',
    appearance: 'none',
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236B7280' stroke-width='2.5' stroke-linecap='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'right 12px center',
    paddingRight: '32px',
  };

  return (
    <Card padding={28}>
      <h2 style={{ margin: '0 0 24px', fontSize: '16px', fontWeight: 700, color: '#1A1A2E' }}>
        콘텐츠 정보 입력
      </h2>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
        {/* Title */}
        <div>
          <label style={labelStyle}>
            제목 <span style={{ color: '#D4A847' }}>*</span>
          </label>
          <input
            style={inputStyle}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="콘텐츠 제목을 입력하세요"
            onFocus={(e) => ((e.target as HTMLInputElement).style.borderColor = '#1E3A5F')}
            onBlur={(e) => ((e.target as HTMLInputElement).style.borderColor = '#E1E5EB')}
          />
        </div>

        {/* Topic */}
        <div>
          <label style={labelStyle}>주제 / 키워드</label>
          <input
            style={inputStyle}
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="주요 주제나 키워드를 입력하세요 (예: ETF 투자 전략)"
            onFocus={(e) => ((e.target as HTMLInputElement).style.borderColor = '#1E3A5F')}
            onBlur={(e) => ((e.target as HTMLInputElement).style.borderColor = '#E1E5EB')}
          />
        </div>

        {/* Content textarea */}
        <div>
          <label style={labelStyle}>내용 / 참고 자료</label>
          <textarea
            style={{ ...inputStyle, minHeight: '120px', resize: 'vertical', lineHeight: '1.6' }}
            value={contentInput}
            onChange={(e) => setContentInput(e.target.value)}
            placeholder="AI가 글을 생성할 때 참고할 내용을 입력하세요. 비워두면 AI가 주제를 바탕으로 자동 작성합니다."
            onFocus={(e) => ((e.target as HTMLTextAreaElement).style.borderColor = '#1E3A5F')}
            onBlur={(e) => ((e.target as HTMLTextAreaElement).style.borderColor = '#E1E5EB')}
          />
        </div>

        {/* Bottom row: AI provider + brand */}
        <div style={{ display: 'flex', gap: '16px' }}>
          {/* AI provider */}
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>AI 제공자</label>
            <select
              style={selectStyle}
              value={aiProvider}
              onChange={(e) => setAiProvider(e.target.value as AIProvider)}
            >
              <option value="claude">Claude (Anthropic)</option>
              <option value="gemini">Gemini (Google)</option>
            </select>
          </div>

          {/* Brand setting */}
          {brandSettings.length > 0 && (
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>브랜드 설정</label>
              <select
                style={selectStyle}
                value={brandSettingId ?? ''}
                onChange={(e) =>
                  setBrandSettingId(e.target.value ? Number(e.target.value) : undefined)
                }
              >
                <option value="">선택 안함</option>
                {brandSettings.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.brand_name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div
            style={{
              padding: '10px 14px',
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

        {/* Submit */}
        <div style={{ paddingTop: '4px' }}>
          <Button
            variant="primary"
            size="lg"
            fullWidth
            loading={isLoading}
            onClick={handleGenerate}
            style={{ backgroundColor: '#D4A847', borderColor: '#D4A847', color: '#1A1A2E', fontWeight: 700 }}
          >
            {isLoading ? 'AI 글 생성 중...' : 'AI 글 생성'}
          </Button>
        </div>
      </div>
    </Card>
  );
}

export default InputPanel;
