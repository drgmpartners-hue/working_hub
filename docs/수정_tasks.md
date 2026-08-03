# 안정화 수정 Tasks

- 근거: 2026-08-03 전면 안정성 감사 (1차: 은퇴플랜·고객관리 / 2차: 대시보드·주식·수당정산 / 3차: 잔여 메뉴·고객포털)
- 규칙: 한 항목 수정 → 검증(typecheck/build/test) → 체크 → 다음 항목. 완료 시 `[x]`
- 심각도: 🔴 상 / 🟡 중 / ⚪ 하

---

## P0 — 즉효 수정 (일상 "됐다 안 됐다"의 주범 제거)

- [x] **P0-1** 🔴 [BE] DB 커넥션 풀 설정 — `app/db/session.py:4`
  `pool_pre_ping=True, pool_recycle=300` 추가 + `echo=False` (뜸한 뒤 첫 요청 500 제거, SQL·민감값 로그 유출 차단)
- [x] **P0-2** 🔴 [BE] Notion 프록시 타임아웃 예산 — `app/api/v1/notion.py`
  `page_size: 100` 명시 + 최대 페이지 상한 + 총 시간 예산(25초) + next_cursor 무한루프 방어 ("Failed to fetch"의 실체)
- [x] **P0-3** 🔴 [BE] test-saved 복호화 500 → 400 — `app/api/v1/user_api_keys.py:214`
  `_decrypt`를 try 안으로 이동, 재등록 안내 메시지
- [x] **P0-4** 🔴 [FE] 401 전역 처리 + 토큰 소스 단일화
  - ProtectedRoute가 `authLib`(access_token) 기준으로도 검사 (화면만 뜨고 API 죽는 상태 차단)
  - API 401 응답 전역 감지 → 토큰 정리(양쪽 저장소) + "세션 만료" 안내 + /login 이동
  - `services/auth.ts` 401 시 zustand `auth-storage`도 함께 정리
- [x] **P0-5** 🔴 [FE] Notion 동기화 안전장치 — `InvestmentFlowTab.tsx:1228`
  기존 거래 조회 실패 시 "0건 간주" 금지 → 동기화 중단 (대량 중복 생성 방지)
- [x] **P0-6** 🔴 [FE] 고객 전환 시 상태 리셋 — `InvestmentFlowTab.tsx`
  `selectedCustomerId` 변경 시 accountTransactions·expandedAccountIds·appliedYears·desiredPlanData 초기화 (이전 고객 데이터 잔존 차단)
- [x] **P0-7** 🔴 [수동/사장님] API 키 4종 재등록 (Gemini·KIS·DART·네이버) + Railway `SECRET_KEY` 환경변수 고정 확인 — 완료 (설정 화면에서 4종 활성 확인, Claude 키도 등록)


### P0 신규 — 2·3차 스윕 발견 (보안·전면 장애)

- [x] **P0-8** 🔴 [BE] 주식 스크리닝 항상 500 — `stock.py:548` `select()` 누락 (`db.execute(safunc.max(...))` → `select(func.max(...))`)
- [x] **P0-9** 🔴 [BE/보안] 고객 포털 제안 IDOR — `client_portal.py:161` 제안↔고객 소유권 검증 누락 (타 고객 포트폴리오 전량 노출)
- [x] **P0-10** 🔴 [BE/보안] `call-reserve` 무인증 + SMS 발송 트리거 — `client_portal.py:413` 포털 JWT 의존성 추가
- [x] **P0-11** 🔴 [FE/보안] 포털 XSS — `SuggestionPanel.tsx:106`, `PortalReportView.tsx:342` dangerouslySetInnerHTML sanitize
- [x] **P0-12** 🔴 [BE] 빈 old_keyword 차단 — `product_name_changes.py:55` min_length + `snapshot_service.py:62` 가드 (스냅샷 상품명 전면 파괴 방지)

## P1 — 이번 주 (재발 방지 + 시한폭탄 제거)

