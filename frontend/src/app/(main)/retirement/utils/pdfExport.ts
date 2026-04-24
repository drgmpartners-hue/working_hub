'use client';

import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

interface PdfSection {
  /** CSS selector or element ref for the section */
  element: HTMLElement;
  /** Force page break before this section */
  pageBreakBefore?: boolean;
}

/**
 * 여러 섹션을 A4 세로 PDF로 내보냅니다.
 * 각 섹션은 pageBreakBefore=true이면 새 페이지에서 시작합니다.
 */
export async function exportToPdf(
  sections: PdfSection[],
  filename: string,
  options?: { margin?: number; scale?: number },
) {
  const margin = options?.margin ?? 10;
  const scale = options?.scale ?? 2;
  const pdf = new jsPDF('p', 'mm', 'a4');
  const pageW = 210; // A4 width mm
  const pageH = 297; // A4 height mm
  const contentW = pageW - margin * 2;
  const contentH = pageH - margin * 2;

  let isFirstPage = true;

  for (const section of sections) {
    const el = section.element;
    if (!el) continue;

    // 캡처
    const canvas = await html2canvas(el, {
      scale,
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false,
      // 차트 등 SVG 렌더링을 위해
      allowTaint: true,
    });

    const imgData = canvas.toDataURL('image/png');
    const imgW = contentW;
    const imgH = (canvas.height * contentW) / canvas.width;

    // 새 페이지 필요 여부
    if (!isFirstPage && section.pageBreakBefore) {
      pdf.addPage();
    }

    if (isFirstPage) {
      isFirstPage = false;
    }

    // 이미지가 한 페이지를 초과하면 분할
    if (imgH <= contentH) {
      pdf.addImage(imgData, 'PNG', margin, margin, imgW, imgH);
    } else {
      // 긴 섹션 분할: 원본 캔버스를 페이지 단위로 잘라서 추가
      const totalPages = Math.ceil(imgH / contentH);
      for (let p = 0; p < totalPages; p++) {
        if (p > 0) pdf.addPage();

        const srcY = (p * contentH / imgH) * canvas.height;
        const srcH = Math.min((contentH / imgH) * canvas.height, canvas.height - srcY);
        const drawH = (srcH / canvas.height) * imgH;

        // 부분 캔버스 생성
        const partCanvas = document.createElement('canvas');
        partCanvas.width = canvas.width;
        partCanvas.height = Math.round(srcH);
        const ctx = partCanvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(canvas, 0, Math.round(srcY), canvas.width, Math.round(srcH), 0, 0, canvas.width, Math.round(srcH));
          const partImg = partCanvas.toDataURL('image/png');
          pdf.addImage(partImg, 'PNG', margin, margin, imgW, drawH);
        }
      }
    }
  }

  pdf.save(filename);
}

/**
 * 특정 요소들을 프린트합니다.
 */
export function printSections(sectionIds: string[]) {
  const printContent = sectionIds
    .map(id => document.getElementById(id)?.outerHTML ?? '')
    .join('<div style="page-break-before: always;"></div>');

  const printWindow = window.open('', '_blank');
  if (!printWindow) return;

  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Wrap 은퇴설계</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 20px; color: #111827; }
        @page { size: A4 portrait; margin: 10mm; }
        @media print {
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .no-print { display: none !important; }
        }
      </style>
    </head>
    <body>${printContent}</body>
    </html>
  `);
  printWindow.document.close();
  setTimeout(() => {
    printWindow.print();
    printWindow.close();
  }, 500);
}
