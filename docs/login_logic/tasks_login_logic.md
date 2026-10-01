# 매니저 계정 체계 · 대표 대행 관리 (권한체계 재설계) Tasks

- 지시서: `docs/login_logic/개발지시서_매니저계정_권한체계.md` (원본 docx v1.0, 2026-09-21 → 마크다운 사본)
- 목표: 대표(owner) / 매니저(manager) 2단계 역할. 데이터 경계는 `clients.user_id` 단일 규칙. 판정은 `app/core/permissions.py` 한 곳에서만
- 규칙: 한 항목 구현 → 검증(pytest·typecheck·수동 확인) → 체크 → 다음 항목. 완료 시 `[x]`
- 태그: [BE] 백엔드 / [FE] 프론트 / [DB] 마이그레이션 / [TEST] 테스트 / [수동] 대표님 작업 / [확인] 결정 필요
- 표기: `(지시서 N장)` = 지시서 해당 절
- **안전 규칙: P2 완료 전에는 매니저 계정을 하나도 만들지 않는다.** (지시서 15장)

---

## P0 — 사전 정리 (문제 A·B·C, 지시서 2.3·12.1장)

- [ ] **P0-1** [수동] 운영 DB 사전 조사 쿼리 5종 실행·결과 기록 → `backend/scripts/permission_precheck.sql` (지시서 12.1)
  - 진행: 조사 쿼리를 `backend/scripts/permission_precheck.sql`로 작성함. 운영 DB 실행은 [수동]
- [x] **P0-2** [DB] 문제 A: `deposit_accounts` 고아 레코드 정리 후 `customer_id → clients.id` FK(ondelete CASCADE) 추가 마이그레이션
  - `y4d5e6p7f8k9_deposit_accounts_customer_fk` — 고아 행이 1건이라도 있으면 아무것도 바꾸지 않고 멈춤(데이터 임의 삭제 없음). profile_id는 빈 값 저장 사례가 있어 FK 제외
- [x] **P0-3** [BE] 문제 B: `investment_records.py`의 `customer_id` 의미를 `clients.id` 하나로 통일, unique_code 조회는 별도 라우트로 분리
  - 입력은 clients.id 기준으로 통일. 화면(InvestmentFlowTab)이 이미 clients.id를 보내므로 프론트 변경 불필요. 예전 profile.id 입력은 하위호환으로만 허용(스코프 적용). unique_code 조회는 사용처가 없어 제거
- [x] **P0-4** [FE] 문제 C: `services/api.ts` 요청/응답 인터셉터 — Authorization 자동 부착, 401 공통 처리(로그인 이동 / 대행 만료 시 대표 복귀)
  - 완료: 전역 fetch 가드 `components/AuthFetchGuard.tsx`(기존)에 대행 세션 끊김 시 대표 복귀 추가(P3). 원래 가드는 이미 있었음(window.fetch 패치, API 401 → 토큰 정리·로그인 이동). axios 인스턴스는 미사용이라 인터셉터는 불필요. P3에서 이 가드에 '대행 만료 → 대표 계정 복귀'만 추가하면 됨

## P1 — 역할 모델 + 권한 게이트 골격 (지시서 4·5·6.1·6.2장)

- [x] **P1-1** [DB] `models/user.py`: `role`(server_default manager, index), `created_by_user_id`, `deactivated_at` 추가. `is_superuser`는 건드리지 않음
- [x] **P1-2** [DB] 마이그레이션 `add_user_role` — owner 기본값으로 추가 → 기본값 manager로 교체 → 인덱스 (백필 순서 12.2 준수, downgrade 동작)
  - 검증: 기존 계정 → owner 백필, 신규 → manager, downgrade→upgrade 왕복 확인
- [x] **P1-3** [DB] `models/audit_log.py` + 마이그레이션 `add_audit_logs` (인덱스 3종)
- [x] **P1-4** [DB] `models/client_transfer.py` + 마이그레이션 `add_client_transfers`
- [x] **P1-5** [BE] `core/permissions.py` 신규: `is_owner`, `require_owner`, `not_found`, `scope_clients`, `assert_client/account/profile`, `scope_own`, `assert_own`, `forbid_while_impersonating`
- [x] **P1-6** [BE] `core/deps.py`: `AuthContext(actor, effective)` + `get_auth_context`, `get_current_user`는 실효 사용자 반환(시그니처 유지), `Auth` 타입 추가
  - 대행 토큰은 매 요청마다 재검증(대표가 강등되거나 대상이 매니저가 아니면 즉시 401). `request.state.auth_ctx`에 남겨 P6 감사 미들웨어가 읽음
