'use client';

/** 공공데이터 — 국민연금 임직원 수 추이·국세청 사업자 상태·KIPRIS 특허·상장사 주가 (P2-8) */
import { useCallback, useEffect, useState } from 'react';
import { Card } from '@/components/common/Card';
import { crGet, crPost, crPut } from '@/lib/companyReportApi';
import { ErrorBox, SectionTitle, inputStyle, mutedText } from './ui';

interface Snap<T> {
  as_of: string;
  data: T | null;
  error: string | null;
}
interface Nps {
  found: boolean;
  workplace?: string;
  data_month?: string;
  members?: number | null;
  joined?: number | null;
  left?: number | null;
  status?: string;
  candidates?: number;
}
interface Nts {
  b_stt: string;
  b_stt_cd?: string;
  tax_type?: string;
  end_dt?: string;
}
interface Kipris {
  total: number;
  registered: number;
  applied_12m: number;
  recent: { title: string | null; application_no: string | null; application_date: string | null; status: string | null }[];
}
interface Resp {
  latest: { nps?: Snap<Nps>; nts?: Snap<Nts>; kipris?: Snap<Kipris>; kis?: Snap<{ current_price?: number; change_rate?: number; market_cap?: number }> };
  nps_trend: { as_of: string; data_month?: string; members?: number | null }[];
}

/** 임직원 수 막대(단일 계열 → 범례 없음, 마지막 값만 직접 표기, 막대마다 툴팁) */
function MemberBars({ trend }: { trend: Resp['nps_trend'] }) {
  const pts = trend.filter((t) => typeof t.members === 'number').slice(-12);
  if (pts.length < 2) return null;
  const max = Math.max(...pts.map((p) => p.members as number), 1);
  const W = 240;
  const H = 56;
  const bw = W / pts.length;
  return (
    <svg width={W} height={H + 14} role="img" aria-label={`임직원 수 추이: ${pts.map((p) => `${p.data_month || p.as_of} ${p.members}명`).join(', ')}`}>
      <line x1={0} y1={H} x2={W} y2={H} stroke="var(--border)" strokeWidth={1} />
      {pts.map((p, i) => {
        const h = Math.max(2, ((p.members as number) / max) * (H - 4));
        const x = i * bw + 2;
        const w = Math.max(2, bw - 4);
        return (
          <g key={p.as_of}>
            <path
              d={`M${x},${H} V${H - h + 4} a4,4 0 0 1 4,-4 H${x + w - 4} a4,4 0 0 1 4,4 V${H} Z`}
              fill="var(--cyan-400)"
              opacity={i === pts.length - 1 ? 1 : 0.55}
            >
              <title>{`${p.data_month || p.as_of}: ${p.members}명`}</title>
            </path>
          </g>
        );
      })}
      <text x={W - 2} y={H + 12} textAnchor="end" fontSize={10} fill="var(--text-muted)">
        {pts[pts.length - 1].data_month || pts[pts.length - 1].as_of}
      </text>
      <text x={2} y={H + 12} fontSize={10} fill="var(--text-muted)">
        {pts[0].data_month || pts[0].as_of}
      </text>
    </svg>
  );
}

const NTS_CLS: Record<string, string> = { '01': 'pos', '02': 'warn', '03': 'neg' };

