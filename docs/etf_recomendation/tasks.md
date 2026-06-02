# FEAT-3 확장 개발 태스크 (고객 포트폴리오 + 종목 상세 분석)

> 원본: docs/planning/06-tasks.md (P3-R7~R10, P3-S3~S4)
> 모드: Domain-Guarded v2.0
> 생성일: 2026-05-04

---

## 의존성 그래프

```
P0-T0.3 (DB 스키마)
    │
    ├──> P3-R7: Customers API ──────────────────┐
    │         └──> P3-R8: Customer Portfolios   │
    │                   └──> P3-R9: Holdings    │
    │                                            ▼
    └──> P3-R10: Stock Market Data ──> P3-S3: 고객 포트폴리오 UI
                                               └──> P3-S4: 종목 상세 분석 UI

병렬 가능: P3-R7 ‖ P3-R10
```

---

## Phase 3 신규 리소스

### P3-R7: Customers Resource

#### [ ] P3-R7-T1: Customers API 구현
- **담당**: backend-specialist
- **리소스**: customers
- **엔드포인트**:
  - GET /api/customers
  - GET /api/customers/:id
  - POST /api/customers
  - PUT /api/customers/:id
- **필드**: id, name, birth_date, phone, email, occupation, notes, created_at
- **파일**: `backend/tests/api/test_customers.py` → `backend/app/routers/customers.py`, `backend/app/models/customer.py`
- **스펙**: 고객 CRUD. 고객 DB 기반, 포트폴리오 관리의 진입점
- **Worktree**: `worktree/phase-3-portfolio`
- **TDD**: RED → GREEN → REFACTOR
- **병렬**: P3-R10-T1과 병렬 가능

---

### P3-R8: Customer Portfolios Resource

#### [ ] P3-R8-T1: Customer Portfolios API 구현
- **담당**: backend-specialist
- **리소스**: customer_portfolios
- **엔드포인트**:
  - GET /api/customers/:customer_id/portfolios
  - POST /api/customers/:customer_id/portfolios
  - GET /api/customers/:customer_id/portfolios/:id
  - PUT /api/customers/:customer_id/portfolios/:id
  - DELETE /api/customers/:customer_id/portfolios/:id
- **필드**: id, customer_id, name, account_number, account_type, total_invested, cash_balance, created_at
- **파일**: `backend/tests/api/test_customer_portfolios.py` → `backend/app/routers/customer_portfolios.py`, `backend/app/models/customer_portfolio.py`
- **스펙**: 고객당 N개 포트폴리오 CRUD
- **Worktree**: `worktree/phase-3-portfolio`
- **TDD**: RED → GREEN → REFACTOR
- **의존**: P3-R7-T1

---

### P3-R9: Portfolio Holdings Resource

#### [ ] P3-R9-T1: Portfolio Holdings API 구현
- **담당**: backend-specialist
- **리소스**: portfolio_holdings
- **엔드포인트**:
  - GET /api/portfolios/:portfolio_id/holdings
  - POST /api/portfolios/:portfolio_id/holdings
  - PUT /api/portfolios/:portfolio_id/holdings/:id
  - DELETE /api/portfolios/:portfolio_id/holdings/:id
- **필드**: id, portfolio_id, stock_code, stock_name, stock_type(stock/etf), holding_type(dividend/growth), quantity, avg_price, purchase_date
- **파일**: `backend/tests/api/test_portfolio_holdings.py` → `backend/app/routers/portfolio_holdings.py`, `backend/app/models/portfolio_holding.py`
- **스펙**: 포트폴리오 내 종목 CRUD. holding_type으로 배당형/성장형 구분
- **Worktree**: `worktree/phase-3-portfolio`
- **TDD**: RED → GREEN → REFACTOR
- **의존**: P3-R8-T1

---

### P3-R10: Stock Market Data Resource

#### [ ] P3-R10-T1: Stock Market Data API 구현
- **담당**: backend-specialist
- **리소스**: stock_market_data
- **엔드포인트**:
  - GET /api/market/stocks/:code
  - GET /api/market/stocks/:code/chart
  - GET /api/market/stocks/:code/dividend
  - GET /api/market/stocks/:code/fundamentals
  - GET /api/market/stocks/:code/supply-demand
- **필드**: code, name, stock_type, current_price, change_rate, price_history, ma5/20/60/120, volume_history, per, eps, pbr, dividend_yield, dividend_cycle, dividend_stability, dividend_growth, foreign_net_buy, institutional_net_buy, sector, business_summary, revenue_trend, operating_profit_trend, related_stocks, etf_holdings, etf_top10_ratio, data_source
- **스펙**:
  - KIS API primary 연동
  - 네이버 금융 secondary fallback
  - stock_type(stock/etf) 분기
- **파일**: `backend/tests/api/test_market_data.py` → `backend/app/routers/market_data.py`, `backend/app/services/market_data_service.py`
- **Worktree**: `worktree/phase-3-portfolio`
- **TDD**: RED → GREEN → REFACTOR
- **병렬**: P3-R7-T1과 병렬 가능

---

## Phase 3 신규 화면

### P3-S3: 고객 포트폴리오 관리 화면

> 화면 명세: `customer-portfolio.yaml`

#### [ ] P3-S3-T1: 고객 포트폴리오 관리 UI 구현
- **담당**: frontend-specialist
- **화면**: /investment/portfolios
- **컴포넌트**:
  - `CustomerSelector` — 고객 DB 검색/선택
  - `PortfolioTabs` — N개 포트폴리오 탭
  - `PortfolioSummary` — 투자금액/예수금/평가금액/수익률 (배당 토글)
  - `DividendOverview` — 월별 배당 바 차트 + 연간 합계
  - `PerformanceChart` — 종목별 기준가 라인 + 수익률 오버레이
  - `HoldingsTable` — 종목 구성 테이블 (클릭 → SCR-11)