- [x] **P1-7** [BE] `core/security.py`: `create_access_token(..., extra_claims=None)` 확장 (기존 호출부 동작 불변)
- [x] **P1-8** [BE] `schemas/user.py` `UserResponse`에 `role` 노출 (`is_superuser`는 계속 비노출)
- [x] **P1-9** [BE] `/auth/register` 신규 가입자 role을 manager로 고정
  - Google 자동 가입도 manager로 고정
- [x] **P1-10** [TEST] 대표 단독 환경에서 기존 테스트 전부 통과 (무회귀)
  - 기존 테스트 650개 전부 통과. mock 사용자에 role 추가(test_auth·ai_settings·brand·product_master·wrap_accounts), retirement_plans 수정 테스트는 db.get→select 조회로 변경
- [x] **P1-11** [확인] 공개 가입(`/auth/register`)을 계속 열어둘지 결정 (지시서 8.1)
  - D-1: 닫음

## P2 — API 전수 적용 (지시서 6.3·6.4장, 파일당 독립 커밋)

### 계층 A — 고객 귀속
- [x] **P2-1** `clients.py` — 기존 필터를 `scope_clients`로 치환, 누락 보완, upload-excel 소유자 지정
- [x] **P2-2** `snapshots.py` — `_verify_*` 헬퍼 내부를 permissions 함수로 위임
- [x] **P2-3** `retirement_profiles.py` — "모든 고객 조회 가능" 주석 제거 + 스코프 적용
- [x] **P2-4** `desired_plans.py` — no-op `_check_access` 제거, 소유 조건 걸어 조회
- [x] **P2-5** `retirement_plans.py` — customer_id → 스코프 조회
- [x] **P2-6** `pension_plans.py` — profile_id → `assert_profile`
- [x] **P2-7** `interactive_calculations.py` — 기존 필터를 헬퍼로 통일
- [x] **P2-8** `investment_records.py` — P0-3 이후 적용
- [x] **P2-9** `deposit_accounts.py` — P0-2 이후 적용
- [x] **P2-10** `portfolio_suggestions.py` — `assert_account`로 통일
- [x] **P2-11** `call_reservations.py` — suggestion 경유 소유권 검증
- [x] **P2-12** `message_logs.py`, `messaging.py` — 조회 권한을 client_id 기준으로 (이관 후 새 담당자도 이력 조회)
- [x] **P2-13** `reports.py`, `ai_retirement_guide.py` — customer_id 입력 검증

### 계층 B — 매니저 개인 자료
- [x] **P2-14** commission / content / portfolio / stock / sms_templates / field_options / user_api_keys — `scope_own`·`assert_own`
  - 점검 결과 전 라우트가 이미 본인 것만 다룸 → 매니저 격리 충족. 목록을 '대표=전체'로 바꾸면 대표 화면(문자 템플릿·드롭다운)이 깨지므로 본인 것 유지로 결정 (route_classification.md 참고)

### 계층 C — 전사 공용 (읽기 전원, 쓰기 대표만)
- [x] **P2-15** product_master / wrap_accounts / product_name_changes / recommended_portfolio — 쓰기 라우트 `require_owner`
- [x] **P2-16** brand / ai_settings / crawling / app 설정 — 동일
- [x] **P2-17** 나머지 라우터 분류 확인: company_report / notion / market / stock_search / inflation_rate / upload
  - crawling·upload(수당 정산 입력)·시장 조회는 제한 없음. company_report는 자체 관리자(is_superuser + admin_ids) 체계 유지 + 대표 항상 관리자(D-2). `/recipients/search` 고객 검색만 스코프 적용
- [x] **P2-18** `client_portal.py` — 변경 없음, 이관 후 동작만 회귀 확인
  - 변경 없음
- [x] **P2-19** 라우트 분류표(A목록/A단건/B/C읽기/C쓰기) 작성 → 이 폴더 `route_classification.md`
  - `docs/login_logic/route_classification.md`

## P3 — 대행 로그인 (지시서 7장)

- [x] **P3-1** [BE] `POST /auth/impersonate/{user_id}` (대표만, 대상 manager·활성, 중첩 400, ~~2시간 토큰~~ 시간제한 없음(D-4), audit)
  - 토큰 sub=매니저·act=대표·imp=true, 유효기간은 일반 로그인과 동일(D-4). 중첩 400, 매니저 호출 403, 대표→대표 400. 대행 토큰은 매 요청 재검증(act가 대표가 아니면 401 — 위조 차단)
