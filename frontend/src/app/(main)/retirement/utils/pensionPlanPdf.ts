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
  pdf.text('은퇴플랜 관리', M, M + 6);
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

/** 연금수령 그래프 데이터 (원 단위) — PDF에서 직접 벡터로 그린다 */
export interface PdfChartPoint { age: number; balance: number; pension: number }

export interface PensionPdfData {
  customer: Customer;
  // 연금전환 옵션 비교
  pensionFundA: string; pensionFundB: string;
  retireAge: number;              // 차트 기준 은퇴나이
  retireAgeA?: number;            // A고객 은퇴나이
  retireAgeB?: number;            // B고객 은퇴나이
  comparisonRows: ComparisonRow[];
  // 종신형
  lifetimeCards: OptionCardData[];
  lifetimeMilestones: MilestoneData[];
  lifetimeChart?: PdfChartPoint[];
  lifetimeNote?: string;
  // 확정형
  fixedCards: OptionCardData[];
  fixedChart?: PdfChartPoint[];
  fixedNote?: string;
  fixedEndAge?: number;
  // 무한지급형
  infiniteCards: OptionCardData[];
  infiniteChart?: PdfChartPoint[];
  infiniteNote?: string;
  // (구) 차트 이미지 — 미사용
  chartImages?: { lifetime?: string; fixed?: string; infinite?: string };
  // 목표달성 플랜
  goalInfo: OptionCardData[];
  goalRows: GoalRow[];
}

/* ---- PDF 내장 차트 렌더러 ---- */
function axisLabel(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e8) return `${(v / 1e8).toFixed(a >= 1e9 ? 0 : 1)}억`;
  if (a >= 1e4) return `${Math.round(v / 1e4).toLocaleString('ko-KR')}만`;
  return String(Math.round(v));
}
/** 눈금이 깔끔하게 떨어지도록 최대값 올림 */
function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const exp = Math.floor(Math.log10(v));
  const base = Math.pow(10, exp);
  const n = v / base;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * base;
}

/** 차트 종류 — 화면(PensionOptionChart)과 동일하게 재현 */
export type PdfChartKind = 'composition' | 'balance' | 'bar';

/**
 * 연금수령 그래프를 PDF에 직접 그린다 (이미지 캡처 없음).
 *  - composition: 스택 막대 (아래=이자 수령분, 위=원금 수령분) — 종신형
 *  - bar        : 막대 (연간 연금액) — 확정형
 *  - balance    : 영역(잔액) + 선(연금) — 무한지급형
 */
