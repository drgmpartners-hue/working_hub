'use client';

/**
 * 고객 정보 관리 — 고객별 증권계좌 펼침 패널 (2026-10-07).
 * 상단 [계좌정보 관리]와 같은 데이터(clients/{id}/accounts)를 고객 줄 아래에 보여 주고, 여기서 수정·등록도 한다.
 * 계좌 삭제는 그 계좌의 분석 기록(스냅샷)까지 함께 지워지므로 여기서는 하지 않는다(상단 [계좌정보 관리]에서).
 */
import { useCallback, useEffect, useState } from 'react';

import { apiJson, isAbort } from '@/lib/apiFetch';

interface Account {
  id: string;
  client_id: string;
  account_type: string;
  account_number?: string | null;
  securities_company?: string | null;
  representative?: string | null;
}

interface Option {
  id: string;
  value: string;
  label: string;
  sort_order: number;
}

interface Form {
  account_type: string;
  securities_company: string;
  account_number: string;
  representative: string;
}

/** 옵션이 아직 없을 때 쓰는 계좌유형 이름(계좌정보 관리와 같음) */
const DEFAULT_TYPES: Option[] = [
  { id: 'd1', value: 'irp', label: 'IRP', sort_order: 1 },
  { id: 'd2', value: 'pension', label: '연금저축', sort_order: 2 },
  { id: 'd3', value: 'pension_hold', label: '연금저축(거치)', sort_order: 3 },
  { id: 'd4', value: 'retirement', label: '퇴직연금', sort_order: 4 },
  { id: 'd5', value: 'stock', label: '주식계좌', sort_order: 5 },
  { id: 'd6', value: 'other', label: '기타계좌', sort_order: 6 },
];

const EMPTY: Form = { account_type: 'irp', securities_company: '', account_number: '', representative: '' };

const cell: React.CSSProperties = { padding: '9px 12px', fontSize: '0.8125rem', color: 'var(--text-secondary)', borderBottom: '1px solid var(--border)' };
const head: React.CSSProperties = { ...cell, fontWeight: 600, color: 'var(--text-muted)', fontSize: '0.75rem', textAlign: 'left', whiteSpace: 'nowrap' };
const input: React.CSSProperties = {
  width: '100%', padding: '6px 8px', fontSize: '0.8125rem', borderRadius: 6,
  border: '1px solid var(--border-strong)', background: 'var(--bg-card)', color: 'var(--text-primary)',
};
const btn = (kind: 'primary' | 'plain'): React.CSSProperties => ({
  padding: '5px 12px', borderRadius: 7, fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
  border: kind === 'primary' ? 'none' : '1px solid var(--border-strong)',
  background: kind === 'primary' ? 'var(--blue-600, #2563EB)' : 'var(--bg-card)',
  color: kind === 'primary' ? '#fff' : 'var(--text-secondary)',
});