- [x] **P3-2** [BE] `POST /auth/impersonate/exit`, `GET /auth/session`
- [x] **P3-3** [BE] 대행 중 금지 동작 403: 비밀번호 변경, /users/me 수정·삭제, API 키 쓰기, /managers, 이관, 중첩 대행
  - 의존성 `NotImpersonating`(core/deps.py): 비밀번호 변경, /users/me 수정·삭제, API 키 등록·수정·삭제. /managers 쓰기는 forbid_while_impersonating, 이관은 P5에서
- [x] **P3-4** [FE] `ImpersonationBanner` (sticky 최상단, 경고색, 남은 시간, 10분 전 경고, 만료 시 자동 복귀) — **배너 없이 대행 배포 금지**
  - `components/common/ImpersonationBanner.tsx` — 상단 고정(네비와 함께 sticky), [내 계정으로 돌아가기]. 카운트다운·경고 없음(D-4). 세션이 어떤 이유로든 끊기면 대표 계정으로 자동 복귀 + 통합 현황에 안내
- [x] **P3-5** [FE] `stores/auth.ts`: `session`, `impersonate()`, `exitImpersonation()`, initialize 시 `/auth/session` 복원
  - 대표 토큰은 `impersonator_token`에 보관 → 종료·세션 끊김 시 복귀. `AuthFetchGuard`·`fetchWithAuth`의 401 처리도 대행 중이면 로그아웃 대신 복귀

## P4 — 대표 통합 화면 (지시서 8장)

- [x] **P4-1** [BE] `api/v1/managers.py` 5종 (목록·생성·수정·임시비번·요약)
  - 목록·생성(임시 비밀번호 1회 노출)·수정(담당 고객 남은 매니저 비활성화 409, 대표·본인 비활성화 불가)·비밀번호 재발급·요약. 전 라우트 대표 전용, 쓰기는 대행 중 금지
- [x] **P4-2** [BE] `GET /clients?manager_id=` + 응답에 `manager {id, nickname}` (`_build_client_response`)
  - `ClientResponse.manager {id, nickname}` 추가
- [x] **P4-3** [BE] `GET /admin/overview`
  - 합계·매니저별 집계(고객·계좌·신규 고객 7일·문자 7일·수당 정산·콘텐츠·분석)·비활성 계정에 남은 고객 수·최근 활동(감사 로그)
- [x] **P4-4** [FE] `/admin` overview · managers · audit-logs 3개 페이지, 매니저 카드에서 [고객만 보기]·[이 매니저로 전환]
  - 진행: `/admin`(통합 현황), `/admin/managers`(매니저 관리), `/admin/managers/[id]`(매니저 상세), [이 매니저로 전환] 버튼(통합 현황·상세), `/admin/audit-logs`(감사 로그) 완료
- [x] **P4-5** [BE/FE] 공개 가입 닫기 (D-1)
  - `/auth/register` 403, Google 로그인은 등록된 활성 계정만(자동 가입 제거), 비활성 계정 로그인 차단, 로그인 시 최근 로그인 시각 기록, 가입 화면은 로그인으로 이동, 로그인 화면 회원가입 링크 → '대표에게 발급 요청' 안내
- [x] **P4-6** [BE] 매니저별 개인 자료(수당·콘텐츠·분석) 통합 조회 `GET /admin/managers/{id}/summary`·overview에 포함 (D-3)

## P5 — 담당자 이관 (지시서 9장)

- [x] **P5-1** [BE] `POST /clients/{id}/transfer`, `POST /managers/{id}/transfer-all`, `GET /clients/{id}/transfers`
  - `clients.py`에 transfer·transfers, `managers.py`에 transfer-all. 로직은 `services/transfer_service.py`
- [x] **P5-2** [BE] 대상 검증(존재·활성·role), client_transfers + audit 기록, 일괄 이관 단일 트랜잭션
  - 대상은 존재·활성·역할 확인(비활성 계정으로는 400), 같은 담당자 400. client_transfers + 감사 로그(action=transfer / transfer_all). 일괄 이관 단일 트랜잭션
- [x] **P5-3** [BE] 담당 고객 남은 매니저 비활성화 → 409
  - P4에서 먼저 구현. 화면은 매니저 관리의 [고객 일괄 이관] → 담당 고객 0명 → [비활성화] 순서로 안내

## P6 — 감사 로그 (지시서 10장)

- [x] **P6-1** [BE] `services/audit_service.py` (블랙리스트 마스킹, 4KB 상한, 실패해도 본 요청 영향 없음)
  - P3에서 먼저 작성
- [x] **P6-2** [BE] `main.py` 쓰기 요청 미들웨어 (actor·effective 동시 기록)
  - `main.py` `audit_middleware` → `audit_service.log_write_request`. 로그인한 사용자의 POST·PUT·PATCH·DELETE를 성공·실패 모두 기록(로그인·대행 시작/종료·고객 포털 제외). 메뉴·대상 id·고객은 경로에서 추출