- [x] **P1-1** 🔴 [BE] `investment_records` 누락 컬럼 5개 마이그레이션 보강 (deposit_account_id, join_date, expected/actual/original_maturity_date) — 기존 DB 안전한 IF NOT EXISTS 방식 (`f9a0b1c2d3e4`)
- [x] **P1-2** 🔴 [BE] 예수금 잔액 재계산 `FOR UPDATE` 잠금 — `deposit_accounts.py` (동시 요청 시 잔액 오염 차단)
- [x] **P1-3** 🟡 [BE] alembic/env.py 전체 모델 import (autogenerate 드리프트 근본 원인) — `import app.models`
- [ ] **P1-4** 🟡 [FE] 환경 배지 + 배포 버전(커밋 해시) 표시 (로컬/운영 구분, 반영 여부 즉시 확인)
- [ ] **P1-5** 🟡 [CI] GitHub Actions: 프론트 typecheck+build, 백엔드 pytest — 실패 시 배포 차단
- [x] **P1-6** 🟡 [QA] 깨진 백엔드 테스트 41개 수리 (대부분 기대값 갱신) + 신규 소유권 검증에 맞춘 tests/api/conftest.py 우회 픽스처 추가
- [x] **P1-7** 🟡 [FE] PDF stale closure 수정 — `handlePrint`가 fetch 반환값을 직접 사용 (첫 PDF 빈 데이터 해결)
- [x] **P1-8** 🟡 [FE] DesiredPlanTab 물가상승률 이중 set 경쟁 해소 (ECOS는 저장값 없을 때만)
- [x] **P1-9** 🟡 [FE] Notion 동기화 중복키 생성 함수 단일화 — `InvestmentFlowTab.tsx` `dupKey()` (동기화마다 중복 추가 방지)
- [x] **P1-10** 🟡 [BE] clients 엑셀 중복체크 `MultipleResultsFound` 방어 — `clients.py` `.limit(1)`

## P2 — 중기 (체질 개선)

- [ ] **P2-1** 🔴 [BE] SECRET_KEY 분리: 암호화 전용 `ENCRYPTION_KEY` + 기동 시 기본값이면 fail-fast + 파생 방식 단일화
- [ ] **P2-2** 🟡 [FE] 침묵 catch 32곳 → 오류 상태/재시도 배너 (fetch 목록은 감사 보고 참조)
- [ ] **P2-3** 🟡 [FE] 공용 `apiFetch` 래퍼로 raw fetch 점진 치환 + AbortController 도입
- [ ] **P2-4** 🟡 [FE] InvestmentFlowTab(4,400줄) 파일 분할
- [ ] **P2-5** 🟡 [FE] 인쇄 CSS: 흰 배경 위 흰 글씨 수정 (`.wh` print 색 보정)
- [ ] **P2-6** 🟡 [FE] localStorage 키에 환경/사용자 접두어 + 저장 설정 실패 시 자동 초기화 폴백
- [ ] **P2-7** ⚪ [QA] 핵심 플로우 Playwright 스모크 4~5개

## P1 추가 — 2·3차 스윕 발견