function drawPensionChart(
  pdf: jsPDF,
  kind: PdfChartKind,
  points: PdfChartPoint[],
  x: number, y: number, w: number, h: number,
  legend: { a: { label: string; color: [number, number, number] }; b?: { label: string; color: [number, number, number]; line?: boolean } },
  markerAge?: number,
  markerLabel?: string,
) {
  if (!points.length) return y + h;
  const padL = 16, padR = 4, padT = 5, padB = 9;
  const px = x + padL, py = y + padT;
  const pw = w - padL - padR, ph = h - padT - padB - 4;   // 하단 범례 자리 4mm
  const n = points.length;

  const maxV = niceCeil(
    kind === 'composition'
      ? Math.max(...points.map(p => p.pension + p.balance), 1)
      // bar(확정형)는 연금액만 그리므로 잔액을 스케일에 포함하지 않는다
      // (포함하면 막대가 바닥에 깔려 보이지 않음)
      : kind === 'bar'
      ? Math.max(...points.map(p => p.pension), 1)
      : Math.max(...points.map(p => Math.max(p.balance, p.pension)), 1)
  );
  const yOf = (v: number) => py + ph - (Math.max(0, v) / maxV) * ph;
  const slot = pw / n;

  // 가로 그리드 + Y축 라벨
  setFont(pdf);
  pdf.setFontSize(5.5);
  for (let i = 0; i <= 4; i++) {
    const gy = py + ph - (ph * i) / 4;
    pdf.setDrawColor(228, 231, 235); pdf.setLineWidth(0.15);
    pdf.line(px, gy, px + pw, gy);
    pdf.setTextColor(130, 138, 148);
    pdf.text(axisLabel((maxV * i) / 4), px - 1.5, gy + 1.4, { align: 'right' });
  }

  if (kind === 'composition') {
    // 스택 막대: 이자(pension) 아래 + 원금(balance) 위 → 합계는 연간 연금액으로 일정
    const bw = Math.max(0.5, Math.min(3.2, slot * 0.62));
    points.forEach((p, i) => {
      const cx = px + slot * (i + 0.5) - bw / 2;
      const hInt = (p.pension / maxV) * ph;
      const hPri = (p.balance / maxV) * ph;
      pdf.setFillColor(legend.a.color[0], legend.a.color[1], legend.a.color[2]);
      if (hInt > 0) pdf.rect(cx, py + ph - hInt, bw, hInt, 'F');
      if (hPri > 0 && legend.b) {
        pdf.setFillColor(legend.b.color[0], legend.b.color[1], legend.b.color[2]);
        pdf.rect(cx, py + ph - hInt - hPri, bw, hPri, 'F');
      }
    });
  } else if (kind === 'bar') {
    const bw = Math.max(0.6, Math.min(4, slot * 0.6));
    pdf.setFillColor(legend.a.color[0], legend.a.color[1], legend.a.color[2]);
    points.forEach((p, i) => {
      if (p.pension <= 0) return;
      const bh = (p.pension / maxV) * ph;
      pdf.rect(px + slot * (i + 0.5) - bw / 2, py + ph - bh, bw, bh, 'F');
    });
  } else {
    // balance: 잔액 영역(면) + 테두리 선, 그 위에 연금 선
    const col = legend.a.color;
    pdf.setFillColor(col[0], col[1], col[2]);
    pdf.saveGraphicsState();
    // @ts-expect-error jsPDF GState 타입 정의 누락
    pdf.setGState(new pdf.GState({ opacity: 0.18 }));
    points.forEach((p, i) => {
      if (i === 0) return;
      const x1 = px + slot * (i - 0.5), x2 = px + slot * (i + 0.5);
      const y1 = yOf(points[i - 1].balance), y2 = yOf(p.balance);
      const base = py + ph;
      pdf.triangle(x1, y1, x2, y2, x1, base, 'F');
      pdf.triangle(x2, y2, x2, base, x1, base, 'F');
    });
    pdf.restoreGraphicsState();
    pdf.setDrawColor(col[0], col[1], col[2]); pdf.setLineWidth(0.8);
    points.forEach((p, i) => {
      if (i === 0) return;
      pdf.line(px + slot * (i - 0.5), yOf(points[i - 1].balance), px + slot * (i + 0.5), yOf(p.balance));
    });
    if (legend.b) {
      const lc = legend.b.color;
      pdf.setDrawColor(lc[0], lc[1], lc[2]); pdf.setLineWidth(0.7);
      points.forEach((p, i) => {
        if (i === 0) return;
        pdf.line(px + slot * (i - 0.5), yOf(points[i - 1].pension), px + slot * (i + 0.5), yOf(p.pension));
      });
    }
  }

  // 축선 + X축 라벨
  pdf.setDrawColor(170, 178, 189); pdf.setLineWidth(0.25);
  pdf.line(px, py + ph, px + pw, py + ph);
  const step = Math.max(1, Math.round(n / 7));
  pdf.setFontSize(5.5); pdf.setTextColor(130, 138, 148);
  points.forEach((p, i) => {
    if (i % step === 0 || i === n - 1) {
      pdf.text(`${p.age}세`, px + slot * (i + 0.5), py + ph + 3.8, { align: 'center' });
    }
  });

  // 기준선 (100세 / 수령종료 등)
  if (markerAge != null) {
    const mi = points.findIndex(p => p.age === markerAge);
    if (mi >= 0) {
      const lx = px + slot * (mi + 0.5);
      pdf.setDrawColor(160, 168, 178); pdf.setLineWidth(0.25);
      pdf.setLineDashPattern([1, 1], 0);
      pdf.line(lx, py, lx, py + ph);
      pdf.setLineDashPattern([], 0);
      pdf.setFontSize(5); pdf.setTextColor(120, 128, 138);
      pdf.text(markerLabel ?? `${markerAge}세`, lx, py - 0.8, { align: 'center' });
    }
  }

  // 범례 (그래프 하단 중앙)
  const lgY = y + h - 1;
  const items = [legend.a, ...(legend.b ? [legend.b] : [])];
  pdf.setFontSize(5.5);
  const widths = items.map(it => pdf.getTextWidth(it.label) + 7);
  let lx = x + (w - widths.reduce((s, v) => s + v, 0)) / 2;
  items.forEach((it, i) => {
    const c2 = it.color;
    if ('line' in it && it.line) {
      pdf.setDrawColor(c2[0], c2[1], c2[2]); pdf.setLineWidth(0.8);
      pdf.line(lx, lgY - 1, lx + 4, lgY - 1);
    } else {
      pdf.setFillColor(c2[0], c2[1], c2[2]);
      pdf.rect(lx, lgY - 2.2, 3.2, 2.4, 'F');
    }
    pdf.setTextColor(90, 98, 108);
    pdf.text(it.label, lx + 5, lgY);
    lx += widths[i];
  });

  return y + h;
}