export function PublicDataPanel({ companyId, bizRegNo, onBizSaved }: { companyId: string; bizRegNo?: string | null; onBizSaved?: () => void }) {
  const [d, setD] = useState<Resp | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [biz, setBiz] = useState('');
  const [showPatents, setShowPatents] = useState(false);

  const load = useCallback(() => {
    crGet<Resp>(`/companies/${companyId}/public-data`)
      .then(setD)
      .catch((e) => setError((e as Error).message));
  }, [companyId]);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await crPost<Resp & { result: Record<string, string> }>(`/companies/${companyId}/public-data/refresh`);
      setD(r);
      const miss = Object.entries(r.result).filter(([, v]) => v === 'no_key').map(([k]) => k);
      if (miss.length) setError(`키가 없어 건너뜀: ${miss.join(', ')} (설정 > API 키에서 공공데이터포털·KIPRIS 등록)`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveBiz = async () => {
    const v = biz.replace(/\D/g, '');
    if (v.length !== 10) {
      setError('사업자번호 10자리를 입력해 주세요.');
      return;
    }
    try {
      await crPut(`/companies/${companyId}`, { biz_reg_no: v });
      setBiz('');
      onBizSaved?.();
      void refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const nps = d?.latest.nps;
  const nts = d?.latest.nts;
  const kp = d?.latest.kipris;
  const kis = d?.latest.kis;
  const box: React.CSSProperties = { border: '1px solid var(--border)', borderRadius: 10, padding: 12, background: 'var(--bg-surface)', minWidth: 0 };

  return (
    <Card padding={16}>
      <SectionTitle
        right={
          <button type="button" className="wh-btn wh-btn-ghost wh-btn-sm" disabled={busy} onClick={() => void refresh()}>
            {busy ? '조회 중…' : '지금 조회'}
          </button>
        }
      >
        공공데이터 <span style={{ ...mutedText, fontWeight: 400, fontSize: 12 }}>매월 자동 갱신</span>
      </SectionTitle>
      <ErrorBox message={error} />
      {!bizRegNo && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10, fontSize: 13, color: 'var(--warning)' }}>
          사업자번호가 없어 국세청 상태를 조회할 수 없고 국민연금 사업장 찾기가 부정확할 수 있습니다.
          <input value={biz} onChange={(e) => setBiz(e.target.value)} placeholder="000-00-00000" style={{ ...inputStyle, width: 150 }} aria-label="사업자번호" />
          <button type="button" className="wh-btn wh-btn-ghost wh-btn-sm" onClick={() => void saveBiz()}>
            저장
          </button>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
        <div style={box}>
          <div style={{ ...mutedText, fontSize: 12 }}>임직원 수 (국민연금 가입자)</div>
          {nps?.data?.found ? (
            <>
              <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', margin: '4px 0' }}>
                {nps.data.members ?? '-'}명
                <span style={{ ...mutedText, fontSize: 12, fontWeight: 400, marginLeft: 6 }}>{nps.data.data_month} 기준</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                신규 {nps.data.joined ?? '-'} · 상실 {nps.data.left ?? '-'} · {nps.data.status}
              </div>
              <MemberBars trend={d?.nps_trend || []} />
            </>
          ) : (
            <div style={{ ...mutedText, fontSize: 13, marginTop: 6 }}>
              {nps?.error ? `조회 실패: ${nps.error}` : nps?.data ? `사업장을 찾지 못했습니다(후보 ${nps.data.candidates ?? 0}곳).` : '아직 조회 전입니다.'}
            </div>
          )}
        </div>

        <div style={box}>
          <div style={{ ...mutedText, fontSize: 12 }}>사업자 상태 (국세청)</div>
          {nts?.data ? (
            <div style={{ marginTop: 6 }}>
              <span className={`wh-badge ${NTS_CLS[nts.data.b_stt_cd || ''] || 'info'}`}>{nts.data.b_stt}</span>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 6 }}>
                {nts.data.tax_type}
                {nts.data.end_dt && ` · 폐업일 ${nts.data.end_dt}`}
              </div>
              <div style={{ ...mutedText, fontSize: 11, marginTop: 4 }}>{nts.as_of} 조회</div>
            </div>
          ) : (
            <div style={{ ...mutedText, fontSize: 13, marginTop: 6 }}>{nts?.error ? `조회 실패: ${nts.error}` : '아직 조회 전입니다.'}</div>
          )}
        </div>

        <div style={box}>
          <div style={{ ...mutedText, fontSize: 12 }}>특허·실용신안 (KIPRIS)</div>
          {kp?.data ? (
            <>
              <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', margin: '4px 0' }}>
                {kp.data.total}건
                <span style={{ ...mutedText, fontSize: 12, fontWeight: 400, marginLeft: 6 }}>
                  등록 {kp.data.registered} · 최근 1년 출원 {kp.data.applied_12m}
                </span>
              </div>
              {kp.data.recent.length > 0 && (
                <button type="button" onClick={() => setShowPatents((v) => !v)} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--cyan-400)', fontSize: 12, cursor: 'pointer' }}>
                  {showPatents ? '목록 접기' : `최근 ${kp.data.recent.length}건 보기`}
                </button>
              )}
            </>
          ) : (
            <div style={{ ...mutedText, fontSize: 13, marginTop: 6 }}>{kp?.error ? `조회 실패: ${kp.error}` : '아직 조회 전입니다.'}</div>
          )}
        </div>

        {kis?.data && (
          <div style={box}>
            <div style={{ ...mutedText, fontSize: 12 }}>주가 (KIS)</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', margin: '4px 0' }}>
              {kis.data.current_price?.toLocaleString('ko-KR') ?? '-'}원
              {typeof kis.data.change_rate === 'number' && (
                <span style={{ fontSize: 13, marginLeft: 6, color: kis.data.change_rate > 0 ? 'var(--danger)' : kis.data.change_rate < 0 ? 'var(--blue-400)' : 'var(--text-secondary)' }}>
                  {kis.data.change_rate > 0 ? '+' : ''}
                  {kis.data.change_rate}%
                </span>
              )}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>시가총액 {kis.data.market_cap?.toLocaleString('ko-KR') ?? '-'}억 · {kis.as_of}</div>
          </div>
        )}
      </div>
      {showPatents && kp?.data && (
        <ul style={{ margin: '10px 0 0', paddingLeft: 18, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
          {kp.data.recent.map((p, i) => (
            <li key={p.application_no || i}>
              <span style={mutedText}>{p.application_date || '-'}</span> {p.title || '(제목 없음)'} <span style={{ ...mutedText, fontSize: 12 }}>{p.status || ''}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default PublicDataPanel;
