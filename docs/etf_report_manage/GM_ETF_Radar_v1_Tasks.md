# GM ETF Radar — v1 태스크 (리포트 제작 프로그램)

- 버전: v1.0 / 작성일: 2026-07-29
- 근거: [GM_ETF_Radar_v1_Spec.md](./GM_ETF_Radar_v1_Spec.md), [PRD v0.9](./GM_ETF_Radar_PRD_v0.9.md), [Workflow v0.9](./GM_ETF_Radar_Workflow_v0.9.md)
- 범위: **1차 = 리포트 제작만** (추적검증=2차, 이메일=3차는 OUT)
- 규약: `[BE]` 백엔드 · `[FE]` 프론트 · `[AI]` LLM/프롬프트 · `[DATA]` 데이터/스키마 · `[QA]` 검증

> 표기: 각 태스크에 **의존(deps)** 과 **완료조건(DoD)** 명시. Phase 내 태스크는 병렬 가능, Phase 간은 순차 권장.
> API prefix `/api/v1`, 신규 라우터 prefix `/etf-radar`.

---

## Phase 0 — 계약 & 기반 (Contract First)

### P0-1 [DATA] 데이터 모델·마이그레이션
- `reports`, `report_stages`, `report_themes` 테이블 (Spec §5) Alembic 마이그레이션
- 상태 enum: `DRAFT | G1_REVIEW | G2_REVIEW | PUBLISHED | ARCHIVED`
- 2차 예약 필드 포함: `reports.signals_registered_at`(nullable), `report_themes.exit_conditions_json`
- **deps**: 없음 · **DoD**: 마이그레이션 up/down 통과, 로컬 DB에 테이블 생성

### P0-2 [DATA] API 계약 정의 (OpenAPI 스키마)
- 요청/응답 Pydantic 스키마: 리포트 생성 요청, 리포트/스테이지/테마 응답, G1 액션(승인/수정/재실행), G2 발행
- **deps**: P0-1 · **DoD**: 스키마 파일 확정, 프론트와 공유

### P0-3 [AI] STAGE JSON 스키마 확정 (S1~S6)
- 각 STAGE 산출물 JSON 스키마를 스킬 문서 규격에서 변환 (Workflow §W1)
  - S1: `{ macro_summary, themes[]{logic, source_urls, rep_etf, tag: 실적형|전환형|기대형} }`
  - S2: `{ culled[]{theme, reason, reentry_condition}, survivors[] }`
  - S3: `{ per_theme{consensus, bear_cases[2], early_warning_indicators[], verdict} }`
  - S4: `{ ranked_themes[]{rank_axes}, correlation_check, exit_conditions_draft[] }`
  - S5: `{ per_theme_products[]{returns(YTD/1Y/3Y+asof), top_holdings, dividend, fee, aum} }`
  - S6: `{ report_md, change_summary? }`
- ★S3 `early_warning_indicators`·S4 `exit_conditions_draft`는 **관측 가능한 형태** 강제(2차 시그널 원천)
- **deps**: 없음 · **DoD**: 6개 JSON 스키마 문서화, 검증 함수 작성

