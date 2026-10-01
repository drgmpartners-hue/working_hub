# 라우트 권한 분류표 (docs/login_logic P2-19, 지시서 6.3)

- 판정 함수는 전부 `backend/app/core/permissions.py`에 있음. 라우터는 호출만 함
- 유형: **A-목록**(스코프 적용, 권한 없으면 빈 목록) / **A-단건**(소유 조건 걸어 조회, 권한 없으면 404) / **B**(본인 것만) / **C-읽기**(인증만) / **C-쓰기**(대표만, 아니면 403) / **공개**(인증 없음)
- 검증: `backend/tests/test_permissions.py` (실제 PostgreSQL, `PERM_PG_URL` 지정 시 실행)

## 계층 A — 고객 귀속 (대표 전체 / 매니저는 담당 고객만)

| 파일 | 처리 | 사용 함수 |
|---|---|---|
| clients.py | 목록 A-목록(+대표 전용 `manager_id` 필터), 단건·수정·삭제·계좌·포털링크·PATCH A-단건. 계좌 수정·삭제에 누락됐던 고객 소유 검증 추가. 엑셀 다운로드도 역할 스코프 적용. 엑셀 업로드·생성은 로그인 계정(실효 사용자)이 담당자 | `scope_clients`, `assert_client`, `scope_by_client_column` |
| services/client_service.py | `list_clients/get_client/update_client/delete_client`가 user_id 대신 사용자(actor)를 받음 | `scope_clients` |
| snapshots.py | `_verify_account_owner`·`_verify_snapshot_owner`를 permissions로 위임, latest-dates 스코프 | `assert_account`, `assert_snapshot`, `scope_clients` |
| retirement_profiles.py | 목록 A-목록, 조회·수정 A-단건. "모든 고객 조회 가능" 주석과 `is_superuser` 분기 제거. 생성 시 `customer_id`(고객 id) 필수 + 소유 확인 | `scope_by_client_column`, `assert_profile_by_customer`, `assert_client` |
| desired_plans.py | no-op `_check_access` 삭제, 소유 조건 걸어 조회 (`/calculate`는 저장 없는 계산이라 그대로) | `find_profile_by_customer` |
| retirement_plans.py | 목록 A-목록, 생성·수정 A-단건 | `scope_by_profile_column`, `assert_profile` |
| pension_plans.py | 생성·수정 A-단건, 목록 A-목록 | `assert_profile`, `scope_by_profile_column` |
| interactive_calculations.py | 기존 user_id 조인 헬퍼를 permissions로 통일 | `find_profile_by_customer` |
| investment_records.py | 문제 B 해소: 입력은 clients.id 기준(예전 profile.id 입력은 하위호환으로만 허용, 역시 스코프 적용). `current_user.id`를 고객 id 자리에 비교하던 목록 분기 제거. annual-flow·생성·수정에 예수금 계좌 교차 연결 차단 | `find_profile_by_customer`, `assert_client`, `assert_deposit_account`, `scope_by_profile_column` |
| deposit_accounts.py (9) | 계좌 목록 A-목록(`customer_id` 선택화), 계좌·거래내역 단건 A-단건 | `scope_by_client_column`, `assert_deposit_account`, `assert_client` |
| portfolio_suggestions.py (6) | 생성·조회·수정·발송·by-snapshot A-단건, latest-dates 스코프 | `assert_account`, `assert_suggestion`, `assert_snapshot`, `scope_clients` |
| call_reservations.py (2) | 제안 → 계좌 → 고객 경유 스코프. 제안이 연결 안 된 예약은 대표만 보임 | `scope_by_suggestion_column` |
| message_logs.py (6) | **권한을 user_id → client_id 기준으로 전환**(이관 후 새 담당자도 과거 이력 조회). user_id는 발송자 기록으로만 유지 | `client_ids_subquery`, `scope_clients` |
| messaging.py (6) | 단건·다건 발송 대상 고객 스코프 | `scope_clients` |
| reports.py | 고객 + 요청한 계좌들이 그 고객 것인지까지 확인 | `assert_client`, `assert_account` |
| ai_retirement_guide.py | 입력 `customer_id` 소유 확인 | `assert_client` |
| company_report.py `/recipients/search` | 고객 이름 검색 결과를 담당 고객으로 제한 | `scope_clients` |
| client_portal.py | **변경 없음** — 인증 없는 고객용 포털 토큰 경로 (P8에서 이관 후 회귀 확인) | — |

## 계층 B — 매니저 개인 자료

commission / content / portfolio / stock(즐겨찾기·추천·보정) / sms_templates / field_options / user_api_keys

- **점검 결과: 모든 라우트가 이미 `user_id == 로그인 계정`으로 본인 것만 다룸 → 매니저 격리는 이미 충족.**
- 결정: 목록을 "대표=전체"로 바꾸지 않고 본인 것만 유지. 대표 화면의 문자 템플릿·드롭다운 설정에 매니저들 것이 섞여 기존 화면이 깨지는 것을 막기 위함(지시서 3장 원칙 6 "기존 동작을 깨지 않는다"). 대표가 매니저 개인 자료를 볼 때는 대행 로그인(P3) 또는 관리자 화면의 `manager_id` 필터(P4)로 본다.
- user_api_keys 쓰기는 P3에서 대행 중 차단(`forbid_while_impersonating`) 추가 예정.

## 계층 C — 전사 공용 (읽기 전원 / 쓰기 대표만)

| 파일 | 대표 전용으로 막은 쓰기 라우트 |
|---|---|
| product_master.py | create / update / delete |
| wrap_accounts.py | 상품 create / update / delete, 선택옵션 create / update / delete |
| product_name_changes.py | create / update / delete |
| recommended_portfolio.py | 포트폴리오 create / update / delete, 저장(PUT), 가격 새로고침 |
| brand.py | 브랜드 설정 PUT |
| ai_settings.py | AI 설정 PUT |
| stock.py | 리포트 이메일 설정 PUT, 즉시 발송 |

GET은 전부 그대로 열려 있음(매니저가 상품 마스터를 읽어야 포트폴리오 제안 화면이 동작).

## 분류상 제외·보류

| 파일 | 판단 |
|---|---|
| crawling.py, upload.py | 수당 정산(계층 B 업무)의 입력 도구 → 매니저도 사용, 제한 없음 |
| market / stock_search / inflation_rate / notion | 시장·외부 조회, 고객 데이터 없음 → 인증만 |
| company_report.py (나머지) | **P9(결정 D-7)로 담당자별 분리.** `services/company_report/visibility.py`: 회사 공통 기업(manager_user_id NULL)은 전원 읽기·대표만 쓰기, 매니저 추가 기업은 그 매니저+대표만. 매니저는 공통 기업 숨기기만. 브리핑은 보는 사람 기준으로 거름, 수신자 명단은 담당자별. 대표는 X-View-As 헤더로 매니저 화면 보기 |
| auth.py | 공개 가입 닫힘(403), Google 로그인은 등록된 활성 계정만, 비활성 계정 로그인 차단. 대행 3종은 P3 |
| users.py | P3에서 대행 중 수정·삭제 차단 |

## 대표 전용 (역할 부족 → 403)

| 파일 | 라우트 |
|---|---|
| managers.py | `GET/POST /managers`, `PATCH /managers/{id}`, `POST /managers/{id}/reset-password`, `GET /managers/{id}/summary` — 쓰기는 대행 중에도 금지 |
| admin.py | `GET /admin/overview` |
| services/company_report/admin.py | 기업 리포트 관리자 판정에 대표(owner) 항상 포함 (결정 D-2) |
