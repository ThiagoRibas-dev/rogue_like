#!/usr/bin/env bash
set -e

export TMPDIR=/tmp
export BUN_TMPDIR=/tmp
export NODE_OPTIONS="--max-old-space-size=4096"

echo "===================================="
echo "Running type check and build verification..."
echo "===================================="

# [1/4] Running format...
echo ""
echo "[1/4] Running format..."
T1=$(node -e "console.log(Date.now())")
bun run format
T2=$(node -e "console.log(Date.now())")
node -e "console.log('\x1b[36m=> Format completed in ' + (($T2 - $T1)/1000).toFixed(2) + ' seconds\x1b[0m')"

# [2/4] Running lint...
echo ""
echo "[2/4] Running lint..."
T1=$(node -e "console.log(Date.now())")
bun run lint --fix
T2=$(node -e "console.log(Date.now())")
node -e "console.log('\x1b[36m=> Lint completed in ' + (($T2 - $T1)/1000).toFixed(2) + ' seconds\x1b[0m')"

# [3/4] Running build...
echo ""
echo "[3/4] Running build..."
T1=$(node -e "console.log(Date.now())")
bun run build
T2=$(node -e "console.log(Date.now())")
node -e "console.log('\x1b[36m=> Build completed in ' + (($T2 - $T1)/1000).toFixed(2) + ' seconds\x1b[0m')"

# [4/4] Running campaign validation...
echo ""
echo "[4/4] Running campaign validation..."
T1=$(node -e "console.log(Date.now())")
bun run scripts/run-validator.ts
T2=$(node -e "console.log(Date.now())")
node -e "console.log('\x1b[36m=> Campaign validation completed in ' + (($T2 - $T1)/1000).toFixed(2) + ' seconds\x1b[0m')"

echo ""
echo "[SUCCESS] All checks passed!"
exit 0
