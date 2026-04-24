'use client';

import { useState } from 'react';
import { exportToPdf } from '../utils/pdfExport';

interface ExportButtonsProps {
  /** 각 페이지로 나눌 섹션 ID 배열 (예: [['sec1','sec2'], ['sec3']]) */
  sectionGroups: string[][];
  filename: string;
  /** 현재 활성 탭 이름 (인쇄 헤더에 표시) */
  activeTab?: string;
  /** 고객 정보 (인쇄 헤더에 표시) */
  customerInfo?: {
    name: string;
    birthDate: string;
    targetFund: string;
    retireAge: string;
  };
}

const ALL_TABS = ['은퇴플랜 설계', '은퇴플랜', '연금수령 계획', '투자흐름'];

function buildHeaderHtml(activeTab: string | undefined, customerInfo: ExportButtonsProps['customerInfo']): string {
  const customerRow = customerInfo
    ? `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 18px;border:1px solid #E5E7EB;border-radius:8px;margin-bottom:12px;font-size:13px;background:#F9FAFB;">
        <div>고객명: <strong style="color:#1E3A5F;">${customerInfo.name}</strong></div>
        <div>생년월일: <strong>${customerInfo.birthDate}</strong></div>
        <div>목표은퇴자금: <strong>${customerInfo.targetFund}</strong></div>
        <div>희망은퇴나이: <strong>${customerInfo.retireAge}세</strong></div>
       </div>`
    : '';

  const tabRow = activeTab
    ? `<div style="display:flex;gap:4px;border-bottom:2px solid #E5E7EB;padding-bottom:8px;margin-bottom:16px;font-size:13px;">
        ${ALL_TABS.map(t => {
          const isActive = t === activeTab;
          return `<span style="padding:4px 14px;${isActive ? 'font-weight:700;color:#1E3A5F;border-bottom:3px solid #1E3A5F;' : 'color:#9CA3AF;'}">${t}</span>`;
        }).join('')}
       </div>`
    : '';

  if (!customerRow && !tabRow) return '';
  return `<div style="margin-bottom:8px;">${customerRow}${tabRow}</div>`;
}

export function ExportButtons({ sectionGroups, filename, activeTab, customerInfo }: ExportButtonsProps) {
  const [exporting, setExporting] = useState(false);

  const handlePdf = async () => {
    setExporting(true);
    try {
      // 헤더 엘리먼트 생성 (숨김 상태로 body에 추가)
      const headerHtml = buildHeaderHtml(activeTab, customerInfo);
      let headerEl: HTMLElement | null = null;
      if (headerHtml) {
        headerEl = document.createElement('div');
        headerEl.style.backgroundColor = '#ffffff';
        headerEl.innerHTML = headerHtml;
        document.body.appendChild(headerEl);
      }

      const sections = sectionGroups.map((ids, gi) => {
        // 같은 그룹의 요소를 하나의 wrapper로 묶기
        const elements = ids.map(id => document.getElementById(id)).filter(Boolean) as HTMLElement[];
        if (elements.length === 0) return null;

        const wrapper = document.createElement('div');
        wrapper.style.backgroundColor = '#ffffff';

        // 첫 번째 섹션 그룹에만 헤더 삽입
        if (gi === 0 && headerEl) {
          const hClone = headerEl.cloneNode(true) as HTMLElement;
          wrapper.appendChild(hClone);
        }

        elements.forEach(el => {
          const clone = el.cloneNode(true) as HTMLElement;
          wrapper.appendChild(clone);
        });
        document.body.appendChild(wrapper);
        return { element: wrapper, pageBreakBefore: gi > 0, _temp: wrapper };
      }).filter(Boolean) as ({ element: HTMLElement; pageBreakBefore: boolean; _temp?: HTMLElement })[];

      await exportToPdf(sections, filename);

      // 임시 wrapper 제거
      sections.forEach(s => { if (s._temp) document.body.removeChild(s._temp); });
      if (headerEl) document.body.removeChild(headerEl);
    } catch (e) {
      console.error('PDF 내보내기 실패:', e);
      alert('PDF 내보내기에 실패했습니다.');
    } finally {
      setExporting(false);
    }
  };

  const handlePrint = async () => {
    setExporting(true);
    try {
      const { default: html2canvas } = await import('html2canvas');

      // 헤더 생성
      const headerHtml = buildHeaderHtml(activeTab, customerInfo);
      let headerEl: HTMLElement | null = null;
      if (headerHtml) {
        headerEl = document.createElement('div');
        headerEl.style.cssText = 'background:#fff;position:absolute;left:-9999px;top:0;';
        headerEl.innerHTML = headerHtml;
        document.body.appendChild(headerEl);
      }

      // 각 섹션 그룹을 이미지로 캡처
      const images: string[] = [];
      for (let gi = 0; gi < sectionGroups.length; gi++) {
        const ids = sectionGroups[gi];
        const elements = ids.map(id => document.getElementById(id)).filter(Boolean) as HTMLElement[];
        if (elements.length === 0) continue;

        // wrapper 생성
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'background:#fff;position:absolute;left:-9999px;top:0;width:1000px;padding:16px;';
        if (gi === 0 && headerEl) wrapper.appendChild(headerEl.cloneNode(true) as HTMLElement);
        elements.forEach(el => {
          const clone = el.cloneNode(true) as HTMLElement;
          clone.style.display = 'block';
          clone.querySelectorAll('[style]').forEach(child => {
            const c = child as HTMLElement;
            if (c.style.display === 'none') c.style.display = 'block';
          });
          wrapper.appendChild(clone);
        });
        document.body.appendChild(wrapper);

        const canvas = await html2canvas(wrapper, { scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false, allowTaint: true });
        images.push(canvas.toDataURL('image/png'));
        document.body.removeChild(wrapper);
      }
      if (headerEl) document.body.removeChild(headerEl);

      // 이미지를 새 창에서 프린트
      const printWindow = window.open('', '_blank');
      if (!printWindow) return;

      const imgTags = images.map((src, i) =>
        `<div style="${i > 0 ? 'page-break-before:always;' : ''}"><img src="${src}" style="width:100%;height:auto;" /></div>`
      ).join('');

      printWindow.document.write(`<!DOCTYPE html><html><head><title>Wrap 은퇴설계</title>
        <style>
          * { margin:0; padding:0; }
          body { background:#fff; }
          @page { size:A4 portrait; margin:8mm; }
          @media print { body { -webkit-print-color-adjust:exact; print-color-adjust:exact; } }
        </style>
      </head><body>${imgTags}</body></html>`);
      printWindow.document.close();
      setTimeout(() => { printWindow.print(); printWindow.close(); }, 500);
    } catch (e) {
      console.error('프린트 실패:', e);
    } finally {
      setExporting(false);
    }
  };

  const btnBase: React.CSSProperties = {
    padding: '8px 16px', fontSize: '13px', fontWeight: 600, borderRadius: '8px',
    cursor: 'pointer', border: 'none', display: 'flex', alignItems: 'center', gap: '6px',
  };

  return (
    <div className="no-print" style={{ display: 'flex', gap: '8px' }}>
      <button
        onClick={handlePdf}
        disabled={exporting}
        style={{ ...btnBase, backgroundColor: '#1E3A5F', color: '#fff', opacity: exporting ? 0.6 : 1 }}
      >
        {exporting ? '생성 중...' : 'PDF 다운로드'}
      </button>
      <button
        onClick={handlePrint}
        style={{ ...btnBase, backgroundColor: '#F3F4F6', color: '#374151', border: '1px solid #D1D5DB' }}
      >
        프린트
      </button>
    </div>
  );
}
