@echo off
setlocal
call D:\SHARED\environment.bat

echo ====================================
echo Running type check and build verification...
echo ====================================
set NODE_OPTIONS=--max-old-space-size=4096

echo [1/6] Running type check (tsc --noEmit)...
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
echo [2/6] Running format...
for /f %%a in ('powershell -NoProfile -Command "(Get-Date).Ticks"') do set T1=%%a
call bun run format
for /f %%a in ('powershell -NoProfile -Command "(Get-Date).Ticks"') do set T2=%%a
powershell -NoProfile -Command "Write-Host ('=> Format completed in {0:N2} seconds' -f (([long]%T2% - [long]%T1%) / 10000000)) -ForegroundColor Cyan"

echo.
echo [3/6] Running lint...
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
echo [4/6] Running regression tests...
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
echo [5/6] Running build...
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
echo [6/6] Running campaign validation...
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
