'use client';

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import html2canvas from 'html2canvas';

/* ================================================================
   연금수령 계획 PDF — jspdf-autotable 기반
   Page 1: 연금전환 옵션 비교 + 종신형 옵션
   Page 2: 확정형 + 무한지급형 옵션 + 목표달성 플랜
   ================================================================ */

const PW = 210, PH = 297, M = 12;
const CW = PW - M * 2;
const HDR = 14, FTR = 8;
const BY = M + HDR;

/* ---- Base64 ---- */
function ab2b64(buf: ArrayBuffer): string {
  const u8 = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s);
}

/* ---- 한글 폰트 ---- */
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

/* ---- 헤더/푸터 ---- */
interface Customer { name: string; birthDate: string; targetFund: string; retireAge: string; }
let _tp = 0;

function drawHeader(pdf: jsPDF, c: Customer) {
  setFont(pdf, 'bold');
  pdf.setFontSize(14); pdf.setTextColor(30, 58, 95);
  pdf.text('Wrap 은퇴설계', M, M + 6);
  setFont(pdf);
  pdf.setFontSize(7); pdf.setTextColor(107, 114, 128);
  pdf.text('연금수령 계획 보고서', M, M + 10);
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

function subTitle(pdf: jsPDF, title: string, y: number): number {
  setFont(pdf, 'bold');
  pdf.setFontSize(8); pdf.setTextColor(55, 65, 81);
  pdf.text(title, M, y + 3);
  return y + 6;
}

/* ---- 숫자 포맷 ---- */
function fmt(v: number): string { return Math.round(v).toLocaleString('ko-KR'); }
function fmtW(v: number): string {
  if (Math.abs(v) >= 1e8) return `${(v / 1e8).toFixed(1)}억원`;
  if (Math.abs(v) >= 1e4) return `${fmt(Math.round(v / 1e4))}만원`;
  return `${fmt(Math.round(v))}원`;
}
function fmtPct(v: number): string { return `${v.toFixed(1)}%`; }

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
   데이터 인터페이스
   ================================================================ */
export interface ComparisonRow {
  type: string; customer: string; rate: string; period: string; monthly: string; inheritance: string;
}

export interface OptionCardData {
  label: string; value: string;
}

export interface MilestoneData {
  title: string; items: { label: string; value: string }[];
}

export interface GoalRow {
  lumpSum: string; annualSavings: string; pensionRate: string; monthlyPension: string; inheritance100: string; inheritancePositive: boolean;
}

export interface PensionPdfData {
  customer: Customer;
  // 연금전환 옵션 비교
  pensionFundA: string; pensionFundB: string;
  retireAge: number;
  comparisonRows: ComparisonRow[];
  // 종신형
  lifetimeCards: OptionCardData[];
  lifetimeMilestones: MilestoneData[];
  // 확정형
  fixedCards: OptionCardData[];
  // 무한지급형
  infiniteCards: OptionCardData[];
  // 차트 이미지 (사전 캡처)
  chartImages: { lifetime?: string; fixed?: string; infinite?: string };
  // 목표달성 플랜
  goalInfo: OptionCardData[];
  goalRows: GoalRow[];
}

/* ================================================================
   메인: PDF 생성
   ================================================================ */
export async function generatePensionPlanPdf(data: PensionPdfData, filename: string) {
  const pdf = new jsPDF('p', 'mm', 'a4');
  await loadFont(pdf);
  const c = data.customer;
  let pn = 0;

  function newPage() { if (pn > 0) pdf.addPage(); pn++; drawHeader(pdf, c); }

  // ==================== Page 1: 연금전환 옵션 비교 + 종신형 ====================
  newPage();
  let y = secTitle(pdf, '1. 연금전환 옵션 비교', BY);

  // 연금재원 표시
  setFont(pdf);
  pdf.setFontSize(7); pdf.setTextColor(55, 65, 81);
  pdf.text(`연금재원 — A: ${data.pensionFundA}, B: ${data.pensionFundB} · 은퇴나이: ${data.retireAge}세`, M, y + 2);
  y += 5;

  // 비교 테이블
  autoTable(pdf, {
    startY: y,
    margin: { top: BY + 2, left: M, right: M },
    tableWidth: CW,
    styles: { font: 'NG', fontSize: 6, cellPadding: 1.5, halign: 'center' },
    headStyles: { fillColor: [30, 58, 95], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 5.5 },
    head: [['구분', '고객', '예상수익률', '연금수령기간', '월 연금액', '상속재원']],
    body: data.comparisonRows.map(r => [r.type, r.customer, r.rate, r.period, r.monthly, r.inheritance]),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    didDrawCell: (d: any) => { if (d.section === 'body') { pdf.setDrawColor(210, 210, 210); pdf.setLineDashPattern([0.5, 0.5], 0); pdf.line(d.cell.x, d.cell.y + d.cell.height, d.cell.x + d.cell.width, d.cell.y + d.cell.height); pdf.setLineDashPattern([], 0); } },
  });
  y = (pdf as any).lastAutoTable.finalY + 3; // eslint-disable-line @typescript-eslint/no-explicit-any

  // 안내문구
  setFont(pdf);
  pdf.setFontSize(5); pdf.setTextColor(156, 163, 175);
  pdf.text('※ 본 표는 고객의 이해를 돕기 위한 참고용 시뮬레이션이며, 실제 연금전환 조건 및 수령액은 보험사별로 상이할 수 있습니다.', M, y + 2);
  y += 7;

  // --- 목표달성 플랜 (Page 1 하단에 이어서) ---
  y += 2;
  y = subTitle(pdf, '목표달성 플랜', y);

  if (data.goalInfo.length > 0) {
    autoTable(pdf, {
      startY: y,
      margin: { top: BY + 2, left: M, right: M },
      tableWidth: CW,
      styles: { font: 'NG', fontSize: 7, cellPadding: 2, halign: 'center' },
      headStyles: { fillColor: [30, 58, 95], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 6.5 },
      head: [data.goalInfo.map(c => c.label)],
      body: [data.goalInfo.map(c => c.value)],
    });
    y = (pdf as any).lastAutoTable.finalY + 3; // eslint-disable-line @typescript-eslint/no-explicit-any
  }

  if (data.goalRows.length > 0) {
    autoTable(pdf, {
      startY: y,
      margin: { top: BY + 2, left: M, right: M },
      tableWidth: CW,
      styles: { font: 'NG', fontSize: 6.5, cellPadding: 2, halign: 'center' },
      headStyles: { fillColor: [30, 58, 95], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 6 },
      head: [['거치금액', '적립금액(연)', '은퇴연금 수익률', '은퇴연금액', '100세 상속금액']],
      body: data.goalRows.map(r => [r.lumpSum, r.annualSavings, r.pensionRate, r.monthlyPension, r.inheritance100]),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      didParseCell: (d: any) => {
        // 거치금액, 적립금액(연) 헤더: 초록색 배경
        if (d.section === 'head' && (d.column.index === 0 || d.column.index === 1)) {
          d.cell.styles.fillColor = [22, 101, 52];
        }
        if (d.section === 'body' && d.column.index === 4) {
          const row = data.goalRows[d.row.index];
          if (row && !row.inheritancePositive) d.cell.styles.textColor = [220, 38, 38];
          else if (row) d.cell.styles.textColor = [22, 163, 74];
        }
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      didDrawCell: (d: any) => { if (d.section === 'body') { pdf.setDrawColor(210, 210, 210); pdf.setLineDashPattern([0.5, 0.5], 0); pdf.line(d.cell.x, d.cell.y + d.cell.height, d.cell.x + d.cell.width, d.cell.y + d.cell.height); pdf.setLineDashPattern([], 0); } },
    });
    y = (pdf as any).lastAutoTable.finalY + 3; // eslint-disable-line @typescript-eslint/no-explicit-any
  }

  setFont(pdf);
  pdf.setFontSize(5); pdf.setTextColor(156, 163, 175);
  pdf.text('* 은퇴연금액은 무한지급형(이자수령) 기준입니다. 100세 상속금액이 음수면 100세 전 자금 소진됩니다.', M, y + 2);
  drawFooter(pdf, pn);

  // ==================== Page 2: 종신형 옵션 ====================
  newPage();
  y = secTitle(pdf, '2. 종신형 옵션', BY);

  if (data.lifetimeCards.length > 0) {
    autoTable(pdf, {
      startY: y, margin: { top: BY + 2, left: M, right: M }, tableWidth: CW,
      styles: { font: 'NG', fontSize: 6.5, cellPadding: 2, halign: 'center' },
      headStyles: { fillColor: [30, 58, 95], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 6 },
      head: [data.lifetimeCards.map(c => c.label)],
      body: [data.lifetimeCards.map(c => c.value)],
    });
    y = (pdf as any).lastAutoTable.finalY + 3; // eslint-disable-line @typescript-eslint/no-explicit-any
  }

  // 종신형 그래프 (milestones보다 위에)
  if (data.chartImages.lifetime) {
    const img = new Image();
    await new Promise<void>(resolve => { img.onload = () => resolve(); img.src = data.chartImages.lifetime!; });
    const imgW = CW - 4;
    const remaining = PH - M - FTR - y;
    const imgH = Math.min((img.height * imgW) / img.width, remaining - 40);
    if (imgH > 30) {
      pdf.addImage(data.chartImages.lifetime!, 'JPEG', M + 2, y, imgW, imgH);
      y += imgH + 4;
    }
  }

  // 수령 현황 비교 (그래프 아래)
  if (data.lifetimeMilestones.length > 0) {
    y = subTitle(pdf, '수령 현황 비교', y);
    const msHead = ['항목', ...data.lifetimeMilestones.map(m => m.title)];
    const msLabels = data.lifetimeMilestones[0]?.items.map(it => it.label) ?? [];
    const msBody = msLabels.map((lbl, i) => [lbl, ...data.lifetimeMilestones.map(m => m.items[i]?.value ?? '-')]);
    autoTable(pdf, {
      startY: y, margin: { top: BY + 2, left: M, right: M }, tableWidth: CW,
      styles: { font: 'NG', fontSize: 6, cellPadding: 1.5, halign: 'center' },
      headStyles: { fillColor: [30, 58, 95], textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center', fontSize: 5.5 },
      columnStyles: { 0: { halign: 'center', fontStyle: 'bold' } },
      head: [msHead], body: msBody,
    });
  }
  drawFooter(pdf, pn);

  // ==================== Page 3: 확정형 + 무한지급형 ====================
  newPage();
  y = secTitle(pdf, '3. 확정형 옵션', BY);

  if (data.fixedCards.length > 0) {
    autoTable(pdf, {
      startY: y, margin: { top: BY + 2, left: M, right: M }, tableWidth: CW,
      styles: { font: 'NG', fontSize: 6.5, cellPadding: 2, halign: 'center' },
      headStyles: { fillColor: [59, 130, 246], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 6 },
      head: [data.fixedCards.map(c => c.label)],
      body: [data.fixedCards.map(c => c.value)],
    });
    y = (pdf as any).lastAutoTable.finalY + 3; // eslint-disable-line @typescript-eslint/no-explicit-any
  }

  // 확정형 그래프
  if (data.chartImages.fixed) {
    const img = new Image();
    await new Promise<void>(resolve => { img.onload = () => resolve(); img.src = data.chartImages.fixed!; });
    const imgW = CW - 4;
    const imgH = Math.min((img.height * imgW) / img.width, 70);
    pdf.addImage(data.chartImages.fixed!, 'JPEG', M + 2, y, imgW, imgH);
    y += imgH + 8;
  }

  y = secTitle(pdf, '4. 무한지급형 옵션', y);

  if (data.infiniteCards.length > 0) {
    autoTable(pdf, {
      startY: y, margin: { top: BY + 2, left: M, right: M }, tableWidth: CW,
      styles: { font: 'NG', fontSize: 6.5, cellPadding: 2, halign: 'center' },
      headStyles: { fillColor: [22, 163, 74], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 6 },
      head: [data.infiniteCards.map(c => c.label)],
      body: [data.infiniteCards.map(c => c.value)],
    });
    y = (pdf as any).lastAutoTable.finalY + 3; // eslint-disable-line @typescript-eslint/no-explicit-any
  }

  // 무한지급형 그래프
  if (data.chartImages.infinite) {
    const img = new Image();
    await new Promise<void>(resolve => { img.onload = () => resolve(); img.src = data.chartImages.infinite!; });
    const imgW = CW - 4;
    const remaining = PH - M - FTR - y;
    const imgH = Math.min((img.height * imgW) / img.width, remaining - 5, 70);
    if (imgH > 20) { pdf.addImage(data.chartImages.infinite!, 'JPEG', M + 2, y, imgW, imgH); }
  }
  drawFooter(pdf, pn);

  // 총 페이지 수 업데이트
  _tp = pn;
  for (let i = 1; i <= pn; i++) { pdf.setPage(i); drawFooter(pdf, i); }

  pdf.save(filename);
}
