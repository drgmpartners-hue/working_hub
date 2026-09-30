'use client';

/**
 * 고객 관리 — 대표 전용 행 동작 (docs/login_logic P5·P6-5).
 *  [담당자 변경] : 고객 한 명을 다른 매니저(또는 대표)에게 이관
 *  [변경 이력]   : 이 고객의 등록·수정·삭제·이관 기록 (감사 로그는 대표만 — 결정 D-5)
 * 화면에서 숨기는 것은 편의일 뿐, 서버가 대표 여부를 다시 확인한다.
 */
import { useState } from 'react';
import {
  ACTION_LABEL,
  RESOURCE_LABEL,
  adminApi,
  cell,
  fmtDateTime,
  headCell,
  type AuditItem,
} from '@/app/(main)/admin/_lib/api';

interface Props {
  client: { id: string; name: string; manager?: { id: string; nickname: string } | null };
  managers: { id: string; nickname: string; is_active: boolean }[];
  onChanged: () => void;
}

interface TransferRow {
  id: string;
  created_at: string;
  from: string | null;
  to: string | null;
  performed_by: string | null;
  reason: string | null;
}

const btn: React.CSSProperties = {
  padding: '5px 10px', borderRadius: 7, border: '1px solid var(--border-strong)', background: 'var(--bg-card)',
  color: 'var(--text-secondary)', fontSize: '0.75rem', fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap',
};

function Overlay({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="dcard"
        style={{ width: '100%', maxWidth: wide ? 900 : 460, maxHeight: '85vh', overflow: 'auto', textAlign: 'left' }}
      >
        <div className="dcard-head">
          <h4>{title}</h4>
          <button style={btn} onClick={onClose}>닫기</button>
        </div>
        <div style={{ padding: '16px 24px' }}>{children}</div>
      </div>
    </div>
  );
}

export function OwnerClientActions({ client, managers, onChanged }: Props) {
  const [mode, setMode] = useState<'none' | 'transfer' | 'history'>('none');
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [transfers, setTransfers] = useState<TransferRow[] | null>(null);
  const [logs, setLogs] = useState<AuditItem[] | null>(null);

  const targets = managers.filter((m) => m.is_active && m.id !== client.manager?.id);

  const openTransfer = () => {
    setTo('');
    setReason('');
    setErr(null);
    setMode('transfer');
  };

  const openHistory = () => {
    setMode('history');
    setTransfers(null);
    setLogs(null);
    adminApi<TransferRow[]>(`/clients/${client.id}/transfers`).then(setTransfers).catch(() => setTransfers([]));
    adminApi<{ items: AuditItem[] }>(`/admin/audit-logs?client_id=${encodeURIComponent(client.id)}&limit=100`)
      .then((d) => setLogs(d.items))
      .catch(() => setLogs([]));
  };

  const submit = async () => {
    if (!to) {
      setErr('새 담당자를 고르세요.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await adminApi(`/clients/${client.id}/transfer`, { method: 'POST', body: JSON.stringify({ to_user_id: to, reason: reason.trim() || null }) });
      setMode('none');
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '이관하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button style={btn} onClick={openTransfer}>담당자 변경</button>
      <button style={btn} onClick={openHistory}>변경 이력</button>

      {mode === 'transfer' && (
        <Overlay title={`담당자 변경 · ${client.name}`} onClose={() => setMode('none')}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 14 }}>
            <div style={{ color: 'var(--text-muted)' }}>
              현재 담당자: <b style={{ color: 'var(--text-primary)' }}>{client.manager?.nickname ?? '-'}</b>
            </div>
            <select
              value={to}
              onChange={(e) => setTo(e.target.value)}
              style={{ height: 38, padding: '0 10px', borderRadius: 8, border: '1px solid var(--border-strong)', background: 'var(--bg-card)', color: 'var(--text-primary)' }}
            >
              <option value="">새 담당자 선택</option>
              {targets.map((m) => <option key={m.id} value={m.id}>{m.nickname}</option>)}
            </select>
            <input
              placeholder="사유 (선택)"
              value={reason}
              maxLength={300}
              onChange={(e) => setReason(e.target.value)}
              style={{ height: 38, padding: '0 10px', borderRadius: 8, border: '1px solid var(--border-strong)', background: 'var(--bg-card)', color: 'var(--text-primary)' }}
            />
            <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
              계좌·스냅샷·은퇴플랜·예수금·투자기록이 함께 넘어가고, 새 담당자가 과거 문자 이력도 볼 수 있습니다.
              이전 담당자의 수당 정산·콘텐츠 같은 개인 자료는 넘어가지 않습니다.
            </div>
            {err && <div style={{ color: 'var(--danger)', fontSize: 13 }}>{err}</div>}
            <button className="wh-btn wh-btn-primary wh-btn-sm" onClick={submit} disabled={busy}>{busy ? '변경 중...' : '담당자 변경'}</button>
          </div>
        </Overlay>
      )}

      {mode === 'history' && (
        <Overlay title={`변경 이력 · ${client.name}`} onClose={() => setMode('none')} wide>
          <h5 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 8px' }}>담당자 이관</h5>
          {!transfers ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>불러오는 중...</div>
          ) : transfers.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 16 }}>이관 기록이 없습니다.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 20 }}>
              <thead><tr>{['시각', '이전', '새 담당', '실행', '사유'].map((h) => <th key={h} style={headCell}>{h}</th>)}</tr></thead>
              <tbody>
                {transfers.map((t) => (
                  <tr key={t.id}>
                    <td style={{ ...cell, whiteSpace: 'nowrap' }}>{fmtDateTime(t.created_at)}</td>
                    <td style={cell}>{t.from ?? '-'}</td>
                    <td style={cell}>{t.to ?? '-'}</td>
                    <td style={cell}>{t.performed_by ?? '-'}</td>
                    <td style={{ ...cell, color: 'var(--text-secondary)' }}>{t.reason ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <h5 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 8px' }}>등록·수정·삭제 기록</h5>
          {!logs ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>불러오는 중...</div>
          ) : logs.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>기록이 없습니다.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>{['시각', '누가', '동작', '메뉴', '결과'].map((h) => <th key={h} style={headCell}>{h}</th>)}</tr></thead>
              <tbody>
                {logs.map((it) => {
                  const ok = it.status_code === null || (it.status_code >= 200 && it.status_code < 400);
                  return (
                    <tr key={it.id}>
                      <td style={{ ...cell, whiteSpace: 'nowrap' }}>{fmtDateTime(it.created_at)}</td>
                      <td style={cell}>
                        {it.actor ?? '-'}
                        {it.is_impersonated && (
                          <>
                            <span className="wh-badge warn" style={{ marginLeft: 6 }}>대표(대행)</span>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>→ {it.effective ?? '-'} 계정으로</div>
                          </>
                        )}
                      </td>
                      <td style={cell}>{ACTION_LABEL[it.action] ?? it.action}</td>
                      <td style={cell}>{RESOURCE_LABEL[it.resource_type ?? ''] ?? it.resource_type ?? '-'}</td>
                      <td style={cell}><span className={`wh-badge ${ok ? 'pos' : 'neg'}`}>{ok ? '성공' : `실패 ${it.status_code}`}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Overlay>
      )}
    </>
  );
}

export default OwnerClientActions;
