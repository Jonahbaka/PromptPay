// ═══════════════════════════════════════════════════════════════
// PromptPay :: Cluster Utilities
// PM2 cluster-mode awareness for zero-downtime deploys
// ═══════════════════════════════════════════════════════════════

/**
 * Get the current PM2 worker instance ID.
 * Returns 0 for non-cluster (fork) mode.
 */
export function getWorkerId(): number {
  return Number(process.env.NODE_APP_INSTANCE ?? process.env.pm_id ?? 0);
}

/**
 * True for worker 0 — singletons (Telegram polling, daemon loop)
 * should only run on the primary worker to avoid 409 conflicts.
 */
export function isPrimaryWorker(): boolean {
  return getWorkerId() === 0;
}

/**
 * Signal PM2 that this worker is ready to accept connections.
 * Used with `wait_ready: true` in ecosystem config for graceful reload.
 */
export function signalReady(): void {
  if (typeof process.send === 'function') {
    process.send('ready');
  }
}
