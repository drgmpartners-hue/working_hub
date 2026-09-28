'use client';

/** 발송 설정 — 발송 켜기·승인 기간·수신자(2~5명)·템플릿·키 상태·모델·발송 기록 (기획 4장 화면 ⑤) */
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Card } from '@/components/common/Card';
import { ErrorBox, Field, SectionTitle, Spinner, fmtDate, inputStyle, mutedText } from '@/components/company-report/ui';
import { crGet, crPost, crPut } from '@/lib/companyReportApi';
import { useCrMe } from '@/lib/useCrMe';

interface Settings {
  ai_usage: { month: string; usd: number; rows: { model: string; calls: number; input: number; output: number; usd: number }[] };
  solapi_balance: { balance?: number; point?: number; error?: string } & Record<string, unknown>;
  regions: string[];
  storage: { bytes: number; files: number; persistent: boolean };
  enabled: boolean;
  review_until: string | null;
  approval_required_today: boolean;
  approval_days_left: number | null;
  template_daily: string;
  template_monthly: string;
  weather_region: string;
  models: { main: string; review: string; summary: string };
  last_run_at: string | null;
  last_send_at: string | null;
  keys: Record<string, boolean>;
  send_logs: { briefing_type: string; phone: string; channel: string; status: string; error: string | null; sent_at: string | null }[];
}

interface Recipient {
  user_id: string;
  nickname: string;
  email: string;
  phone_masked: string | null;
  has_phone: boolean;
  selected: boolean;
}

const KEY_LABEL: Record<string, string> = {
  claude: 'Claude (작성·2차 검토·요약)',
  gemini: 'Gemini (1차 검토)',
  naver_search: '네이버 뉴스 검색',
  dart: 'DART 공시',
  data_go_kr: '공공데이터포털 (공휴일·날씨)',
  kis: 'KIS (한국 지수 보조)',
  solapi: 'SOLAPI 발송 키·발신번호',
  kakao_channel: '카카오 채널(SOLAPI_PF_ID)',
};

