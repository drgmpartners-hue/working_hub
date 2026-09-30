-- 권한체계 재설계 사전 조사 (docs/login_logic P0-1, 지시서 12.1)
-- 운영 DB 에서 코드 배포·마이그레이션 전에 실행하고 결과를 tasks_login_logic.md 진행 기록에 남긴다.

-- 1) 현재 계정 현황
SELECT id, email, nickname, is_active, is_superuser FROM users ORDER BY created_at;

-- 2) 담당자 없는 고객 (0이어야 정상)
SELECT COUNT(*) AS clients_without_owner FROM clients c
LEFT JOIN users u ON u.id = c.user_id WHERE u.id IS NULL;

-- 3) 고아 은퇴 프로필
SELECT COUNT(*) AS orphan_profiles FROM customer_retirement_profiles p
LEFT JOIN clients c ON c.id = p.customer_id WHERE c.id IS NULL;

-- 4) 고아 예수금 계좌 (문제 A — FK 가 없어 가장 위험). 0이 아니면 아래 상세 조회
SELECT COUNT(*) AS orphan_deposit_accounts FROM deposit_accounts d
LEFT JOIN clients c ON c.id = d.customer_id WHERE c.id IS NULL;
-- 4-1) 상세
-- SELECT d.* FROM deposit_accounts d LEFT JOIN clients c ON c.id = d.customer_id WHERE c.id IS NULL;

-- 5) 계좌 → 고객 연결 확인
SELECT COUNT(*) AS orphan_client_accounts FROM client_accounts a
LEFT JOIN clients c ON c.id = a.client_id WHERE c.id IS NULL;

-- 6) (마이그레이션 직후) 역할 분포 — owner = 기존 계정 수, manager = 0 이어야 한다
-- SELECT role, COUNT(*) FROM users GROUP BY role;
