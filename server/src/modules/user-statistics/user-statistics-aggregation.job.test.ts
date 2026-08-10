import { Logger } from '@nestjs/common';

import { UserStatisticsAggregationJob } from './user-statistics-aggregation.job';

describe('UserStatisticsAggregationJob', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('recomputes on bootstrap and logs when rows changed', async () => {
    const service = {
      rebuildDailyStatsAffectedByNoProgressKoreaderSessions: vi.fn().mockResolvedValue({
        scanned: 2,
        rebuiltDays: 1,
      }),
      recomputeRecentDailyStats: vi.fn().mockResolvedValue({
        deleted: 2,
        inserted: 3,
        since: '2026-04-09',
      }),
    };
    const logSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    const job = new UserStatisticsAggregationJob(service as never);
    await job.onApplicationBootstrap();

    expect(service.rebuildDailyStatsAffectedByNoProgressKoreaderSessions).toHaveBeenCalledOnce();
    expect(service.recomputeRecentDailyStats).toHaveBeenCalledWith(2);
    expect(service.rebuildDailyStatsAffectedByNoProgressKoreaderSessions.mock.invocationCallOrder[0]).toBeLessThan(
      service.recomputeRecentDailyStats.mock.invocationCallOrder[0]!,
    );
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('deleted=2, inserted=3'));
  });

  it('fails bootstrap when historical daily stats cannot be rebuilt', async () => {
    const failure = new Error('rebuild failed');
    const service = {
      rebuildDailyStatsAffectedByNoProgressKoreaderSessions: vi.fn().mockRejectedValue(failure),
      recomputeRecentDailyStats: vi.fn(),
    };
    const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const job = new UserStatisticsAggregationJob(service as never);

    await expect(job.onApplicationBootstrap()).rejects.toBe(failure);
    expect(service.recomputeRecentDailyStats).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[reading_session.rebuild_no_progress_stats] [fail]'));
  });

  it('runs hourly without chatty logs when no rows changed', async () => {
    const service = {
      recomputeRecentDailyStats: vi.fn().mockResolvedValue({
        deleted: 0,
        inserted: 0,
        since: '2026-04-09',
      }),
    };
    const logSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    const job = new UserStatisticsAggregationJob(service as never);
    await job.runHourlyAggregation();

    expect(service.recomputeRecentDailyStats).toHaveBeenCalledWith(2);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('logs failures with root cause details', async () => {
    const service = {
      recomputeRecentDailyStats: vi.fn().mockRejectedValue(new Error('aggregation failed', { cause: new Error('db timeout') })),
    };
    const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const job = new UserStatisticsAggregationJob(service as never);
    await job.runHourlyAggregation();

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('db timeout'), expect.any(String));
  });
});
