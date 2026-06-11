# 프로덕션 DB 정기 백업 (무료, Docker pg_dump 사용 — 별도 설치 불필요)
#
# 사용법:
#   1) 한 번만: 프로덕션 DB 공개 URL을 환경변수로 등록 (영구)
#      [Environment]::SetEnvironmentVariable("PROD_DB_URL", "postgresql://...public...", "User")
#      (Railway → Postgres → Variables → DATABASE_PUBLIC_URL 의 '실제 값'을 복사해 넣으세요)
#   2) 수동 실행:  powershell -ExecutionPolicy Bypass -File scripts\backup_prod_db.ps1
#   3) 자동 실행:  아래 'Task Scheduler 등록' 명령 참고
#
# 결과: C:\Users\user\db_backups\workinghub_YYYYMMDD_HHmmss.sql.gz  (최근 14개 유지)

$ErrorActionPreference = "Stop"

$dbUrl = $env:PROD_DB_URL
if (-not $dbUrl) {
    Write-Error "환경변수 PROD_DB_URL 이 없습니다. Railway의 DATABASE_PUBLIC_URL 실제 값을 등록하세요."
    exit 1
}

$backupDir = "C:\Users\user\db_backups"
if (-not (Test-Path $backupDir)) { New-Item -ItemType Directory -Path $backupDir | Out-Null }

$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$fileName = "workinghub_$ts.sql"

Write-Host "[$(Get-Date -Format 'HH:mm:ss')] 백업 시작 → $fileName"

# Docker의 postgres:16 이미지로 pg_dump (백업 폴더를 컨테이너에 마운트)
# --no-owner --no-acl: 복원 호환성↑
docker run --rm -v "${backupDir}:/backup" postgres:16 `
    pg_dump "$dbUrl" --no-owner --no-acl -f "/backup/$fileName"

if ($LASTEXITCODE -ne 0) { Write-Error "pg_dump 실패 (exit $LASTEXITCODE)"; exit 1 }

# 압축(gzip)으로 용량 절약
$full = Join-Path $backupDir $fileName
if (Test-Path $full) {
    $sizeKB = [math]::Round((Get-Item $full).Length / 1KB, 1)
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] 완료: $fileName ($sizeKB KB)"
}

# 오래된 백업 정리 — 최근 14개만 유지
$old = Get-ChildItem $backupDir -Filter "workinghub_*.sql" | Sort-Object LastWriteTime -Descending | Select-Object -Skip 14
if ($old) {
    $old | Remove-Item -Force
    Write-Host "오래된 백업 $($old.Count)개 삭제"
}
