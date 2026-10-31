#!/usr/bin/env bash
set -e

export TMPDIR=/tmp
export BUN_TMPDIR=/tmp
export NODE_OPTIONS="--max-old-space-size=4096"

echo "===================================="
echo "Running type check and build verification..."
echo "===================================="

# [1/8] Running type check (tsc --noEmit)...
echo ""
echo "[1/8] Running type check (tsc --noEmit)..."
T1=$(node -e "console.log(Date.now())")
bun x tsc --noEmit
T2=$(node -e "console.log(Date.now())")
node -e "console.log('\x1b[36m=> Type check completed in ' + (($T2 - $T1)/1000).toFixed(2) + ' seconds\x1b[0m')"

# [2/8] Running format...
echo ""
echo "[2/8] Running format..."
T1=$(node -e "console.log(Date.now())")
bun run format
T2=$(node -e "console.log(Date.now())")
node -e "console.log('\x1b[36m=> Format completed in ' + (($T2 - $T1)/1000).toFixed(2) + ' seconds\x1b[0m')"

# [3/8] Running lint...
echo ""
echo "[3/8] Running lint..."
T1=$(node -e "console.log(Date.now())")
bun run lint --fix
T2=$(node -e "console.log(Date.now())")
node -e "console.log('\x1b[36m=> Lint completed in ' + (($T2 - $T1)/1000).toFixed(2) + ' seconds\x1b[0m')"

# [4/8] Running architectural dependency check (dependency-cruiser)...
echo ""
echo "[4/8] Running architectural dependency check..."
T1=$(node -e "console.log(Date.now())")
bun run lint:arch
T2=$(node -e "console.log(Date.now())")
node -e "console.log('\x1b[36m=> Architecture check completed in ' + (($T2 - $T1)/1000).toFixed(2) + ' seconds\x1b[0m')"

# [5/8] Running dead-code & unused-file check (knip)...
echo ""
echo "[5/8] Running dead-code & unused-file check..."
T1=$(node -e "console.log(Date.now())")
bun run lint:deadcode
T2=$(node -e "console.log(Date.now())")
node -e "console.log('\x1b[36m=> Dead-code check completed in ' + (($T2 - $T1)/1000).toFixed(2) + ' seconds\x1b[0m')"

# [6/8] Running regression tests...
echo ""
echo "[6/8] Running regression tests..."
T1=$(node -e "console.log(Date.now())")
bun test
T2=$(node -e "console.log(Date.now())")
node -e "console.log('\x1b[36m=> Regression tests completed in ' + (($T2 - $T1)/1000).toFixed(2) + ' seconds\x1b[0m')"

# [7/8] Running build...
echo ""
echo "[7/8] Running build..."
T1=$(node -e "console.log(Date.now())")
bun run build
T2=$(node -e "console.log(Date.now())")
node -e "console.log('\x1b[36m=> Build completed in ' + (($T2 - $T1)/1000).toFixed(2) + ' seconds\x1b[0m')"

# [8/8] Running campaign validation...
echo ""
echo "[8/8] Running campaign validation..."
T1=$(node -e "console.log(Date.now())")
bun run scripts/run-validator.ts
T2=$(node -e "console.log(Date.now())")
node -e "console.log('\x1b[36m=> Campaign validation completed in ' + (($T2 - $T1)/1000).toFixed(2) + ' seconds\x1b[0m')"

echo ""
echo "[SUCCESS] All checks passed!"
exit 0
