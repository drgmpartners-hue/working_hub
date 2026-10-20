'use client';

/**
 * 관리자 > 기사 제보 (2026-10-19) — '관련성 없는 기사' 제보를 검토한다.
 * 언제·누가(웹/폰)·어느 기업·어떤 기사인지 보고, [Claude 분석]으로 왜 이 기업에 모였는지와 키워드 대안을 받는다.
 * 기업명을 누르면 오른쪽 패널에서 키워드를 바로 고치고(제안 [적용] → [저장]), 이미 모인 기사도 다시 점검한다.
 * 처리: [기사 숨기기] / [처리 완료](키워드만 고침) / [관련 있음](그대로 둠). 같은 기사의 다른 제보도 함께 닫힌다.
 */
import { useCallback, useEffect, useState } from 'react';
import { CompanyKeywordPanel, type KwAction } from '../_lib/CompanyKeywordPanel';
import { CleanupBox } from './CleanupBox';
import { crGet, crPost } from '@/lib/companyReportApi';
import { fmtDate } from '@/components/company-report/ui';

type Status = 'open' | 'resolved' | 'dismissed' | 'all';
interface Analysis {
  verdict: 'irrelevant' | 'relevant' | 'unclear';
  confidence: 'high' | 'mid' | 'low';
  cause: string;
  matched_by: string;
  reason: string;
  actions: KwAction[];
  hide_article: boolean;
  summary: string;
}
interface Item {
  id: string;
  status: Exclude<Status, 'all'>;
  channel: 'web' | 'mobile';
  reason: string | null;
  created_at: string | null;
  reporter_name: string;
  company: { id: string; name: string; is_active: boolean };
  article: {
    id: string;
    title: string;
    url: string;
    press: string | null;
    summary: string | null;
    published_at: string | null;
    is_hidden: boolean;
    relevance_score: number | null;
    relevance_reason?: string | null;
    ai_role?: string | null;
  };
  same_article_reports: number;
  ai_analysis: Analysis | null;
  ai_analyzed_at: string | null;
  resolution: string | null;
  resolved_by_name: string | null;
  resolved_at: string | null;
}

const TABS: { key: Status; label: string }[] = [
  { key: 'open', label: '검토 대기' },
  { key: 'resolved', label: '처리 완료' },
  { key: 'dismissed', label: '관련 있음(유지)' },
  { key: 'all', label: '전체' },
];
const VERDICT: Record<Analysis['verdict'], { label: string; cls: string }> = {
  irrelevant: { label: '관련 없음', cls: 'neg' },
  relevant: { label: '관련 있음', cls: 'pos' },
  unclear: { label: '애매함', cls: 'warn' },
};
const ROLE_LABEL: Record<string, string> = {
  main: '주인공', major: '주요 등장', mention: '단순 언급', market: '주가·시황 나열', other: '다른 회사',
};
const CONF: Record<Analysis['confidence'], string> = { high: '확신 높음', mid: '확신 보통', low: '확신 낮음' };
const ACTION_LABEL: Record<KwAction['type'], string> = {
  add_exclude: '제외어 추가',
  remove_required: '필수어 빼기',
  add_required: '필수어 추가',
  remove_boost: '보조어 빼기',
  add_boost: '보조어 추가',
};

