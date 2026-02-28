#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# PromptPay :: Zero-Downtime Deploy Script
# Run on EC2: ./scripts/deploy.sh
# ═══════════════════════════════════════════════════════════════

set -euo pipefail

APP_DIR="/home/ec2-user/PromptPay"
HEALTH_URL="http://127.0.0.1:19000/"
MAX_RETRIES=5
RETRY_INTERVAL=3

cd "$APP_DIR"

echo "══════════════════════════════════════"
echo " PromptPay Deploy — $(date '+%Y-%m-%d %H:%M:%S')"
echo "══════════════════════════════════════"

# ── 1. Backup current dist ──
echo "[1/6] Backing up dist/..."
rm -rf dist.backup
if [ -d dist ]; then
  cp -r dist dist.backup
  echo "  Backup created: dist.backup/"
else
  echo "  No dist/ to backup (first deploy?)"
fi

# ── 2. Pull latest code ──
echo "[2/6] Pulling latest from main..."
git pull origin main

# ── 3. Install dependencies ──
echo "[3/6] Installing dependencies..."
npm ci --production=false

# ── 4. Compile TypeScript ──
echo "[4/6] Compiling TypeScript..."
npx tsc
echo "  Build complete: dist/"

# ── 5. Reload PM2 (zero-downtime) ──
echo "[5/6] Reloading PM2 cluster..."
pm2 reload ecosystem.config.cjs --env production

# ── 6. Health check ──
echo "[6/6] Running health checks..."
HEALTHY=false
for i in $(seq 1 $MAX_RETRIES); do
  sleep $RETRY_INTERVAL
  STATUS=$(curl -s -o /dev/null -w '%{http_code}' "$HEALTH_URL" 2>/dev/null || echo "000")
  if [ "$STATUS" = "200" ]; then
    HEALTHY=true
    echo "  Health check passed (attempt $i/$MAX_RETRIES)"
    break
  else
    echo "  Health check $i/$MAX_RETRIES — status: $STATUS (retrying...)"
  fi
done

if [ "$HEALTHY" = true ]; then
  echo ""
  echo "══════════════════════════════════════"
  echo " Deploy SUCCESS"
  echo " $(date '+%Y-%m-%d %H:%M:%S')"
  echo "══════════════════════════════════════"
  # Clean up backup on success
  rm -rf dist.backup
  exit 0
else
  echo ""
  echo "══════════════════════════════════════"
  echo " Deploy FAILED — Rolling back..."
  echo "══════════════════════════════════════"

  if [ -d dist.backup ]; then
    rm -rf dist
    mv dist.backup dist
    echo "  Restored dist from backup"
    pm2 reload ecosystem.config.cjs --env production
    echo "  PM2 reloaded with previous build"
  else
    echo "  No backup available — manual intervention needed"
  fi

  exit 1
fi
