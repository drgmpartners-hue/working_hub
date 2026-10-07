'use client';

/**
 * 중복 고객 정리 (2026-10-07) — 대표 화면. 같은 고객이 두 번 등록된 묶음(이름·생년월일·담당자 같음)을 보여 주고 합친다.
 * 없으면 아무것도 표시하지 않는다. 합치기는 되돌릴 수 없으므로 한 번 더 확인받는다.
 */
import { useCallback, useEffect, useState } from 'react';

import { adminApi } from './api';

interface Rec {
  id: string;
  unique_code: string | null;
  created_at: string | null;
  keep: boolean;
  linked: Record<string, number>;
}
interface Group {
  name: string;
  birth_date: string | null;
  keep_id: string;
  code_after: string | null;
  blocked: string | null;
  records: Rec[];
}
interface MergeResult {
  merged: { name: string }[];
  failed: { keep_id: string; reason: string }[];
}

const linkedText = (l: Record<string, number>) => {
  const parts = Object.entries(l).filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n}`);
  return parts.length ? parts.join(' · ') : '연결된 자료 없음';
};

export function DuplicateClientsCard() {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    adminApi<{ groups: Group[] }>('/admin/duplicate-clients')
      .then((d) => setGroups(d.groups))
      .catch(() => setGroups([]));
  }, []);

  useEffect(() => {
    let alive = true;
    adminApi<{ groups: Group[] }>('/admin/duplicate-clients')
      .then((d) => alive && setGroups(d.groups))
      .catch(() => alive && setGroups([]));
    return () => {
      alive = false;
    };
  }, []);

  if (!groups || (groups.length === 0 && !msg)) return null;

  const ready = groups.filter((g) => !g.blocked);

  async function mergeAll() {
    if (!ready.length) return;
    const ok = window.confirm(
      `${ready.length}명의 중복 고객을 하나로 합칩니다.\n\n` +
        '· 계좌가 있는 기록을 남기고, 다른 기록의 문자 기록·은퇴설계 등은 남길 기록으로 옮깁니다.\n' +
        '· 고유번호는 먼저 등록된(고객 정보 관리) 쪽 번호로 맞춥니다.\n' +
        '· 이미 보낸 두 포털 링크는 모두 계속 열립니다.\n' +
        '· 비어 있게 된 기록은 지워지며 되돌릴 수 없습니다.\n\n진행할까요?',
    );
    if (!ok) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await adminApi<MergeResult>('/admin/duplicate-clients/merge', {
        method: 'POST',
        body: JSON.stringify({
          groups: ready.map((g) => ({ keep_id: g.keep_id, remove_ids: g.records.filter((r) => !r.keep).map((r) => r.id) })),
        }),
      });
      setMsg(
        `${res.merged.length}명 합쳤습니다.` +
          (res.failed.length ? ` ${res.failed.length}명은 합치지 못했습니다: ${res.failed.map((f) => f.reason).join(' / ')}` : ''),
      );
      load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '합치지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: '12px 16px', borderRadius: 10, background: 'var(--warning-bg)', fontSize: 13, lineHeight: 1.7 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <div>
          <span style={{ fontWeight: 700, color: 'var(--warning)' }}>
            {groups.length ? `중복 등록된 고객 ${groups.length}명` : '중복 고객 정리'}
          </span>
          {groups.length > 0 && (
            <span style={{ color: 'var(--text-secondary)', marginLeft: 8 }}>
              이름·생년월일·담당자가 같은 고객이 두 번 등록돼, 계좌가 고객 정보 관리 쪽에 보이지 않습니다.
            </span>
          )}
        </div>
        {groups.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            <button className="wh-btn wh-btn-ghost wh-btn-sm" onClick={() => setOpen((v) => !v)}>
              {open ? '목록 닫기' : '목록 보기'}
            </button>
            <button className="wh-btn wh-btn-primary wh-btn-sm" disabled={busy || !ready.length} onClick={mergeAll}>
              {busy ? '합치는 중…' : `${ready.length}명 합치기`}
            </button>
          </div>
        )}
      </div>
      {msg && <div style={{ marginTop: 6, color: 'var(--text-primary)' }}>{msg}</div>}
      {open && groups.length > 0 && (
        <div style={{ marginTop: 8, maxHeight: 360, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ color: 'var(--text-muted)', textAlign: 'left' }}>
                <th style={{ padding: '4px 6px' }}>고객</th>
                <th style={{ padding: '4px 6px' }}>등록일 · 고유번호 · 연결된 자료</th>
                <th style={{ padding: '4px 6px' }}>합친 뒤 고유번호</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.keep_id} style={{ borderTop: '1px solid var(--border)', verticalAlign: 'top' }}>
                  <td style={{ padding: '6px', whiteSpace: 'nowrap', color: 'var(--text-primary)', fontWeight: 600 }}>
                    {g.name}
                    <div style={{ fontWeight: 400, color: 'var(--text-muted)' }}>{g.birth_date}</div>
                  </td>
                  <td style={{ padding: '6px' }}>
                    {g.records.map((r) => (
                      <div key={r.id} style={{ color: r.keep ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                        {r.keep ? '남길 기록' : '지울 기록(자료는 옮김)'} · {(r.created_at || '').slice(0, 10)} · {r.unique_code || '-'} · {linkedText(r.linked)}
                      </div>
                    ))}
                    {g.blocked && <div style={{ color: 'var(--danger)' }}>{g.blocked}</div>}
                  </td>
                  <td style={{ padding: '6px', fontFamily: 'monospace' }}>{g.blocked ? '-' : g.code_after}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default DuplicateClientsCard;
