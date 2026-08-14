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
        lastId: 12,
        complete: true,
        alreadyComplete: false,
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
    await vi.waitFor(() => expect(service.rebuildDailyStatsAffectedByNoProgressKoreaderSessions).toHaveBeenCalledOnce());

    expect(service.rebuildDailyStatsAffectedByNoProgressKoreaderSessions).toHaveBeenCalledOnce();
    expect(service.recomputeRecentDailyStats).toHaveBeenCalledWith(2);
    expect(service.rebuildDailyStatsAffectedByNoProgressKoreaderSessions.mock.invocationCallOrder[0]).toBeLessThan(
      service.recomputeRecentDailyStats.mock.invocationCallOrder[0]!,
    );
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('deleted=2, inserted=3'));
  });

  it('retries historical rebuild failures without blocking bootstrap', async () => {
    vi.useFakeTimers();
    const failure = new Error('rebuild failed');
    const service = {
      rebuildDailyStatsAffectedByNoProgressKoreaderSessions: vi
        .fn()
        .mockRejectedValueOnce(failure)
        .mockResolvedValue({ scanned: 1, rebuiltDays: 3, lastId: 12, complete: true, alreadyComplete: false }),
      recomputeRecentDailyStats: vi.fn().mockResolvedValue({ deleted: 0, inserted: 0, since: '2026-04-09' }),
    };
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const job = new UserStatisticsAggregationJob(service as never);

    await expect(job.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('retryDelayMs=1000'));
    expect(service.recomputeRecentDailyStats).toHaveBeenCalledWith(2);

    await vi.advanceTimersByTimeAsync(1_000);

    expect(service.rebuildDailyStatsAffectedByNoProgressKoreaderSessions).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('does not wait for a historical rebuild before bootstrap completes', async () => {
    let finishRebuild!: (value: { scanned: number; rebuiltDays: number; lastId: number; complete: boolean; alreadyComplete: boolean }) => void;
    const rebuildPromise = new Promise<Parameters<typeof finishRebuild>[0]>((resolve) => {
      finishRebuild = resolve;
    });
    const service = {
      rebuildDailyStatsAffectedByNoProgressKoreaderSessions: vi.fn().mockReturnValue(rebuildPromise),
      recomputeRecentDailyStats: vi.fn().mockResolvedValue({ deleted: 0, inserted: 0, since: '2026-04-09' }),
    };
    const logSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    const job = new UserStatisticsAggregationJob(service as never);

    await expect(job.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(service.rebuildDailyStatsAffectedByNoProgressKoreaderSessions).toHaveBeenCalledOnce();

    finishRebuild({ scanned: 1, rebuiltDays: 1, lastId: 9, complete: true, alreadyComplete: false });
    await vi.waitFor(() => expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[reading_session.rebuild_no_progress_stats] [end]')));
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
