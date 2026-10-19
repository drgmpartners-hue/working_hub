'use client';

/**
 * [관련성 없는 기사] 제보 버튼 (2026-10-19).
 * 기업과 무관한 기사가 섞여 보이면 누구나 눌러 관리자(대표·기업 리포트 관리자)에게 알린다.
 * 사유는 선택(예: "같은 이름의 화장품 회사"). 관리자 > 기사 제보에서 Claude 분석·숨기기·키워드 수정으로 처리.
 * submit 을 넘기면(폰 화면) 그것으로, 아니면 로그인한 웹 API 로 보낸다.
 */
import { useState } from 'react';
import { crPost } from '@/lib/companyReportApi';

export function ReportArticleButton({
  articleId,
  submit,
  dark,
}: {
  articleId: string;
  submit?: (articleId: string, reason: string) => Promise<void>;
  /** 폰 화면(어두운 배경) 색 */
  dark?: boolean;
}) {
  const [step, setStep] = useState<'idle' | 'ask' | 'sending' | 'done'>('idle');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const muted = dark ? 'var(--text-muted, #AAB6C8)' : 'var(--text-muted)';

  const send = async () => {
    setStep('sending');
    setErr(null);
    try {
      if (submit) await submit(articleId, reason.trim());
      else await crPost(`/articles/${articleId}/report`, { reason: reason.trim() || null });
      setStep('done');
    } catch (e) {
      setErr(e instanceof Error ? e.message : '보내지 못했습니다.');
      setStep('ask');
    }
  };

  if (step === 'done') {
    return <span style={{ fontSize: 12, color: dark ? '#34D399' : 'var(--success)' }}>✓ 제보했습니다. 관리자가 확인합니다.</span>;
  }
  if (step === 'idle') {
    return (
      <button
        type="button"
        onClick={() => setStep('ask')}
        title="이 기업과 관련 없는 기사면 관리자에게 알려 주세요"
        style={{ background: 'none', border: 'none', padding: 0, color: muted, fontSize: 12, cursor: 'pointer', textDecoration: 'underline' }}
      >
        관련성 없는 기사
      </button>
    );
  }
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 4, width: '100%' }}>
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={300}
        placeholder="사유(선택) 예: 같은 이름의 다른 회사"
        aria-label="제보 사유"
        style={{
          flex: 1,
          minWidth: 160,
          padding: '6px 8px',
          fontSize: 13,
          borderRadius: 6,
          border: `1px solid ${dark ? '#243049' : 'var(--border)'}`,
          background: dark ? '#0B1220' : 'var(--bg-surface)',
          color: dark ? '#F1F5F9' : 'var(--text-primary)',
        }}
      />
      <button
        type="button"
        disabled={step === 'sending'}
        onClick={() => void send()}
        style={{ padding: '6px 12px', fontSize: 13, fontWeight: 700, borderRadius: 6, border: 'none', background: '#F87171', color: '#fff', cursor: 'pointer' }}
      >
        {step === 'sending' ? '보내는 중…' : '제보하기'}
      </button>
      <button
        type="button"
        onClick={() => setStep('idle')}
        style={{ padding: '6px 10px', fontSize: 13, borderRadius: 6, border: `1px solid ${dark ? '#243049' : 'var(--border)'}`, background: 'none', color: muted, cursor: 'pointer' }}
      >
        취소
      </button>
      {err && <span style={{ fontSize: 12, color: '#F87171', width: '100%' }}>{err}</span>}
    </div>
  );
}

export default ReportArticleButton;
