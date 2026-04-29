'use client';

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import html2canvas from 'html2canvas';

/* ================================================================
   은퇴플랜 PDF — jspdf-autotable 기반
   Page 1+: 기본정보 + 연도별 예상 평가금액 테이블
   Last page: 성장 그래프
   ================================================================ */

const PW = 210, PH = 297, M = 12;
const CW = PW - M * 2;
const HDR = 14, FTR = 8;
const BY = M + HDR;

function ab2b64(buf: ArrayBuffer): string {
  const u8 = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let fc: any = null;
async function loadFont(pdf: jsPDF) {
  if (!fc) {
    try {
      const [rn, rb] = await Promise.all([
        fetch('/fonts/NanumGothic.ttf').then(r => r.arrayBuffer()),
        fetch('/fonts/NanumGothicBold.ttf').then(r => r.arrayBuffer()),
      ]);
      fc = { n: ab2b64(rn), b: ab2b64(rb) };
    } catch { return; }
  }
  pdf.addFileToVFS('NG.ttf', fc.n);
  pdf.addFont('NG.ttf', 'NG', 'normal');
  pdf.addFileToVFS('NGB.ttf', fc.b);
  pdf.addFont('NGB.ttf', 'NG', 'bold');
  pdf.setFont('NG', 'normal');
}

function setFont(pdf: jsPDF, style: 'normal' | 'bold' = 'normal') {
  try { pdf.setFont('NG', style); } catch { /* fallback */ }
}

interface Customer { name: string; birthDate: string; targetFund: string; retireAge: string; }
let _tp = 0;

function drawHeader(pdf: jsPDF, c: Customer) {
  setFont(pdf, 'bold');
  pdf.setFontSize(14); pdf.setTextColor(30, 58, 95);
  pdf.text('Wrap 은퇴설계', M, M + 6);
  setFont(pdf);
  pdf.setFontSize(7); pdf.setTextColor(107, 114, 128);
  pdf.text('은퇴플랜 보고서', M, M + 10);
  setFont(pdf, 'bold');
  pdf.setFontSize(10); pdf.setTextColor(17, 24, 39);
  pdf.text(c.name, PW - M, M + 6, { align: 'right' });
  setFont(pdf);
  pdf.setFontSize(6.5); pdf.setTextColor(107, 114, 128);
  pdf.text(`${c.birthDate} | 목표: ${c.targetFund} | 은퇴: ${c.retireAge}세`, PW - M, M + 10, { align: 'right' });
  pdf.setDrawColor(30, 58, 95); pdf.setLineWidth(0.5);
  pdf.line(M, M + 13, PW - M, M + 13);
}

function drawFooter(pdf: jsPDF, pg: number) {
  setFont(pdf);
  pdf.setFontSize(6); pdf.setTextColor(156, 163, 175);
  const fy = PH - M;
  pdf.setFillColor(255, 255, 255);
  pdf.rect(M, fy - 4, 40, 6, 'F');
  pdf.rect(PW - M - 20, fy - 4, 20, 6, 'F');
  pdf.setTextColor(156, 163, 175);
  pdf.text(`출력일: ${new Date().toLocaleDateString('ko-KR')}`, M, fy);
  pdf.text(`${pg} / ${_tp}`, PW - M, fy, { align: 'right' });
}

function secTitle(pdf: jsPDF, title: string, y: number): number {
  setFont(pdf, 'bold');
  pdf.setFontSize(10); pdf.setTextColor(30, 58, 95);
  pdf.text(title, M, y + 4);
  pdf.setDrawColor(30, 58, 95); pdf.setLineWidth(0.4);
  pdf.line(M, y + 6, PW - M, y + 6);
  return y + 10;
}

function fmt(v: number): string { return Math.round(v).toLocaleString('ko-KR'); }
function fmtW(v: number): string {
  if (Math.abs(v) >= 1e8) return `${(v / 1e8).toFixed(1)}억원`;
  if (Math.abs(v) >= 1e4) return `${fmt(Math.round(v / 1e4))}만원`;
  return `${fmt(Math.round(v))}원`;
}

/* ---- 데이터 인터페이스 ---- */
export interface SimRow {
  calYear: number; year: number; age: number; phase: string;
  monthlyPayment: number; additional: number;
  cumulativePrincipal: number; investmentReturn: number;
  pension: number; cumPension: number; evaluation: number;
}

export interface RetirementPlanPdfData {
  customer: Customer;
  info: { [key: string]: string };
  simRows: SimRow[];
  retirementAge: number;
  chartId: string; // 성장 그래프 DOM id
}

/* ---- 차트 캡처 ---- */
async function captureChart(el: HTMLElement): Promise<string | null> {
  if (!el || el.offsetHeight === 0) return null;
  try {
    const canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: '#fff', logging: false, allowTaint: true });
    if (canvas.width === 0 || canvas.height === 0) return null;
    return canvas.toDataURL('image/jpeg', 0.92);
  } catch { return null; }
}

/* ================================================================
   메인: PDF 생성
   ================================================================ */
