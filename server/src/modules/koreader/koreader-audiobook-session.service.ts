import { Injectable, Logger } from '@nestjs/common';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { AchievementEventsService, ACHIEVEMENT_EVENT_BOOK_PROGRESS_CHANGED } from '../achievement/achievement-events.service';
import { KoreaderAudiobookSessionRepository, type AudiobookExternalSyncTarget } from './koreader-audiobook-session.repository';

const EVENT = 'koreader.audiobook_session';

@Injectable()
export class KoreaderAudiobookSessionService {
  private readonly logger = new Logger(KoreaderAudiobookSessionService.name);

  constructor(
    private readonly repo: KoreaderAudiobookSessionRepository,
    private readonly achievementEvents: AchievementEventsService,
  ) {}

  async recordProgress(params: {
    userId: number;
    bookFileId: number;
    bookId: number;
    libraryId: number;
    device: string;
    deviceId: string;
    progress: number;
  }): Promise<void> {
    const syncTargets = await this.repo.recordProgress(params);
    this.emitExternalSyncTargets(syncTargets, 'finalized-previous');
    this.logger.debug(
      `[${EVENT}] [record] userId=${params.userId} bookFileId=${params.bookFileId} deviceId=${sanitizeLogValue(params.deviceId, 24)} progress=${params.progress} - audiobook progress recorded`,
    );
  }

  async finalizeDueSessions(): Promise<{ finalized: number; skipped: number }> {
    const result = await this.repo.finalizeDueSessions();
    this.emitExternalSyncTargets(result.syncTargets, 'idle');
    if (result.finalized > 0 || result.skipped > 0) {
      this.logger.log(
        `[${EVENT}] [finalize] finalized=${result.finalized} skipped=${result.skipped} externalSyncs=${result.syncTargets.length} - audiobook sessions finalized`,
      );
    }
    return { finalized: result.finalized, skipped: result.skipped };
  }

  async flushLateNightExternalSyncs(): Promise<number> {
    const syncTargets = await this.repo.flushLateNightExternalSyncs();
    this.emitExternalSyncTargets(syncTargets, 'late-night');
    if (syncTargets.length > 0) {
      this.logger.log(`[${EVENT}] [external_sync] reason=late-night count=${syncTargets.length} - audiobook progress syncs flushed`);
    }
    return syncTargets.length;
  }

  private emitExternalSyncTargets(syncTargets: AudiobookExternalSyncTarget[], reason: string): void {
    for (const target of syncTargets) {
      this.achievementEvents.emit(ACHIEVEMENT_EVENT_BOOK_PROGRESS_CHANGED, {
        userId: target.userId,
        bookId: target.bookId,
        bookFileId: target.bookFileId,
        progress: target.progress,
        source: 'audiobook',
      });
    }

    if (syncTargets.length > 0) {
      this.logger.debug(`[${EVENT}] [external_sync] reason=${reason} count=${syncTargets.length} - queued integration progress syncs`);
    }
  }
}
