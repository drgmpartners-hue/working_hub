'use client';

import { useState } from 'react';
import { FileUpload } from '@/components/common/FileUpload';
import { authLib } from '@/lib/auth';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export interface UploadResult {
  file_path: string;
  filename: string;
  row_count?: number;
  columns?: string[];
}

interface ExcelUploadProps {
  onUploadSuccess: (result: UploadResult) => void;
  onUploadError?: (error: string) => void;
  label?: string;
  disabled?: boolean;
}

export function ExcelUpload({
  onUploadSuccess,
  onUploadError,
  label = '엑셀 파일 업로드',
  disabled = false,
}: ExcelUploadProps) {
  const [progress, setProgress] = useState<number | undefined>(undefined);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    const file = files[0];

    setUploading(true);
    setError(null);
    setSuccessMsg(null);
    setProgress(10);

    try {
      const formData = new FormData();
      formData.append('file', file);

      setProgress(30);

      const response = await fetch(`${API_URL}/api/v1/upload/excel`, {
        method: 'POST',
        headers: {
          ...authLib.getAuthHeader(),
        },
        body: formData,
      });

      setProgress(80);

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.detail || `업로드 실패 (${response.status})`);
      }

      const data: UploadResult = await response.json();
      setProgress(100);
      setSuccessMsg(`파일 업로드 완료: ${data.filename}${data.row_count != null ? ` (${data.row_count}행)` : ''}`);
      onUploadSuccess(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '업로드 중 오류가 발생했습니다.';
      setError(msg);
      setProgress(undefined);
      onUploadError?.(msg);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <FileUpload
        onFilesSelected={handleFiles}
        label={label}
        progress={progress}
        disabled={disabled || uploading}
      />

      {error && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 14px',
            borderRadius: 8,
            backgroundColor: 'rgba(239,68,68,0.06)',
            border: '1px solid rgba(239,68,68,0.2)',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="2.5" strokeLinecap="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span style={{ fontSize: '0.8125rem', color: '#EF4444' }}>{error}</span>
        </div>
      )}

      {successMsg && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 14px',
            borderRadius: 8,
            backgroundColor: 'rgba(16,185,129,0.06)',
            border: '1px solid rgba(16,185,129,0.2)',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2.5" strokeLinecap="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span style={{ fontSize: '0.8125rem', color: '#10B981' }}>{successMsg}</span>
        </div>
      )}
    </div>
  );
}

export default ExcelUpload;
