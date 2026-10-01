'use client';

/**
 * 브리핑 수신자(2~5명) — 이름으로 찾아 추가
 * 찾는 곳: 데이터 관리 > 고객 정보 관리(휴대폰 번호 포함) + 직원 계정
 */
import { useCallback, useEffect, useState } from 'react';
import { Card } from '@/components/common/Card';
import { crDelete, crGet, crPost } from '@/lib/companyReportApi';
import { ErrorBox, SectionTitle, inputStyle, mutedText } from './ui';

interface Selected {
  id: string;
  kind: 'user' | 'client';
  ref_id: string;
  name: string;
  phone_masked: string | null;
  has_phone: boolean;
}
interface Candidate {
  kind: 'user' | 'client';
  ref_id: string;
  name: string;
  detail: string;
  phone_masked: string | null;
  has_phone: boolean;
  selected: boolean;
}

const KIND: Record<string, { label: string; cls: string }> = {
  client: { label: '고객 정보', cls: 'info' },
  user: { label: '직원 계정', cls: 'pos' },
};

interface ListView {
  mode: 'all' | 'company' | 'manager';
  manager_id: string | null;
  manager_name: string | null;
}

/**
 * 수신자 명단 — 담당자별 (docs/login_logic P9).
 * admin: 이 명단을 고칠 수 있는지(매니저는 자기 명단, 회사 명단은 대표·기업 리포트 관리자).
 * mine: 로그인한 매니저 본인 명단인지(제목 표시용).
 */