export default function ArticleReportsPage() {
  const [tab, setTab] = useState<Status>('open');
  const [data, setData] = useState<{ items: Item[]; counts: Record<string, number> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // 처리 중인 제보 id
  const [panel, setPanel] = useState<{ companyId: string; suggestions: KwAction[] } | null>(null);

  const load = useCallback(() => {
    crGet<{ items: Item[]; counts: Record<string, number> }>(`/article-reports?status=${tab}`)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [tab]);

  useEffect(() => {
    let alive = true;
    crGet<{ items: Item[]; counts: Record<string, number> }>(`/article-reports?status=${tab}`)
      .then((d) => {
        if (!alive) return;
        setData(d);
        setError(null);
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [tab]);

  const analyze = async (it: Item) => {
    setBusy(it.id);
    setError(null);
    try {
      const a = await crPost<Analysis>(`/article-reports/${it.id}/analyze`);
      setData((d) => d && { ...d, items: d.items.map((x) => (x.id === it.id ? { ...x, ai_analysis: a, ai_analyzed_at: new Date().toISOString() } : x)) });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const resolve = async (it: Item, action: 'hide' | 'resolved' | 'dismissed') => {
    setBusy(it.id);
    setError(null);
    try {
      await crPost(`/article-reports/${it.id}/resolve`, { action });
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: '1.375rem', fontWeight: 800, color: 'var(--text-primary)' }}>기사 제보</h1>
        <p style={{ margin: '6px 0 0', fontSize: '0.8125rem', color: 'var(--text-muted)', lineHeight: 1.7 }}>
          브리핑·기업 화면에서 직원이 [관련성 없는 기사]로 알린 기사입니다. [Claude 분석]으로 왜 이 기업에 모였는지와 키워드 대안을 보고,
          기업명을 눌러 오른쪽 패널에서 키워드를 바로 고치세요. 처리하면 같은 기사의 다른 제보도 함께 닫힙니다.
        </p>
      </div>

      <CleanupBox />

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`wh-btn wh-btn-sm ${tab === t.key ? 'wh-btn-primary' : 'wh-btn-ghost'}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            {t.key !== 'all' && data ? ` ${data.counts[t.key] ?? 0}` : ''}
          </button>
        ))}
      </div>

      {error && <div style={{ padding: 12, borderRadius: 10, background: 'var(--danger-bg)', color: 'var(--danger)', fontSize: 13 }}>{error}</div>}

      {!data ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>불러오는 중…</div>
      ) : data.items.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
          {tab === 'open' ? '검토할 제보가 없습니다.' : '해당하는 제보가 없습니다.'}
        </div>
      ) : (
        data.items.map((it) => {
          const a = it.ai_analysis;
          const open = it.status === 'open';
          return (
            <article
              key={it.id}
              style={{
                padding: 16,
                borderRadius: 12,
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
                <span>{fmtDate(it.created_at, true)}</span>
                <span>·</span>
                <span style={{ color: 'var(--text-secondary)' }}>{it.reporter_name}</span>
                <span className="wh-badge">{it.channel === 'mobile' ? '폰(카톡 링크)' : '웹'}</span>
                <span>·</span>
                <button
                  type="button"
                  onClick={() => setPanel({ companyId: it.company.id, suggestions: it.ai_analysis?.actions || [] })}
                  title="오른쪽 패널에서 키워드 보기·고치기"
                  style={{ background: 'none', border: 'none', padding: 0, color: 'var(--cyan-400)', fontWeight: 700, fontSize: 13, cursor: 'pointer', textDecoration: 'underline' }}
                >
                  {it.company.name}
                </button>
                {it.same_article_reports > 1 && <span className="wh-badge warn">같은 기사 제보 {it.same_article_reports}건</span>}
                {it.article.is_hidden && <span className="wh-badge">숨김</span>}
              </div>

              <div>
                <a href={it.article.url} target="_blank" rel="noreferrer" style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', textDecoration: 'none' }}>
                  {it.article.title} <span style={{ color: 'var(--cyan-400)' }}>↗</span>
                </a>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                  {[it.article.press, fmtDate(it.article.published_at, true), it.article.relevance_score != null && `관련도 ${it.article.relevance_score}점`,
                    it.article.relevance_reason && `수집 근거: ${it.article.relevance_reason}`,
                    it.article.ai_role && `AI 판정: ${ROLE_LABEL[it.article.ai_role] ?? it.article.ai_role}`]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
                {it.article.summary && <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{it.article.summary}</p>}
                {it.reason && (
                  <div style={{ marginTop: 4, fontSize: 13, color: 'var(--warning)' }}>
                    제보 사유: {it.reason}
                  </div>
                )}
              </div>

              {a && (
                <div style={{ padding: 12, borderRadius: 10, background: 'var(--bg-surface)', border: '1px solid var(--border)', fontSize: 13, lineHeight: 1.65 }}>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    <b style={{ color: 'var(--text-primary)' }}>Claude 분석</b>
                    <span className={`wh-badge ${VERDICT[a.verdict].cls}`}>{VERDICT[a.verdict].label}</span>
                    <span className="wh-badge">{a.cause}</span>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{CONF[a.confidence]}</span>
                    {a.matched_by && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>· 걸린 말: {a.matched_by}</span>}
                  </div>
                  {a.summary && <div style={{ color: 'var(--text-primary)', marginTop: 4 }}>{a.summary}</div>}
                  {a.reason && <div style={{ color: 'var(--text-secondary)', marginTop: 2 }}>{a.reason}</div>}
                  {a.actions.length > 0 && (
                    <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>대안:</span>
                      {a.actions.map((x, i) => (
                        <span key={i} className="wh-badge info" title={x.why}>
                          {ACTION_LABEL[x.type]} &lsquo;{x.keyword}&rsquo;
                        </span>
                      ))}
                      <button
                        type="button"
                        className="wh-btn wh-btn-primary wh-btn-sm"
                        onClick={() => setPanel({ companyId: it.company.id, suggestions: a.actions })}
                      >
                        패널에서 키워드 고치기
                      </button>
                    </div>
                  )}
                </div>
              )}

              {open ? (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button type="button" className="wh-btn wh-btn-ghost wh-btn-sm" disabled={busy === it.id} onClick={() => void analyze(it)}>
                    {busy === it.id ? '처리 중…' : a ? 'Claude 다시 분석' : 'Claude 분석'}
                  </button>
                  <button type="button" className="wh-btn wh-btn-sm" disabled={busy === it.id} onClick={() => void resolve(it, 'hide')}
                    style={{ background: 'var(--danger)', color: '#fff', border: 'none' }}>
                    기사 숨기기
                  </button>
                  <button type="button" className="wh-btn wh-btn-ghost wh-btn-sm" disabled={busy === it.id} onClick={() => void resolve(it, 'resolved')}
                    title="키워드를 고쳐 처리했고 기사는 그대로 둘 때">
                    처리 완료
                  </button>
                  <button type="button" className="wh-btn wh-btn-ghost wh-btn-sm" disabled={busy === it.id} onClick={() => void resolve(it, 'dismissed')}>
                    관련 있음(유지)
                  </button>
                </div>
              ) : (
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {it.resolution} · {it.resolved_by_name || '-'} · {fmtDate(it.resolved_at, true)}
                </div>
              )}
            </article>
          );
        })
      )}

      {panel && (
        <CompanyKeywordPanel
          key={panel.companyId}
          companyId={panel.companyId}
          suggestions={panel.suggestions}
          onClose={() => setPanel(null)}
          onSaved={load}
        />
      )}
    </div>
  );
}