- [x] **P6-3** [BE] 주민번호 복호화 조회 `view_ssn` 기록, 로그인 성공·실패 기록
  - 로그인 성공(login)·실패(login_failed, 시도한 이메일만 — 비밀번호 절대 미기록)·Google 로그인 모두 기록
  - 주민번호: 점검 결과 **평문을 돌려주는 API가 없음**(항상 마스킹). 기록할 조회가 없으므로, 향후 평문 조회 API를 만들면 `audit_service.record(action="view_ssn")` 필수
- [x] **P6-4** [BE/FE] `GET /admin/audit-logs` (대표 전용 필터) ~~+ 매니저는 본인 actor 로그만~~ → 매니저는 조회 불가(D-5)
  - 필터: 기간·사람(행위자 또는 권한 계정)·고객·동작·대행 여부, 50건씩. 화면 `/admin/audit-logs`, 관리자 메뉴 '감사 로그', 통합 현황 '최근 활동'에 한글 표기·전체 보기 링크
- [x] **P6-5** [FE] 고객 상세 "변경 이력" 탭 ("대표(대행)" 배지)
  - D-5에 따라 대표에게만: 고객 관리 행의 [변경 이력] → 담당자 이관 이력 + 등록·수정·삭제 기록('대표(대행)' 배지). 별도 고객 상세 화면이 없어 팝업으로 구현

## P7 — 프론트 마감 (지시서 11장)

- [x] **P7-1** [FE] `types/auth.ts` role·SessionInfo
  - User.role, SessionInfo 타입 추가
- [x] **P7-2** [FE] `TopNav.tsx` ownerOnly 메뉴, `ProtectedRoute` ownerOnly 가드(/admin → /home)
  - 관리자 메뉴(통합 현황·매니저 관리)는 대표에게만 표시. `/admin` 레이아웃 가드가 매니저를 /home 으로 보냄
- [x] **P7-3** [FE] 고객관리 화면: 대표에게만 담당자 컬럼·필터·[담당자 변경]
  - 대표에게만 담당자 컬럼·담당자 필터 드롭다운. 관리 화면의 [고객 보기]가 `?manager_id=`로 넘어옴. [담당자 변경]은 P5(이관)에서 추가
- [x] **P7-4** [FE] 상품마스터·데이터관리: 매니저 읽기 전용
  - `portfolio/product-master`·`data-management/wrap-accounts`: 매니저에게 안내 문구(`components/common/ReadOnlyNotice.tsx`) + 등록·수정·삭제·엑셀 업로드·Notion 가져오기/동기화·일괄 삭제 버튼 숨김. 조회·검색·엑셀 내보내기는 그대로
- [x] **P7-5** [FE] 404 문구 "대상을 찾을 수 없습니다"로 통일
  - 점검 결과 화면에 '권한이 없습니다'류 문구 없음. 관리 화면 호출(adminApi)은 404를 '대상을 찾을 수 없습니다'로 통일

## P8 — 검증 (지시서 14장)

- [x] **P8-1** [TEST] `tests/test_permissions.py` — 데이터 격리 #1~10
  - 작성·통과(20건): 격리 #1~10 전부 + 예수금·투자기록·문자이력·발송·보고서 교차 접근 + 공개 가입 차단·매니저 생성→로그인·비밀번호 재발급·비활성화 409·통합 현황
- [x] **P8-2** [TEST] `tests/test_impersonation.py` — 대행 #11~17
  - 10건 통과: #11~17 + 위조 대행 토큰 401 + 대행 수정 감사 기록(#16 실제 쓰기) + 감사 로그 대표 전용
- [x] **P8-3** [TEST] `tests/test_transfer.py` — 이관·회귀 #18~25
  - 6건 통과: #18~21(이관 후 플랜·문자 이력·원 담당자 404·감사 기록), 가드(매니저 403·대행 중 403·없는 계정·같은 담당자), #22 퇴사 절차(409 → 일괄 이관 → 비활성화 → 비활성 계정으로 이관 400), #23 포털, #24 대표 무회귀, #25 API 키
- [ ] **P8-4** [수동] 첫 매니저 온보딩 절차(지시서 12.4) 실행
- [x] **P8-5** [BE] `.claude/memory/project.md` Key Decisions 교체 (지시서 1.1)
  - .claude/memory/project.md 의 'All employees same permissions' 줄을 새 권한 원칙 3줄로 교체

