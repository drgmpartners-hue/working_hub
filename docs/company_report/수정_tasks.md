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
- [x] **P1-4** 🟡 [FE] 환경 배지 + 배포 버전(커밋 해시) 표시 (로컬/운영 구분, 반영 여부 즉시 확인) — 화면 오른쪽 아래 `EnvBadge`: 로컬·미리보기는 색 배지, 화면(Vercel)·서버(Railway) 커밋을 함께 표시, 다르면 '반영 중'. 서버 `GET /api/v1/version`
- [x] **P1-5** 🟡 [CI] GitHub Actions: 프론트 typecheck+build, 백엔드 pytest — 실패 시 배포 차단 — `.github/workflows/ci.yml`(빈 PostgreSQL 에 마이그레이션 처음부터 + 전체 pytest, 나눔글꼴). 배포 차단은 **수동 1회**: Railway 서비스 Settings > Wait for CI 켜기, GitHub main 보호 규칙에 CI 필수 지정. 덤: `railway.toml` 에 healthcheck(`/health`) — 새 배포가 못 뜨면 예전 배포 유지
- [x] **P1-6** 🟡 [QA] 깨진 백엔드 테스트 41개 수리 (대부분 기대값 갱신) + 신규 소유권 검증에 맞춘 tests/api/conftest.py 우회 픽스처 추가
- [x] **P1-7** 🟡 [FE] PDF stale closure 수정 — `handlePrint`가 fetch 반환값을 직접 사용 (첫 PDF 빈 데이터 해결)
- [x] **P1-8** 🟡 [FE] DesiredPlanTab 물가상승률 이중 set 경쟁 해소 (ECOS는 저장값 없을 때만)
- [x] **P1-9** 🟡 [FE] Notion 동기화 중복키 생성 함수 단일화 — `InvestmentFlowTab.tsx` `dupKey()` (동기화마다 중복 추가 방지)
- [x] **P1-10** 🟡 [BE] clients 엑셀 중복체크 `MultipleResultsFound` 방어 — `clients.py` `.limit(1)`

## P2 — 중기 (체질 개선)

