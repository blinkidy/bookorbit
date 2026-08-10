import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { UserStatisticsService } from './user-statistics.service';

@Injectable()
export class UserStatisticsAggregationJob implements OnApplicationBootstrap {
  private readonly logger = new Logger(UserStatisticsAggregationJob.name);

  constructor(private readonly userStatisticsService: UserStatisticsService) {}

  async onApplicationBootstrap() {
    await this.rebuildNoProgressKoreaderDailyStats();
    await this.recomputeRecent();
  }

  @Cron('15 * * * *')
  async runHourlyAggregation() {
    await this.recomputeRecent();
  }

  private async rebuildNoProgressKoreaderDailyStats() {
    const startedAt = Date.now();
    this.logger.log('[reading_session.rebuild_no_progress_stats] [start] batchSize=500 - historical stats rebuild started');
    try {
      const result = await this.userStatisticsService.rebuildDailyStatsAffectedByNoProgressKoreaderSessions();
      this.logger.log(
        `[reading_session.rebuild_no_progress_stats] [end] durationMs=${Date.now() - startedAt} scanned=${result.scanned} rebuiltDays=${result.rebuiltDays} - historical stats rebuild completed`,
      );
    } catch (error) {
      const errorClass = error instanceof Error ? error.name : 'UnknownError';
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[reading_session.rebuild_no_progress_stats] [fail] durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${sanitizeLogValue(message)}" - historical stats rebuild failed`,
      );
      throw error;
    }
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
