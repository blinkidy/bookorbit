import { CollectionPositionBackfillService } from './collection-position-backfill.service';

describe('CollectionPositionBackfillService', () => {
  const repository = {
    backfillPositionsByLegacyOrder: vi.fn(),
  };
  const appSettings = {
    getValue: vi.fn(),
    setValue: vi.fn(),
  };

  let service: CollectionPositionBackfillService;

  beforeEach(() => {
    vi.resetAllMocks();
    repository.backfillPositionsByLegacyOrder.mockResolvedValue(8);
    appSettings.getValue.mockResolvedValue(null);
    appSettings.setValue.mockResolvedValue(undefined);
    service = new CollectionPositionBackfillService(repository as never, appSettings as never);
  });

  it('restores legacy collection order once before the application starts', async () => {
    await service.onApplicationBootstrap();

    expect(repository.backfillPositionsByLegacyOrder).toHaveBeenCalledOnce();
    expect(appSettings.setValue).toHaveBeenCalledWith('collection_position_backfill_v1', 'complete');
  });

  it('skips a completed backfill', async () => {
    appSettings.getValue.mockResolvedValue('complete');

    await service.onApplicationBootstrap();

    expect(repository.backfillPositionsByLegacyOrder).not.toHaveBeenCalled();
    expect(appSettings.setValue).not.toHaveBeenCalled();
  });

  it('does not mark a failed backfill complete', async () => {
    const error = new Error('database unavailable');
    repository.backfillPositionsByLegacyOrder.mockRejectedValue(error);

    await expect(service.onApplicationBootstrap()).rejects.toBe(error);

    expect(appSettings.setValue).not.toHaveBeenCalled();
  });
});
