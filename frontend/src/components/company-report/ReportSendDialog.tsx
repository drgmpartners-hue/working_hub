'use client';

/**
 * 반기 보고서 고객 전달 — 고객 고르기 창 (P4-10).
 * mode='send'   : 카톡 링크 발송(알림톡 템플릿 승인 전에는 문자). 검토 완료한 내 보고서만.
 * mode='export' : 고객용 PDF·DOCX(표지에 고객 이름, 쪽 아래 그 고객 담당자 연락처).
 * 매니저에게는 자기 담당 고객만 보인다(서버가 거른다).
 */
import { useEffect, useMemo, useState } from 'react';
import { ErrorBox, Spinner, fmtDate, inputStyle, mutedText } from '@/components/company-report/ui';
import { Modal } from '@/components/common/Modal';
import { crDownload, crGet, crPost } from '@/lib/companyReportApi';

interface SendClient {
  id: string;
  name: string;
  phone_masked: string | null;
  has_phone: boolean;
  manager_name: string | null;
  sent_at: string | null;
}
interface SendResult {
  success: boolean;
  sent: number;
  channel?: string;
  skipped: string[];
  error?: string | null;
}

export function ReportSendDialog({
  reportId,
  title,
  mode,
  onClose,
}: {
  reportId: string;
  title: string;
  mode: 'send' | 'export';
  onClose: () => void;
}) {
  const [clients, setClients] = useState<SendClient[] | null>(null);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SendResult | null>(null);

  useEffect(() => {
    let alive = true;
    crGet<SendClient[]>(`/report-send/clients?report_id=${reportId}`)
      .then((r) => alive && setClients(r))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [reportId]);

  const shown = useMemo(
    () => (clients || []).filter((c) => !q.trim() || c.name.includes(q.trim())),
    [clients, q],
  );
  const toggle = (id: string) =>
    setPicked((p) => (mode === 'export' ? [id] : p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const send = async () => {
    if (!picked.length) return;
    if (!window.confirm(`고객 ${picked.length}명에게 보고서 링크를 보낼까요?`)) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await crPost<SendResult>(`/reports/${reportId}/send`, { client_ids: picked }));
      setClients(await crGet<SendClient[]>(`/report-send/clients?report_id=${reportId}`));
      setPicked([]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const exportFor = async (fmt: 'pdf' | 'docx') => {
    if (!picked[0]) return;
    setBusy(true);
    setError(null);
    try {
      await crDownload(`/reports/${reportId}/export?format=${fmt}&client_id=${picked[0]}`, `보고서.${fmt}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`${mode === 'send' ? '고객에게 보내기' : '고객용 출력'} — ${title}`}
      maxWidth={580}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: '70vh' }}>
        <div style={{ ...mutedText, fontSize: 12 }}>
          {mode === 'send'
            ? '고른 고객에게 카카오톡(알림톡 템플릿 승인 전에는 문자)으로 보고서 링크를 보냅니다. 링크는 로그인 없이 그 고객만 180일 동안 열 수 있고, 담당자 연락처가 함께 보입니다.'
            : '표지에 고객 이름, 쪽 아래에 그 고객 담당자 연락처를 넣어 내려받습니다. 고객용 파일은 기업DB에 저장하지 않고 출력 기록만 남깁니다.'}
        </div>
        <input
          aria-label="고객 이름 찾기"
          placeholder="고객 이름 찾기"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={inputStyle}
        />
        <ErrorBox message={error} />
        {result && (
          <div
            role="status"
            style={{
              padding: '8px 12px', borderRadius: 8, fontSize: 13,
              background: result.success ? 'var(--success-bg)' : 'var(--danger-bg)',
            }}
          >
            {result.success
              ? `${result.sent}명에게 보냈습니다(${result.channel === 'alimtalk' ? '카카오톡' : '문자'}).`
              : `보내지 못했습니다: ${result.error}`}
            {result.skipped.length > 0 && ` · 건너뜀: ${result.skipped.join(', ')}`}
          </div>
        )}
        <div style={{ overflowY: 'auto', flex: 1, border: '1px solid var(--border)', borderRadius: 8 }}>
          {clients === null ? (
            <Spinner />
          ) : shown.length === 0 ? (
            <div style={{ ...mutedText, padding: 16, textAlign: 'center' }}>담당 고객이 없습니다.</div>
          ) : (
            shown.map((c) => {
              const disabled = mode === 'send' && !c.has_phone;
              return (
                <label
                  key={c.id}
                  style={{
                    display: 'flex', gap: 10, alignItems: 'center', padding: '8px 12px',
                    borderBottom: '1px solid var(--border-soft)', opacity: disabled ? 0.5 : 1,
                    cursor: disabled ? 'not-allowed' : 'pointer', fontSize: 13,
                  }}
                >
                  <input
                    type={mode === 'export' ? 'radio' : 'checkbox'}
                    name="report-client"
                    disabled={disabled}
                    checked={picked.includes(c.id)}
                    onChange={() => toggle(c.id)}
                  />
                  <span style={{ fontWeight: 600, minWidth: 80 }}>{c.name}</span>
                  <span style={mutedText}>{c.phone_masked || '휴대폰 없음'}</span>
                  {c.manager_name && <span style={{ ...mutedText, fontSize: 12 }}>담당 {c.manager_name}</span>}
                  {c.sent_at && (
                    <span className="wh-badge pos" style={{ marginLeft: 'auto', fontSize: 11 }}>
                      보냄 {fmtDate(c.sent_at)}
                    </span>
                  )}
                </label>
              );
            })
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button type="button" className="wh-btn wh-btn-ghost" onClick={onClose}>
            닫기
          </button>
          {mode === 'send' ? (
            <button
              type="button"
              className="wh-btn wh-btn-primary"
              disabled={busy || !picked.length}
              onClick={() => void send()}
            >
              {busy ? '보내는 중…' : `${picked.length}명에게 보내기`}
            </button>
          ) : (
            <>
              <button
                type="button"
                className="wh-btn wh-btn-ghost"
                disabled={busy || !picked.length}
                onClick={() => void exportFor('docx')}
              >
                DOCX
              </button>
              <button
                type="button"
                className="wh-btn wh-btn-primary"
                disabled={busy || !picked.length}
                onClick={() => void exportFor('pdf')}
              >
                PDF 내려받기
              </button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

export default ReportSendDialog;
