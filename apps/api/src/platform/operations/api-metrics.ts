import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
@Injectable()
export class ApiMetrics {
  private readonly instanceId = randomUUID();
  private readonly since = new Date();
  private requests = 0;
  private errors = 0;
  private inFlight = 0;
  private duration = 0;
  private readonly errorBuckets = new Map<number, number>();
  recentErrors() {
    const cutoff = Math.floor(Date.now() / 1000) - 300;
    for (const second of this.errorBuckets.keys())
      if (second <= cutoff) this.errorBuckets.delete(second);
    return [...this.errorBuckets.values()].reduce((sum, n) => sum + n, 0);
  }
  begin() {
    this.inFlight++;
    const start = performance.now();
    let finished = false;
    return (status: number) => {
      if (finished) return;
      finished = true;
      this.inFlight--;
      this.requests++;
      if (status >= 500) {
        this.errors++;
        this.recentErrors();
        const second = Math.floor(Date.now() / 1000);
        this.errorBuckets.set(second, (this.errorBuckets.get(second) ?? 0) + 1);
      }
      this.duration += Math.max(0, performance.now() - start);
    };
  }
  snapshot() {
    return {
      instanceId: this.instanceId,
      since: this.since.toISOString(),
      requests: this.requests,
      errors: this.errors,
      inFlight: this.inFlight,
      meanLatencyMs: Math.round(this.duration / Math.max(1, this.requests)),
      requestsPerMinute:
        (this.requests * 60000) / Math.max(60000, Date.now() - +this.since),
    };
  }
}