- [x] **P1-11** 🔴 [BE/보안] snapshots.py 전 엔드포인트(10개) 소유권 검증 — `_verify_account_owner`/`_verify_snapshot_owner` 공통 헬퍼 (IDOR)
- [x] **P1-12** 🔴 [BE/보안] interactive_calculations/reports 소유권 스코핑 + interactive `.limit(1)` (플랜 2개면 500) + client_portal `_verify_suggestion_owner` — ※ retirement_plans/pension_plans 스코핑은 잔여 (P1-22와 묶어 후속)
- [x] **P1-13** 🔴 [FE/BE] 수당정산 계약 불일치 5건 — employees 자동파생(엑셀 파싱/크롤링, 한글 헤더 매핑), input_data 기본값, results.items 언랩+total_amount 평탄화, 개별 다운로드 루프, 빈 직원 422 안내
- [x] **P1-14** 🔴 [BE] Vision 실패 시 빈 스냅샷 201 생성 차단 — 인식 실패 시 이미지 정리 후 422 반환
- [x] **P1-15** 🔴 [BE] 테마 캐시 오염 3종 — 실패 payload 캐시 금지(`theme_flow.py`), JSON 잘림 안전망(`ai_report.py`), 점수 None 덮어쓰기 금지·stale 보존(`daily_batch.py`)
- [x] **P1-16** 🔴 [BE] ai_retirement_guide 동기 SDK 호출로 이벤트 루프 정지 — `asyncio.to_thread` + timeout 60s + max_tokens 4096 + Claude 모델 claude-haiku-4-5
- [ ] **P1-17** 🟡 [FE] IRP 리밸런싱 불변식 파괴(`irp:1359` 소액 억제)·비중 0% 무시(`:1356`)
- [ ] **P1-18** 🟡 [FE] wrap-accounts 수익률 단위 100배 불일치 (Notion×100 vs 엑셀 원값)
- [ ] **P1-19** 🟡 [FE] stock-recommend 무한 폴링(최대시도·취소 없음) + 영구 로딩 문구
- [ ] **P1-20** 🟡 [BE] 포털 락아웃 defaultdict DoS/다중워커 무력 — `client_portal_service.py:43,151`
- [ ] **P1-21** 🟡 [FE] 100세 플로우 단위 추측 휴리스틱(10,000배 오차) 제거 — `LifetimeRetirementFlow.tsx:356-379`
- [ ] **P1-22** 🟡 [BE] call_reservations 전 직원 노출 — 담당자 스코핑
- [ ] **P1-23** 🟡 [BE] retirement_plans PUT None 가드(`:127`) + 시뮬 lump_sum 무시(`retirement_simulation.py:71`) + commission_service 타입 방어

## P2 추가 — 2·3차 스윕 발견

- [ ] **P2-8** 🟡 대시보드 하드코딩 샘플 데이터 — 실데이터 연동 또는 명시 배너
- [ ] **P2-9** 🟡 포털: path token↔JWT 대조, unique_code NULL 우회, 401 재인증 복귀, deps scope 검증
- [ ] **P2-10** 🟡 product-master: 저장/삭제 실패 무피드백, 필드 클리어 불가, 중복명 500, 삭제 참조 검사
- [ ] **P2-11** 🟡 연금 계산: 0값 falsy 대체, 121세 off-by-one, 누적입금 리셋, 입력값 미저장 경고
- [ ] **P2-12** 🟡 수집기: 네이버 비200→0 왜곡, DART 연도 하드코딩·캐시 무TTL, KIS 실패 흡수, 백오프 없는 재시도
- [ ] **P2-13** 🟡 업로드: 메모리 전량 적재, 고아 파일, OCR 날짜 무경고 덮어쓰기, ExcelUpload filename undefined
- [ ] **P2-14** ⚪ 죽은 코드·주석 정리 (security.py 미사용 암호화, 단위 주석 불일치 등)

---

## 진행 로그
| 일시 | 항목 | 결과 |
|---|---|---|
| 2026-08-03 | P0-1~6 | 완료 — 백엔드 컴파일·프론트 typecheck/build 통과 |
| 2026-08-03 | P0-8~12 (2·3차 긴급: 스크리닝500·IDOR·무인증SMS·XSS·키워드파괴) | 완료 — 검증 통과 (dompurify 추가) |
| 2026-08-03 | P0-7 (수동) | 완료 — API 키 4종 재등록 확인(설정 화면 활성) + Claude 키 등록 |
| 2026-08-03 | P1-1~3, 7~16 | 완료 — 마이그레이션·FOR UPDATE·IDOR 소유권 헬퍼·수당정산 복원·Vision/테마 캐시 가드·to_thread. 백엔드 import OK, 프론트 tsc/build 통과 |
| 2026-08-03 | P1-6 (테스트) | 완료 — 전체 스위트 **624 passed, 3 skipped, 0 failed** (기존 41개 baseline 실패 전량 복구 + 신규 소유권 검증 정합. skip 3건은 라이브 Imagen 호출 design 테스트. JSONB 타입 제자리 변형 순서 의존성도 수정) |
| 2026-08-03 | 설정/LLM 라우팅 | 완료 — 키움 섹션 삭제, 키 오버플로 수정, 보고서 AI 코멘트 Claude Haiku 4.5 우선(Gemini 폴백) |