- [x] **P2-1** 🔴 [BE] SECRET_KEY 분리: 암호화 전용 `ENCRYPTION_KEY` + 기동 시 기본값이면 fail-fast + 파생 방식 단일화 — `app/core/encryption.py` 하나로 통일(sha256). 예전 두 방식(API 키: sha256(SECRET_KEY), 주민번호: SECRET_KEY 앞 32자)으로 저장된 값도 읽음(MultiFernet). ENCRYPTION_KEY 를 넣고 재배포하면 기동 때 주민번호·API 키를 새 키로 자동 재암호화(지문 기록, 한 번만). 키 교체는 `OLD_ENCRYPTION_KEYS`. 운영(Railway)에서 SECRET_KEY·ENCRYPTION_KEY 가 기본값/32자 미만이면 기동 중단, ENCRYPTION_KEY 없음은 경고. 관리자 > 통합 현황에 '보안 설정' 점검 줄(정상이면 한 줄). **수동: Railway 백엔드·Cron 서비스 Variables 에 ENCRYPTION_KEY 추가**
- [x] **P2-2** 🟡 [FE] 침묵 catch 32곳 → 오류 상태/재시도 배너 (fetch 목록은 감사 보고 참조) — 공통 알림(`lib/notify.ts` + 화면 오른쪽 위 `ErrorToaster`). 저장·삭제·불러오기 실패를 알리도록 바꿈: 은퇴플랜 불러오기(실패 시 '저장 전에 새로고침' — 빈 화면에서 저장해 덮어쓰는 위험), 100세 적용 내역 저장/불러오기(저장은 그 키만 보내 다른 탭 값 덮어쓰기 방지), 계좌 숨김·활성화·거래/투자기록 삭제, 상품명 변경 메모, 문자 템플릿(실패해도 '저장됨'·목록에서 사라지던 것), 발송 기록·최근 분석일. 그대로 둔 것: 브라우저 저장소·PDF 글꼴·검색 자동완성·화면 캡처·부가 기록 등 실패해도 되는 곳
- [x] **P2-3** 🟡 [FE] 공용 `apiFetch` 래퍼로 raw fetch 점진 치환 + AbortController 도입 — `lib/apiFetch.ts`(`apiFetch`·`apiJson`·`isAbort`): 토큰·JSON·서버 detail 오류 문구·시간 제한 30초·취소 신호를 한 곳에서. 먼저 꼬일 위험이 큰 곳부터 옮김: 대시보드(화면 떠나면 취소), 1번탭 플랜 불러오기, 연금 탭 불러오기·자동 저장 — 고객을 빠르게 바꿀 때 앞 고객의 늦은 응답이 화면·자동 저장에 섞이던 위험 차단. 나머지 fetch 는 손대는 화면부터 점진 전환
- [x] **P2-4** 🟡 [FE] InvestmentFlowTab(4,400줄) 파일 분할 — 5,377줄 → 본 화면 3,336줄 + `tab2/investment-flow/` 4개(types·ui·modals·notion). 동작 변경 없이 코드만 옮김(옮기기 전후 줄 단위 대조로 빠진 줄·바뀐 줄 0 확인, tsc·build·스모크 통과)
- [x] **P2-5** 🟡 [FE] 인쇄 CSS: 흰 배경 위 흰 글씨 수정 (`.wh` print 색 보정) — 인쇄할 때 어두운 화면 색(글씨 흰색 계열)을 밝은 인쇄용 색으로 바꿈(`globals.css` 끝 @media print), 배경 흰색·장식 숨김, 상단 메뉴·환경 배지·알림은 인쇄 제외. 스모크 테스트가 인쇄 모드 글씨·바탕 밝기를 확인(고치기 전 상태면 실패하는 것도 확인)
- [x] **P2-6** 🟡 [FE] localStorage 키에 환경/사용자 접두어 + 저장 설정 실패 시 자동 초기화 폴백 — `lib/storage.ts`: 키 = `wh:<서버>:<사용자>:<이름>`(같은 브라우저에서 다른 직원·대행·다른 서버 설정이 섞이지 않음), 예전 키 값은 처음 한 번 옮김. 깨진 값·모양이 맞지 않는 값은 지우고 처음 상태로. Notion 연결 설정(고객·투자상품·투자기록·예수금)은 연결한 DB 가 지워졌거나 칸 이름이 바뀌면 설정을 지우고 DB 고르기부터 다시. 정렬·최근 검색어·기업 리포트 담당자 선택도 같은 방식. 로그인 토큰은 그대로
- [x] **P2-7** ⚪ [QA] 핵심 플로우 Playwright 스모크 4~5개 — `frontend/tests/smoke/core-flows.spec.ts` 6개(로그인→대시보드 실데이터, 대시보드 실패 시 오류 문구, 고객 목록·검색, 고객 포털 본인 확인·만료 후 재확인, 인쇄 색, 투자 흐름 탭 열기). 백엔드 없이 응답을 흉내 내 어디서나 실행: `npx playwright test -c playwright.smoke.config.ts`

## P1 추가 — 2·3차 스윕 발견

