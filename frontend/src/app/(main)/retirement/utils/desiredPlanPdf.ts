'use client';

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import html2canvas from 'html2canvas';

/* ================================================================
   은퇴플랜 설계 PDF — jspdf-autotable 기반
   Page 1: 목표 은퇴자금 + 투자조건 + 목표 은퇴플랜
   Page 2: 시뮬레이션 그래프
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
  pdf.text('은퇴플랜 관리', M, M + 6);
  setFont(pdf);
  pdf.setFontSize(7); pdf.setTextColor(107, 114, 128);
  pdf.text('은퇴플랜 설계 보고서', M, M + 10);
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

/* ---- 데이터 인터페이스 ---- */
export interface CardItem { label: string; value: string; highlight?: boolean; }

export interface SimRow {
  calYear: number; year: number; age: number; phase: string;
  monthlyPayment: number; additional: number;
  cumulativePrincipal: number; investmentReturn: number;
  pension: number; cumPension: number; evaluation: number;
}

/** 플랜분석 비교 행 (화면 테이블과 동일 구성) */
export interface AnalysisRow {
  group: string;   // 플랜 / 투자 / 연금 / 상속
  label: string;
  cur: string;
  rec: string;
  diff?: string;
}

export interface DesiredPlanPdfData {
  customer: Customer;
  targetFundCards: CardItem[];   // 현재플랜 입력 (8개 카드)
  targetFundResults?: CardItem[];// 현재플랜 결과 (은퇴금액·월 연금액) — 크게 강조
  investCards: CardItem[];       // 추천플랜 입력 (8개 카드)
  investResults?: CardItem[];    // 추천플랜 결과 (은퇴금액·월 연금액) — 크게 강조
  goalPlanCards: CardItem[];     // (하위 호환, 미사용)
  analysisRows?: AnalysisRow[];  // 플랜분석 비교 테이블
  hasCur?: boolean;
  hasRec?: boolean;
  simRows: SimRow[];             // 시뮬레이션 테이블
  retirementAge: number;
  graphId: string;               // 시뮬레이션 그래프 DOM id
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
// 카드 2행 렌더링 헬퍼
function renderCards(pdf: jsPDF, cards: CardItem[], y: number, headColor: [number, number, number], hlBg: [number, number, number], hlText: [number, number, number]): number {
  const row1 = cards.slice(0, 4);
  const row2 = cards.slice(4, 8);
  const colW = CW / 4; // 4등분 균등

  autoTable(pdf, {
    startY: y,
    margin: { top: BY + 2, left: M, right: M },
    tableWidth: CW,
    styles: { font: 'NG', fontSize: 8, cellPadding: 2, halign: 'center' },
    headStyles: { fillColor: headColor, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.5 },
    columnStyles: { 0: { cellWidth: colW }, 1: { cellWidth: colW }, 2: { cellWidth: colW }, 3: { cellWidth: colW } },
    head: [row1.map(c => c.label)],
    body: [row1.map(c => c.value)],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    didParseCell: (d: any) => {
      if (d.section === 'body') {
        const card = row1[d.column.index];
        if (card?.highlight) { d.cell.styles.fillColor = hlBg; d.cell.styles.fontStyle = 'bold'; d.cell.styles.textColor = hlText; }
      }
    },
  });
  y = (pdf as any).lastAutoTable.finalY + 1; // eslint-disable-line @typescript-eslint/no-explicit-any

  if (row2.length > 0) {
    // 2행 헤더: 진한 회색 (1행과 구분)
    autoTable(pdf, {
      startY: y,
      margin: { top: BY + 2, left: M, right: M },
      tableWidth: CW,
      styles: { font: 'NG', fontSize: 8, cellPadding: 2, halign: 'center' },
      headStyles: { fillColor: [75, 85, 99], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.5 },
      columnStyles: { 0: { cellWidth: colW }, 1: { cellWidth: colW }, 2: { cellWidth: colW }, 3: { cellWidth: colW } },
      head: [row2.map(c => c.label)],
      body: [row2.map(c => c.value)],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      didParseCell: (d: any) => {
        if (d.section === 'body') {
          const card = row2[d.column.index];
          if (card?.highlight) { d.cell.styles.fillColor = hlBg; d.cell.styles.fontStyle = 'bold'; d.cell.styles.textColor = hlText; }
        }
      },
    });
    y = (pdf as any).lastAutoTable.finalY; // eslint-disable-line @typescript-eslint/no-explicit-any
  }
  return y;
}

/** 결과 카드(은퇴금액·월 연금액) — 테두리 없이 배경색으로만 강조, 값은 섹션 제목과 같은 크기(10pt) */
function renderResultCards(pdf: jsPDF, cards: CardItem[], y: number): number {
  if (!cards.length) return y;
  const h = 12;
  const colW = CW / cards.length;
  cards.forEach((card, i) => {
    const x = M + colW * i;
    pdf.setFillColor(236, 253, 245);                    // 연한 초록 배경만
    pdf.roundedRect(x + 1, y, colW - 2, h, 1.4, 1.4, 'F');
    setFont(pdf);
    pdf.setFontSize(7); pdf.setTextColor(71, 85, 105);
    pdf.text(card.label, x + colW / 2, y + 4.6, { align: 'center' });
    setFont(pdf, 'bold');
    pdf.setFontSize(10); pdf.setTextColor(5, 122, 85);   // 섹션 제목과 동일 크기
    pdf.text(card.value, x + colW / 2, y + 9.6, { align: 'center' });
  });
  setFont(pdf);
  return y + h;
}

export async function generateDesiredPlanPdf(data: DesiredPlanPdfData, filename: string) {
  const pdf = new jsPDF('p', 'mm', 'a4');
  await loadFont(pdf);
  const c = data.customer;
  let pn = 0;

  function newPage() { if (pn > 0) pdf.addPage(); pn++; drawHeader(pdf, c); }

  // ==================== Page 1: 현재플랜 + 추천플랜 + 그래프 ====================
  newPage();
  let y = secTitle(pdf, '1. 현재플랜', BY);

  if (data.targetFundCards.length > 0) {
    y = renderCards(pdf, data.targetFundCards, y, [30, 58, 95], [236, 253, 245], [22, 101, 52]);
    y += 2.5;
  }
  if (data.targetFundResults?.length) {
    y = renderResultCards(pdf, data.targetFundResults, y);
  }
  y += 5;

  y = secTitle(pdf, '2. 추천플랜', y);

  if (data.investCards.length > 0) {
    y = renderCards(pdf, data.investCards, y, [30, 58, 95], [255, 237, 213], [180, 83, 9]);
    y += 2.5;
  }
  if (data.investResults?.length) {
    y = renderResultCards(pdf, data.investResults, y);
  }
  y += 5;

  // 시뮬레이션 그래프 (Page 1 하단)
  const chartEl = document.getElementById(data.graphId);
  if (chartEl) {
    y = secTitle(pdf, '3. 시뮬레이션 그래프', y);
    const imgData = await captureChart(chartEl);
    if (imgData) {
      const img = new Image();
      await new Promise<void>(resolve => { img.onload = () => resolve(); img.src = imgData; });
      const imgW = CW - 4;
      const remaining = PH - M - FTR - y;
      const imgH = Math.min((img.height * imgW) / img.width, remaining - 3);
      if (imgH > 30) {
        pdf.addImage(imgData, 'JPEG', M + 2, y, imgW, imgH);
      }
    }
  }
  drawFooter(pdf, pn);

  // ==================== Page 2: 플랜분석 ====================
  newPage();
  y = secTitle(pdf, '4. 플랜분석', BY);

  const aRows = data.analysisRows ?? [];
  if (aRows.length > 0) {
    const showCur = data.hasCur !== false;
    const showRec = data.hasRec !== false;
    const showDiff = showCur && showRec;
    // 항목 / 현재플랜 / 추천플랜 / 차이
    const head: string[] = ['항목'];
    if (showCur) head.push('현재플랜');
    if (showRec) head.push('추천플랜');
    if (showDiff) head.push('차이 (추천-현재)');

    // 분류(플랜·투자·연금·상속)가 바뀌면 그룹 헤더 행 삽입
    const body: string[][] = [];
    const groupRowIdx = new Set<number>();
    let prevGroup = '';
    for (const r of aRows) {
      if (r.group !== prevGroup) {
        groupRowIdx.add(body.length);
        body.push([r.group, ...Array(head.length - 1).fill('')]);
        prevGroup = r.group;
      }
      const line: string[] = [r.label];
      if (showCur) line.push(r.cur);
      if (showRec) line.push(r.rec);
      if (showDiff) line.push(r.diff ?? '-');
      body.push(line);
    }

    autoTable(pdf, {
      startY: y,
      margin: { top: BY + 2, left: M, right: M },
      tableWidth: CW,
      styles: { font: 'NG', fontSize: 8, cellPadding: 2, halign: 'right', overflow: 'linebreak' },
      headStyles: { fillColor: [30, 58, 95], textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center', fontSize: 7.5 },
      columnStyles: { 0: { halign: 'left', cellWidth: CW * 0.34 } },
      head: [head],
      body,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      didParseCell: (d: any) => {
        if (d.section !== 'body') return;
        if (groupRowIdx.has(d.row.index)) {
          // 분류 헤더 행
          d.cell.styles.fillColor = [226, 232, 240];
          d.cell.styles.textColor = [30, 58, 95];
          d.cell.styles.fontStyle = 'bold';
          d.cell.styles.halign = 'left';
          d.cell.styles.fontSize = 7.5;
        } else if (d.column.index === 0) {
          d.cell.styles.textColor = [55, 65, 81];
        }
      },
      didDrawPage: () => { drawHeader(pdf, c); },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      willDrawPage: (d: any) => { if (d.pageNumber > 1) pn++; },
    });
    y = (pdf as any).lastAutoTable.finalY; // eslint-disable-line @typescript-eslint/no-explicit-any
  }
  drawFooter(pdf, pn);

  // ==================== Page 3~: 은퇴플랜 시뮬레이션 (2페이지에 맞춰 행높이 자동 조절) ====================
  if (data.simRows.length > 0) {
    newPage();
    y = secTitle(pdf, '5. 은퇴플랜 시뮬레이션', BY);
    const retAge = data.retirementAge;

    // 2페이지 안에 담기도록 행 높이·글자 크기를 역산
    const bottom = PH - M - FTR;
    const page1Avail = bottom - y - 4;          // 제목이 있는 첫 장
    const pageNAvail = bottom - (BY + 2) - 4;   // 이후 장
    const headH = 6;                            // 헤더 행 추정 높이
    const capacity = (page1Avail - headH) + (pageNAvail - headH);   // 2페이지 총 용량
    const n = data.simRows.length;
    const rowH = Math.max(2.4, Math.min(5.0, capacity / Math.max(1, n)));
    const fs = rowH >= 4.4 ? 7 : rowH >= 3.8 ? 6.2 : rowH >= 3.2 ? 5.4 : 4.6;
    const pad = Math.max(0.25, (rowH - fs * 0.36) / 2);

    autoTable(pdf, {
      startY: y,
      margin: { top: BY + 2, left: M, right: M },
      tableWidth: CW,
      styles: { font: 'NG', fontSize: fs, cellPadding: pad, minCellHeight: rowH, valign: 'middle', overflow: 'linebreak', halign: 'right' },
      headStyles: { fillColor: [30, 58, 95], textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center', fontSize: Math.max(4.6, fs - 0.5), cellPadding: Math.max(0.4, pad) },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: {
        0: { halign: 'center' },
        1: { halign: 'center' },
        2: { halign: 'center' },
        3: { halign: 'center' },
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
          d.cell.styles.fillColor = [30, 58, 95]; d.cell.styles.textColor = [255, 255, 255]; d.cell.styles.fontStyle = 'bold';
        } else if (row.age === 100) {
          d.cell.styles.fillColor = [180, 130, 30]; d.cell.styles.textColor = [255, 255, 255]; d.cell.styles.fontStyle = 'bold';
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

  // 실제 생성된 페이지 수 기준으로 푸터(쪽번호) 재기록
  const total = pdf.getNumberOfPages();
  _tp = total;
  for (let i = 1; i <= total; i++) { pdf.setPage(i); drawFooter(pdf, i); }

  pdf.save(filename);
}
