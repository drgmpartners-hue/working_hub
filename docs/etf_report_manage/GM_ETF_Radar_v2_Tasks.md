# GM ETF Radar — v2 태스크 (추적검증 프로그램 · F3)

- 버전: v2.0 / 작성일: 2026-07-29
- 근거: [PRD v0.9](./GM_ETF_Radar_PRD_v0.9.md) §F3, [Workflow v0.9](./GM_ETF_Radar_Workflow_v0.9.md) §W2·W3·W4, [v1 Spec](./GM_ETF_Radar_v1_Spec.md)
- 범위: **2차 = 발행 리포트의 이탈조건을 매일 자동 추적**(시그널 레지스트리 + 4유형 수집기 + 판정·집계). **이메일 발송은 3차**로 분리
- 전제: v1(리포트 제작) 완료 — `reports.published_at`, `report_themes.exit_conditions_json` 존재
- 규약: `[BE]` 백엔드 · `[FE]` 프론트 · `[AI]` LLM/프롬프트 · `[DATA]` 스키마 · `[QA]` 검증. 라우터 prefix `/etf-radar`

> ⚠️ **R-CORE-1 (구현 누락 금지)**: 리포트 발행(G2)은 반드시 시그널 자동등록을 트리거하며, 둘은 하나의 트랜잭션. 등록 실패 시 발행도 롤백. (PRD R-CORE-1)

---

## Phase 0 — 시그널 데이터 모델 & 계약

### P0-1 [DATA] 시그널 레지스트리 스키마
- `signals`: id, report_id?(nullable, LIBRARY는 null), theme, etf_codes[], **scope**(REPORT|LIBRARY), **type**(QUANT|NEWS|DISCLOSURE|EARNINGS), name, source_json, rule_json, frequency, action_on_trigger, **status**(GREEN|YELLOW|RED), proxy_note?
- `report_signal_links`: report_id, signal_id, action_on_trigger_override? (LIBRARY 신호 ↔ 리포트)
- `signal_events`: id, signal_id, observed_at, status_from, status_to, evidence_json(수치 스냅샷·기사 링크), prompt_version?
- **deps**: v1 완료 · **DoD**: 마이그레이션 up/down, 외래키(report_id→reports) 연결

### P0-2 [AI] 이탈조건→Signal 파싱 스키마
- 자연어 이탈조건 → Signal 스키마 변환 규격(LLM 프롬프트 + JSON 출력), 유형 자동분류 규칙
- QUANT 소스 매핑 사전(FRED DGS10, ECOS 기준금리, KRX 코드…), 매핑 실패 시 "프록시 필요" 플래그
- **deps**: P0-1 · **DoD**: 샘플 이탈조건 5종 → Signal 변환 검증

### P0-3 [DATA] 판정 규칙·프롬프트 레지스트리
- QUANT 임계값 규칙 스키마(threshold/window), NEWS/EARNINGS 판정 프롬프트를 코드와 분리된 레지스트리로 관리(prompt_id·버전)
- **deps**: P0-1 · **DoD**: 규칙/프롬프트 CRUD 가능, 버전ID 기록

---

## Phase 1 — R-CORE-1 발행↔자동등록 (v1 G2 연동)

### P1-1 [BE] 이탈조건 파싱 → 신호 후보 생성
- v1 `report_themes.exit_conditions_json` → LLM 파싱(P0-2) → Signal 후보[]
- 유형 자동분류, QUANT 소스 매핑 시도
- **deps**: P0-2 · **DoD**: 리포트 1건 이탈조건 → 신호 후보 생성

### P1-2 [BE] LIBRARY 중복 판정·링크 생성
- 기존 LIBRARY 신호와 동일 대상·지표면 **신규 생성 대신 ReportSignalLink 생성**
- 애매하면 REPORT 신호 생성 + 검수 화면에 "병합 제안" 표시 플래그
- **deps**: P1-1 · **DoD**: 동일 신호 재발행 시 링크로 처리(중복 신호 미생성)

### P1-3 [BE] G2 발행 트랜잭션에 자동등록 결합 (R-CORE-1)
- v1 `POST /reports/{id}/g2(publish)` 확장: 발행 + 시그널 등록을 **단일 트랜잭션**, 등록 실패 시 발행 롤백
- 발행 시 `reports.signals_registered_at` 기록, 직전 리포트 신호 중 미승계분 만료 처리(W1 ③)
- **deps**: P1-1, P1-2 · **DoD**: G2 승인 직후 해당 리포트 이탈조건이 `report_id`로 레지스트리 조회됨 (PRD 검수기준)

### P1-4 [FE] G2 연장 — 신호 검수 화면
- 발행 직후 신호 목록·임계값·프록시 여부·병합 제안 검수 후 [활성화]
- **deps**: P1-3 · **DoD**: 검수→활성 전이, 수동 수정 가능

---

## Phase 2 — 유형별 수집기 (병렬·독립 실행)

### P2-1 [BE] QUANT 수집기
- FRED(美10년물)·ECOS(기준금리)·KRX(ETF가격·낙폭)·환율 API, 일 1회
- 규칙 판정: 임계값 충족 + **2영업일 연속** → 🟢/🟡/🔴, 수치 스냅샷 저장
- **deps**: P0-3 · **DoD**: 임계값 규칙 판정·이력 저장, 원데이 스파이크 배제

