'use client';

/**
 * 기업DB 파일 목록 — 필터(폴더·형식·자동/업로드·기간·검색)·업로드(끌어놓기)·미리보기·다운로드·zip
 * companyId가 있으면 그 기업 폴더, portfolio면 '_포트폴리오 공통', 둘 다 없으면 전체
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Card } from '@/components/common/Card';
import { Modal } from '@/components/common/Modal';
import { crBlob, crDownload, crGet, crPatch, crPost, crUpload } from '@/lib/companyReportApi';
import type { DbFile } from './types';
import { FOLDER_LABELS, fmtSize } from './types';
import { ErrorBox, Spinner, fmtDate, inputStyle, mutedText } from './ui';

const TYPE_FILTERS = [
  { key: '', label: '모든 형식' },
  { key: 'pdf', label: 'PDF' },
  { key: 'doc', label: '문서(docx·hwp)' },
  { key: 'slide', label: '발표(ppt)' },
  { key: 'sheet', label: '표(xlsx·csv)' },
  { key: 'md', label: 'MD' },
  { key: 'image', label: '이미지' },
];
const UPLOAD_EXT = '.pdf,.docx,.doc,.hwp,.hwpx,.ppt,.pptx,.md,.txt,.xlsx,.xls,.csv,.png,.jpg,.jpeg,.gif,.webp';
const PREVIEWABLE = new Set(['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'md', 'txt', 'csv']);

export function FileBrowser({
  companyId,
  portfolio = false,
  title,
  onChanged,
}: {
  companyId?: string | null;
  portfolio?: boolean;
  title?: string;
  onChanged?: () => void;
}) {
  const [items, setItems] = useState<DbFile[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [folder, setFolder] = useState('');
  const [ftype, setFtype] = useState('');
  const [origin, setOrigin] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [q, setQ] = useState('');
  const [qApplied, setQApplied] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [upFolder, setUpFolder] = useState(portfolio ? 'portfolio' : 'docs');
  const [upKind, setUpKind] = useState('');
  const [uploading, setUploading] = useState(false);
  const [drag, setDrag] = useState(false);
  const [preview, setPreview] = useState<{ file: DbFile; url?: string; text?: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const SIZE = 50;
  const canUpload = !!companyId || portfolio;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ page: String(page), size: String(SIZE) });
      if (companyId) p.append('company', companyId);
      if (portfolio) p.set('portfolio', 'true');
      if (folder) p.set('folder', folder);
      if (ftype) p.set('type', ftype);
      if (origin) p.set('origin', origin);
      if (from) p.set('date_from', from);
      if (to) p.set('date_to', to);
      if (qApplied) p.set('q', qApplied);
      const r = await crGet<{ total: number; items: DbFile[] }>(`/db/files?${p}`);
      setItems(r.items);
      setTotal(r.total);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [companyId, portfolio, folder, ftype, origin, from, to, qApplied, page]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [companyId, portfolio]);

  const upload = async (files: FileList | File[]) => {
    if (!canUpload || !files.length) return;
    setUploading(true);
    setError(null);
    let ok = 0;
    for (const f of Array.from(files)) {
      const form = new FormData();
      form.append('file', f);
      if (companyId) form.append('company_id', companyId);
      form.append('folder', upFolder);
      if (upKind.trim()) form.append('doc_kind', upKind.trim());
      try {
        await crUpload('/db/files', form);
        ok++;
      } catch (e) {
        setError(`${f.name}: ${(e as Error).message}`);
      }
    }
    setUploading(false);
    if (ok) {
      setNotice(`${ok}개 파일을 올렸습니다. 이름은 규칙에 맞게 자동으로 바뀌었습니다.`);
      void load();
      onChanged?.();
    }
  };

  const openPreview = async (f: DbFile) => {
    if (!PREVIEWABLE.has(f.file_type)) {
      await crDownload(`/db/files/${f.id}/download`, f.display_name);
      return;
    }
    try {
      const { blob } = await crBlob(`/db/files/${f.id}/download?inline=true`);
      if (['md', 'txt', 'csv'].includes(f.file_type)) setPreview({ file: f, text: await blob.text() });
      else setPreview({ file: f, url: URL.createObjectURL(blob) });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const closePreview = () => {
    if (preview?.url) URL.revokeObjectURL(preview.url);
    setPreview(null);
  };

  const editMemo = async (f: DbFile) => {
    const memo = window.prompt('메모', f.memo || '');
    if (memo === null) return;
    try {
      await crPatch(`/db/files/${f.id}`, { memo });
      void load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const remove = async (f: DbFile) => {
    if (!window.confirm(`${f.display_name}을(를) 목록에서 지울까요?`)) return;
    try {
      await crPatch(`/db/files/${f.id}`, { deleted: true });
      void load();
      onChanged?.();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const refreshAuto = async () => {
    if (!companyId) return;
    try {
      await crPost(`/db/companies/${companyId}/refresh`);
      setNotice('자동 파일(뉴스 모음·원장 엑셀·기업카드)을 새로 만들었습니다.');
      void load();
      onChanged?.();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const zip = async () => {
    try {
      await crDownload(`/db/companies/${companyId || '_portfolio'}/zip`, 'folder.zip');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const folders = portfolio ? [] : ['info', 'news', 'docs', 'reports', 'images'];
  const pages = Math.max(1, Math.ceil(total / SIZE));

  return (
    <Card padding={0}>
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10, borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <strong style={{ color: 'var(--text-primary)', fontSize: 15 }}>
            {title || '전체 파일'} <span style={{ ...mutedText, fontWeight: 400 }}>{total}개</span>
          </strong>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {companyId && (
              <button type="button" className="wh-btn wh-btn-ghost wh-btn-sm" onClick={() => void refreshAuto()}>
                자동 파일 새로 만들기
              </button>
            )}
            {(companyId || portfolio) && (
              <button type="button" className="wh-btn wh-btn-ghost wh-btn-sm" onClick={() => void zip()}>
                폴더 통째로 내려받기
              </button>
            )}
          </div>
        </div>
        {folders.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button type="button" className={`wh-btn wh-btn-sm ${folder === '' ? 'wh-btn-primary' : 'wh-btn-ghost'}`} onClick={() => { setFolder(''); setPage(1); }}>
              전체 폴더
            </button>
            {folders.map((f) => (
              <button key={f} type="button" className={`wh-btn wh-btn-sm ${folder === f ? 'wh-btn-primary' : 'wh-btn-ghost'}`} onClick={() => { setFolder(f); setPage(1); }}>
                {FOLDER_LABELS[f]}
              </button>
            ))}
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setQApplied(q);
            setPage(1);
          }}
          style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}
        >
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="파일명·기업명·이전 사명·본문 검색" style={{ ...inputStyle, width: 240 }} aria-label="파일 검색" />
          <select value={ftype} onChange={(e) => { setFtype(e.target.value); setPage(1); }} style={{ ...inputStyle, width: 'auto' }} aria-label="형식">
            {TYPE_FILTERS.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
          <select value={origin} onChange={(e) => { setOrigin(e.target.value); setPage(1); }} style={{ ...inputStyle, width: 'auto' }} aria-label="생성 방식">
            <option value="">자동·업로드</option>
            <option value="auto">자동</option>
            <option value="upload">업로드</option>
          </select>
          <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} style={{ ...inputStyle, width: 140 }} aria-label="시작일" />
          <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} style={{ ...inputStyle, width: 140 }} aria-label="종료일" />
          <button type="submit" className="wh-btn wh-btn-ghost wh-btn-sm">
            검색
          </button>
        </form>
      </div>

      {canUpload && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            void upload(e.dataTransfer.files);
          }}
          style={{
            margin: 14,
            padding: 14,
            border: `1px dashed ${drag ? 'var(--blue-400)' : 'var(--border-strong)'}`,
            borderRadius: 10,
            background: drag ? 'rgba(59,130,246,.08)' : 'transparent',
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <span style={{ ...mutedText, flex: 1, minWidth: 200 }}>
            {uploading ? '올리는 중…' : '파일을 여기로 끌어놓거나 [파일 선택] — pdf·docx·hwp·hwpx·ppt·pptx·md·xlsx·이미지, 50MB까지'}
          </span>
          {!portfolio && (
            <select value={upFolder} onChange={(e) => setUpFolder(e.target.value)} style={{ ...inputStyle, width: 'auto' }} aria-label="올릴 폴더">
              {['docs', 'info', 'reports', 'images', 'news'].map((f) => (
                <option key={f} value={f}>
                  {FOLDER_LABELS[f]}
                </option>
              ))}
            </select>
          )}
          <input value={upKind} onChange={(e) => setUpKind(e.target.value)} placeholder="문서 종류(예: IR자료)" style={{ ...inputStyle, width: 160 }} aria-label="문서 종류" />
          <input ref={inputRef} type="file" multiple accept={UPLOAD_EXT} style={{ display: 'none' }} onChange={(e) => e.target.files && void upload(e.target.files)} />
          <button type="button" className="wh-btn wh-btn-primary wh-btn-sm" disabled={uploading} onClick={() => inputRef.current?.click()}>
            파일 선택
          </button>
        </div>
      )}

      <div style={{ padding: '0 14px' }}>
        <ErrorBox message={error} />
        {notice && <div style={{ ...mutedText, color: 'var(--success)', marginBottom: 8 }}>{notice}</div>}
      </div>

      {loading ? (
        <Spinner />
      ) : items.length === 0 ? (
        <div style={{ ...mutedText, padding: 24, textAlign: 'center' }}>파일이 없습니다.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
            <thead>
              <tr>
                {['이름', '폴더', '기간', '형식', '크기', '날짜', ''].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '8px 12px', fontSize: 12, color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((f) => (
                <tr key={f.id}>
                  <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border-soft)', fontSize: 13 }}>
                    <button type="button" onClick={() => void openPreview(f)} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--text-primary)', fontWeight: 600, cursor: 'pointer', textAlign: 'left', fontSize: 13 }}>
                      {f.display_name}
                    </button>
                    <div style={{ ...mutedText, fontSize: 11, marginTop: 2 }}>
                      <span className={`wh-badge ${f.origin === 'auto' ? 'info' : 'pos'}`} style={{ marginRight: 6 }}>
                        {f.origin === 'auto' ? '자동' : '업로드'}
                      </span>
                      {!companyId && !portfolio && (f.company_name || '_포트폴리오 공통')}
                      {f.original_name && ` · 원래 이름: ${f.original_name}`}
                      {f.memo && ` · 메모: ${f.memo}`}
                    </div>
                  </td>
                  <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border-soft)', fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{f.folder_label}</td>
                  <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border-soft)', fontSize: 12, color: 'var(--text-secondary)' }}>{f.period_label || '-'}</td>
                  <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border-soft)', fontSize: 12, color: 'var(--text-secondary)' }}>{f.file_type.toUpperCase()}</td>
                  <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border-soft)', fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{fmtSize(f.size)}</td>
                  <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border-soft)', fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{fmtDate(f.updated_at || f.created_at)}</td>
                  <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border-soft)', whiteSpace: 'nowrap', textAlign: 'right' }}>
                    <button type="button" className="wh-btn wh-btn-ghost wh-btn-sm" onClick={() => void crDownload(`/db/files/${f.id}/download`, f.display_name).catch((e) => setError((e as Error).message))}>
                      받기
                    </button>{' '}
                    <button type="button" className="wh-btn wh-btn-ghost wh-btn-sm" onClick={() => void editMemo(f)}>
                      메모
                    </button>{' '}
                    {f.origin === 'upload' && (
                      <button type="button" className="wh-btn wh-btn-ghost wh-btn-sm" onClick={() => void remove(f)}>
                        지우기
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, alignItems: 'center', padding: 12 }}>
          <button type="button" className="wh-btn wh-btn-ghost wh-btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            이전
          </button>
          <span style={mutedText}>
            {page} / {pages}
          </span>
          <button type="button" className="wh-btn wh-btn-ghost wh-btn-sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>
            다음
          </button>
        </div>
      )}

      <Modal open={!!preview} onClose={closePreview} title={preview?.file.display_name} maxWidth={960}>
        {preview?.url && preview.file.file_type === 'pdf' && (
          <iframe src={preview.url} title="미리보기" style={{ width: '100%', height: '70vh', border: 'none', borderRadius: 8, background: '#fff' }} />
        )}
        {preview?.url && preview.file.file_type !== 'pdf' && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview.url} alt={preview.file.display_name} style={{ maxWidth: '100%', borderRadius: 8 }} />
        )}
        {preview?.text !== undefined && (
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 13, color: 'var(--text-secondary)', maxHeight: '70vh', overflow: 'auto', margin: 0 }}>{preview.text}</pre>
        )}
        {preview && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
            <button type="button" className="wh-btn wh-btn-primary wh-btn-sm" onClick={() => void crDownload(`/db/files/${preview.file.id}/download`, preview.file.display_name)}>
              내려받기
            </button>
          </div>
        )}
      </Modal>
    </Card>
  );
}

export default FileBrowser;
