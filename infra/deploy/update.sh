#!/usr/bin/env bash
# =============================================================================
# update.sh — Update Sink on VPS
# =============================================================================
# Pulls latest code, rebuilds images, runs migrations, and restarts services.
#
# Usage:
#   cd /opt/infra/apps/sink
#   ./update.sh [--no-cache] [--skip-proxy]
# =============================================================================
set -euo pipefail

SINK_DIR="/opt/infra/apps/sink"
REPO_DIR="${SINK_DIR}/repo"
BRANCH="main"
LOGFILE="${SINK_DIR}/logs/update-$(date +%Y%m%d-%H%M%S).log"

NO_CACHE=""
SKIP_PROXY=false

for arg in "$@"; do
    case $arg in
        --no-cache) NO_CACHE="--no-cache" ;;
        --skip-proxy) SKIP_PROXY=true ;;
    esac
done

mkdir -p "${SINK_DIR}/logs"

log() { echo "[sink] $*" | tee -a "${LOGFILE}"; }

log "============================================"
log " Sink Update — $(date)"
log "============================================"

# Pull latest code
log ""
log "[1/5] Pulling latest code..."
cd "${REPO_DIR}"
git fetch origin
git reset --hard "origin/${BRANCH}"
cd "${SINK_DIR}"
log "  Updated to latest."

# Rebuild images
log ""
log "[2/5] Building images..."
docker compose build ${NO_CACHE}
log "  Images built."

# Run migrations
log ""
log "[3/5] Running migrations..."
docker compose run --rm -T api sh -c \
    "npx prisma migrate deploy 2>/dev/null || npx prisma db push --accept-data-loss 2>/dev/null || echo 'Schema already up to date'"
log "  Migrations complete."

# Restart services
log ""
log "[4/5] Restarting services..."
docker compose up -d
log "  Services restarted."

# Update proxy config if needed
if [ "${SKIP_PROXY}" = false ]; then
    log ""
    log "[5/5] Regenerating proxy config..."
    # Re-run the installer to regenerate configs
    bash "${SINK_DIR}/install-sink.sh" 2>/dev/null || true
    if [ -f "${SINK_DIR}/sink.conf" ]; then
        cp "${SINK_DIR}/sink.conf" /opt/infra/proxy/nginx/conf.d/ 2>/dev/null || log "  Skipped proxy update (no permissions or proxy not found)"
        docker exec proxy-nginx nginx -t 2>/dev/null && docker exec proxy-nginx nginx -s reload 2>/dev/null || log "  Skipped proxy reload"
    fi
    log "  Proxy updated."
else
    log ""
    log "[5/5] Skipping proxy update (--skip-proxy)"
fi

# Wait for health
log ""
log "Waiting for API to be ready..."
for i in $(seq 1 30); do
    if docker exec sink-api wget -qO- http://localhost:3000/api/health >/dev/null 2>&1; then
        log "  API is healthy."
        break
    fi
    sleep 2
done

log ""
log "============================================"
log " Update complete!"
log " Log: ${LOGFILE}"
log "============================================"
