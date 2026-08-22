import type { CycleHealthReport } from "./notify";

export class StageRunner {
  private stages: CycleHealthReport["stages"] = {};
  private runId: string;
  private startedAt: Date;

  constructor(runId: string) {
    this.runId = runId;
    this.startedAt = new Date();
  }

  // Runs one stage in isolation: a thrown error is captured (not propagated),
  // so one failing stage never stops the rest of the cycle from running.
  async run<T>(name: string, fn: () => Promise<T>): Promise<T | null> {
    const start = Date.now();
    try {
      const result = await fn();
      this.stages[name] = { status: "ok", durationMs: Date.now() - start, detail: result };
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.stages[name] = { status: "error", durationMs: Date.now() - start, error: message };
      console.error(`Cycle stage "${name}" failed:`, err);
      return null;
    }
  }

  skip(name: string, reason: string) {
    this.stages[name] = { status: "skipped", durationMs: 0, detail: reason };
  }

  finish(): CycleHealthReport {
    const finishedAt = new Date();
    return {
      runId: this.runId,
      startedAt: this.startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - this.startedAt.getTime(),
      stages: this.stages,
    };
  }
}