export function ClientAccountsPanel({ clientId, clientName }: { clientId: string; clientName: string }) {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [types, setTypes] = useState<Option[]>(DEFAULT_TYPES);
  const [securities, setSecurities] = useState<Option[]>([]);
  const [reps, setReps] = useState<Option[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null); // 계좌 id 또는 'new'
  const [form, setForm] = useState<Form>(EMPTY);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const list = await apiJson<Account[]>(`/api/v1/clients/${clientId}/accounts`, { signal });
      setAccounts(list);
      setError(null);
    } catch (e) {
      if (!isAbort(e)) setError(e instanceof Error ? e.message : '계좌를 불러오지 못했습니다.');
    }
  }, [clientId]);

  useEffect(() => {
    const ctrl = new AbortController();
    apiJson<Account[]>(`/api/v1/clients/${clientId}/accounts`, { signal: ctrl.signal })
      .then((list) => setAccounts(list))
      .catch((e: unknown) => {
        if (!isAbort(e)) setError(e instanceof Error ? e.message : '계좌를 불러오지 못했습니다.');
      });
    // 선택지(계좌정보 관리에서 관리하는 목록) — 못 불러와도 직접 입력으로 저장 가능
    const opt = (f: string) =>
      apiJson<Option[]>(`/api/v1/field-options/${f}`, { signal: ctrl.signal })
        .then((o) => [...o].sort((a, b) => a.sort_order - b.sort_order))
        .catch(() => [] as Option[]);
    opt('account_type').then((o) => o.length && setTypes(o));
    opt('securities').then(setSecurities);
    opt('representative').then(setReps);
    return () => ctrl.abort();
  }, [clientId]);

  const typeLabel = (v: string) => types.find((t) => t.value === v)?.label ?? DEFAULT_TYPES.find((t) => t.value === v)?.label ?? v;

  function startEdit(a: Account) {
    setEditId(a.id);
    setForm({
      account_type: a.account_type,
      securities_company: a.securities_company ?? '',
      account_number: a.account_number ?? '',
      representative: a.representative ?? '',
    });
    setError(null);
  }

  function startNew() {
    setEditId('new');
    setForm(EMPTY);
    setError(null);
  }

  async function save() {
    if (!form.account_type) {
      setError('계좌유형을 고르세요.');
      return;
    }
    setSaving(true);
    try {
      const body = {
        account_type: form.account_type,
        securities_company: form.securities_company.trim(),
        account_number: form.account_number.trim(),
        representative: form.representative.trim(),
      };
      if (editId === 'new') {
        await apiJson(`/api/v1/clients/${clientId}/accounts`, { method: 'POST', json: body });
      } else if (editId) {
        await apiJson(`/api/v1/clients/${clientId}/accounts/${editId}`, { method: 'PUT', json: body });
      }
      setEditId(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  }

  /** 선택지에 없는 예전 값도 그대로 보이도록 목록에 끼워 넣는다 */
  const withCurrent = (opts: Option[], cur: string) =>
    cur && !opts.some((o) => o.label === cur) ? [{ id: `cur-${cur}`, value: cur, label: cur, sort_order: -1 }, ...opts] : opts;

  const editRow = (key: string) => (
    <tr key={key} style={{ background: 'var(--bg-surface)' }}>
      <td style={cell}>
        <select value={form.securities_company} onChange={(e) => setForm({ ...form, securities_company: e.target.value })} style={input}>
          <option value="">선택</option>
          {withCurrent(securities, form.securities_company).map((o) => <option key={o.id} value={o.label}>{o.label}</option>)}
        </select>
      </td>
      <td style={cell}>
        <select value={form.account_type} onChange={(e) => setForm({ ...form, account_type: e.target.value })} style={input}>
          {types.map((o) => <option key={o.id} value={o.value}>{o.label}</option>)}
        </select>
      </td>
      <td style={cell}>
        <input value={form.account_number} onChange={(e) => setForm({ ...form, account_number: e.target.value })} placeholder="계좌번호" style={input} />
      </td>
      <td style={cell}>
        <select value={form.representative} onChange={(e) => setForm({ ...form, representative: e.target.value })} style={input}>
          <option value="">선택</option>
          {withCurrent(reps, form.representative).map((o) => <option key={o.id} value={o.label}>{o.label}</option>)}
        </select>
      </td>
      <td style={{ ...cell, textAlign: 'right' }}>
        <div style={{ display: 'inline-flex', gap: 6 }}>
          <button onClick={() => setEditId(null)} disabled={saving} style={btn('plain')}>취소</button>
          <button onClick={save} disabled={saving} style={btn('primary')}>{saving ? '저장 중…' : '저장'}</button>
        </div>
      </td>
    </tr>
  );

  return (
    <div style={{ padding: '12px 16px 16px', background: 'var(--bg-card-2, var(--bg-surface))', borderTop: '1px dashed var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-primary)' }}>
          {clientName} 님의 증권계좌 {accounts ? <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>({accounts.length})</span> : null}
        </div>
        {editId !== 'new' && (
          <button onClick={startNew} style={btn('primary')}>+ 계좌 등록</button>
        )}
      </div>

      {error && <div style={{ fontSize: '0.8125rem', color: 'var(--danger)', marginBottom: 8 }}>{error}</div>}

      {accounts === null && !error ? (
        <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', padding: '8px 0' }}>불러오는 중…</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ ...head, width: '22%' }}>증권사</th>
              <th style={{ ...head, width: '18%' }}>계좌유형</th>
              <th style={{ ...head, width: '24%' }}>계좌번호</th>
              <th style={{ ...head, width: '16%' }}>투권인</th>
              <th style={{ ...head, textAlign: 'right' }}>관리</th>
            </tr>
          </thead>
          <tbody>
            {(accounts ?? []).map((a) =>
              editId === a.id ? editRow(a.id) : (
                <tr key={a.id}>
                  <td style={{ ...cell, color: 'var(--text-primary)' }}>{a.securities_company || '-'}</td>
                  <td style={cell}>
                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--blue-400)', background: 'var(--bg-card)', padding: '2px 8px', borderRadius: 5 }}>
                      {typeLabel(a.account_type)}
                    </span>
                  </td>
                  <td style={{ ...cell, fontFamily: 'monospace' }}>{a.account_number || '-'}</td>
                  <td style={cell}>{a.representative || '-'}</td>
                  <td style={{ ...cell, textAlign: 'right' }}>
                    <button onClick={() => startEdit(a)} disabled={!!editId} style={btn('plain')}>수정</button>
                  </td>
                </tr>
              ),
            )}
            {editId === 'new' && editRow('new')}
            {accounts && accounts.length === 0 && editId !== 'new' && (
              <tr>
                <td colSpan={5} style={{ ...cell, textAlign: 'center', color: 'var(--text-muted)' }}>
                  등록된 증권계좌가 없습니다. [+ 계좌 등록]으로 추가하세요.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
      <div style={{ marginTop: 8, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
        여기서 고친 내용은 위쪽 [계좌정보 관리]와 주식, 펀드 관리에 그대로 반영됩니다. 계좌 삭제는 분석 기록이 함께 지워지므로 [계좌정보 관리]에서 하세요.
      </div>
    </div>
  );
}

export default ClientAccountsPanel;
