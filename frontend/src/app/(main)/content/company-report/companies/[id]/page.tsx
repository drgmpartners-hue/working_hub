'use client';

/**
 * 기업 상세 — 기본 정보·키워드 + 탭 4개 (기획 4장 ②)
 * 기사 아카이브(?tab=archive&date=) · 기업 원장(?tab=ledger) · 기업 폴더(?tab=folder) · 반기 보고서(?tab=report)
 */
import Link from 'next/link';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Card } from '@/components/common/Card';
import { Tab } from '@/components/common/Tab';
import { ArchiveTab } from '@/components/company-report/ArchiveTab';
import { ComingSoon } from '@/components/company-report/ComingSoon';
import { CoveragePanel } from '@/components/company-report/CoveragePanel';
import { FolderTab } from '@/components/company-report/FolderTab';
import { LedgerTab } from '@/components/company-report/LedgerTab';
import { PublicDataPanel } from '@/components/company-report/PublicDataPanel';
import type { Company, KeywordSet } from '@/components/company-report/types';
import { ChipEditor, ErrorBox, SectionTitle, Spinner, mutedText } from '@/components/company-report/ui';
import { crGet, crPost, crPut } from '@/lib/companyReportApi';

const TABS = [
  { key: 'archive', label: '기사 아카이브' },
  { key: 'ledger', label: '기업 원장' },
  { key: 'folder', label: '기업 폴더' },
  { key: 'report', label: '반기 보고서' },
];

function DetailInner() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tab = TABS.some((t) => t.key === params.get('tab')) ? (params.get('tab') as string) : 'archive';
  const [company, setCompany] = useState<Company | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editKw, setEditKw] = useState<KeywordSet | null>(null);
  const [showInfo, setShowInfo] = useState(false);

  const load = useCallback(async () => {
    try {
      setCompany(await crGet<Company>(`/companies/${id}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveKw = async () => {
    if (!editKw) return;
    try {
      await crPut<Company>(`/companies/${id}`, { keywords: editKw });
      await load();
      setEditKw(null);
      setNotice('키워드를 저장했습니다. 바뀐 키워드로 최근 6개월 기사를 다시 모으고 검증합니다(기업 원장 탭에서 진행률 확인).');
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <Link href="/content/company-report/companies" style={{ ...mutedText, fontSize: 12 }}>
            ← 투자기업 목록
          </Link>
          <h2 style={{ margin: '4px 0 0', fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>
            {company.name}
            {company.name_en && <span style={{ ...mutedText, fontWeight: 400, marginLeft: 8 }}>{company.name_en}</span>}
            {!company.is_active && <span className="wh-badge neg" style={{ marginLeft: 8, verticalAlign: 'middle' }}>비활성</span>}
          </h2>
          <div style={{ ...mutedText, marginTop: 4 }}>
            대표 {company.ceo_name || '-'} · {company.industry || '업종 미상'} · {company.is_listed ? `상장 ${company.stock_code || ''}` : '비상장'} · 누적 기사{' '}
            {company.stats.total}건
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="wh-btn wh-btn-ghost wh-btn-sm" onClick={() => setShowInfo((v) => !v)} aria-expanded={showInfo}>
            {showInfo ? '정보 접기' : '기본 정보·키워드'}
          </button>
          {!company.deleted_at && (
            <button type="button" className="wh-btn wh-btn-ghost wh-btn-sm" onClick={() => void collect()}>
              지금 수집
            </button>
          )}
        </div>
      </div>

      <ErrorBox message={error} />
      {notice && <div style={{ ...mutedText, color: 'var(--success)' }}>{notice}</div>}
      {company.deleted_at && (
        <div
          role="status"
          style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '10px 14px', borderRadius: 10, background: 'var(--warning-bg)', color: 'var(--warning)', fontSize: 13 }}
        >
          화면에서 삭제된 기업입니다({company.deleted_at.slice(0, 10)}). 수집이 멈춰 있고 목록·검색에 나오지 않습니다.
          <button
            type="button"
            className="wh-btn wh-btn-ghost wh-btn-sm"
            onClick={() =>
              void crPost(`/companies/${id}/restore`)
                .then(() => {
                  setNotice('복구했습니다. 수집이 다시 시작됩니다.');
                  return load();
                })
                .catch((e) => setError((e as Error).message))
            }
          >
            복구
          </button>
        </div>
      )}

      {showInfo && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
          <Card padding={16}>
            <SectionTitle>기본 정보</SectionTitle>
            <dl style={{ display: 'grid', gridTemplateColumns: '88px 1fr', gap: '6px 12px', margin: 0, fontSize: 13 }}>
              {[
                ['설립일', company.established_at],
                ['주소', company.address],
                ['홈페이지', company.homepage],
                ['사업자번호', company.biz_reg_no],
                ['정보 출처', company.profile_source === 'dart' ? 'DART' : company.profile_source === 'web' ? '웹 검색' : '직접 입력'],
                ['투자일', company.invested_at],
                ['투자 형태', company.invest_type],
                ['별칭', (company.aliases || []).join(', ')],
                ['메모', company.memo],
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
          </Card>
        </div>
      )}

      <Tab
        items={TABS}
        activeKey={tab}
        onChange={(k) => router.replace(`${pathname}?tab=${k}`)}
        variant="pill"
      />

      {tab === 'archive' && <ArchiveTab companyId={id} initialDate={params.get('date')} />}
      {tab === 'ledger' && (
        <LedgerTab
          companyId={id}
          top={
            <>
              <CoveragePanel companyId={id} />
              <PublicDataPanel companyId={id} bizRegNo={company.biz_reg_no} onBizSaved={() => void load()} />
            </>
          }
        />
      )}
      {tab === 'folder' && <FolderTab companyId={id} companyName={company.name} />}
      {tab === 'report' && (
        <ComingSoon title="반기 보고서" phase="P4" desc="반기별 보고서 본문·이미지, 문장별 출처와 교차 검토 결과, 버전 관리가 여기에 표시됩니다." />
      )}
    </div>
  );
}

export default function CompanyDetailPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <DetailInner />
    </Suspense>
  );
}
