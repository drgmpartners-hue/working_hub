'use client';

import { useState, useRef, DragEvent, ChangeEvent } from 'react';

interface FileUploadProps {
  /** Called when valid file(s) are selected */
  onFilesSelected: (files: File[]) => void;
  /** Accepted extensions (default: .xlsx, .xls) */
  accept?: string[];
  /** Allow multiple files */
  multiple?: boolean;
  /** 0–100 upload progress, undefined = no progress bar */
  progress?: number;
  /** Disable the dropzone */
  disabled?: boolean;
  /** Custom label */
  label?: string;
}

const DEFAULT_ACCEPT = ['.xlsx', '.xls'];
const ACCEPT_MIME = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
];

export function FileUpload({
  onFilesSelected,
  accept = DEFAULT_ACCEPT,
  multiple = false,
  progress,
  disabled = false,
  label,
}: FileUploadProps) {
  const [dragging, setDragging] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const isValidFile = (file: File) => {
    const ext = '.' + file.name.split('.').pop()?.toLowerCase();
    return accept.includes(ext) || ACCEPT_MIME.includes(file.type);
  };

  const processFiles = (raw: FileList | File[]) => {
    setError(null);
    const files = Array.from(raw);
    const valid = files.filter(isValidFile);
    const invalid = files.filter((f) => !isValidFile(f));

    if (invalid.length > 0) {
      setError(`Invalid file type: ${invalid.map((f) => f.name).join(', ')}. Only ${accept.join(', ')} allowed.`);
    }

    if (valid.length > 0) {
      setSelectedFiles(multiple ? valid : [valid[0]]);
      onFilesSelected(multiple ? valid : [valid[0]]);
    }
  };

  /* Drag handlers */
  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!disabled) setDragging(true);
  };
  const onDragLeave = () => setDragging(false);
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    if (!disabled) processFiles(e.dataTransfer.files);
  };

  const onInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFiles(e.target.files);
      /* Reset input so same file can be re-selected */
      e.target.value = '';
    }
  };

  const borderColor = error ? '#EF4444' : dragging ? '#4A90D9' : '#E1E5EB';
  const bgColor = dragging ? 'rgba(74,144,217,0.05)' : '#F5F7FA';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {label && (
        <span style={{ fontSize: '0.8125rem', fontWeight: 500, color: '#1A1A2E' }}>{label}</span>
      )}

      {/* Dropzone */}
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(e) => { if (!disabled && (e.key === 'Enter' || e.key === ' ')) inputRef.current?.click(); }}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        style={{
          border: `2px dashed ${borderColor}`,
          borderRadius: 12,
          backgroundColor: bgColor,
          padding: '28px 20px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
          transition: 'border-color 0.15s ease, background-color 0.15s ease',
          outline: 'none',
        }}
      >
        {/* Upload icon */}
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 48,
            height: 48,
            borderRadius: '50%',
            backgroundColor: dragging ? 'rgba(74,144,217,0.15)' : '#E1E5EB',
            transition: 'background-color 0.15s ease',
          }}
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke={dragging ? '#4A90D9' : '#6B7280'}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="16 16 12 12 8 16" />
            <line x1="12" y1="12" x2="12" y2="21" />
            <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
          </svg>
        </span>

        <div style={{ textAlign: 'center' }}>
          <p style={{ margin: 0, fontSize: '0.875rem', fontWeight: 500, color: '#1A1A2E' }}>
            {dragging ? 'Drop your file here' : 'Drag & drop or click to upload'}
          </p>
          <p style={{ margin: '4px 0 0', fontSize: '0.75rem', color: '#6B7280' }}>
            Supported formats: {accept.join(', ')}
          </p>
        </div>
      </div>

      {/* Hidden file input */}
      <input
        ref={inputRef}
        type="file"
        accept={accept.join(',')}
        multiple={multiple}
        style={{ display: 'none' }}
        onChange={onInputChange}
      />

      {/* Error */}
      {error && (
        <span style={{ fontSize: '0.75rem', color: '#EF4444', display: 'flex', alignItems: 'center', gap: 4 }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          {error}
        </span>
      )}

      {/* Selected files list */}
      {selectedFiles.length > 0 && (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {selectedFiles.map((file, idx) => (
            <li
              key={idx}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 10px',
                borderRadius: 8,
                backgroundColor: '#F5F7FA',
                border: '1px solid #E1E5EB',
              }}
            >
              {/* File icon */}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#2E8B8B" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              <span style={{ fontSize: '0.8125rem', color: '#1A1A2E', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {file.name}
              </span>
              <span style={{ fontSize: '0.75rem', color: '#6B7280', flexShrink: 0 }}>
                {(file.size / 1024).toFixed(1)} KB
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* Progress bar */}
      {progress !== undefined && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div
            style={{
              height: 6,
              borderRadius: 3,
              backgroundColor: '#E1E5EB',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${Math.min(100, Math.max(0, progress))}%`,
                backgroundColor: progress >= 100 ? '#10B981' : '#4A90D9',
                borderRadius: 3,
                transition: 'width 0.3s ease, background-color 0.3s ease',
              }}
            />
          </div>
          <span style={{ fontSize: '0.75rem', color: '#6B7280', textAlign: 'right' }}>
            {progress >= 100 ? 'Upload complete' : `${Math.round(progress)}%`}
          </span>
        </div>
      )}
    </div>
  );
}

export default FileUpload;
