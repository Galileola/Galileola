// In-process scheduler: runs engine.tick() every SCHEDULER_INTERVAL_MS (default 60s).
// For serverless hosting, disable it (SCHEDULER_INTERVAL_MS=0) and call POST /api/cron/tick instead.
export function startScheduler(engine, intervalMs) {
  if (!intervalMs) return () => {};
  const run = () => engine.tick().catch((err) => console.error('[scheduler]', err));
  const timer = setInterval(run, intervalMs);
  timer.unref();
  setTimeout(run, 2000).unref();
  return () => clearInterval(timer);
}