## P9 — 기업 리포트·보고서 담당자별 분리 (2026-10-01 대표님 지시, 결정 D-7)

> 담당자 지정이 모든 기능보다 먼저다. 매니저마다 고객도, 하위 프로그램(기업 리포트 등) 쓰는 방식도 다르다.

- [x] **P9-1** [DB] 마이그레이션 `a6m7g8r9c0o1`: `portfolio_companies.manager_user_id`(NULL = 회사 공통), `company_hidden`(매니저별 숨김), `briefing_recipients.manager_user_id`(명단 주인, 유니크를 (명단, 사람) 단위로). 기존 데이터는 모두 회사 공통·회사 명단으로 남음
- [x] **P9-2** [BE] `services/company_report/visibility.py`: 보는 관점(매니저=자기 화면 / 대표=X-View-As 헤더로 전체·회사 공통·매니저별), 기업 가시성·읽기/쓰기 판정, 브리핑 거르기(`filter_daily`·`filter_monthly`)
- [x] **P9-3** [BE] `api/v1/company_report.py` 전 라우트 적용: 목록·상세·기사·백필·원장·투자유치·아카이브·기업DB·검색·공공데이터·삭제는 기업 가시성 기준(남의 기업 404, 공통 기업 쓰기 403), [숨기기]/[다시 보이기], 등록 중복 규칙(공통이면 안내·숨김 해제 / 다른 매니저 기업이면 409 / 대표가 등록하면 공통 전환)
- [x] **P9-4** [BE] 브리핑: AI 생성은 지금처럼 하루 1회 전사로, 볼 때·보낼 때 보는 사람(수신자는 명단 주인) 기준으로 기업 카드·종합 문장·건수를 거름. 폰 링크(`/m/daily`·`/m/monthly`)도 같은 규칙
- [x] **P9-5** [BE] 수신자 명단 담당자별: 매니저는 자기 명단을 직접 관리(고객은 담당 고객만), 회사 명단은 대표·기업 리포트 관리자. 발송 기록도 매니저에겐 자기 명단 것만
- [x] **P9-6** [BE] 대표 계정이 있으면 '첫 관리자 지정(claim)' 불가(매니저가 스스로 관리자가 되는 것 차단), 관리자 목록에 대표 표시
- [x] **P9-7** [BE] 퇴사 일괄 이관 때 그 매니저의 추가 기업·수신자 명단도 함께 이동(대표에게 넘기면 회사 공통·회사 명단)
- [x] **P9-8** [FE] 기업 리포트 상단 [담당자 선택](대표 전용: 전체 / 회사 공통만 / 매니저 화면), 목록에 '회사 공통'·'OOO 기업' 표시, 고칠 수 없는 기업은 버튼 숨김, [숨기기]·[숨긴 기업], 상세 화면 읽기 전용 안내, 수신자 카드 '내 수신자 명단'
- [x] **P9-9** [FE·BE] 고객용 보고서(은퇴플랜·목표플랜·연금수령·투자흐름 PDF, 세액공제 투자상품 보고서)에 'Dr.GM Family Office · 담당 OOO · 전화 · 이메일'. 담당자 = 그 고객의 담당 매니저, 연락처 = 매니저 '내 정보'
- [x] **P9-10** [TEST] `tests/test_company_report_per_manager.py` 6건(가시성·숨기기·중복 규칙·브리핑 거르기·명단·발송 거르기·퇴사 이동) + 기존 E2E 기대값 갱신

## P10 — 고객 추가 시 담당자 지정 (2026-10-01 대표님 지시)

- [x] **P10-1** [BE] `POST /clients`·`POST /clients/upload-excel`에 `manager_id`. 대표는 반드시 골라야 함(없으면 422), 매니저(대행 중 포함)는 보내도 무시하고 본인으로 고정 (`client_service.resolve_new_client_manager`)
- [x] **P10-2** [FE] 공용 `components/customer/ManagerSelectField.tsx`(대표: 담당자 선택 / 매니저: 본인 이름 고정)를 고객이 새로 생기는 모든 곳에 적용
  - 데이터 관리 > 고객 정보 관리 [고객 추가] 팝업 — 맨 위 고정, Notion 일괄 가져오기에도 같은 담당자 적용
  - 고객 정보 관리 엑셀 대량 등록 — 대표는 담당자 선택 창 → 파일 선택
  - 은퇴설계 고객 선택의 [+ 고객 추가] 팝업
  - 포트폴리오 계좌정보 관리 팝업의 [신규 등록]
- [x] **P10-3** [TEST] 대표 미선택 422·없는 계정 422·매니저 지정·매니저 본인 고정·대행 중 고정·엑셀 동일 규칙