export default function SettingsPage() {
  const me = useCrMe();
  const admin = !!me?.is_admin;
  const [s, setS] = useState<Settings | null>(null);
  const [rec, setRec] = useState<Recipient[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [tpl, setTpl] = useState({ daily: '', monthly: '' });
  const [models, setModels] = useState({ main: '', review: '', summary: '' });
  const [region, setRegion] = useState('서울');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [st, r] = await Promise.all([crGet<Settings>('/settings'), crGet<Recipient[]>('/recipients')]);
      setS(st);
      setTpl({ daily: st.template_daily, monthly: st.template_monthly });
      setModels(st.models);
      setRegion(st.weather_region || '서울');
      setRec(r);
      setPicked(r.filter((x) => x.selected).map((x) => x.user_id));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (body: Record<string, unknown>, msg: string) => {
    setBusy(true);
    setError(null);
    try {
      setS(await crPut<Settings>('/settings', body));
      setNotice(msg);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveRecipients = async () => {
    if (picked.length < 2 || picked.length > 5) {
      setError('수신자는 2~5명을 골라 주세요.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await crPut('/recipients', { user_ids: picked });
      setNotice(`수신자 ${picked.length}명을 저장했습니다.`);
      void load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const sendNow = async () => {
    if (!window.confirm('오늘 브리핑을 지금 수신자에게 보낼까요? (승인된 브리핑만, 하루 한 번)')) return;
    setBusy(true);
    try {
      const r = await crPost<Record<string, unknown>>('/briefings/daily/send-now');
      setNotice(`발송 결과: ${JSON.stringify(r)}`);
      void load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!s) return error ? <ErrorBox message={error} /> : <Spinner />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <ErrorBox message={error} />
      {notice && <div style={{ ...mutedText, color: 'var(--success)' }}>{notice}</div>}
      {!admin && <div style={mutedText}>설정 변경은 관리자 계정만 할 수 있습니다.</div>}

      <Card padding={16}>
        <SectionTitle
          right={
            admin && (
              <button
                type="button"
                className={`wh-btn wh-btn-sm ${s.enabled ? 'wh-btn-ghost' : 'wh-btn-primary'}`}
                disabled={busy}
                onClick={() => void save({ enabled: !s.enabled }, s.enabled ? '자동 발송을 껐습니다.' : '자동 발송을 켰습니다.')}
              >
                {s.enabled ? '발송 끄기' : '발송 켜기'}
              </button>
            )
          }
        >
          데일리 발송
        </SectionTitle>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, fontSize: 14, color: 'var(--text-secondary)' }}>
          <div>
            <div style={mutedText}>상태</div>
            <span className={`wh-badge ${s.enabled ? 'pos' : 'neg'}`}>{s.enabled ? '켜짐 · 평일 08:30' : '꺼짐'}</span>
          </div>
          <div>
            <div style={mutedText}>승인 모드</div>
            {s.review_until ? (
              s.approval_required_today ? (
                <span>
                  {s.review_until}까지 승인 후 발송 <strong style={{ color: 'var(--warning)' }}>(남은 {s.approval_days_left}일)</strong>
                </span>
              ) : (
                <span>자동 발송 중 ({s.review_until} 승인 기간 종료)</span>
              )
            ) : (
              <span>발송을 켜면 평일 7일간 승인 모드로 시작</span>
            )}
            {admin && s.review_until && (
              <div style={{ marginTop: 6 }}>
                <button type="button" className="wh-btn wh-btn-ghost wh-btn-sm" disabled={busy} onClick={() => void save({ restart_approval: true }, '승인 기간을 오늘부터 다시 시작했습니다.')}>
                  승인 기간 다시 시작
                </button>
              </div>
            )}
          </div>
          <div>
            <div style={mutedText}>최근 작성 / 발송</div>
            {fmtDate(s.last_run_at, true)} / {fmtDate(s.last_send_at, true)}
            <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <Link href="/content/company-report/briefing" className="wh-btn wh-btn-ghost wh-btn-sm">
                브리핑 보기
              </Link>
              {admin && (
                <button type="button" className="wh-btn wh-btn-ghost wh-btn-sm" disabled={busy} onClick={() => void sendNow()}>
                  지금 발송
                </button>
              )}
            </div>
          </div>
        </div>
      </Card>

      <Card padding={16}>
        <SectionTitle
          right={
            admin && (
              <button type="button" className="wh-btn wh-btn-primary wh-btn-sm" disabled={busy} onClick={() => void saveRecipients()}>
                수신자 저장 ({picked.length})
              </button>
            )
          }
        >
          수신자 (2~5명 · 데일리·월간 공통)
        </SectionTitle>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
          {rec.map((r) => {
            const on = picked.includes(r.user_id);
            return (
              <label
                key={r.user_id}
                style={{
                  display: 'flex',
                  gap: 8,
                  alignItems: 'center',
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: `1px solid ${on ? 'var(--blue-400)' : 'var(--border)'}`,
                  background: 'var(--bg-surface)',
                  opacity: r.has_phone ? 1 : 0.5,
                  cursor: admin && r.has_phone ? 'pointer' : 'not-allowed',
                }}
              >
                <input
                  type="checkbox"
                  checked={on}
                  disabled={!admin || !r.has_phone || (!on && picked.length >= 5)}
                  onChange={(e) => setPicked((p) => (e.target.checked ? [...p, r.user_id] : p.filter((x) => x !== r.user_id)))}
                />
                <span style={{ fontSize: 14, color: 'var(--text-primary)' }}>
                  {r.nickname}
                  <span style={{ ...mutedText, fontSize: 12, display: 'block' }}>{r.has_phone ? r.phone_masked : '휴대폰 번호 없음'}</span>
                </span>
              </label>
            );
          })}
        </div>
      </Card>

      <Card padding={16}>
        <SectionTitle
          right={
            admin && (
              <button
                type="button"
                className="wh-btn wh-btn-ghost wh-btn-sm"
                disabled={busy}
                onClick={() => void save({ template_daily: tpl.daily, template_monthly: tpl.monthly, main_model: models.main, review_model: models.review, summary_model: models.summary, weather_region: region }, '저장했습니다.')}
              >
                저장
              </button>
            )
          }
        >
          알림톡 템플릿 · AI 모델 · 날씨 지역
        </SectionTitle>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>
          <Field label="날씨 지역(데일리 기본정보)">
            <select style={inputStyle} disabled={!admin} value={region} onChange={(e) => setRegion(e.target.value)}>
              {s.regions.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </Field>
          <Field label="데일리 템플릿 B ID (비우면 LMS로 발송)">
            <input style={inputStyle} disabled={!admin} value={tpl.daily} onChange={(e) => setTpl({ ...tpl, daily: e.target.value })} placeholder="KA01TP…" />
          </Field>
          <Field label="월간 템플릿 C ID">
            <input style={inputStyle} disabled={!admin} value={tpl.monthly} onChange={(e) => setTpl({ ...tpl, monthly: e.target.value })} placeholder="KA01TP…" />
          </Field>
          <Field label="작성·2차 검토 모델">
            <input style={inputStyle} disabled={!admin} value={models.main} onChange={(e) => setModels({ ...models, main: e.target.value })} />
          </Field>
          <Field label="1차 검토 모델">
            <input style={inputStyle} disabled={!admin} value={models.review} onChange={(e) => setModels({ ...models, review: e.target.value })} />
          </Field>
          <Field label="기사 요약 모델">
            <input style={inputStyle} disabled={!admin} value={models.summary} onChange={(e) => setModels({ ...models, summary: e.target.value })} />
          </Field>
        </div>
      </Card>

      <Card padding={16}>
        <SectionTitle right={<Link href="/settings" style={{ fontSize: 12, color: 'var(--cyan-400)' }}>API 키 설정 →</Link>}>연결 상태</SectionTitle>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 8 }}>
          {Object.entries(KEY_LABEL).map(([k, label]) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, color: 'var(--text-secondary)', padding: '6px 0' }}>
              {label}
              <span className={`wh-badge ${s.keys[k] ? 'pos' : 'neg'}`}>{s.keys[k] ? '연결됨' : '없음'}</span>
            </div>
          ))}
        </div>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
        <Card padding={16}>
          <SectionTitle right={<span style={mutedText}>{s.ai_usage.month}</span>}>AI 사용량(추정)</SectionTitle>
          {s.ai_usage.rows.length === 0 ? (
            <div style={mutedText}>이번 달 기록이 없습니다.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  {['모델', '호출', '입력 토큰', '출력 토큰', '추정 금액'].map((h, i) => (
                    <th key={h} style={{ textAlign: i ? 'right' : 'left', padding: '6px 4px', color: 'var(--text-muted)', fontWeight: 600, fontSize: 12, borderBottom: '1px solid var(--border)' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {s.ai_usage.rows.map((r) => (
                  <tr key={r.model}>
                    <td style={{ padding: '6px 4px', color: 'var(--text-secondary)' }}>{r.model}</td>
                    <td style={{ padding: '6px 4px', textAlign: 'right', color: 'var(--text-secondary)' }}>{r.calls.toLocaleString('ko-KR')}</td>
                    <td style={{ padding: '6px 4px', textAlign: 'right', color: 'var(--text-secondary)' }}>{r.input.toLocaleString('ko-KR')}</td>
                    <td style={{ padding: '6px 4px', textAlign: 'right', color: 'var(--text-secondary)' }}>{r.output.toLocaleString('ko-KR')}</td>
                    <td style={{ padding: '6px 4px', textAlign: 'right', color: 'var(--text-primary)' }}>${r.usd.toFixed(2)}</td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={4} style={{ padding: '6px 4px', color: 'var(--text-muted)' }}>합계(공개 단가 기준 추정)</td>
                  <td style={{ padding: '6px 4px', textAlign: 'right', color: 'var(--text-primary)', fontWeight: 700 }}>${s.ai_usage.usd.toFixed(2)}</td>
                </tr>
              </tbody>
            </table>
          )}
        </Card>
        <Card padding={16}>
          <SectionTitle>SOLAPI 잔액 · 파일 저장소</SectionTitle>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.9 }}>
            <div>
              잔액:{' '}
              {s.solapi_balance?.error ? (
                <span style={mutedText}>{String(s.solapi_balance.error)}</span>
              ) : (
                <strong style={{ color: 'var(--text-primary)' }}>
                  {Number(s.solapi_balance?.balance ?? 0).toLocaleString('ko-KR')}원
                  {s.solapi_balance?.point ? ` · 포인트 ${Number(s.solapi_balance.point).toLocaleString('ko-KR')}` : ''}
                </strong>
              )}
            </div>
            <div>
              기업DB 파일 {s.storage.files.toLocaleString('ko-KR')}개 · {(s.storage.bytes / 1048576).toFixed(1)}MB{' '}
              {s.storage.persistent ? <span className="wh-badge pos">영구 저장소</span> : <span className="wh-badge warn">Volume 미연결</span>}
            </div>
          </div>
        </Card>
      </div>

      <Card padding={16}>
        <SectionTitle>최근 발송 기록</SectionTitle>
        {s.send_logs.length === 0 ? (
          <div style={mutedText}>기록이 없습니다.</div>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {s.send_logs.map((l, i) => (
              <li key={i} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 13, padding: '6px 0', borderBottom: '1px solid var(--border-soft)', color: 'var(--text-secondary)' }}>
                <span style={{ width: 130 }}>{fmtDate(l.sent_at, true)}</span>
                <span>{l.briefing_type === 'test' ? '테스트' : l.briefing_type === 'monthly' ? '월간' : '데일리'}</span>
                <span>{l.phone}</span>
                <span>{l.channel === 'alimtalk' ? '알림톡' : 'LMS'}</span>
                <span className={`wh-badge ${l.status === 'failed' ? 'neg' : 'pos'}`}>{l.status === 'failed' ? '실패' : '요청됨'}</span>
                {l.error && <span style={{ color: 'var(--danger)' }}>{l.error}</span>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