- **파일**: `frontend/tests/unit/customer-portfolio.test.tsx` → `frontend/src/app/(main)/investment/portfolios/page.tsx`
- **TDD**: RED → GREEN → REFACTOR
- **의존**: P3-R7-T1, P3-R8-T1, P3-R9-T1, P3-R10-T1

#### [ ] P3-S3-T2: 고객 포트폴리오 통합 테스트
- **담당**: test-specialist
- **시나리오**:
  | 시나리오 | 액션 | 기대 결과 |
  |---------|------|---------|
  | 고객 선택 | 드롭다운 선택 | 포트폴리오 탭 + 요약 로드 |
  | 배당 토글 | 토글 클릭 | 수익률 + 차트 즉시 전환 |
  | 배당 현황 | 포트폴리오 선택 | 월별 배당 + 연간 합계 표시 |
  | 종목 클릭 | 테이블 행 클릭 | SCR-11 슬라이드 열림 |
  | 포트폴리오 추가 | 추가 버튼 | 새 탭 생성 |
- **파일**: `frontend/tests/e2e/customer-portfolio.spec.ts`
- **의존**: P3-S3-T1

#### [ ] P3-S3-V: 고객 포트폴리오 연결점 검증
- **담당**: test-specialist
- **검증 항목**:
  - [ ] customers.[id, name, phone, email] 존재
  - [ ] customer_portfolios.[id, customer_id, name, total_invested, cash_balance] 존재
  - [ ] portfolio_holdings.[id, portfolio_id, stock_code, stock_type, holding_type, quantity, avg_price] 존재
  - [ ] stock_market_data.[current_price, dividend_yield] 존재
  - [ ] GET /api/customers 정상
  - [ ] GET /api/customers/:id/portfolios 정상
  - [ ] GET /api/portfolios/:id/holdings 정상
  - [ ] GET /api/market/stocks/:code 정상
  - [ ] 배당 토글 동작
  - [ ] HoldingsTable 행 클릭 → SCR-11 패널 열림
- **파일**: `frontend/tests/integration/customer-portfolio.verify.ts`
- **의존**: P3-S3-T2

---

### P3-S4: 개별 종목 상세 분석 (Overlay)

> 화면 명세: `stock-detail.yaml`

#### [ ] P3-S4-T1: 종목 상세 분석 UI 구현
- **담당**: frontend-specialist
- **화면**: overlay (슬라이드 패널)
- **공통 컴포넌트**:
  - `StockDetailHeader` — 종목명/티커/현재가/등락률/타입 뱃지
  - `PriceChart` — MA(5/20/60/120일) + 거래량 + 기간 선택
- **주식(stock) 전용**:
  - `ValuationSection` — PER, EPS, PBR
  - `SupplyDemandChart` — 외국인/기관 순매수
  - `CompanyInfoSection` — 업종/시가총액/사업요약
  - `RevenueChart` — 매출·영업이익 트렌드 (4분기)
  - `RelatedStocksList` — 관련 종목 (클릭 시 전환)
- **ETF 전용**:
  - `EtfDividendSection` — 배당주기/수익률/안정성/성장성
  - `EtfHoldingsChart` — Top 10 비중 파이/바 차트
  - `EtfHoldingsTable` — 편입 기업 비중·수익률
- **파일**: `frontend/tests/unit/stock-detail.test.tsx` → `frontend/src/components/investment/StockDetailPanel.tsx`
- **TDD**: RED → GREEN → REFACTOR
- **의존**: P3-R10-T1, P3-S3-T1

#### [ ] P3-S4-T2: 종목 상세 분석 통합 테스트
- **담당**: test-specialist
- **시나리오**:
  | 시나리오 | 액션 | 기대 결과 |
  |---------|------|---------|
  | 주식 타입 | stock 클릭 | 주식 전용 섹션 표시, ETF 섹션 미표시 |
  | ETF 타입 | ETF 클릭 | ETF 전용 섹션 표시, 주식 섹션 미표시 |
  | KIS fallback | KIS API 실패 | 네이버 금융 전환 |
  | 관련 종목 전환 | RelatedStocks 클릭 | 패널 내용 교체 |
- **파일**: `frontend/tests/e2e/stock-detail.spec.ts`
- **의존**: P3-S4-T1

#### [ ] P3-S4-V: 종목 상세 분석 연결점 검증
- **담당**: test-specialist
- **검증 항목**:
  - [ ] stock_market_data.[price_history, ma5~120, volume_history] 존재
  - [ ] stock_market_data.[per, eps, pbr] 존재
  - [ ] stock_market_data.[dividend_yield, dividend_cycle, dividend_stability, dividend_growth] 존재
  - [ ] stock_market_data.[foreign_net_buy, institutional_net_buy] 존재
  - [ ] stock_market_data.[etf_holdings, etf_top10_ratio] 존재
  - [ ] GET /api/market/stocks/:code/chart 정상
  - [ ] GET /api/market/stocks/:code/fundamentals 정상
  - [ ] GET /api/market/stocks/:code/supply-demand 정상
  - [ ] GET /api/market/stocks/:code/dividend 정상
  - [ ] KIS 실패 시 네이버 자동 전환
  - [ ] stock_type 분기 렌더링 정확
- **파일**: `frontend/tests/integration/stock-detail.verify.ts`
- **의존**: P3-S4-T2