## P11 — 매니저별 사용 프로그램 (2026-10-01 대표님 지시)

- [x] **P11-1** [DB] 마이그레이션 `b7p8r9o0g1r2`: `users.allowed_programs`(JSONB, NULL = 전부). 기존 계정은 전부 허용 그대로
- [x] **P11-2** [BE] `app/core/programs.py`: 프로그램 9개(고객 정보 관리·증권사 상품 관리·투자상품 관리·Dr.GM 수당정산·증권사 수당정산·주식,펀드 관리·은퇴플랜 관리·주식·ETF 추천·기업 리포트). `get_auth_context`에서 그 프로그램 전용 API를 403(대행 중엔 대상 매니저 기준, 대표는 항상 전부). 고객 목록·상품 마스터·투자상품 목록 같은 공용 API는 막지 않음
- [x] **P11-3** [BE] `/managers` 생성·수정에 `allowed_programs`, `GET /managers/programs`, `/users/me`에 `programs`
- [x] **P11-4** [FE] 매니저 관리: 추가 폼 체크박스(기본 모두 해제 — 대표가 열어 줌), 목록 [사용 프로그램] 칸에서 바로 변경. 상단 메뉴·메인 프로그램 카드는 허용된 것만, 주소로 들어오면 '사용 권한이 없는 프로그램' 안내
- [x] **P11-5** [TEST] `tests/test_programs.py` (경로 규칙·대표/기존 계정 전부·403·대행·잘못된 키·새 매니저)

## P12 — 업무 자동화·주식·ETF 추천 삭제, '투자 분석' → '자산관리' (2026-10-01 대표님 지시)

> 의도와 달라 쓰지 않음. 주식·ETF 추천은 다시 만든다면 구조가 완전히 달라질 예정이라 지금 코드는 남기지 않는다.

- [x] **P12-1** [FE] 삭제: `app/(main)/commission`(Dr.GM·증권사 수당정산), `app/(main)/investment`(주식·ETF 추천), `components/commission`, `components/investment`. 상단 메뉴 '업무 자동화' 묶음 제거, '투자 분석' → '자산관리'. 메인·첫 화면 프로그램 카드·문구, 관리자 화면의 수당 정산 칸 정리
- [x] **P12-2** [BE] 삭제: 라우터 `commission`·`crawling`·`upload`·`stock`·`market`, 이들만 쓰던 서비스 15개(`commission_service`·`crawler_service`·`excel_service`·`stock_service`·`daily_batch`·`theme_*`·`weight_calibration`·`indicator_engine`·`market_data_service`·`stock_advanced_service`·`stock_report`·`collectors/theme_mapping_collector`), `scripts/run_daily_batch.py`, 관련 테스트 14개
- [x] **P12-3** [BE] 매니저 사용 프로그램 목록에서 3개 제거(예전에 저장된 키는 무시)
- 유지: DB 테이블·기존 데이터(수당 계산·주식 추천 기록 등)는 지우지 않음. 되살릴 때는 git 기록에서 복원
- 검증(삭제 전·후 비교): 백엔드 651 → 467(차이 184 = 삭제한 테스트 수와 정확히 일치), 실DB 72 → 72, 모든 모듈 import 성공, 프론트 tsc 통과, 빌드 성공(화면 37 → 34, 빠진 3개 = 삭제한 화면), 새 eslint 오류 0, 실제 서버에서 남은 화면 정상·삭제한 주소 404. PC 사본과 검증 사본 421개 파일 내용 동일 확인

---

## 결정 사항 (2026-09-30 대표님 확정)

- [x] **D-1 공개 가입 닫음.** 시스템은 내부 전용. 계정은 대표가 관리 화면에서 매니저를 추가하는 방식으로만 만든다. `/auth/register` 차단, Google 로그인은 이미 등록된 활성 계정만(자동 가입 없음), 가입 화면 제거
- [x] **D-2 반기 기업 종합보고서는 매니저도 만든다.** 매니저가 자기 고객의 가입 상품(투자 기업)에 맞춰 뽑아야 하므로 관리자 전용이 아님 → 기업 리포트 P4 설계 요구사항으로 `docs/company_report/tasks_news_report.md`에 기록. 브리핑 발송·수신자·발송 설정 같은 회사 차원 설정은 기존 기업 리포트 관리자 체계 유지, 단 대표(owner)는 항상 관리자로 인정
- [x] **D-3 대표 전용 관리 화면에서 한 화면에 모아 본다.** 매니저별 고객·계좌·수당 정산·콘텐츠·포트폴리오 분석·최근 활동을 대표만 보는 `/admin`에서 통합 조회. 개인 목록 화면(문자 템플릿·드롭다운 등)은 지금처럼 본인 것만 유지