- [x] **P1-11** 🔴 [BE/보안] snapshots.py 전 엔드포인트(10개) 소유권 검증 — `_verify_account_owner`/`_verify_snapshot_owner` 공통 헬퍼 (IDOR)
- [x] **P1-12** 🔴 [BE/보안] interactive_calculations/reports 소유권 스코핑 + interactive `.limit(1)` (플랜 2개면 500) + client_portal `_verify_suggestion_owner` — ※ retirement_plans/pension_plans 스코핑은 잔여 (P1-22와 묶어 후속)
- [x] **P1-13** 🔴 [FE/BE] 수당정산 계약 불일치 5건 — employees 자동파생(엑셀 파싱/크롤링, 한글 헤더 매핑), input_data 기본값, results.items 언랩+total_amount 평탄화, 개별 다운로드 루프, 빈 직원 422 안내
- [x] **P1-14** 🔴 [BE] Vision 실패 시 빈 스냅샷 201 생성 차단 — 인식 실패 시 이미지 정리 후 422 반환
- [x] **P1-15** 🔴 [BE] 테마 캐시 오염 3종 — 실패 payload 캐시 금지(`theme_flow.py`), JSON 잘림 안전망(`ai_report.py`), 점수 None 덮어쓰기 금지·stale 보존(`daily_batch.py`)
- [x] **P1-16** 🔴 [BE] ai_retirement_guide 동기 SDK 호출로 이벤트 루프 정지 — `asyncio.to_thread` + timeout 60s + max_tokens 4096 + Claude 모델 claude-haiku-4-5
- [x] **P1-17** 🟡 [FE] IRP 리밸런싱 불변식 파괴(`irp:1359` 소액 억제)·비중 0% 무시(`:1356`) — 비중 0% 도 반영(전량 매도), 1만원 이하 소액 매매를 건너뛸 때 금액·비중도 '그대로 보유'로 맞춰 매수·매도 합 0·비중 합 100% 유지, 금액 직접 입력 행은 그 금액 그대로(비율 반올림 영향 없음). 숫자로 검증
- [x] **P1-18** 🟡 [FE] wrap-accounts 수익률 단위 100배 불일치 (Notion×100 vs 엑셀 원값) — 단위 추측 없이 출처 기준으로 통일(`lib/percent.ts`): '%' 붙은 글자는 그대로, Notion 숫자 속성이 '퍼센트' 형식일 때만 ×100(서버가 형식 전달), 엑셀은 % 서식 셀을 보이는 글자로 읽음. 동기화도 같은 규칙(예전엔 매핑 화면을 안 열면 매핑이 비어 있었음). ※ 이미 잘못 들어간 값은 Notion [동기화] 한 번이면 고쳐짐
- [x] **P1-19** 🟡 [FE] stock-recommend 무한 폴링(최대시도·취소 없음) + 영구 로딩 문구 — 해당 없음: 주식·ETF 추천 메뉴는 2026-10-01 삭제됨(docs/login_logic P12)
- [x] **P1-20** 🟡 [BE] 포털 락아웃 defaultdict DoS/다중워커 무력 — `client_portal_service.py:43,151` — 메모리 대신 DB(`clients.portal_failures`·`portal_locked_until`, 마이그레이션 `f2p3o4r5t6l7`). 있는 고객만 기록(없는 링크는 404, 아무것도 안 쌓임), 원자적 +1, 3회 실패 → 30분, 서버 여러 대·재시작에도 유지
- [x] **P1-21** 🟡 [FE] 100세 플로우 단위 추측 휴리스틱(10,000배 오차) 제거 — `LifetimeRetirementFlow.tsx:356-379` — [적용] 값은 늘 원 단위라 항상 ÷10,000. 덤: 100세 그래프가 10억을 '1.0억'으로 표시하던 것(1억=10,000만원) 수정
- [x] **P1-22** 🟡 [BE] call_reservations 전 직원 노출 — 담당자 스코핑 — 권한 체계 작업 때 `scope_by_suggestion_column` 으로 이미 적용돼 있음(제안→계좌→고객 담당자, 대표 전체). 실제 DB 시험 추가로 확인. retirement_plans·pension_plans 도 `scope_by_profile_column` 적용 확인
- [x] **P1-23** 🟡 [BE] retirement_plans PUT None 가드(`:127`) + 시뮬 lump_sum 무시(`retirement_simulation.py:71`) + commission_service 타입 방어 — 비울 수 없는 칸의 null 무시, 적립 기간 0년이어도 거치금 반영. commission_service 는 수당정산 삭제(2026-10-01)로 해당 없음

## P2 추가 — 2·3차 스윕 발견