export async function generateRetirementPlanPdf(data: RetirementPlanPdfData, filename: string) {
  const pdf = new jsPDF('p', 'mm', 'a4');
  await loadFont(pdf);
  const c = data.customer;
  let pn = 0;

  function newPage() { if (pn > 0) pdf.addPage(); pn++; drawHeader(pdf, c); }

  // ==================== 1. 기본정보 + 테이블 ====================
  newPage();
  let y = secTitle(pdf, '1. 은퇴플랜 기본정보', BY);

  // 기본정보 (3그룹 카드)
  if (Object.keys(data.info).length > 0) {
    const entries = Object.entries(data.info);
    // 3열 배치
    const groups = [
      { title: '기간 설정', items: entries.filter(([k]) => ['플랜 시작', '희망 은퇴', '총 투자기간', '구성'].includes(k)) },
      { title: '투자 계획', items: entries.filter(([k]) => ['연적립금액(평균)', '총거치금액', '총투자금액'].includes(k)) },
      { title: '목표', items: entries.filter(([k]) => !['플랜 시작', '희망 은퇴', '총 투자기간', '구성', '연적립금액(평균)', '총거치금액', '총투자금액'].includes(k)) },
    ];

    const colW = (CW - 4) / 3;
    for (let g = 0; g < groups.length; g++) {
      const gr = groups[g];
      if (gr.items.length === 0) continue;
      const x = M + g * (colW + 2);
      autoTable(pdf, {
        startY: y,
        margin: { top: BY + 2, left: x, right: PW - x - colW },
        tableWidth: colW,
        styles: { font: 'NG', fontSize: 6, cellPadding: 1.5 },
        headStyles: { fillColor: [30, 58, 95], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 6.5 },
        head: [[gr.title, '']],
        body: gr.items.map(([k, v]) => [k, v || '-']),
        columnStyles: { 0: { cellWidth: colW * 0.45, fontStyle: 'bold' }, 1: { halign: 'right' } },
      });
    }
    y = (pdf as any).lastAutoTable.finalY + 5; // eslint-disable-line @typescript-eslint/no-explicit-any
  }

  // 연도별 예상 평가금액 테이블
  y = secTitle(pdf, '2. 연도별 예상 평가금액', y);

  if (data.simRows.length > 0) {
    const retAge = data.retirementAge;
    autoTable(pdf, {
      startY: y,
      margin: { top: BY + 2, left: M, right: M },
      tableWidth: CW,
      styles: { font: 'NG', fontSize: 5, cellPadding: 0.8, overflow: 'linebreak', halign: 'right', minCellWidth: 8 },
      headStyles: { fillColor: [30, 58, 95], textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center', fontSize: 4.5, cellPadding: 1.2 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: {
        0: { halign: 'center', cellWidth: 10 },
        1: { halign: 'center', cellWidth: 7 },
        2: { halign: 'center', cellWidth: 8 },
        3: { halign: 'center', cellWidth: 10 },
      },
      head: [['연도', '연차', '나이', '구분', '월적립(만)', '거치금(만)', '누적원금', '운용수익', '연금인출', '누적인출', '총평가']],
      body: data.simRows.map(r => [
        r.calYear, r.year, `${r.age}세`, r.phase,
        r.monthlyPayment > 0 ? fmt(Math.round(r.monthlyPayment / 1e4)) : '-',
        r.additional > 0 ? fmt(Math.round(r.additional / 1e4)) : '-',
        fmt(Math.round(r.cumulativePrincipal / 1e4)),
        fmt(Math.round(r.investmentReturn / 1e4)),
        r.pension > 0 ? fmt(Math.round(r.pension / 1e4)) : '-',
        r.cumPension > 0 ? fmt(Math.round(r.cumPension / 1e4)) : '-',
        fmt(Math.round(r.evaluation / 1e4)),
      ]),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      didParseCell: (d: any) => {
        if (d.section !== 'body') return;
        const row = data.simRows[d.row.index];
        if (!row) return;
        if (row.age === retAge) {
          d.cell.styles.fillColor = [30, 58, 95];
          d.cell.styles.textColor = [255, 255, 255];
          d.cell.styles.fontStyle = 'bold';
        } else if (row.age === 100) {
          d.cell.styles.fillColor = [180, 130, 30];
          d.cell.styles.textColor = [255, 255, 255];
          d.cell.styles.fontStyle = 'bold';
        }
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      didDrawCell: (d: any) => { if (d.section === 'body') { pdf.setDrawColor(210, 210, 210); pdf.setLineDashPattern([0.5, 0.5], 0); pdf.line(d.cell.x, d.cell.y + d.cell.height, d.cell.x + d.cell.width, d.cell.y + d.cell.height); pdf.setLineDashPattern([], 0); } },
      didDrawPage: () => { drawHeader(pdf, c); },
      willDrawPage: (d: any) => { if (d.pageNumber > 1) pn++; }, // eslint-disable-line @typescript-eslint/no-explicit-any
    });

    setFont(pdf);
    pdf.setFontSize(5); pdf.setTextColor(156, 163, 175);
    const tblEndY = (pdf as any).lastAutoTable.finalY; // eslint-disable-line @typescript-eslint/no-explicit-any
    pdf.text('(단위: 만원)', PW - M, tblEndY + 3, { align: 'right' });
    drawFooter(pdf, pn);
  }

  // ==================== 성장 그래프 ====================
  const chartEl = document.getElementById(data.chartId);
  if (chartEl) {
    const imgData = await captureChart(chartEl);
    if (imgData) {
      newPage();
      y = secTitle(pdf, '3. 성장 그래프', BY);
      const img = new Image();
      await new Promise<void>(resolve => { img.onload = () => resolve(); img.src = imgData; });
      const imgW = CW - 4;
      const imgH = Math.min((img.height * imgW) / img.width, PH - M * 2 - HDR - FTR - 15);
      pdf.addImage(imgData, 'JPEG', M + 2, y, imgW, imgH);
      drawFooter(pdf, pn);
    }
  }

  // 총 페이지 수 업데이트
  _tp = pn;
  for (let i = 1; i <= pn; i++) { pdf.setPage(i); drawFooter(pdf, i); }

  pdf.save(filename);
}