- [x] **D-4 대행에 시간제한을 두지 않는다.** 대표가 대행으로 업무 중일 때 끊기면 안 됨. 지시서 7.1의 2시간 토큰·만료 경고는 폐기 → 대행 토큰 유효기간 = 일반 로그인과 동일, 배너는 카운트다운 없이 '누구 계정으로 작업 중'과 [내 계정으로 돌아가기]만
- [x] **D-5 감사 로그는 대표만 본다.** 지시서 10.3의 '매니저는 본인 기록 조회'는 폐기 → 매니저는 어떤 감사 로그도 볼 수 없음(대행 중에도 403)
- [x] **D-6 대표 계정은 drgmpartners@gmail.com.** 마이그레이션 `z5o6w7n8e9r0`이 배포 시 자동으로 이 계정만 owner로 두고 나머지 기존 계정은 manager로 바꾼다(환경변수 OWNER_EMAIL로 변경 가능, 계정이 없으면 아무것도 안 바꿈)

- [x] **D-7 담당자 지정이 모든 기능보다 먼저다(2026-10-01).** 매니저마다 따로 쓰는 것: **기업 리포트**(대상 기업·브리핑·수신자 명단), **보고서에 찍히는 담당자 이름·연락처**(로고·회사명은 Dr.GM 통일). 그 밖의 상품 마스터·랩어카운트·추천 포트폴리오·AI·발송 설정은 전사 공용 유지
  - 구조: 회사 기본 + 매니저 추가. 대표가 등록한 기업은 회사 공통(모든 매니저에게 보임), 매니저는 공통 기업을 **숨기기만** 할 수 있고 자기 기업을 추가한다. 새 매니저는 회사 공통 기업이 보이는 상태로 시작
  - 브리핑: AI는 하루 1회 공통 생성, 매니저별로 걸러 보기(비용 증가 없음). 수신자 명단은 매니저별
  - 대표 화면: [담당자 선택]으로 매니저 화면을 그대로 본다(기본은 전체)

## 진행 기록

- 2026-09-30: 폴더·작업 파일 생성, 지시서 사본 보관
- 2026-09-30: P0(2·3)·P1·P2 완료. 신규 `core/permissions.py`, `core/deps.py` AuthContext, 마이그레이션 4개(`v1r2o3l4e5a6` role → `w2a3u4d5i6t7` audit_logs → `x3t4r5a6n7s8` client_transfers → `y4d5e6p7f8k9` 예수금 FK). 검증: 기존 테스트 650 통과 + `tests/test_permissions.py` 13 통과(실제 PostgreSQL 16)
  - 배포 순서: ① 운영 DB 백업 ② `permission_precheck.sql` 실행·기록 ③ `alembic upgrade head` ④ `SELECT role, COUNT(*) FROM users GROUP BY role` → owner=기존 계정 수, manager=0 확인
  - 아직 매니저 계정 생성 금지 — 화면(P3 배너·P7 메뉴)과 매니저 관리(P4)가 없음
  - 다음: P3 대행 로그인(백엔드 3종 + 금지 동작 + 전역 fetch 래퍼 + 배너)
- 2026-09-30 (2차): 결정 D-1~D-3 반영. 공개 가입 닫음, 매니저 관리 API(`api/v1/managers.py`)·통합 현황 API(`api/v1/admin.py`, `services/admin_service.py`), 대표 전용 화면 `/admin`·`/admin/managers`·`/admin/managers/[id]`, 관리자 메뉴·라우트 가드, 고객 관리 담당자 컬럼·필터. 기업 리포트 관리자에 대표 항상 포함
  - 검증: 백엔드 672 통과(실DB 권한 19 + 기업 리포트 E2E 포함), 프론트 tsc 통과·변경 파일 eslint 통과, 실제 서버 띄워 대표/매니저 두 계정으로 화면 확인(대표: 관리자 메뉴·통합 현황·매니저 생성/임시 비밀번호·담당자 필터 / 매니저: 관리자 메뉴 없음, /admin → /home, /register → /login)
  - 로컬 `npm run build` 성공 확인(2026-09-30 14:24). `/admin`·`/admin/managers`·`/admin/managers/[id]` 포함 30개 페이지. (빌드 전 남아 있던 옛 `.next/dev/types`가 삭제된 etf-radar를 참조해 실패 → 삭제 후 해결)
  - 테스트 변경: 가입 API로 계정을 만들던 테스트(test_upload·test_commissions·test_commission_results)는 DB에 직접 생성하도록 바꿈, test_auth 가입 테스트 → '가입 닫힘 403'
  - 매니저 계정 생성은 이제 가능하지만, 실제 매니저에게 배포하는 건 P3(대행 배너) 전이라도 문제없음 — 매니저 격리(P2)는 이미 적용됨. 대행 로그인을 쓰려면 P3 필요