export function RecipientsCard({ admin, mine = false }: { admin: boolean; mine?: boolean }) {
  const [selected, setSelected] = useState<Selected[]>([]);
  const [view, setView] = useState<ListView | null>(null);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Candidate[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await crGet<{ selected: Selected[]; view?: ListView }>('/recipients');
      setSelected(Array.isArray(r?.selected) ? r.selected : []);
      setView(r?.view ?? null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const search = async () => {
    if (!q.trim()) return;
    setSearching(true);
    setError(null);
    try {
      setResults(await crGet<Candidate[]>(`/recipients/search?q=${encodeURIComponent(q.trim())}`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSearching(false);
    }
  };

  const add = async (c: Candidate) => {
    setBusy(c.ref_id);
    setError(null);
    try {
      await crPost('/recipients', { kind: c.kind, ref_id: c.ref_id });
      setNotice(`${c.name}님을 수신자로 추가했습니다.`);
      setResults((rs) => rs?.map((x) => (x.ref_id === c.ref_id ? { ...x, selected: true } : x)) || null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const remove = async (s: Selected) => {
    if (!window.confirm(`${s.name}님을 수신자에서 뺄까요?`)) return;
    setBusy(s.id);
    try {
      await crDelete(`/recipients/${s.id}`);
      setResults((rs) => rs?.map((x) => (x.ref_id === s.ref_id ? { ...x, selected: false } : x)) || null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const test = async (s: Selected) => {
    setBusy(s.id);
    setError(null);
    try {
      const r = await crPost<{ channel: string; to: string }>(`/recipients/${s.id}/test-send`);
      setNotice(`${r.to}님께 가장 최근 브리핑을 테스트 발송했습니다(${r.channel === 'alimtalk' ? '알림톡' : '문자'}).`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const full = selected.length >= 5;

  return (
    <Card padding={16}>
      <SectionTitle right={<span style={mutedText}>{selected.length}/5명 · 2명 이상 권장</span>}>
        {view?.mode === 'manager'
          ? mine
            ? '내 수신자 명단'
            : `${view.manager_name ?? '매니저'} 수신자 명단`
          : '회사 수신자 명단'}{' '}
        (데일리·월간 공통)
      </SectionTitle>
      <div style={{ ...mutedText, fontSize: 12, marginTop: -4, marginBottom: 10 }}>
        {view?.mode === 'manager'
          ? '이 명단의 사람들은 이 담당자 화면의 기업(회사 공통 중 숨기지 않은 기업 + 추가한 기업) 브리핑만 받습니다. 고객은 담당 고객만 추가할 수 있습니다.'
          : '이 명단의 사람들은 회사 공통 기업 브리핑을 받습니다.'}
      </div>
      <ErrorBox message={error} />
      {notice && <div style={{ ...mutedText, color: 'var(--success)', marginBottom: 8 }}>{notice}</div>}

      {selected.length === 0 ? (
        <div style={{ ...mutedText, marginBottom: 12 }}>아직 수신자가 없습니다. 아래에서 이름으로 찾아 추가하세요.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 8, marginBottom: 14 }}>
          {selected.map((s) => (
            <div key={s.id} style={{ border: '1px solid var(--blue-400)', borderRadius: 8, padding: '10px 12px', background: 'var(--bg-surface)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                <strong style={{ fontSize: 14, color: 'var(--text-primary)' }}>{s.name}</strong>
                <span className={`wh-badge ${KIND[s.kind].cls}`}>{KIND[s.kind].label}</span>
              </div>
              <div style={{ fontSize: 12, marginTop: 2, color: s.has_phone ? 'var(--text-secondary)' : 'var(--danger)' }}>
                {s.has_phone ? s.phone_masked : '휴대폰 번호 없음 — 발송되지 않습니다'}
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <button type="button" className="wh-btn wh-btn-ghost wh-btn-sm" disabled={busy === s.id || !s.has_phone} onClick={() => void test(s)}>
                  테스트 발송
                </button>
                {admin && (
                  <button type="button" className="wh-btn wh-btn-ghost wh-btn-sm" disabled={busy === s.id} onClick={() => void remove(s)}>
                    빼기
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {admin ? (
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void search();
            }}
            style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}
          >
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="이름으로 찾기 (고객 정보 관리·직원 계정)"
              aria-label="수신자 이름 검색"
              style={{ ...inputStyle, maxWidth: 320 }}
            />
            <button type="submit" className="wh-btn wh-btn-primary wh-btn-sm" disabled={searching || !q.trim()}>
              {searching ? '찾는 중…' : '찾기'}
            </button>
          </form>
          {results && (
            results.length === 0 ? (
              <div style={mutedText}>&quot;{q}&quot;(으)로 찾은 사람이 없습니다. 데이터 관리 &gt; 고객 정보 관리에 등록되어 있는지 확인하세요.</div>
            ) : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {results.map((c) => (
                  <li
                    key={`${c.kind}-${c.ref_id}`}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8, flexWrap: 'wrap' }}
                  >
                    <span className={`wh-badge ${KIND[c.kind].cls}`}>{KIND[c.kind].label}</span>
                    <strong style={{ fontSize: 14, color: 'var(--text-primary)' }}>{c.name}</strong>
                    <span style={{ fontSize: 12, color: c.has_phone ? 'var(--text-secondary)' : 'var(--danger)' }}>
                      {c.has_phone ? c.phone_masked : '휴대폰 번호 없음'}
                    </span>
                    <span style={{ ...mutedText, fontSize: 12, flex: 1, minWidth: 160 }}>{c.detail}</span>
                    {c.selected ? (
                      <span className="wh-badge pos">추가됨</span>
                    ) : (
                      <button
                        type="button"
                        className="wh-btn wh-btn-ghost wh-btn-sm"
                        disabled={!c.has_phone || full || busy === c.ref_id}
                        title={!c.has_phone ? '휴대폰 번호가 없어 추가할 수 없습니다' : full ? '수신자는 최대 5명입니다' : ''}
                        onClick={() => void add(c)}
                      >
                        추가
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )
          )}
        </>
      ) : (
        <div style={mutedText}>회사 수신자 명단은 대표(기업 리포트 관리자)만 고칠 수 있습니다.</div>
      )}
    </Card>
  );
}

export default RecipientsCard;
