'use client';

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import html2canvas from 'html2canvas';

/* ================================================================
   투자흐름 보고서 PDF v5 — jspdf-autotable 기반 (모든 이슈 수정)
   ================================================================ */

const PW = 210, PH = 297, M = 12;
const CW = PW - M * 2;  // 186mm
const HDR = 14;
const FTR = 8;
const BY = M + HDR;
const BH = PH - M * 2 - HDR - FTR;

/* ---- Base64 ---- */
function ab2b64(buf: ArrayBuffer): string {
  const u8 = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s);
}

/* ---- 한글 폰트 ---- */
let fc: { n: string; b: string } | null = null;
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
let _totalPages = 0;

function drawHeader(pdf: jsPDF, c: Customer) {
  setFont(pdf, 'bold');
  pdf.setFontSize(14); pdf.setTextColor(30, 58, 95);
  pdf.text('Wrap 은퇴설계', M, M + 6);
  setFont(pdf);
  pdf.setFontSize(7); pdf.setTextColor(107, 114, 128);
  pdf.text('투자흐름 보고서', M, M + 10);
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
  // 이전 텍스트 덮기 (백색 사각형)
  pdf.setFillColor(255, 255, 255);
  pdf.rect(M, fy - 4, 40, 6, 'F');
  pdf.rect(PW - M - 20, fy - 4, 20, 6, 'F');
  pdf.setTextColor(156, 163, 175);
  pdf.text(`출력일: ${new Date().toLocaleDateString('ko-KR')}`, M, fy);
  pdf.text(`${pg} / ${_totalPages}`, PW - M, fy, { align: 'right' });
}

function sectionTitle(pdf: jsPDF, title: string, y: number): number {
  setFont(pdf, 'bold');
  pdf.setFontSize(10); pdf.setTextColor(30, 58, 95);
  pdf.text(title, M, y + 4);
  pdf.setDrawColor(30, 58, 95); pdf.setLineWidth(0.4);
  pdf.line(M, y + 6, PW - M, y + 6);
  return y + 10;
}

/* ---- 차트 캡처 ---- */
async function captureChart(el: HTMLElement): Promise<string | null> {
  if (!el || el.offsetHeight === 0) return null;
  try {
    // 요소의 실제 크기 그대로 캡처 (잘림 방지)
    const canvas = await html2canvas(el, {
      scale: 2, useCORS: true, backgroundColor: '#fff',
      logging: false, allowTaint: true,
    });
    if (canvas.width === 0 || canvas.height === 0) return null;
    return canvas.toDataURL('image/jpeg', 0.92);
  } catch { return null; }
}

/* ---- 숫자 포맷 ---- */
function fmt(v: any): string {
  if (v == null || v === '' || isNaN(Number(v))) return '-';
  return Math.round(Number(v)).toLocaleString('ko-KR');
}
function fmtPct(v: any): string {
  if (v == null || v === '' || isNaN(Number(v))) return '-';
  return `${Number(v).toFixed(2)}%`;
}

/* ---- 구분 한글 변환 ---- */
const TX_TYPE_KR: Record<string, string> = {
  deposit: '입금', withdrawal: '출금', investment: '투자',
  savings: '적립', termination: '종료', interim_eval: '중간평가',
  입금: '입금', 출금: '출금', 투자: '투자', 적립: '적립', 종료: '종료', 종결: '종결', 중간평가: '중간평가',
};
function txTypeKr(t: string): string { return TX_TYPE_KR[t] || t; }

const PHASE_KR: Record<string, string> = {
  saving: '적립', savings: '적립', holding: '거치', retirement: '은퇴후',
  적립: '적립', 거치: '거치', 은퇴후: '은퇴후',
};
function phaseKr(p: string): string { return PHASE_KR[p] || p; }

/* ================================================================
   메인: PDF 생성
   ================================================================ */
export interface FlowRow {
  year: number; year_index?: number; age: number | null;
  lump_sum: number; annual_savings: number;
  total_contribution: number; annual_evaluation: number;
  annual_return: number; annual_return_rate: number;
  deposit_in: number; cumulative_deposit_in: number;
  withdrawal: number; cumulative_withdrawal: number;
  total_evaluation: number;
  net_asset_growth_rate?: number;
  net_profit?: number;
  net_asset_return_rate?: number;
  is_100yr_flow?: boolean;
}