- 2026-09-30 (3차): P3 대행 로그인 완료. `POST /auth/impersonate/{id}`·`POST /auth/impersonate/exit`·`GET /auth/session`, 대행 중 금지 동작 403, 시작·종료 감사 기록, 배너, 전환 버튼, 만료 복귀
  - 검증: 백엔드 680 통과(대행 8 포함), 프론트 tsc 통과, 실제 서버에서 대표→김매니저 전환(배너·관리자 메뉴 숨김·매니저 고객만 보임·스크롤해도 배너 고정) → 돌아가기 → 만료 토큰 상황에서 대표 계정 자동 복귀 확인
  - 다음: P5 담당자 이관(고객 관리 [담당자 변경], 퇴사 시 일괄 이관) → P6 감사 로그 미들웨어·조회 화면
- 2026-09-30 (4차): 결정 D-4·D-5 반영. 대행 시간제한 제거(토큰 유효기간 = 일반 로그인, 배너 카운트다운 제거), 감사 로그 전 쓰기 기록 미들웨어 + 대표 전용 조회 API·화면(`/admin/audit-logs`)
  - 검증: 백엔드 682 통과, 프론트 tsc 통과, 실제 서버에서 대행 중 고객 수정 → 감사 로그에 '대표 [대행] → 김매니저 계정으로 · 수정 · 고객 정보 · 홍길동' 확인
  - 1년 보존: `backend/scripts/archive_audit_logs.py` (기본 미리보기, `--apply`로 월별 JSONL.gz 내보내기 후 삭제, 365일 미만 거부). Railway Cron 등록은 [수동]
- 2026-09-30 (5차): P5 이관·P6 감사 로그 마무리·P7 화면 마감·P8 검증 완료 → **개발 항목 전부 완료.** 남은 것은 [수동] 2건(P0-1 운영 DB 사전 조사, P8-4 첫 매니저 온보딩)과 배포
  - 검증: 백엔드 691 통과(실DB 권한 20·대행 12·이관 6 + 기업 리포트 E2E 포함), 프론트 tsc 통과, 실제 서버에서 [담당자 변경]·[변경 이력]·[고객 일괄 이관]·매니저 읽기 전용 화면 확인
  - 배포 순서: ① 운영 DB 백업 ② `scripts/permission_precheck.sql` 실행(특히 4번 고아 예수금 0건 확인) ③ `alembic upgrade head`(4개) ④ 역할 분포 확인(owner = 기존 계정 수) ⑤ 백엔드·프론트 배포 ⑥ Railway Cron에 `archive_audit_logs.py --apply` 월 1회 등록
- 2026-09-30 (6차): GitHub `feature/permission-system` 브랜치에 push(c0be463). 대표 계정 자동 지정 마이그레이션 추가(D-6), 예수금 FK 마이그레이션은 고아 행이 있으면 건너뛰고 경고(서버 시작 실패 방지) + `scripts/add_deposit_fk.py`
- 2026-10-01: 결정 D-7·P9 완료(기업 리포트·보고서 담당자별 분리). 마이그레이션 `a6m7g8r9c0o1` 1개(배포 시 자동 적용)
  - 검증: 백엔드 649 통과 + 실제 PostgreSQL 67 통과(권한·대행·이관·기업 리포트 E2E·담당자별 분리 6), 프론트 tsc 통과, 실제 서버에서 대표(전체·매니저 화면)·매니저 두 계정으로 기업 목록·발송 설정 화면 확인
  - 함께 고침: 고객 목록 로딩 시 고객별 계좌 재조회 제거(속도), 설정의 비밀번호 카드 제거(내 정보에만), 통합 현황의 최근 활동 카드 제거(감사 로그와 중복)
- 2026-10-01 (2차): P10 고객 추가 담당자 지정. 검증: 백엔드 649 + 실DB 권한·이관 28 통과, 프론트 tsc 통과, 실제 서버에서 대표(선택 필수)·매니저(본인 고정) 팝업 확인
- 2026-10-01 (3차): 매니저에게 발송 설정 탭 숨김(수신자 명단은 브리핑 탭), P11 매니저별 사용 프로그램. 검증: 백엔드 651 + 실DB 72 통과, 프론트 tsc 통과, 실제 서버에서 대표(체크박스)·매니저(메뉴 제한·차단 안내) 확인
