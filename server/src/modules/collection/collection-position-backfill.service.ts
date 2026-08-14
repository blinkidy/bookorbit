import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { AppSettingsService } from '../app-settings/app-settings.service';
import { CollectionRepository } from './collection.repository';

const BACKFILL_KEY = 'collection_position_backfill_v1';
const BACKFILL_COMPLETE = 'complete';

@Injectable()
export class CollectionPositionBackfillService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CollectionPositionBackfillService.name);

  constructor(
    private readonly repository: CollectionRepository,
    private readonly appSettings: AppSettingsService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if ((await this.appSettings.getValue(BACKFILL_KEY)) === BACKFILL_COMPLETE) return;

    const event = 'collection.position_backfill';
    const startedAt = Date.now();
    this.logger.log(`[${event}] [start] version=1 - collection position backfill started`);

    try {
      const updatedRows = await this.repository.backfillPositionsByLegacyOrder();
      await this.appSettings.setValue(BACKFILL_KEY, BACKFILL_COMPLETE);
      this.logger.log(`[${event}] [end] durationMs=${Date.now() - startedAt} updatedRows=${updatedRows} - collection position backfill completed`);
    } catch (error) {
      const errorClass = error instanceof Error ? error.constructor.name : 'UnknownError';
      const message = sanitizeLogValue(error instanceof Error ? error.message : String(error));
      this.logger.error(
        `[${event}] [fail] durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${message}" - collection position backfill failed`,
      );
      throw error;
    }
  }
}
