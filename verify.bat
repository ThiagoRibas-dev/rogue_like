@echo off
setlocal
call D:\SHARED\environment.bat

echo ====================================
echo Running type check and build verification...
echo ====================================
set NODE_OPTIONS=--max-old-space-size=4096
set KNIP_DISABLE_RAW_TRANSFER=1

echo [1/8] Running type check (tsc --noEmit)...
for /f %%a in ('powershell -NoProfile -Command "(Get-Date).Ticks"') do set T1=%%a
call bun x tsc --noEmit
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] TypeScript check failed!
    exit /b %errorlevel%
)
for /f %%a in ('powershell -NoProfile -Command "(Get-Date).Ticks"') do set T2=%%a
powershell -NoProfile -Command "Write-Host ('=> Type check completed in {0:N2} seconds' -f (([long]%T2% - [long]%T1%) / 10000000)) -ForegroundColor Cyan"

echo.
echo [2/8] Running format...
for /f %%a in ('powershell -NoProfile -Command "(Get-Date).Ticks"') do set T1=%%a
call bun run format
for /f %%a in ('powershell -NoProfile -Command "(Get-Date).Ticks"') do set T2=%%a
powershell -NoProfile -Command "Write-Host ('=> Format completed in {0:N2} seconds' -f (([long]%T2% - [long]%T1%) / 10000000)) -ForegroundColor Cyan"

echo.
echo [3/8] Running lint...
for /f %%a in ('powershell -NoProfile -Command "(Get-Date).Ticks"') do set T1=%%a
call bun run lint --fix
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] ESLint check failed!
    exit /b %errorlevel%
)
for /f %%a in ('powershell -NoProfile -Command "(Get-Date).Ticks"') do set T2=%%a
powershell -NoProfile -Command "Write-Host ('=> Lint completed in {0:N2} seconds' -f (([long]%T2% - [long]%T1%) / 10000000)) -ForegroundColor Cyan"

echo.
echo [4/8] Running architectural dependency check...
for /f %%a in ('powershell -NoProfile -Command "(Get-Date).Ticks"') do set T1=%%a
call bun run lint:arch
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Architectural dependency check failed!
    exit /b %errorlevel%
)
for /f %%a in ('powershell -NoProfile -Command "(Get-Date).Ticks"') do set T2=%%a
powershell -NoProfile -Command "Write-Host ('=> Architecture check completed in {0:N2} seconds' -f (([long]%T2% - [long]%T1%) / 10000000)) -ForegroundColor Cyan"

echo.
echo [4b/8] Checking file lengths (<= 300 lines warning check)...
call bun run lint:filelength

echo.
echo [5/8] Running dead-code & unused-file check...
for /f %%a in ('powershell -NoProfile -Command "(Get-Date).Ticks"') do set T1=%%a
call bun run lint:deadcode
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Dead-code check failed!
    exit /b %errorlevel%
)
for /f %%a in ('powershell -NoProfile -Command "(Get-Date).Ticks"') do set T2=%%a
powershell -NoProfile -Command "Write-Host ('=> Dead-code check completed in {0:N2} seconds' -f (([long]%T2% - [long]%T1%) / 10000000)) -ForegroundColor Cyan"

echo.
echo [6/8] Running regression tests...
for /f %%a in ('powershell -NoProfile -Command "(Get-Date).Ticks"') do set T1=%%a
call bun test
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Regression tests failed!
    exit /b %errorlevel%
)
for /f %%a in ('powershell -NoProfile -Command "(Get-Date).Ticks"') do set T2=%%a
powershell -NoProfile -Command "Write-Host ('=> Regression tests completed in {0:N2} seconds' -f (([long]%T2% - [long]%T1%) / 10000000)) -ForegroundColor Cyan"

echo.
echo [7/8] Running build...
for /f %%a in ('powershell -NoProfile -Command "(Get-Date).Ticks"') do set T1=%%a
call bun run build
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Verification failed!
    exit /b %errorlevel%
)
for /f %%a in ('powershell -NoProfile -Command "(Get-Date).Ticks"') do set T2=%%a
powershell -NoProfile -Command "Write-Host ('=> Build completed in {0:N2} seconds' -f (([long]%T2% - [long]%T1%) / 10000000)) -ForegroundColor Cyan"

echo.
echo [8/8] Running campaign validation...
for /f %%a in ('powershell -NoProfile -Command "(Get-Date).Ticks"') do set T1=%%a
call bun run scripts/run-validator.ts
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Campaign validation failed!
    exit /b %errorlevel%
)
for /f %%a in ('powershell -NoProfile -Command "(Get-Date).Ticks"') do set T2=%%a
powershell -NoProfile -Command "Write-Host ('=> Campaign validation completed in {0:N2} seconds' -f (([long]%T2% - [long]%T1%) / 10000000)) -ForegroundColor Cyan"

echo.
echo [SUCCESS] All checks passed!
exit /b 0
