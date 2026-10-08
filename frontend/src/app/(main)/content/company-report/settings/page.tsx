'use client';

/** 발송 설정 — 발송 켜기·승인 기간·수신자(2~5명)·템플릿·키 상태·모델·발송 기록 (기획 4장 화면 ⑤) */
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Card } from '@/components/common/Card';
import {
  ErrorBox,
  Field,
  SectionTitle,
  Spinner,
  fmtDate,
  inputStyle,
  mutedText,
} from '@/components/company-report/ui';
import { crGet, crPost, crPut } from '@/lib/companyReportApi';
import { useCrMe } from '@/lib/useCrMe';
import { AdminCard } from '@/components/company-report/AdminCard';
import { RecipientsCard } from '@/components/company-report/RecipientsCard';
import { CronStatusCard, type CronJob } from '@/components/company-report/CronStatusCard';
import {
  CostHistoryCard,
  StageCostCard,
  type StageReport,
} from '@/components/company-report/CostCards';

interface Settings {
  ai_stages?: StageReport | null;
  ai_usage: {
    month: string;
    usd: number;
    rows: { model: string; calls: number; input: number; output: number; usd: number }[];
  };
  solapi_balance: { balance?: number; point?: number; error?: string } & Record<string, unknown>;
  regions: string[];
  storage: { bytes: number; files: number; persistent: boolean };
  enabled: boolean;
  monthly_enabled?: boolean;
  review_until: string | null;
  approval_required_today: boolean;
  approval_days_left: number | null;
  template_daily: string;
  template_monthly: string;
  template_report: string;
  weather_region: string;
  models: { main: string; writer?: string; review: string; summary: string };
  last_run_at: string | null;
  last_send_at: string | null;
  cron?: CronJob[];
  manager_self?: { name: string; phone_masked: string | null; has_phone: boolean; company_count: number }[];
  keys: Record<string, boolean>;
  send_logs: {
    briefing_type: string;
    phone: string;
    name?: string | null;
    channel: string;
    status: string;
    error: string | null;
    sent_at: string | null;
  }[];
}

