'use client';

/**
 * 투자기업 2단계 삭제
 * 1단계 TrashModal  · 화면에서 삭제 — 목록·검색·수집에서 빠짐, 데이터·폴더는 남음, 복구 가능
 * 2단계 PurgeModal  · 폴더까지 완전 삭제 — 관리자, 기업명 입력 확인, 되돌릴 수 없음
 */
import { useEffect, useState } from 'react';
import { Modal } from '@/components/common/Modal';
import { crDownload, crGet, crPost } from '@/lib/companyReportApi';
import { fmtSize } from './types';
import { ErrorBox, inputStyle, mutedText } from './ui';

interface Target {
  id: string;
  name: string;
}

export function TrashModal({ target, onClose, onDone }: { target: Target | null; onClose: () => void; onDone: (name: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setError(null), [target]);
  if (!target) return null;
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await crPost(`/companies/${target.id}/trash`);
      onDone(target.name);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={`${target.name} 삭제 — 1단계`} maxWidth={520}>
      <ErrorBox message={error} />
      <p style={{ margin: '0 0 10px', fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.7 }}>
        <strong>화면에서 삭제</strong>합니다. 이 기업을 추가한 <strong>모든 담당자</strong>의 목록·통합 검색·기업DB 목록·브리핑에서 빠지고, 뉴스 수집이 멈춥니다. 폴더는 남습니다(폴더 삭제는 [삭제된 기업]에서 따로).
      </p>
      <ul style={{ margin: '0 0 12px', paddingLeft: 18, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.8 }}>
        <li>모은 기사·기업 원장·투자유치 기록·기업 폴더 파일은 <strong>그대로 남습니다</strong>.</li>
        <li>목록 위 <strong>[삭제된 기업]</strong>에서 언제든 <strong>복구</strong>할 수 있습니다.</li>
        <li>데이터와 폴더까지 없애려면 그 뒤에 관리자가 <strong>2단계 · 폴더까지 완전 삭제</strong>를 합니다.</li>
      </ul>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button type="button" className="wh-btn wh-btn-ghost wh-btn-sm" onClick={onClose}>
          취소
        </button>
        <button type="button" className="wh-btn wh-btn-primary wh-btn-sm" disabled={busy} onClick={() => void run()}>
          {busy ? '삭제 중…' : '화면에서 삭제'}
        </button>
      </div>
    </Modal>
  );
}

interface Summary {
  name: string;
  trashed: boolean;
  articles: number;
  keywords: number;
  facts: number;
  funding_rounds: number;
  public_data: number;
  backfill_jobs: number;
  files: number;
  file_bytes: number;
}

export function PurgeModal({ target, onClose, onDone }: { target: Target | null; onClose: () => void; onDone: (name: string) => void }) {
  const [sum, setSum] = useState<Summary | null>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSum(null);
    setTyped('');
    setError(null);
    if (target) {
      crGet<Summary>(`/companies/${target.id}/purge-summary`)
        .then(setSum)
        .catch((e) => setError((e as Error).message));
    }
  }, [target]);

  if (!target) return null;
  const ok = typed.trim() === target.name;

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await crPost(`/companies/${target.id}/purge`, { confirm_name: typed.trim() });
      onDone(target.name);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const rows: [string, number | string][] = sum
    ? [
        ['기사·공시', sum.articles],
        ['기업 원장 사실', sum.facts],
        ['투자유치 기록', sum.funding_rounds],
        ['검색 키워드', sum.keywords],
        ['공공데이터 기록', sum.public_data],
        ['과거 데이터 구축 기록', sum.backfill_jobs],
        ['기업 폴더 파일', `${sum.files}개 (${fmtSize(sum.file_bytes)})`],
      ]
    : [];

  return (
    <Modal open onClose={onClose} title={`${target.name} — 2단계 · 폴더까지 완전 삭제`} maxWidth={560}>
      <ErrorBox message={error} />
      <div role="alert" style={{ padding: '10px 12px', borderRadius: 8, background: 'var(--danger-bg)', color: 'var(--danger)', fontSize: 13, marginBottom: 12, lineHeight: 1.6 }}>
        아래 데이터와 기업DB 폴더의 파일이 <strong>영구히 지워지며 되돌릴 수 없습니다.</strong> 지난 데일리 브리핑(발송 기록) 안의 요약은 남습니다.
      </div>
      {sum && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginBottom: 12 }}>
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k}>
                <td style={{ padding: '5px 4px', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-soft)' }}>{k}</td>
                <td style={{ padding: '5px 4px', textAlign: 'right', color: 'var(--text-primary)', borderBottom: '1px solid var(--border-soft)' }}>
                  {typeof v === 'number' ? `${v.toLocaleString('ko-KR')}건` : v}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <span style={mutedText}>지우기 전에 보관하려면</span>
        <button
          type="button"
          className="wh-btn wh-btn-ghost wh-btn-sm"
          onClick={() => void crDownload(`/db/companies/${target.id}/zip`, `${target.name}.zip`).catch((e) => setError((e as Error).message))}
        >
          폴더 zip 먼저 받기
        </button>
      </div>
      <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>
        확인을 위해 기업명 <strong style={{ color: 'var(--text-primary)' }}>{target.name}</strong>을(를) 그대로 입력하세요.
      </label>
      <input value={typed} onChange={(e) => setTyped(e.target.value)} style={inputStyle} aria-label="확인용 기업명" autoComplete="off" />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
        <button type="button" className="wh-btn wh-btn-ghost wh-btn-sm" onClick={onClose}>
          취소
        </button>
        <button
          type="button"
          className="wh-btn wh-btn-sm"
          disabled={!ok || busy || !sum?.trashed}
          onClick={() => void run()}
          style={{ background: ok ? 'var(--danger)' : 'var(--bg-surface)', color: ok ? '#fff' : 'var(--text-muted)', border: '1px solid var(--danger)' }}
        >
          {busy ? '삭제 중…' : '영구 삭제'}
        </button>
      </div>
    </Modal>
  );
}