### P2-2 [AI/BE] NEWS 수집기 (LLM 배치)
- **테마당 1회** 웹검색 스캔 → `{signal_id, hit: yes|watch|no, evidence[], source_urls[], confidence}`
- 규칙: 독립 출처 2개 이상 & confidence 기준 통과 시만 🔴 후보, **프록시 신호 최대 🟡**
- **deps**: P0-3 · **DoD**: 테마 배치 1콜로 다수 신호 판정, 근거 링크 필수

### P2-3 [BE] DISCLOSURE 수집기
- DART OpenAPI 키워드 필터(수주 취소·계약 해지·정정) → 후보만 LLM 판정
- **deps**: P0-3 · **DoD**: 키워드 후보 추출 → LLM 판정 → 이력 저장

### P2-4 [AI/BE] EARNINGS 수집기 (실적 시즌 활성)
- 실적 캘린더 매칭 시 활성화 → 발표문·기사 LLM 요약 → capex/수주 가이던스 방향 판정
- v2는 실적 시즌 수동 지정 수준(자동연동 고도화는 후속)
- **deps**: P0-3 · **DoD**: 시즌 활성 시 판정 산출, 비시즌 휴면

---

## Phase 3 — 집계·판정 엔진

### P3-1 [BE] 상태 집계 엔진
- 신호 상태 갱신 + `signal_events` 이력(근거 스냅샷). 테마 등급 = 소속 신호 최고 등급
- "지정학 묶음" 등 다수 테마 걸친 신호 발동 시 **묶음 전체 전파**
- **deps**: P2-1~P2-4 · **DoD**: 신호→테마 집계, 묶음 전파 동작

### P3-2 [BE] 🔴 발동 요건 게이트 (오탐 통제)
- QUANT: 임계값+2영업일 연속 / NEWS·DISCLOSURE: 2출처+confidence+근거링크 / 프록시: 자동 🔴 금지(YELLOW까지)
- **deps**: P3-1 · **DoD**: 요건 미충족 시 🔴 승격 차단

### P3-3 [BE] 장애 격리·"확인 불가" 표기
- 수집기 1종 장애가 전체 파이프라인 막지 않도록 독립 실행, 실패 신호는 "확인 불가"(침묵 금지)
- **deps**: P3-1 · **DoD**: 1개 수집기 실패해도 나머지 정상, 실패 신호 표기

---

## Phase 4 — 일일 스캔 오케스트레이터

### P4-1 [BE] 스캔 스케줄러 (백엔드 cron)
- 매 영업일 새벽(예: 07:00 KST) 트리거 → 4수집기 병렬 실행(⇉) → 집계 엔진 → 결과 저장
- 영업일 캘린더, 재실행/수동 트리거 지원
- **deps**: P2·P3 · **DoD**: 스케줄 실행 → 당일 신호등 갱신
- ※ v2는 결과를 화면·저장까지. 이메일 발송은 3차(P-mail)에서 연결

### P4-2 [BE] 비용 상한·모니터링
- LLM 일일 스캔 테마당 1콜 배치 강제(신호별 개별 호출 금지), 월 API 예산 상한·사용량 모니터
- **deps**: P4-1 · **DoD**: 일일 호출수·비용 집계, 상한 경보

---

## Phase 5 — 관리자 화면

### P5-1 [FE] 시그널 레지스트리 CRUD
- 신호 목록/추가/수정/일시정지, scope(REPORT/LIBRARY)·type·임계값·프록시 표시, 병합 제안 처리
- **deps**: P1·P0-1 · **DoD**: 수동 CRUD + 리포트 연결 관리

### P5-2 [FE] 신호등 대시보드
- 현재 활성 리포트에 연결된 신호 전체(동적 목록), 테마별 🟢🟡🔴 현황표, 오늘 관측값·근거·대응기준
- **deps**: P3·P4 · **DoD**: 실시간 신호등 현황 표시

### P5-3 [FE] 판정 이력 · 오탐 마킹
- 신호별 `signal_events` 타임라인(근거 링크), **오탐 마킹** → 프롬프트 개선 큐 기록(주간 리뷰용)
- **deps**: P3-1 · **DoD**: 이력 열람 + 오탐 마킹 저장

---

## Phase 6 — 통합·품질

### P6-1 [QA] R-CORE-1 검수 시나리오
- G2 승인 직후 이탈조건이 `report_id`로 레지스트리 연결·조회, 등록 실패 시 발행 롤백 확인 (PRD 검수기준)
- **deps**: P1 · **DoD**: 자동등록/롤백 시나리오 통과

### P6-2 [QA] 일일 스캔 E2E
- 스캔 트리거 → 4수집기 → 집계 → 🔴 발동 요건 → 대시보드 반영. 수집기 장애 격리·프록시 제한 확인
- **deps**: Phase 2~5 · **DoD**: 해피패스 + 장애/프록시 시나리오 통과

## v2 완료 정의

- [ ] G2 발행 = 시그널 자동등록(트랜잭션, R-CORE-1) 동작
- [ ] 4유형 수집기 매일 병렬 실행 → 신호등 판정·이력 저장
- [ ] 🔴 발동 오탐 통제(2영업일/2출처/프록시 제한) 적용
- [ ] 관리자: 레지스트리 CRUD · 신호등 대시보드 · 판정이력/오탐 마킹
- [ ] 3차(이메일) 연결 지점 확보(스캔 결과·🔴 발동 이벤트 노출)
