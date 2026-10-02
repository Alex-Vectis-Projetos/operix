import { reconcileExpiredWeeklogs } from "../services/weeklogService.js";

let runnerInterval: NodeJS.Timeout | null = null;
let isRunning = false;

/**
 * Executes startup catch-up for all expired weeklogs across all workspaces.
 * Must run before normal HTTP readiness.
 */
export async function runStartupCatchup(): Promise<void> {
  if (isRunning) return;
  isRunning = true;
  try {
    console.log("[weekCloseRunner] Running startup week closure catchup...");
    await reconcileExpiredWeeklogs();
    console.log("[weekCloseRunner] Startup week closure catchup completed successfully.");
  } catch (err) {
    console.error("[weekCloseRunner] Startup week closure catchup error:", err);
  } finally {
    isRunning = false;
  }
}

/**
 * Starts the periodic background runner (default every 60 seconds).
 */
export function startPeriodicCloseRunner(intervalMs = 60_000): NodeJS.Timeout {
  if (runnerInterval) {
    clearInterval(runnerInterval);
  }

  runnerInterval = setInterval(async () => {
    if (isRunning) return;
    isRunning = true;
    try {
      await reconcileExpiredWeeklogs();
    } catch (err) {
      console.error("[weekCloseRunner] Periodic reconciliation error:", err);
    } finally {
      isRunning = false;
    }
  }, intervalMs);

  return runnerInterval;
}

/**
 * Stops the periodic background runner if active.
 */
export function stopPeriodicCloseRunner(): void {
  if (runnerInterval) {
    clearInterval(runnerInterval);
    runnerInterval = null;
  }
}
