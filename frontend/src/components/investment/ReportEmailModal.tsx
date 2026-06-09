'use client';

import { useState, useEffect, useCallback } from 'react';
import { Modal } from '@/components/common/Modal';
import { Button } from '@/components/common/Button';
import { authLib } from '@/lib/auth';
import { API_URL } from '@/lib/api-url';

interface Props {
  open: boolean;
  onClose: () => void;
}

/** 분석 리포트 이메일 설정 팝업 — 기본 수신자=로그인 이메일, 수정 가능 */
export function ReportEmailModal({ open, onClose }: Props) {
  const [enabled, setEnabled] = useState(false);
  const [recipient, setRecipient] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/stocks/report/settings`, {
        headers: { ...authLib.getAuthHeader() },
      });
      if (res.ok) {
        const d = await res.json();
        setEnabled(!!d.email_enabled);
        setRecipient(d.recipient || '');
      }
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      setMsg('');
      fetchSettings();
    }
  }, [open, fetchSettings]);

  async function save(nextEnabled: boolean) {
    setMsg('');
    try {
      const res = await fetch(`${API_URL}/api/v1/stocks/report/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
        body: JSON.stringify({ email_enabled: nextEnabled, recipient: recipient || null }),
      });
      if (!res.ok) throw new Error();
      setEnabled(nextEnabled);
      setMsg('저장되었습니다.');
    } catch {
      setMsg('저장 실패');
    }
  }

  async function preview() {
    try {
      const res = await fetch(`${API_URL}/api/v1/stocks/report/preview`, {
        headers: { ...authLib.getAuthHeader() },
      });
      const html = await res.text();
      const w = window.open('', '_blank');
      if (w) {
        w.document.write(html);
        w.document.close();
      }
    } catch {
      setMsg('미리보기 실패');
    }
  }

  async function sendNow() {
    setMsg('발송 중...');
    try {
      // 최신 수신자 먼저 저장 후 발송
      await save(enabled);
      const res = await fetch(`${API_URL}/api/v1/stocks/report/send`, {
        method: 'POST',
        headers: { ...authLib.getAuthHeader() },
      });
      setMsg(res.ok ? '발송 요청 완료 (메일 미설정 시 서버 로그만 기록)' : '발송 실패');
    } catch {
      setMsg('발송 실패');
    }
  }

  const labelStyle = { fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 } as const;

  return (
    <Modal open={open} onClose={onClose} title="분석 리포트 이메일 설정" maxWidth={460}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
          매일 분석 후 <strong style={{ color: 'var(--text-primary)' }}>테마 랭킹·상승/하락 종목 리포트</strong>를
          이메일로 받습니다. 기본 수신자는 로그인 이메일이며, 다른 주소로 변경할 수 있습니다.
        </p>

        {/* 수신자 */}
        <div>
          <p style={labelStyle}>받는 사람 (수정 가능)</p>
          <input
            type="email"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder={loading ? '불러오는 중...' : 'email@example.com'}
            style={{
              width: '100%', height: 38, padding: '0 12px', borderRadius: 8,
              border: '1px solid var(--border)', backgroundColor: 'var(--bg-surface)',
              color: 'var(--text-primary)', fontSize: '0.875rem', outline: 'none',
            }}
          />
        </div>

        {/* 자동 발송 토글 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <p style={{ margin: 0, fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>자동 발송</p>
            <p style={{ margin: '2px 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>매일 배치 후 자동으로 보냅니다</p>
          </div>
          <button
            onClick={() => save(!enabled)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8, height: 34, padding: '0 16px',
              borderRadius: 999, border: 'none', cursor: 'pointer', fontSize: '0.8125rem', fontWeight: 700,
              backgroundColor: enabled ? 'rgba(5,150,105,0.15)' : 'var(--bg-surface)',
              color: enabled ? '#059669' : 'var(--text-muted)',
            }}
          >
            <span style={{ width: 9, height: 9, borderRadius: '50%', backgroundColor: enabled ? '#059669' : '#9CA3AF' }} />
            {enabled ? 'ON' : 'OFF'}
          </button>
        </div>

        {msg && <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-muted)' }}>{msg}</p>}

        {/* 액션 */}
        <div style={{ display: 'flex', gap: 8, paddingTop: 4, borderTop: '1px solid var(--border)' }}>
          <Button variant="secondary" size="md" onClick={preview} style={{ flex: 1 }}>미리보기</Button>
          <Button variant="secondary" size="md" onClick={sendNow} style={{ flex: 1 }}>지금 보내기</Button>
          <Button variant="primary" size="md" onClick={() => save(enabled)} style={{ flex: 1, backgroundColor: '#2E8B8B', borderColor: '#2E8B8B' }}>저장</Button>
        </div>
      </div>
    </Modal>
  );
}

export default ReportEmailModal;