/** 그래프 하단 첨언 (화면의 Note 박스와 동일 문구) */
function drawNote(pdf: jsPDF, text: string, y: number, color: [number, number, number], bg: [number, number, number]): number {
  setFont(pdf);
  pdf.setFontSize(7);
  const lines = pdf.splitTextToSize(text, CW - 8) as string[];
  const h = lines.length * 3.6 + 4;
  pdf.setFillColor(bg[0], bg[1], bg[2]);
  pdf.roundedRect(M, y, CW, h, 1.2, 1.2, 'F');
  pdf.setTextColor(color[0], color[1], color[2]);
  lines.forEach((ln, i) => pdf.text(ln, M + 4, y + 4.6 + i * 3.6));
  return y + h;
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
  pdf.setFontSize(8.5); pdf.setTextColor(55, 65, 81);
  {
    // 은퇴나이도 A/B가 다를 수 있으므로 각각 표기 (화면과 동일)
    const rA = data.retireAgeA ?? data.retireAge;
    const rB = data.retireAgeB ?? data.retireAge;
    pdf.text(
      `연금재원 — A: ${data.pensionFundA}, B: ${data.pensionFundB} · 은퇴나이 — A: ${rA}세, B: ${rB}세`,
      M, y + 2,
    );
  }
  y += 6;

  // 비교 테이블
  autoTable(pdf, {
    startY: y,
    margin: { top: BY + 2, left: M, right: M },
    tableWidth: CW,
    styles: { font: 'NG', fontSize: 8.5, cellPadding: 3, minCellHeight: 9, valign: 'middle', halign: 'center' },
    headStyles: { fillColor: [30, 58, 95], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8, cellPadding: 3 },
    head: [['구분', '고객', '예상수익률', '연금수령기간', '월 연금액', '상속재원']],
    // 화면과 동일하게 '구분'·'상속재원'은 A/B 두 행을 병합 (type이 빈 행 = 같은 그룹의 B고객)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    body: (() => {
      const rows = data.comparisonRows;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const out: any[][] = [];
      rows.forEach((r, i) => {
        if (r.type === '') {
          // 병합된 그룹의 두 번째 행 — 구분/상속재원 셀은 생략
          out.push([r.customer, r.rate, r.period, r.monthly]);
          return;
        }
        const span = rows[i + 1] && rows[i + 1].type === '' ? 2 : 1;
        out.push([
          { content: r.type, rowSpan: span, styles: { valign: 'middle', fontStyle: 'bold' } },
          r.customer, r.rate, r.period, r.monthly,
          { content: r.inheritance, rowSpan: span, styles: { valign: 'middle' } },
        ]);
      });
      return out;
    })(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    didDrawCell: (d: any) => { if (d.section === 'body') { pdf.setDrawColor(210, 210, 210); pdf.setLineDashPattern([0.5, 0.5], 0); pdf.line(d.cell.x, d.cell.y + d.cell.height, d.cell.x + d.cell.width, d.cell.y + d.cell.height); pdf.setLineDashPattern([], 0); } },
  });
  y = (pdf as any).lastAutoTable.finalY + 3; // eslint-disable-line @typescript-eslint/no-explicit-any

  // 안내문구
  setFont(pdf);
  pdf.setFontSize(5); pdf.setTextColor(156, 163, 175);
  pdf.text('※ 본 표는 고객의 이해를 돕기 위한 참고용 시뮬레이션이며, 실제 연금전환 조건 및 수령액은 보험사별로 상이할 수 있습니다.', M, y + 2);
  y += 7;

  drawFooter(pdf, pn);

  const bottomY = PH - M - FTR;

  // 옵션 요약 카드를 표로 렌더링
  function renderOptionCards(cards: OptionCardData[], top: number, head: [number, number, number]): number {
    if (!cards.length) return top;
    autoTable(pdf, {
      startY: top, margin: { top: BY + 2, left: M, right: M }, tableWidth: CW,
      styles: { font: 'NG', fontSize: 8, cellPadding: 2.5, minCellHeight: 8, valign: 'middle', halign: 'center' },
      headStyles: { fillColor: head, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.5, cellPadding: 2.5 },
      head: [cards.map(c => c.label)],
      body: [cards.map(c => c.value)],
    });
    return (pdf as any).lastAutoTable.finalY + 3; // eslint-disable-line @typescript-eslint/no-explicit-any
  }

  // ==================== Page 2: 종신형 ====================
  newPage();
  y = secTitle(pdf, '2. 종신형 옵션', BY);
  y = renderOptionCards(data.lifetimeCards, y, [30, 58, 95]);

  if (data.lifetimeChart?.length) {
    subTitle(pdf, '연금 수령 구성 (원금 vs 이자)', y - 4);
    y = drawPensionChart(pdf, 'composition', data.lifetimeChart, M, y + 2, CW, 62,
      { a: { label: '이자 수령분 (감소)', color: [245, 158, 11] }, b: { label: '원금 수령분 (증가)', color: [59, 130, 246] } },
      data.retireAge + 10, `${data.retireAge + 10}세`) + 3;
  }
  if (data.lifetimeNote) {
    y = drawNote(pdf, data.lifetimeNote, y, [180, 83, 9], [255, 247, 237]) + 4;
  }

  // 수령 현황 비교
  if (data.lifetimeMilestones.length > 0) {
    y = subTitle(pdf, '수령 현황 비교', y);
    const msHead = ['항목', ...data.lifetimeMilestones.map(m => m.title)];
    const msLabels = data.lifetimeMilestones[0]?.items.map(it => it.label) ?? [];
    const msBody = msLabels.map((lbl, i) => [lbl, ...data.lifetimeMilestones.map(m => m.items[i]?.value ?? '-')]);
    autoTable(pdf, {
      startY: y, margin: { top: BY + 2, left: M, right: M }, tableWidth: CW,
      styles: { font: 'NG', fontSize: 8, cellPadding: 2.5, minCellHeight: 8, valign: 'middle', halign: 'center' },
      headStyles: { fillColor: [30, 58, 95], textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center', fontSize: 7.5 },
      columnStyles: { 0: { halign: 'left', fontStyle: 'bold' } },
      head: [msHead], body: msBody,
    });
  }
  drawFooter(pdf, pn);

  // ==================== Page 3: 확정형 + 무한지급형 ====================
  newPage();
  y = secTitle(pdf, '3. 확정형 옵션', BY);
  y = renderOptionCards(data.fixedCards, y, [59, 130, 246]);
  if (data.fixedChart?.length) {
    y = drawPensionChart(pdf, 'bar', data.fixedChart, M, y, CW, 56,
      { a: { label: '연금(연)', color: [59, 130, 246] } },
      data.fixedEndAge, data.fixedEndAge ? `${data.fixedEndAge}세 (수령종료)` : undefined) + 3;
  }
  if (data.fixedNote) y = drawNote(pdf, data.fixedNote, y, [37, 99, 235], [239, 246, 255]) + 6;

  y = secTitle(pdf, '4. 무한지급형 옵션', y);
  y = renderOptionCards(data.infiniteCards, y, [22, 163, 74]);
  if (data.infiniteChart?.length) {
    const avail = bottomY - y - (data.infiniteNote ? 16 : 2);
    y = drawPensionChart(pdf, 'balance', data.infiniteChart, M, y, CW, Math.min(56, avail),
      { a: { label: '잔액', color: [22, 163, 74] }, b: { label: '연금(연)', color: [217, 119, 6], line: true } },
      100, '100세') + 3;
  }
  if (data.infiniteNote) drawNote(pdf, data.infiniteNote, y, [21, 128, 61], [240, 253, 244]);
  drawFooter(pdf, pn);

  // 총 페이지 수 업데이트
  _tp = pn;
  for (let i = 1; i <= pn; i++) { pdf.setPage(i); drawFooter(pdf, i); }

  pdf.save(filename);
}
