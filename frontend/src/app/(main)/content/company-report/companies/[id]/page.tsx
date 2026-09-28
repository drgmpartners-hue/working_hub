'use client';

/** 기업 상세 — 기본 정보·키워드·과거 데이터 상태·날짜별 누적 기사 (기획 4장 화면 ②) */
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/common/Card';
import type { Article, Company, KeywordSet } from '@/components/company-report/types';
import { TAG_BADGE } from '@/components/company-report/types';
import { ChipEditor, ErrorBox, SectionTitle, Spinner, fmtDate, mutedText } from '@/components/company-report/ui';
import { crGet, crPatch, crPost, crPut } from '@/lib/companyReportApi';

interface BackfillJob {
  id: string;
  period_from: string;
  period_to: string;
  status: string;
  progress: number;
  source_stats: { naver?: number; dart?: number; new?: number; excluded?: number } | null;
  coverage: { monthly?: Record<string, number>; hit_limit_queries?: string[] } | null;
  verdict: string | null;
  error: string | null;
  created_at: string | null;
}

const TAG_FILTERS = [
  { key: '', label: '전체' },
  { key: 'caution', label: '주의' },
  { key: 'positive', label: '호재' },
  { key: 'neutral', label: '중립' },
];

const SIZE = 30;

export default function CompanyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [company, setCompany] = useState<Company | null>(null);
  const [jobs, setJobs] = useState<BackfillJob[]>([]);
  const [articles, setArticles] = useState<Article[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [tag, setTag] = useState('');
  const [showHidden, setShowHidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editKw, setEditKw] = useState<KeywordSet | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadCompany = useCallback(async () => {
    try {
      const [c, j] = await Promise.all([crGet<Company>(`/companies/${id}`), crGet<BackfillJob[]>(`/companies/${id}/backfill-jobs`)]);
      setCompany(c);
      setJobs(j);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  const loadArticles = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ page: String(page), size: String(SIZE) });
      if (tag) qs.set('tag', tag);
      if (showHidden) qs.set('include_hidden', 'true');
      const res = await crGet<{ total: number; items: Article[] }>(`/companies/${id}/articles?${qs}`);
      setArticles(res.items);
      setTotal(res.total);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id, page, tag, showHidden]);

  useEffect(() => {
    void loadCompany();
  }, [loadCompany]);
  useEffect(() => {
    void loadArticles();
  }, [loadArticles]);

  const byDate = useMemo(() => {
    const m = new Map<string, Article[]>();
    for (const a of articles) {
      const d = a.published_at ? fmtDate(a.published_at) : '날짜 미상';
      m.set(d, [...(m.get(d) || []), a]);
    }
    return Array.from(m.entries());
  }, [articles]);

  const hide = async (a: Article) => {
    try {
      const updated = await crPatch<Article>(`/articles/${a.id}`, { is_hidden: !a.is_hidden });
      setArticles((xs) => (showHidden ? xs.map((x) => (x.id === a.id ? updated : x)) : xs.filter((x) => x.id !== a.id)));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const saveKw = async () => {
    if (!editKw) return;
    try {
      setCompany(await crPut<Company>(`/companies/${id}`, { keywords: editKw }));
      setEditKw(null);
      setNotice('키워드를 저장했습니다. 다음 수집부터 적용됩니다.');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const collect = async () => {
    try {
      await crPost(`/companies/${id}/collect`);
      setNotice('수집을 시작했습니다. 잠시 후 새로고침하세요.');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (!company) return error ? <ErrorBox message={error} /> : <Spinner />;
  const job = jobs[0];
  const pages = Math.max(1, Math.ceil(total / SIZE));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <Link href="/content/company-report/companies" style={{ ...mutedText, fontSize: 12 }}>
            ← 투자기업 목록
          </Link>
          <h2 style={{ margin: '4px 0 0', fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>
            {company.name}
            {company.name_en && <span style={{ ...mutedText, fontWeight: 400, marginLeft: 8 }}>{company.name_en}</span>}
          </h2>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="wh-btn wh-btn-ghost wh-btn-sm" onClick={() => void collect()}>
            지금 수집
          </button>
        </div>
      </div>

      <ErrorBox message={error} />
      {notice && <div style={{ ...mutedText, color: 'var(--success)' }}>{notice}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
        <Card padding={16}>
          <SectionTitle>기본 정보</SectionTitle>
          <dl style={{ display: 'grid', gridTemplateColumns: '88px 1fr', gap: '6px 12px', margin: 0, fontSize: 13 }}>
            {[
              ['대표자', company.ceo_name],
              ['업종', company.industry],
              ['설립일', company.established_at],
              ['상장', company.is_listed ? `상장 ${company.stock_code || ''}` : '비상장'],
              ['주소', company.address],
              ['홈페이지', company.homepage],
              ['정보 출처', company.profile_source === 'dart' ? 'DART' : company.profile_source === 'web' ? '웹 검색' : '직접 입력'],
              ['투자일', company.invested_at],
              ['별칭', (company.aliases || []).join(', ')],
            ].map(([k, v]) => (
              <div key={k} style={{ display: 'contents' }}>
                <dt style={{ color: 'var(--text-muted)' }}>{k}</dt>
                <dd style={{ margin: 0, color: 'var(--text-secondary)', wordBreak: 'break-all' }}>{v || '-'}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card padding={16}>
          <SectionTitle
            right={
              editKw ? (
                <div style={{ display: 'flex', gap: 6 }}>
                  <button type="button" className="wh-btn wh-btn-ghost wh-btn-sm" onClick={() => setEditKw(null)}>
                    취소
                  </button>
                  <button type="button" className="wh-btn wh-btn-primary wh-btn-sm" onClick={() => void saveKw()}>
                    저장
                  </button>
                </div>
              ) : (
                <button type="button" className="wh-btn wh-btn-ghost wh-btn-sm" onClick={() => setEditKw(company.keywords)}>
                  수정
                </button>
              )
            }
          >
            검색 키워드
          </SectionTitle>
          {editKw ? (
            <>
              <ChipEditor label="필수어" values={editKw.required} onChange={(v) => setEditKw({ ...editKw, required: v })} />
              <ChipEditor label="보조어" values={editKw.boost} onChange={(v) => setEditKw({ ...editKw, boost: v })} tone="pos" />
              <ChipEditor label="제외어" values={editKw.exclude} onChange={(v) => setEditKw({ ...editKw, exclude: v })} tone="neg" />
            </>
          ) : (
            (['required', 'boost', 'exclude'] as const).map((k) => (
              <div key={k} style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ ...mutedText, fontSize: 12, width: 44 }}>{{ required: '필수어', boost: '보조어', exclude: '제외어' }[k]}</span>
                {company.keywords[k].length ? (
                  company.keywords[k].map((w) => (
                    <span key={w} className={`wh-badge ${k === 'required' ? 'info' : k === 'boost' ? 'pos' : 'neg'}`}>
                      {w}
                    </span>
                  ))
                ) : (
                  <span style={mutedText}>-</span>
                )}
              </div>
            ))
          )}
          <div style={{ borderTop: '1px solid var(--border)', marginTop: 12, paddingTop: 12 }}>
            <div style={{ ...mutedText, fontSize: 12, marginBottom: 4 }}>과거 데이터 가져오기</div>
            {job ? (
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                <span className={`wh-badge ${job.status === 'done' ? 'pos' : job.status === 'failed' ? 'neg' : 'warn'}`}>
                  {{ queued: '대기', running: `진행 ${job.progress}%`, done: '완료', failed: '실패' }[job.status] || job.status}
                </span>{' '}
                {job.period_from} ~ {job.period_to}
                {job.source_stats && (
                  <div>
                    뉴스 {job.source_stats.naver ?? 0} · 공시 {job.source_stats.dart ?? 0} → 저장 {job.source_stats.new ?? 0} (제외 {job.source_stats.excluded ?? 0})
                  </div>
                )}
                {!!job.coverage?.hit_limit_queries?.length && (
                  <div style={{ color: 'var(--warning)' }}>검색 한도 도달: {job.coverage.hit_limit_queries.join(', ')} — 일부 기간이 빠졌을 수 있음</div>
                )}
                {job.error && <div style={{ color: 'var(--danger)' }}>{job.error}</div>}
              </div>
            ) : (
              <span style={mutedText}>기록 없음</span>
            )}
          </div>
        </Card>
      </div>

      <Card padding={16}>
        <SectionTitle
          right={
            <span style={mutedText}>
              누적 {company.stats.total}건 · 7일 {company.stats.week}건
            </span>
          }
        >
          날짜별 기사
        </SectionTitle>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
          {TAG_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={`wh-btn wh-btn-sm ${tag === f.key ? 'wh-btn-primary' : 'wh-btn-ghost'}`}
              aria-pressed={tag === f.key}
              onClick={() => {
                setTag(f.key);
                setPage(1);
              }}
            >
              {f.label}
            </button>
          ))}
          <label style={{ ...mutedText, display: 'flex', gap: 6, alignItems: 'center', marginLeft: 8, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={showHidden}
              onChange={(e) => {
                setShowHidden(e.target.checked);
                setPage(1);
              }}
            />
            숨긴 기사 보기
          </label>
        </div>

        {loading ? (
          <Spinner />
        ) : byDate.length === 0 ? (
          <div style={{ ...mutedText, padding: '24px 0', textAlign: 'center' }}>기사가 없습니다.</div>
        ) : (
          byDate.map(([d, list]) => (
            <div key={d} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                {d} <span style={{ ...mutedText, fontWeight: 400 }}>{list.length}건</span>
              </div>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {list.map((a) => {
                  const t = a.tag ? TAG_BADGE[a.tag] : null;
                  return (
                    <li key={a.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--border-soft)', opacity: a.is_hidden ? 0.5 : 1 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                        {t && <span className={`wh-badge ${t.cls}`}>{t.label}</span>}
                        {a.source_type === 'dart' && <span className="wh-badge warn">공시</span>}
                        {a.issue_type && <span style={{ ...mutedText, fontSize: 12 }}>{a.issue_type}</span>}
                        <a href={a.url} target="_blank" rel="noreferrer" style={{ color: 'var(--text-primary)', fontSize: 14, fontWeight: 600, flex: 1, minWidth: 200 }}>
                          {a.title}
                        </a>
                        <span style={{ ...mutedText, fontSize: 12 }}>{a.press || a.source}</span>
                        <button
                          type="button"
                          onClick={() => void hide(a)}
                          style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer', textDecoration: 'underline' }}
                        >
                          {a.is_hidden ? '다시 보이기' : '관련 없음'}
                        </button>
                      </div>
                      {a.summary && <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{a.summary}</p>}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}

        {pages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, alignItems: 'center' }}>
            <button type="button" className="wh-btn wh-btn-ghost wh-btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              이전
            </button>
            <span style={mutedText}>
              {page} / {pages}
            </span>
            <button type="button" className="wh-btn wh-btn-ghost wh-btn-sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>
              다음
            </button>
          </div>
        )}
      </Card>

      <Card padding={16}>
        <SectionTitle>자료함</SectionTitle>
        <p style={{ ...mutedText, margin: 0 }}>IR 자료·투자사 보고서 업로드(pdf, docx, hwp, pptx 등)는 기업DB 단계(P2)에서 열립니다.</p>
      </Card>
    </div>
  );
}