- [x] **P2-8** 🟡 대시보드 하드코딩 샘플 데이터 — 실데이터 연동 또는 명시 배너 — 실데이터 연동(`GET /api/v1/dashboard/summary`, 매니저 = 본인 담당, 대표 = 전체): 관리 고객·이번 주 신규, 담당 AUM(계좌별 최신 분석 합)·전월 대비, 평균 수익률, 이번 달 통화 예약·처리 대기, AUM 12개월 추이, 주의 고객(수익률 -5% 이하·90일 넘게 분석 없음·대기 중 통화 예약), 계좌 구성, 오늘 일정, 최근 활동. 샘플 안내 문구·작동 안 하던 기간 버튼 제거, 새로고침 버튼
- [x] **P2-9** 🟡 포털: path token↔JWT 대조, unique_code NULL 우회, 401 재인증 복귀, deps scope 검증 — 포털 JWT 의 링크 열쇠가 주소 {token}·고객의 지금 링크와 같아야 함(남의 링크 주소·바뀐 링크 차단). 고유번호 없는 고객은 403 "담당자 문의"(마이그레이션이 빈 고유번호를 6자리로 채움). 직원 API 는 scope 있는 토큰(포털) 거부. 화면: 401 이면 '다시 본인 확인' 안내 후 보던 화면으로 복귀(`lib/portalFetch.ts`), 서버 잠금(429) 안내. 덤: 통화 예약 SMS 알림이 db 인자 누락으로 늘 실패하던 것 수정
- [x] **P2-10** 🟡 product-master: 저장/삭제 실패 무피드백, 필드 클리어 불가, 중복명 500, 삭제 참조 검사 — 실패 시 이유 표시, 빈 칸은 null 로 보내 지워짐, 다른 상품 이름으로 바꾸면 409(500 아님)·빈 이름 422·공백 정리, 삭제 전 사용처(보유 종목·추천 포트폴리오 항목) 확인 후 한 번 더 묻기(`GET /product-master/{id}/usage`, `DELETE ?force=true`)
- [x] **P2-11** 🟡 연금 계산: 0값 falsy 대체, 121세 off-by-one, 누적입금 리셋, 입력값 미저장 경고 — 0% 입력이 기본값(5% 등)으로 바뀌던 것 수정(무한지급형 기본값 5%/6% 불일치도 통일), 표·그래프 나이를 은퇴 나이~120세로(121세 제거, 확정형 '60~89세' 표기), 100세 플로우 누적입금이 실적 적용 다음 해에 플랜 값으로 되돌아가던 것 수정, 연금 탭 직접 입력값을 1번탭 플랜에 자동 저장(고객 전환·새로고침 후 유지, 저장 전 이탈 경고). 덤: 월초 수령 상각 계산 수정 — 종신형 120세·확정형 만기에 잔액이 0 이 되도록(예전엔 10억 기준 약 1,500만원이 남음), 백엔드 종신형 100세 해 잔액 0인데 연금 지급하던 것 수정
- [x] **P2-12** 🟡 수집기: 네이버 비200→0 왜곡, DART 연도 하드코딩·캐시 무TTL, KIS 실패 흡수, 백오프 없는 재시도 — 공통 재시도(`collectors/http_retry.py`: 연결 오류·429·5xx 만 1→2→4초), 네이버 건수 실패는 None, DART 재무 연도는 올해 기준 작년·재작년, 회사 목록 캐시 7일(실패 시 예전 캐시), 공시 실패를 '공시 없음'으로 삼키지 않음(첫 쪽 실패는 오류), KIS 는 200 이어도 rt_cd≠0 이면 오류(빈 값이 '성공'으로 저장되던 것), 공휴일 캐시 12시간(임시공휴일 반영)
- [x] **P2-13** 🟡 업로드: 메모리 전량 적재, 고아 파일, OCR 날짜 무경고 덮어쓰기, ExcelUpload filename undefined — 업로드를 1MB 씩 읽다가 한도를 넘으면 바로 413(캡처·문자 이미지 20MB, 엑셀 10MB, 기업 자료 50MB, `app/core/uploads.py`). 스냅샷 저장이 어떤 이유로든 실패하면 이미지 삭제, 스냅샷·계좌·고객을 지우면 딸린 캡처·문자 이미지도 삭제(DB 삭제가 끝난 뒤에만). 캡처에서 읽은 날짜가 입력한 날짜와 다르면 저장은 캡처 날짜로 하되 화면에 알림(미래·이상한 날짜면 입력 날짜 유지). 고객 엑셀 등록은 .xlsx 만 받고 .xls 는 '.xlsx 로 저장 후' 안내(예전엔 알 수 없는 오류), 쓰지 않던 공용 FileUpload 부품 삭제
- [x] **P2-14** ⚪ 죽은 코드·주석 정리 (security.py 미사용 암호화, 단위 주석 불일치 등) — security.py 암호화는 P2-1 때 `encryption.py` 로 통일됨. 삭제된 기능의 남은 코드 제거(삭제 전·후 전체 모듈 import 197→195 오류 0 확인): 수당정산 PDF(`pdf_service.py`), 테마 보고서(`ai_report.py`), 주식 분석 함수 3개(`ai_service.py`), 주식 리포트 메일(`email_service.send_stock_report`). 단위 불일치: 투자기록 종결 창의 '평가금액 (만원)' → '(원)'(투자금액은 원 단위라 만원으로 넣으면 수익률이 -99%로 계산됨) + 모델·스키마 주석 정정

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
| 2026-10-02 | P2-1·P1-20·P1-22·P2-9 (암호화 키 분리·포털 보안) | 완료 — `test_security_hardening.py` 8개 추가, 전체 sqlite 497 / PostgreSQL 557 통과, 프론트 tsc·build 통과 |
| 2026-10-02 | P1-4·5·17·18·19·21·23 (P1 잔여 전부) | 완료 — 전체 sqlite 499 / PostgreSQL 560 통과(빈 DB 마이그레이션 포함), 프론트 tsc·build 통과 |
| 2026-10-02 | P2-2·P2-10·P2-11·P2-12 | 완료 — 전체 sqlite 508 / PostgreSQL 570 통과, 연금 계산은 숫자로 확인(잔액 0·나이 범위), 프론트 tsc·build 통과 |
| 2026-10-02 | P2-8·5·13·3·4·6·7·14 (P2 잔여 전부) | 완료 — `test_upload_hardening.py` 4개·대시보드 시험 추가, 전체 sqlite 510 / PostgreSQL 575 통과, 프론트 tsc·build 통과, 스모크 6개 통과, 린트 문제 152→148 |
| 2026-10-07 | 배포 후 정리 (API 키 공용화·키움 제거·보안 점검) | 완료 — 대표가 등록한 키를 매니저도 함께 쓰는 '회사 공용 키'로(매니저는 상태만 보고 못 바꿈), Notion 만 각자 본인 키. 예전엔 공용 키가 없으면 아무 사용자의 키를 썼던 것도 막음. 키움증권 키 삭제(마이그레이션 `g3k4i5w6o7m8`, 쓰는 코드 없음 확인). 매니저 계정에 남은 공용 서비스 키 삭제(`h4m5g6r7k8e9`, Notion·대표 키는 유지 — 삭제 전 쓰는 곳 없음 확인, 시험 DB 에서 매니저 Gemini·DART 만 지워지는 것 확인). 키 하나짜리 서비스(Claude·Gemini·Notion·DART·공공데이터·KIPRIS)는 쓰지 않는 두 번째 칸 값을 읽지 않음(그 값이 안 열리면 키 전체를 못 쓰던 문제). 관리자 '보안 설정'이 못 여는 값을 열 때마다 다시 세고 누구 계정의 어떤 키인지 표시(다시 등록하면 바로 사라짐). `test_shared_api_keys.py` 4개·스모크 1개 추가, 전체 sqlite 510 / PostgreSQL 579 통과, 빈 DB 마이그레이션·tsc 통과 |
| 2026-10-07 | 고객 정보 관리 '증권계좌' 펼침 · SECRET_KEY 교체 준비 | 완료 — 고객 줄 '관리'에 [증권계좌] 버튼: 누르면 바로 아래에 그 고객의 증권계좌(주식, 펀드 관리의 계좌정보와 같은 데이터)가 열리고 수정·등록 가능(삭제는 분석 기록이 함께 지워져 계좌정보 관리에서만). `OLD_SECRET_KEYS` 추가 — SECRET_KEY 를 바꿔도 이미 보낸 브리핑(45일)·보고서(180일) 링크는 예전 값으로 계속 열림(로그인은 새로). `test_secret_key_rotation.py` 2개·스모크 1개 추가, 전체 sqlite 512 / PostgreSQL 581 통과, tsc 통과 |
| 2026-10-07 | 중복 고객 정리 도구 · 중복 등록 방지 | 완료 — 원인: 주식, 펀드 관리 > 계좌정보 관리에서 고객을 새로 등록하면 고객 정보 관리의 같은 고객과 별개 기록이 생겨, 계좌가 고객 정보 관리 쪽에 안 보였음(운영 22명: 3/24 고객정보 등록분 + 3/25 계좌 등록분, 담당 백서연). 관리자 > 통합 현황에 '중복 등록된 고객' 카드: 이름·생년월일·담당자가 같은 묶음과 기록별 연결 자료를 보여 주고 [N명 합치기] — 계좌 있는 기록을 남기고 다른 기록의 문자 기록·담당 이력·예수금 계좌·은퇴설계·보고서 출력·브리핑 수신·감사 기록을 옮긴 뒤 빈 기록 삭제, 고유번호는 먼저 등록된(고객 정보 관리) 쪽 번호(대표 결정), 두 포털 링크 모두 유지(`clients.portal_token_alt`, 마이그레이션 `i5p6t7a8l9t0`), 양쪽 모두 은퇴설계가 있으면 건너뜀. 재발 방지: 계좌정보 관리에서 같은 이름의 고객이 있으면 그 고객에 계좌를 붙임(동명이인은 확인 후 새로). `test_client_merge.py` 2개 추가, 전체 sqlite 512 / PostgreSQL 583 통과, 빈 DB 마이그레이션·tsc 통과 |
