import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { UserStatisticsService } from './user-statistics.service';

const REBUILD_BATCH_DELAY_MS = 25;
const REBUILD_RETRY_BASE_DELAY_MS = 1_000;
const REBUILD_RETRY_MAX_DELAY_MS = 60_000;

@Injectable()
export class UserStatisticsAggregationJob implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(UserStatisticsAggregationJob.name);
  private stopping = false;
  private rebuilding = false;
  private retryTimer: NodeJS.Timeout | null = null;
  private resolveRetryDelay: (() => void) | null = null;

  constructor(private readonly userStatisticsService: UserStatisticsService) {}

  async onApplicationBootstrap() {
    void this.rebuildNoProgressKoreaderDailyStats();
    await this.recomputeRecent();
  }

  onModuleDestroy() {
    this.stopping = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.resolveRetryDelay?.();
    this.resolveRetryDelay = null;
  }

  @Cron('15 * * * *')
  async runHourlyAggregation() {
    await this.recomputeRecent();
  }

  private async rebuildNoProgressKoreaderDailyStats(): Promise<void> {
    if (this.rebuilding) return;
    this.rebuilding = true;
    const startedAt = Date.now();
    let scanned = 0;
    let rebuiltDays = 0;
    let consecutiveFailures = 0;
    this.logger.log('[reading_session.rebuild_no_progress_stats] [start] batchSize=500 - historical stats rebuild started');
    while (!this.stopping) {
      try {
        const result = await this.userStatisticsService.rebuildDailyStatsAffectedByNoProgressKoreaderSessions();
        consecutiveFailures = 0;
        scanned += result.scanned;
        rebuiltDays += result.rebuiltDays;
        if (result.complete) break;
        await new Promise((resolve) => setTimeout(resolve, REBUILD_BATCH_DELAY_MS));
      } catch (error) {
        consecutiveFailures += 1;
        const retryDelayMs = Math.min(REBUILD_RETRY_BASE_DELAY_MS * 2 ** (consecutiveFailures - 1), REBUILD_RETRY_MAX_DELAY_MS);
        const errorClass = error instanceof Error ? error.name : 'UnknownError';
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `[reading_session.rebuild_no_progress_stats] [fail] durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${sanitizeLogValue(message)}" retryDelayMs=${retryDelayMs} - historical stats rebuild failed and will retry`,
        );
        await this.waitForRetry(retryDelayMs);
      }
    }
    this.logger.log(
      `[reading_session.rebuild_no_progress_stats] [end] durationMs=${Date.now() - startedAt} scanned=${scanned} rebuiltDays=${rebuiltDays} stopped=${this.stopping} - historical stats rebuild completed`,
    );
    this.rebuilding = false;
  }

  private waitForRetry(delayMs: number): Promise<void> {
    return new Promise((resolve) => {
      this.resolveRetryDelay = resolve;
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        this.resolveRetryDelay = null;
        resolve();
      }, delayMs);
    });
  }

  private async recomputeRecent() {
    try {
      const result = await this.userStatisticsService.recomputeRecentDailyStats(2);
      if (result.deleted > 0 || result.inserted > 0) {
        this.logger.log(`User daily stats recomputed from ${result.since}: deleted=${result.deleted}, inserted=${result.inserted}`);
      }
    } catch (err) {
      const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : undefined;
      const stack = err instanceof Error ? err.stack : String(err);
      this.logger.error(`User daily stats aggregation failed${cause ? `: ${cause}` : ''}`, stack);
    }
  }
}
