# ETF/주식 추천 + 고객 포트폴리오 관리 — 개발 자료

> 기획일: 2026-05-04
> FEAT-3 확장: 고객별 포트폴리오 관리 + 개별 종목 상세 분석

---

## 개발 범위

| 화면 ID | 화면명 | 경로 |
|---------|--------|------|
| SCR-10 | 고객 포트폴리오 관리 | /investment/portfolios |
| SCR-11 | 개별 종목 상세 분석 | overlay (슬라이드 패널) |

---

## 핵심 개념

**목표**: 배당형·성장형 주식을 장기 보유 → 배당 안정성 향상 → 안정적 현금흐름 창출

**데이터 소스**:
- KIS(한국투자증권) API — primary
- 네이버 금융 API — secondary fallback

---

## 파일 목록

| 파일 | 설명 |
|------|------|
| [customer-portfolio.yaml](./customer-portfolio.yaml) | SCR-10 화면 명세 |
| [stock-detail.yaml](./stock-detail.yaml) | SCR-11 화면 명세 |
| [resources.yaml](./resources.yaml) | 신규 도메인 리소스 정의 |
| [tasks.md](./tasks.md) | 개발 태스크 목록 |

---

## 태스크 의존성 요약

```
P3-R7 (Customers API)  ──┐
                          ├──> P3-R8 (Customer Portfolios API)
                          │         └──> P3-R9 (Portfolio Holdings API)
P3-R10 (Market Data)  ───┤
                          └──> P3-S3 (고객 포트폴리오 UI)
                                       └──> P3-S4 (종목 상세 분석 UI)
```

**병렬 가능**: P3-R7 ‖ P3-R10 (동시 개발 가능)

---

## 관련 파일 (프로젝트 내 위치)

| 위치 | 파일 |
|------|------|
| docs/planning/01-prd.md | FEAT-3 PRD (FEAT-3-2, FEAT-3-3 섹션) |
| docs/planning/06-screens.md | SCR-10, SCR-11 화면 상세 |
| docs/planning/06-tasks.md | P3-R7~R10, P3-S3~S4 태스크 |
| specs/domain/resources.yaml | customers, customer_portfolios, portfolio_holdings, stock_market_data |
| specs/screens/customer-portfolio.yaml | SCR-10 YAML 명세 |
| specs/screens/stock-detail.yaml | SCR-11 YAML 명세 |