/** 서버가 이전 버전이거나 일부 값이 빠져도 화면이 깨지지 않게 기본값을 채운다. */
function normalize(raw: Partial<Settings> | null | undefined): Settings {
  const r = (raw || {}) as Partial<Settings>;
  const au = (r.ai_usage || {}) as Partial<Settings['ai_usage']>;
  const st = (r.storage || {}) as Partial<Settings['storage']>;
  return {
    ...(r as Settings),
    regions: Array.isArray(r.regions) && r.regions.length ? r.regions : ['서울'],
    ai_usage: {
      ...(au as Settings['ai_usage']),
      month: au.month || '',
      rows: Array.isArray(au.rows) ? au.rows : [],
      usd: Number(au.usd || 0),
    },
    storage: {
      ...(st as Settings['storage']),
      files: Number(st.files || 0),
      bytes: Number(st.bytes || 0),
      persistent: !!st.persistent,
    },
    solapi_balance: r.solapi_balance || {},
    keys: r.keys || {},
    send_logs: Array.isArray(r.send_logs) ? r.send_logs : [],
    models: { main: '', writer: '', review: '', summary: '', ...(r.models || {}) },
    template_daily: r.template_daily || '',
    template_monthly: r.template_monthly || '',
    template_report: r.template_report || '',
  };
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
  const [me, reloadMe] = useCrMe(true);
  const admin = !!me?.is_admin;
  // 수신자 명단은 담당자별: 매니저는 자기 명단을 직접 관리 (docs/login_logic P9)
  const [s, setS] = useState<Settings | null>(null);
  const [tpl, setTpl] = useState({ daily: '', monthly: '', report: '' });
  const [models, setModels] = useState({ main: '', writer: '', review: '', summary: '' });
  const [region, setRegion] = useState('서울');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const st = normalize(await crGet<Settings>('/settings'));
      setS(st);
      setTpl({ daily: st.template_daily, monthly: st.template_monthly, report: st.template_report });
      setModels({ ...st.models, writer: st.models.writer || '' });
      setRegion(st.weather_region || '서울');
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
      setS(normalize(await crPut<Settings>('/settings', body)));
      setNotice(msg);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const sendNow = async () => {
    if (!window.confirm('오늘 브리핑을 지금 수신자에게 보낼까요? (승인된 브리핑만, 하루 한 번)'))
      return;
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
      <AdminCard
        me={me}
        onChanged={() => {
          reloadMe();
          void load();
        }}
      />

      <Card padding={16}>
        <SectionTitle
          right={
            admin && (
              <button
                type="button"
                className={`wh-btn wh-btn-sm ${s.enabled ? 'wh-btn-ghost' : 'wh-btn-primary'}`}
                disabled={busy}
                onClick={() =>
                  void save(
                    { enabled: !s.enabled },
                    s.enabled ? '자동 발송을 껐습니다.' : '자동 발송을 켰습니다.',
                  )
                }
              >
                {s.enabled ? '발송 끄기' : '발송 켜기'}
              </button>
            )
          }
        >
          데일리 발송
        </SectionTitle>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 12,
            fontSize: 14,
            color: 'var(--text-secondary)',
          }}
        >
          <div>
            <div style={mutedText}>상태</div>
            <span className={`wh-badge ${s.enabled ? 'pos' : 'neg'}`}>
              {s.enabled ? '켜짐 · 평일 08:30' : '꺼짐'}
            </span>
          </div>
          <div>
            <div style={mutedText}>월간 브리핑</div>
            <span
              className={`wh-badge ${s.enabled && s.monthly_enabled !== false ? 'pos' : 'neg'}`}
            >
              {s.monthly_enabled === false
                ? '꺼짐'
                : s.enabled
                  ? '켜짐 · 매월 1일(휴일이면 다음 영업일)'
                  : '데일리 발송이 꺼져 있어 보내지 않음'}
            </span>
            {admin && (
              <div style={{ marginTop: 6 }}>
                <button
                  type="button"
                  className="wh-btn wh-btn-ghost wh-btn-sm"
                  disabled={busy}
                  onClick={() =>
                    void save(
                      { monthly_enabled: s.monthly_enabled === false },
                      s.monthly_enabled === false
                        ? '월간 발송을 켰습니다.'
                        : '월간 발송을 껐습니다.',
                    )
                  }
                >
                  {s.monthly_enabled === false ? '월간 켜기' : '월간 끄기'}
                </button>
              </div>
            )}
          </div>
          <div>
            <div style={mutedText}>발송 방식</div>
            {s.approval_required_today ? (
              <>
                <span>
                  {s.review_until}까지 승인 후 발송{' '}
                  <strong style={{ color: 'var(--warning)' }}>
                    (남은 {s.approval_days_left}일)
                  </strong>
                </span>
                {admin && (
                  <div style={{ marginTop: 6 }}>
                    <button
                      type="button"
                      className="wh-btn wh-btn-ghost wh-btn-sm"
                      disabled={busy}
                      onClick={() =>
                        void save(
                          {
                            review_until: new Date(Date.now() - 86400000)
                              .toISOString()
                              .slice(0, 10),
                          },
                          '승인 없이 자동 발송으로 바꿨습니다.',
                        )
                      }
                    >
                      승인 없이 자동 발송으로
                    </button>
                  </div>
                )}
              </>
            ) : (
              <span>승인 없이 평일 08:30 자동 발송</span>
            )}
          </div>
          <div>
            <div style={mutedText}>최근 작성 / 발송</div>
            {fmtDate(s.last_run_at, true)} / {fmtDate(s.last_send_at, true)}
            <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <Link
                href="/content/company-report/briefing"
                className="wh-btn wh-btn-ghost wh-btn-sm"
              >
                브리핑 보기
              </Link>
              {admin && (
                <button
                  type="button"
                  className="wh-btn wh-btn-ghost wh-btn-sm"
                  disabled={busy}
                  onClick={() => void sendNow()}
                >
                  지금 발송
                </button>
              )}
            </div>
          </div>
        </div>
      </Card>

      <CronStatusCard jobs={s.cron} />

      <RecipientsCard admin={admin} />

      <ManagerSelfCard rows={s.manager_self} />

      <Card padding={16}>
        <SectionTitle
          right={
            admin && (
              <button
                type="button"
                className="wh-btn wh-btn-ghost wh-btn-sm"
                disabled={busy}
                onClick={() =>
                  void save(
                    {
                      template_daily: tpl.daily,
                      template_monthly: tpl.monthly,
                      template_report: tpl.report,
                      main_model: models.main,
                      writer_model: models.writer,
                      review_model: models.review,
                      summary_model: models.summary,
                      weather_region: region,
                    },
                    '저장했습니다.',
                  )
                }
              >
                저장
              </button>
            )
          }
        >
          알림톡 템플릿 · AI 모델 · 날씨 지역
        </SectionTitle>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: 10,
          }}
        >
          <Field label="날씨 지역(데일리 기본정보)">
            <select
              style={inputStyle}
              disabled={!admin}
              value={region}
              onChange={(e) => setRegion(e.target.value)}
            >
              {s.regions.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </Field>
          <Field label="데일리 템플릿 ID (승인된 v1, 비우면 같은 내용을 문자로)">
            <input
              style={inputStyle}
              disabled={!admin}
              value={tpl.daily}
              onChange={(e) => setTpl({ ...tpl, daily: e.target.value })}
              placeholder="KA01TP…"
            />
          </Field>
          <Field label="월간 템플릿 ID (승인된 v1, 비우면 문자로)">
            <input
              style={inputStyle}
              disabled={!admin}
              value={tpl.monthly}
              onChange={(e) => setTpl({ ...tpl, monthly: e.target.value })}
              placeholder="KA01TP…"
            />
          </Field>
          <Field label="반기 보고서 고객 전달 템플릿 ID (템플릿 D, 비우면 문자로)">
            <input
              style={inputStyle}
              disabled={!admin}
              value={tpl.report}
              onChange={(e) => setTpl({ ...tpl, report: e.target.value })}
              placeholder="KA01TP…"
            />
          </Field>
          <Field label="작성 모델 (초안·기업별 요약·사실 확인)">
            <input
              style={inputStyle}
              disabled={!admin}
              value={models.writer || ''}
              onChange={(e) => setModels({ ...models, writer: e.target.value })}
              placeholder="claude-sonnet-5-5"
            />
          </Field>
          <Field label="2차 검토 모델 (최종 판정)">
            <input
              style={inputStyle}
              disabled={!admin}
              value={models.main}
              onChange={(e) => setModels({ ...models, main: e.target.value })}
              placeholder="claude-opus-5-5"
            />
          </Field>
          <Field label="1차 검토 모델">
            <input
              style={inputStyle}
              disabled={!admin}
              value={models.review}
              onChange={(e) => setModels({ ...models, review: e.target.value })}
            />
          </Field>
          <Field label="기사 요약 모델">
            <input
              style={inputStyle}
              disabled={!admin}
              value={models.summary}
              onChange={(e) => setModels({ ...models, summary: e.target.value })}
            />
          </Field>
        </div>
      </Card>

      <Card padding={16}>
        <SectionTitle
          right={
            <Link href="/settings" style={{ fontSize: 12, color: 'var(--cyan-400)' }}>
              API 키 설정 →
            </Link>
          }
        >
          연결 상태
        </SectionTitle>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
            gap: 8,
          }}
        >
          {Object.entries(KEY_LABEL).map(([k, label]) => (
            <div
              key={k}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontSize: 13,
                color: 'var(--text-secondary)',
                padding: '6px 0',
              }}
            >
              {label}
              <span className={`wh-badge ${s.keys[k] ? 'pos' : 'neg'}`}>
                {s.keys[k] ? '연결됨' : '없음'}
              </span>
            </div>
          ))}
        </div>
      </Card>

      <StageCostCard r={s.ai_stages} />
      <CostHistoryCard />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: 16,
        }}
      >
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
                  {s.solapi_balance?.point
                    ? ` · 포인트 ${Number(s.solapi_balance.point).toLocaleString('ko-KR')}`
                    : ''}
                </strong>
              )}
            </div>
            <div>
              기업DB 파일 {s.storage.files.toLocaleString('ko-KR')}개 ·{' '}
              {(s.storage.bytes / 1048576).toFixed(1)}MB{' '}
              {s.storage.persistent ? (
                <span className="wh-badge pos">영구 저장소</span>
              ) : (
                <span className="wh-badge warn">Volume 미연결</span>
              )}
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
              <li
                key={i}
                style={{
                  display: 'flex',
                  gap: 10,
                  flexWrap: 'wrap',
                  fontSize: 13,
                  padding: '6px 0',
                  borderBottom: '1px solid var(--border-soft)',
                  color: 'var(--text-secondary)',
                }}
              >
                <span style={{ width: 130 }}>{fmtDate(l.sent_at, true)}</span>
                <span>
                  {l.briefing_type === 'test'
                    ? '테스트'
                    : l.briefing_type === 'monthly'
                      ? '월간'
                      : '데일리'}
                </span>
                <span style={{ color: 'var(--text-primary)', fontWeight: 600, minWidth: 60 }}>
                  {l.name || '(이름 없음)'}
                </span>
                <span>{l.phone}</span>
                <span>{l.channel === 'alimtalk' ? '알림톡' : 'LMS'}</span>
                <span className={`wh-badge ${l.status === 'failed' ? 'neg' : 'pos'}`}>
                  {l.status === 'failed' ? '실패' : '요청됨'}
                </span>
                {l.error && <span style={{ color: 'var(--danger)' }}>{l.error}</span>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/** 매니저 본인 자동 발송 현황(2026-10-01): 매니저는 자기가 추가한 기업 브리핑을 본인 휴대폰으로 받는다 */
function ManagerSelfCard({ rows }: { rows?: Settings['manager_self'] }) {
  if (!Array.isArray(rows)) return null;
  return (
    <Card padding={16}>
      <SectionTitle>매니저 자동 발송</SectionTitle>
      <div style={{ ...mutedText, fontSize: 12, marginTop: -4, marginBottom: 10 }}>
        기업을 한 곳 이상 추가한 매니저는 따로 등록하지 않아도 자기 기업 브리핑을 본인 휴대폰(내 정보)으로 받습니다.
        회사 수신자 명단에 같은 번호가 있으면 한 번만 갑니다.
      </div>
      {rows.length === 0 ? (
        <div style={mutedText}>아직 기업을 추가한 매니저가 없습니다.</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: '8px' }}>{r.name}</td>
                <td style={{ padding: '8px' }}>기업 {r.company_count}곳</td>
                <td style={{ padding: '8px', color: r.has_phone ? 'var(--text-secondary)' : 'var(--danger)' }}>
                  {r.has_phone ? r.phone_masked : '휴대폰 번호 없음 — 받지 못함'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