### P0-4 [BE] 디자인 레퍼런스 반입
- `gm-ppt-builder/SKILL.md`(색상·레이아웃 규격)를 repo에 `design-reference/`로 복사 (Workflow §S6)
- Dr.GM 컬러 토큰(딥네이비 #0B1F3A / 아이보리 #FBFAF6 / 골드 #C9A24A 등) CSS 변수화
- **deps**: 없음 · **DoD**: PDF 템플릿에서 참조 가능한 디자인 토큰 확정

---

## Phase 1 — 리포트 생성 파이프라인 (S1~S4, 자동)

### P1-1 [BE] Claude API 클라이언트 (web_search 포함)
- 기존 `user_api_keys`의 Claude 키 재사용, `messages` 체인 + `web_search` tool
- STAGE 호출 공통 래퍼(프롬프트 버전ID 기록, 토큰·비용 로깅, 재시도)
- **deps**: P0-2 · **DoD**: 단일 STAGE 호출 성공, 산출 JSON 파싱

### P1-2 [AI] S1 시장 리서치·롱리스트 프롬프트
- 국내/미국 전망·ETF 트렌드 웹검색(쿼리에 현재 연·반기), 테마 ≈10×2시장 산출
- **deps**: P0-3, P1-1 · **DoD**: S1 JSON 스키마 충족 산출

### P1-3 [AI] S2 축출 라운드 프롬프트
- 규칙: 기대형=축출 1순위, 남기려면 별도 논거. `culled`/`survivors`
- **deps**: P1-2 · **DoD**: S2 스키마 산출, 사유 구체성 검증

### P1-4 [AI] S3 밸류에이션 + 레드팀 프롬프트
- 테마별 컨센서스·bear case×2·조기경고지표·판정. ★조기경고지표 관측가능 형태 강제
- **deps**: P1-3 · **DoD**: S3 스키마 산출, early_warning 측정가능성 검사 통과

### P1-5 [AI] S4 최종 테마 확정안 프롬프트
- 3축 순위 + 상관관계 점검 + 이탈조건 초안
- **deps**: P1-4 · **DoD**: S4 스키마 산출, exit_conditions_draft 관측가능

### P1-6 [BE] 파이프라인 오케스트레이터 (S1→S4)
- STAGE 순차 실행, 각 산출을 `report_stages`에 저장, 실패 시 `FAILED`·재실행 지점 기록
- 실행 = 리포트 상태 `DRAFT`→ S4 완료 시 `G1_REVIEW`
- **deps**: P1-2~P1-5 · **DoD**: 한 번 실행으로 S1~S4 완주, 상태 전이 확인

### P1-7 [BE] 리포트 생성 트리거 API
- `POST /api/v1/etf-radar/reports` (대상 시장·테마 수) → 파이프라인 비동기 실행, report_id 반환
- 진행 상태 조회 `GET /reports/{id}/stages`
- **deps**: P1-6 · **DoD**: API로 생성·진행조회 동작

---

## Phase 2 — G1 게이트 (관리자 검토)

### P2-1 [BE] G1 조회·액션 API
- `GET /reports/{id}` (S4 결과: 테마안+축출사유+레드팀)
- `POST /reports/{id}/g1` — action: `approve` | `edit`(테마 수정 payload) | `rerun`(S1부터)
- approve 시 상태 `G1_REVIEW`→(S5 트리거) / rerun 시 `DRAFT`
- **deps**: P1-7, P0-2 · **DoD**: 3개 액션 각각 상태 전이·감사 로그

### P2-2 [FE] S-3 G1 검토 화면
- 최종 테마안 + 축출 사유 + 레드팀 전문 표시, [승인]/[테마 수정]/[재실행]
- 수정 시 테마 되살리기·순위 조정 UI, 사유 입력
- **deps**: P2-1 · **DoD**: 승인/수정/재실행 왕복 동작

---

## Phase 3 — 상품 실사·렌더링 (S5~S6, 자동) + G2 발행

### P3-1 [AI/BE] S5 상품 실사
- 국장 테마: 국내 ETF 3 / 미장 테마: 미국판 3 + 국내판 3
- 필수 필드: 수익률(YTD·1Y·3Y+기준일), 상위10~15종목·비중, 배당·보수·AUM. 미확보=“확인 불가”
- 가능 시 기존 stock/portfolio 데이터 인프라 재사용, 부족분 LLM+웹검색 보완
- **deps**: P2-1(approve 후 트리거) · **DoD**: S5 스키마 산출, 기준일 100% 표기

### P3-2 [BE] S6 리포트 렌더링 (HTML→PDF)
- JSON → 리포트 MD → Dr.GM 규격 HTML → **weasyprint PDF**, 면책 문구 고정 삽입
- 직전 리포트 존재 시 변경 요약 섹션 자동 생성
- 산출 PDF 저장(URL) → `reports.pdf_url`, 상태 `G2_REVIEW`
- **deps**: P3-1, P0-4 · **DoD**: PDF 생성·다운로드, 디자인 규격 준수

### P3-3 [BE] G2 발행 승인 API
- `POST /reports/{id}/g2` action: `publish` — 상태 `PUBLISHED`, `published_at` 기록
- ※v1에서는 발행=웹게시+PDF 확정까지. (2차: 여기서 시그널 자동등록 트리거 연결)
- **deps**: P3-2 · **DoD**: 발행 상태 전이, published_at 기록

### P3-4 [FE] S-4 G2 발행 화면
- 리포트 미리보기(웹/PDF) + 변경 요약, [발행 승인]
- **deps**: P3-3 · **DoD**: 미리보기·발행 동작

---

## Phase 4 — 관리자 콘솔 화면 (프론트 통합)

### P4-1 [FE] 라우트·레이아웃 `/content/etf-radar`
- 메뉴 연결(완료됨: TopNav), 페이지 셸·탭/네비
- **deps**: 없음 · **DoD**: 라우트 진입, 빈 상태 렌더

### P4-2 [FE] S-1 리포트 목록 화면
- 상태 배지(초안/G1대기/G2대기/발행됨), 생성일·테마수, [새 리포트 생성]
- **deps**: P1-7, P4-1 · **DoD**: 목록 조회·상태 표시

### P4-3 [FE] S-2 생성 실행/진행 화면
- 대상 시장·테마 수 파라미터, 실행 버튼, STAGE별 진행(폴링)
- **deps**: P1-7, P4-2 · **DoD**: 실행 → 진행 표시 → G1 이동

### P4-4 [FE] S-5 리포트 뷰어
- 발행 리포트 웹 뷰 + PDF 다운로드
- **deps**: P3-3 · **DoD**: 발행 리포트 열람·다운로드

---

## Phase 5 — 통합·품질

### P5-1 [BE] 비용·재현성 로깅
- STAGE별 토큰·web_search 사용량 로깅, 프롬프트 버전ID 저장, 월 예산 모니터 훅
- **deps**: P1-1 · **DoD**: 리포트별 비용 집계 조회

### P5-2 [QA] E2E 시나리오
- 생성 → S1~S4 → G1 승인 → S5~S6 → G2 발행 → 뷰어 열람 전 구간
- 재실행·STAGE 실패 복구·“확인 불가” 필드 처리 확인
- **deps**: Phase 1~4 · **DoD**: 해피패스 + 실패복구 시나리오 통과

### P5-3 [QA] 2차 연동 준비 검수 (Spec §9)
- `exit_conditions_json` 관측가능 형태 저장 확인, `published_at` 기록, report/theme ID 안정성
- **deps**: P3-3 · **DoD**: 체크리스트 3항목 통과 (2차 F3 착수 전제 확보)

---

## 의존성 요약 (실행 순서 가이드)

```
Phase 0 (P0-1..4)                     ← 기반, 병렬
   ▼
Phase 1 (P1-1 → P1-2..5 → P1-6 → P1-7)  ← 파이프라인 S1~S4
   ▼
Phase 2 (P2-1 → P2-2)                 ← G1 게이트
   ▼
Phase 3 (P3-1 → P3-2 → P3-3 → P3-4)   ← 실사·렌더·G2
   ▼
Phase 4 (P4-1 → P4-2 → P4-3, P4-4)    ← 콘솔 화면 (P1-7 이후 병행 가능)
   ▼
Phase 5 (P5-1, P5-2, P5-3)            ← 통합·QA·2차 준비
```

## v1 완료 정의 (Definition of Done)

- [ ] 관리자가 버튼으로 리포트 생성 실행 → S1~S4 자동 완주
- [ ] G1에서 승인/수정/재실행 가능
- [ ] S5 실사 + S6 PDF 렌더링(Dr.GM 규격, 면책 문구) 자동
- [ ] G2 발행 → `PUBLISHED` + PDF 열람·다운로드
- [ ] 리포트 목록·뷰어 관리자 콘솔 동작
- [ ] 리드타임 관리자 검토 30분 이내 달성
- [ ] 2차 연동 준비 체크(§9) 통과