export interface LifetimeRow {
  year: number; calendarYear?: number; age: number; phase: string;
  cumulativePrincipal: number; evaluation: number;
  annualSavings: number; lumpSum: number; expectedRate: number;
  adjustedEval: number; depositIn: number;
  pensionWithdraw: number; cumulativeWithdraw: number;
  netAsset: number; netAssetReturn: number;
}

export interface DepositTx {
  no: number; date: string; type: string; product: string;
  credit: number; debit: number; balance: number; memo: string;
}

export interface InvestRecord {
  no: number; product: string; account: string;
  investment: number; evaluation: number; returnRate: string;
  status: string; startDate: string; expectedEnd: string; actualEnd: string; memo: string;
}

export interface PdfData {
  customer: Customer;
  flowRows: FlowRow[];
  lifetimeRows: LifetimeRow[];
  lifetimeInfo: { [key: string]: string };
  planStartYear: number;
  retirementAge: number;
  depositTxs: DepositTx[];
  depositAccountInfo: string;
  investRecords: InvestRecord[];
  chartIds: string[];
}

export async function generateInvestmentFlowPdf(data: PdfData, filename: string) {
  const pdf = new jsPDF('p', 'mm', 'a4');
  await loadFont(pdf);
  const c = data.customer;
  let pageNum = 0;

  function newPage() {
    if (pageNum > 0) pdf.addPage();
    pageNum++;
    drawHeader(pdf, c);
  }

  // ==================== 1. 연간 투자흐름표 ====================
  newPage();
  let curY = sectionTitle(pdf, '1. 연간 투자흐름표', BY);

  const flowHead = [['연도', '연차', '나이', '일시납금액', '연적립금액', '총납입금액', '연간평가금액', '연간총수익', '연수익률', '입금액', '누적입금액', '인출금액', '누적인출액', '순자산', '순이익', '순자산수익률']];

  autoTable(pdf, {
    startY: curY,
    margin: { top: BY + 2, left: M, right: M },
    tableWidth: CW,
    styles: { font: 'NG', fontSize: 4.5, cellPadding: 0.8, overflow: 'linebreak', halign: 'right', minCellWidth: 8 },
    headStyles: { fillColor: [30, 58, 95], textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center', fontSize: 4, cellPadding: 1.2 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { halign: 'center', cellWidth: 10 },  // 연도
      1: { halign: 'center', cellWidth: 7 },   // 연차
      2: { halign: 'center', cellWidth: 7 },   // 나이
      8: { halign: 'center' },                  // 수익률
      15: { halign: 'center' },                 // 순자산수익률
    },
    head: flowHead,
    body: data.flowRows.map(r => {
      const cumDep = r.cumulative_deposit_in || 0;
      const cumWd = r.cumulative_withdrawal || 0;
      const netAsset = r.total_evaluation || 0;
      const netProfit = r.net_profit ?? (netAsset - (cumDep - cumWd));
      const netReturn = r.net_asset_return_rate ?? (cumDep > 0 ? (netProfit / cumDep * 100) : 0);
      return [
        r.year, r.year_index ?? '-', r.age ?? '-',
        fmt(r.lump_sum), fmt(r.annual_savings), fmt(r.total_contribution),
        fmt(r.annual_evaluation), fmt(r.annual_return), fmtPct(r.annual_return_rate),
        fmt(r.deposit_in), fmt(r.cumulative_deposit_in),
        fmt(r.withdrawal), fmt(r.cumulative_withdrawal),
        fmt(netAsset), fmt(netProfit), fmtPct(netReturn),
      ];
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    didDrawCell: (d: any) => { if (d.section === 'body') { pdf.setDrawColor(210, 210, 210); pdf.setLineDashPattern([0.5, 0.5], 0); pdf.line(d.cell.x, d.cell.y + d.cell.height, d.cell.x + d.cell.width, d.cell.y + d.cell.height); pdf.setLineDashPattern([], 0); } },
    didDrawPage: () => { drawHeader(pdf, c); },
    willDrawPage: (d: any) => { if (d.pageNumber > 1) pageNum++; },
  });
  drawFooter(pdf, pageNum);

  // ==================== 2. 투자흐름 분석 그래프 (2개를 한 페이지에) ====================
  {
    const chartEls = data.chartIds.filter(id => !id.includes('lifetime')).map(id => document.getElementById(id)).filter(Boolean) as HTMLElement[];

    if (chartEls.length > 0) {
      newPage();
      curY = sectionTitle(pdf, '2. 투자흐름 분석 그래프', BY);

      for (let i = 0; i < chartEls.length; i++) {
        const el = chartEls[i];
        const imgData = await captureChart(el);
        if (!imgData) continue;

        const img = new Image();
        await new Promise<void>(resolve => { img.onload = () => resolve(); img.src = imgData; });
        const imgW = CW - 4;
        const imgH = Math.min((img.height * imgW) / img.width, BH / 2 - 8);

        // 차트 제목
        setFont(pdf, 'bold');
        pdf.setFontSize(7); pdf.setTextColor(55, 65, 81);
        const chartTitle = i === 0 ? '투자흐름 그래프' : '순자산 그래프';
        pdf.text(chartTitle, M + 2, curY + 3);
        curY += 5;

        // 차트 이미지
        pdf.addImage(imgData, 'JPEG', M + 2, curY, imgW, imgH);
        curY += imgH + 8;

        // 남은 공간이 부족하면 새 페이지
        if (curY > BY + BH - 40 && i < chartEls.length - 1) {
          drawFooter(pdf, pageNum);
          newPage();
          curY = sectionTitle(pdf, '2. 투자흐름 분석 그래프 (계속)', BY);
        }
      }
      drawFooter(pdf, pageNum);
    }
  }

  // ==================== 3. 100세 은퇴플로우 ====================
  {
    newPage();
    curY = sectionTitle(pdf, '3. 100세 은퇴플로우', BY);

    // 기본정보 (3그룹: 기간설정 / 투자계획 / 목표)
    if (Object.keys(data.lifetimeInfo).length > 0) {
      const info = data.lifetimeInfo;
      const groups = [
        { title: '기간 설정', items: [['플랜 시작', info['플랜 시작']], ['희망 은퇴', info['희망 은퇴']], ['총 투자기간', info['총 투자기간']], ['구성', info['구성']]] },
        { title: '투자 계획', items: [['연적립금액(평균)', info['연적립금액(평균)']], ['총거치금액', info['총거치금액']], ['총투자금액', info['총투자금액']]] },
        { title: '목표', items: [['예상 투자수익률', info['예상 투자수익률']], ['예상 연금수익률', info['예상 연금수익률']], ['은퇴당시 연금액', info['은퇴당시 연금액']], ['은퇴자금', info['은퇴자금']], ['상속자금', info['상속자금']]] },
      ];

      const colW = (CW - 4) / 3;
      for (let g = 0; g < groups.length; g++) {
        const gr = groups[g];
        const x = M + g * (colW + 2);
        autoTable(pdf, {
          startY: curY,
          margin: { top: BY + 2, left: x, right: PW - x - colW },
          tableWidth: colW,
          styles: { font: 'NG', fontSize: 6, cellPadding: 1.5 },
          headStyles: { fillColor: [30, 58, 95], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 6.5 },
          head: [[gr.title, '']],
          body: gr.items.filter(([, v]) => v).map(([k, v]) => [k, v || '-']),
          columnStyles: { 0: { cellWidth: colW * 0.45, fontStyle: 'bold' }, 1: { halign: 'right' } },
        });
      }
      // 3개 중 가장 아래 finalY 사용
      curY = (pdf as any).lastAutoTable.finalY + 4;
    }

    // 100세 플로우 테이블
    if (data.lifetimeRows.length > 0) {
      autoTable(pdf, {
        startY: curY,
        margin: { top: BY + 2, left: M, right: M },
        tableWidth: CW,
        styles: { font: 'NG', fontSize: 5, cellPadding: 0.8, overflow: 'linebreak', halign: 'right', minCellWidth: 7 },
        headStyles: { fillColor: [30, 58, 95], textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center', fontSize: 4.5, cellPadding: 1 },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        columnStyles: {
          0: { halign: 'center', cellWidth: 9 },   // 연도
          1: { halign: 'center', cellWidth: 6 },   // 연차
          2: { halign: 'center', cellWidth: 7 },   // 나이
          3: { halign: 'center', cellWidth: 8 },   // 구분
          8: { halign: 'center' },                  // 수익률
        },
        head: [['연도', '연차', '나이', '구분', '누적원금', '총평가액', '연적립', '일시납', '예상수익률', '보정평가', '누적입금', '중도인출', '인출누적', '보정순자산', '순자산수익률']],
        body: data.lifetimeRows.map((r) => [
          r.calendarYear ?? (data.planStartYear + r.year - 1), r.year, `${r.age}세`, phaseKr(r.phase),
          fmt(r.cumulativePrincipal), fmt(r.evaluation),
          fmt(r.annualSavings), fmt(r.lumpSum),
          fmtPct(r.expectedRate * 100),
          fmt(r.adjustedEval), fmt(r.depositIn),
          fmt(r.pensionWithdraw), fmt(r.cumulativeWithdraw),
          fmt(r.netAsset), fmtPct(r.netAssetReturn),
        ]),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        didParseCell: (d: any) => {
          if (d.section !== 'body') return;
          const row = data.lifetimeRows[d.row.index];
          if (!row) return;
          // 은퇴나이 행 강조 (진한 네이비)
          if (row.age === data.retirementAge) {
            d.cell.styles.fillColor = [30, 58, 95];
            d.cell.styles.textColor = [255, 255, 255];
            d.cell.styles.fontStyle = 'bold';
          }
          // 100세 행 강조 (진한 골드)
          else if (row.age === 100) {
            d.cell.styles.fillColor = [180, 130, 30];
            d.cell.styles.textColor = [255, 255, 255];
            d.cell.styles.fontStyle = 'bold';
          }
          // 보정된 행 (연한 파랑)
          else if (row.adjustedEval > 0) {
            d.cell.styles.fillColor = [235, 242, 255];
          }
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        didDrawCell: (d: any) => { if (d.section === 'body') { pdf.setDrawColor(210, 210, 210); pdf.setLineDashPattern([0.5, 0.5], 0); pdf.line(d.cell.x, d.cell.y + d.cell.height, d.cell.x + d.cell.width, d.cell.y + d.cell.height); pdf.setLineDashPattern([], 0); } },
        didDrawPage: () => { drawHeader(pdf, c); },
        willDrawPage: (d: any) => { if (d.pageNumber > 1) pageNum++; },
      });
      drawFooter(pdf, pageNum);
    }

    // 100세 은퇴플로우 그래프
    const lifetimeChartEl = document.getElementById('print-chart-lifetime');
    if (lifetimeChartEl) {
      const imgData = await captureChart(lifetimeChartEl);
      if (imgData) {
        newPage();
        curY = sectionTitle(pdf, '3. 100세 은퇴플로우 그래프', BY);

        const img = new Image();
        await new Promise<void>(resolve => { img.onload = () => resolve(); img.src = imgData; });
        const imgW = CW - 4;
        const imgH = Math.min((img.height * imgW) / img.width, BH - 10);
        pdf.addImage(imgData, 'JPEG', M + 2, curY, imgW, imgH);
        drawFooter(pdf, pageNum);
      }
    }
  }

  // ==================== 4. 예수금 계좌 기록 ====================
  if (data.depositTxs.length > 0) {
    newPage();
    curY = sectionTitle(pdf, '4. 예수금 계좌 기록', BY);

    setFont(pdf);
    pdf.setFontSize(7); pdf.setTextColor(55, 65, 81);
    pdf.text(data.depositAccountInfo, M, curY + 2);
    curY += 6;

    autoTable(pdf, {
      startY: curY,
      margin: { top: BY + 2, left: M, right: M },
      tableWidth: CW,
      styles: { font: 'NG', fontSize: 5, cellPadding: 1, overflow: 'linebreak', halign: 'right' },
      headStyles: { fillColor: [30, 58, 95], textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center', fontSize: 4.5, cellPadding: 1.2 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: {
        0: { halign: 'center', cellWidth: 8 },   // No
        1: { halign: 'center', cellWidth: 18 },  // 발생일
        2: { halign: 'center', cellWidth: 11 },  // 구분
        3: { halign: 'left', cellWidth: 26 },    // 상품명
        4: { cellWidth: 22 },                    // 입금액
        5: { cellWidth: 22 },                    // 출금액
        6: { cellWidth: 24 },                    // 잔액
        7: { halign: 'left', fontSize: 4.5 },    // 메모 (나머지 공간)
      },
      head: [['No', '발생일', '구분', '상품명', '입금액', '출금액', '잔액', '메모']],
      body: data.depositTxs.map(t => [
        t.no, t.date, txTypeKr(t.type), t.product,
        t.credit > 0 ? fmt(t.credit) : '-',
        t.debit > 0 ? fmt(t.debit) : '-',
        fmt(t.balance), t.memo || '-',
      ]),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      didDrawCell: (d: any) => { if (d.section === 'body') { pdf.setDrawColor(210, 210, 210); pdf.setLineDashPattern([0.5, 0.5], 0); pdf.line(d.cell.x, d.cell.y + d.cell.height, d.cell.x + d.cell.width, d.cell.y + d.cell.height); pdf.setLineDashPattern([], 0); } },
      didDrawPage: () => { drawHeader(pdf, c); },
      willDrawPage: (d: any) => { if (d.pageNumber > 1) pageNum++; },
    });
    drawFooter(pdf, pageNum);
  }

  // ==================== 5. 투자기록 ====================
  if (data.investRecords.length > 0) {
    newPage();
    curY = sectionTitle(pdf, '5. 투자기록', BY);

    autoTable(pdf, {
      startY: curY,
      margin: { top: BY + 2, left: M, right: M },
      tableWidth: CW,
      styles: { font: 'NG', fontSize: 5, cellPadding: 1, overflow: 'linebreak', halign: 'right' },
      headStyles: { fillColor: [30, 58, 95], textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center', fontSize: 4.5, cellPadding: 1.2 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: {
        0: { halign: 'center', cellWidth: 7 },   // #
        1: { halign: 'left', cellWidth: 26 },    // 상품명
        2: { halign: 'left', cellWidth: 20 },    // 계좌
        3: { cellWidth: 20 },                    // 투자금액
        4: { cellWidth: 20 },                    // 평가금액
        5: { halign: 'center', cellWidth: 13 },  // 수익률
        6: { halign: 'center', cellWidth: 10 },  // 상태
        7: { halign: 'center', cellWidth: 16 },  // 가입일
        8: { halign: 'center', cellWidth: 15 },  // 예상만기
        9: { halign: 'center', cellWidth: 15 },  // 실제만기
        10: { halign: 'left', fontSize: 4.5 },   // 메모 (나머지 공간 자동)
      },
      head: [['#', '상품명', '계좌', '투자금액', '평가금액', '수익률', '상태', '가입일', '예상만기', '실제만기', '메모']],
      body: data.investRecords.map(r => [
        r.no, r.product, r.account,
        fmt(r.investment), fmt(r.evaluation), r.returnRate,
        r.status, r.startDate, r.expectedEnd || '-', r.actualEnd || '-',
        r.memo || '-',
      ]),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      didDrawCell: (d: any) => { if (d.section === 'body') { pdf.setDrawColor(210, 210, 210); pdf.setLineDashPattern([0.5, 0.5], 0); pdf.line(d.cell.x, d.cell.y + d.cell.height, d.cell.x + d.cell.width, d.cell.y + d.cell.height); pdf.setLineDashPattern([], 0); } },
      didDrawPage: () => { drawHeader(pdf, c); },
      willDrawPage: (d: any) => { if (d.pageNumber > 1) pageNum++; },
    });
    drawFooter(pdf, pageNum);
  }

  // 총 페이지 수 업데이트 후 푸터 재그리기
  _totalPages = pageNum;
  for (let i = 1; i <= pageNum; i++) {
    pdf.setPage(i);
    drawFooter(pdf, i);
  }

  pdf.save(filename);
}
