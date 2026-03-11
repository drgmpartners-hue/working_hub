'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/common/Button';
import { InputPanel } from '@/components/content/InputPanel';
import { AITextReview } from '@/components/content/AITextReview';
import { ReportPreview } from '@/components/content/ReportPreview';
import { StepIndicator } from '@/components/content/StepIndicator';
import type { ContentProject, ContentVersion } from '@/types/content';

const STEPS = [
  { number: 1, label: '정보 입력' },
  { number: 2, label: 'AI 텍스트 검토' },
  { number: 3, label: '보고서 미리보기' },
];

export default function ReportPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [project, setProject] = useState<ContentProject | null>(null);
  const [versions, setVersions] = useState<ContentVersion[]>([]);
  const [currentVersion, setCurrentVersion] = useState<ContentVersion | null>(null);
  const [approvedVersion, setApprovedVersion] = useState<ContentVersion | null>(null);

  function handleInputComplete(proj: ContentProject, ver: ContentVersion) {
    setProject(proj);
    setVersions([ver]);
    setCurrentVersion(ver);
    setStep(2);
  }

  function handleApprove(ver: ContentVersion) {
    setApprovedVersion(ver);
    setVersions((prev) => prev.map((v) => (v.id === ver.id ? ver : v)));
    setStep(3);
  }

  function handleRegenerate(newVer: ContentVersion) {
    setVersions((prev) => {
      const exists = prev.some((v) => v.id === newVer.id);
      return exists ? prev : [...prev, newVer];
    });
    setCurrentVersion(newVer);
  }

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto' }}>
      {/* Page header */}
      <div
        style={{
          marginBottom: '28px',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
        }}
      >
        <div>
          <div
            style={{
              width: '36px',
              height: '4px',
              borderRadius: '2px',
              backgroundColor: '#D4A847',
              marginBottom: '10px',
            }}
          />
          <h1
            style={{
              margin: 0,
              fontSize: '24px',
              fontWeight: 800,
              color: '#1A1A2E',
              letterSpacing: '-0.5px',
            }}
          >
            보고서 제작
          </h1>
          <p style={{ margin: '6px 0 0', fontSize: '14px', color: '#6B7280' }}>
            AI로 브랜드 보고서를 자동 생성합니다
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push('/dashboard')}
          style={{ marginTop: '4px' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          대시보드
        </Button>
      </div>

      {/* Step indicator */}
      <StepIndicator steps={STEPS} currentStep={step} accentColor="#D4A847" />

      {/* Step content */}
      {step === 1 && (
        <InputPanel contentType="report" onComplete={handleInputComplete} />
      )}

      {step === 2 && project && currentVersion && (
        <AITextReview
          project={project}
          currentVersion={currentVersion}
          versions={versions}
          onApprove={handleApprove}
          onRegenerate={handleRegenerate}
        />
      )}

      {step === 3 && project && approvedVersion && (
        <>
          <ReportPreview project={project} version={approvedVersion} />
          <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'center' }}>
            <Button
              variant="secondary"
              size="md"
              onClick={() => {
                setStep(1);
                setProject(null);
                setVersions([]);
                setCurrentVersion(null);
                setApprovedVersion(null);
              }}
            >
              새 보고서 만들기
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
