@echo off
setlocal
rem ============================================================
rem  Working Hub - local server launcher (double-click to run)
rem  1) PostgreSQL (localhost:5432)  2) Backend :8000  3) Frontend :3000
rem ============================================================
cd /d "%~dp0"
set ROOT=%~dp0

echo.
echo [1/3] Checking database (localhost:5432)...
powershell -NoProfile -Command "if ((Test-NetConnection localhost -Port 5432 -WarningAction SilentlyContinue).TcpTestSucceeded) { exit 0 } else { exit 1 }"
if %errorlevel%==0 goto db_ok

where docker >nul 2>nul
if errorlevel 1 (
  echo   ! PostgreSQL is not running and Docker is not installed.
  echo     Start your local PostgreSQL service, or install Docker Desktop, then run this again.
  pause
  exit /b 1
)
echo   Starting PostgreSQL with Docker...
docker compose up -d db
if errorlevel 1 (
  echo   ! Docker could not start the DB. Open Docker Desktop first, wait until it says "running", then run this again.
  pause
  exit /b 1
)
echo   Waiting for the DB to be ready...
set /a TRIES=0
:wait_db
timeout /t 2 /nobreak >nul
powershell -NoProfile -Command "if ((Test-NetConnection localhost -Port 5432 -WarningAction SilentlyContinue).TcpTestSucceeded) { exit 0 } else { exit 1 }"
if %errorlevel%==0 goto db_ok
set /a TRIES+=1
if %TRIES% lss 30 goto wait_db
echo   ! DB did not start within 60 seconds.
pause
exit /b 1

:db_ok
echo   DB OK.

echo.
echo [2/3] Starting backend (http://localhost:8000) in a new window...
if not exist "%ROOT%backend\venv\Scripts\python.exe" (
  echo   Creating Python venv...
  python -m venv "%ROOT%backend\venv" || (echo   ! Python 3.11 is required. & pause & exit /b 1)
)
start "Working Hub - backend" cmd /k "cd /d "%ROOT%backend" && venv\Scripts\python -m pip install -q -r requirements.txt && venv\Scripts\alembic upgrade head && venv\Scripts\uvicorn app.main:app --reload --port 8000"

echo.
echo [3/3] Starting frontend (http://localhost:3000) in a new window...
start "Working Hub - frontend" cmd /k "cd /d "%ROOT%frontend" && (if not exist node_modules npm install) && npm run dev"

echo.
echo Opening the browser in about 20 seconds...
timeout /t 20 /nobreak >nul
start "" http://localhost:3000

echo.
echo Done. To stop: close the two windows "Working Hub - backend" / "Working Hub - frontend".
echo (Docker DB keeps running; stop it with:  docker compose stop db)
echo.
pause
