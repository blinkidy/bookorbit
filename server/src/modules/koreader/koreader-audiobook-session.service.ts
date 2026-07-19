import { Injectable, Logger } from '@nestjs/common';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { AchievementEventsService, ACHIEVEMENT_EVENT_BOOK_PROGRESS_CHANGED } from '../achievement/achievement-events.service';
import { KoreaderAudiobookSessionRepository } from './koreader-audiobook-session.repository';

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
    await this.repo.recordProgress(params);
    this.emitAudiobookProgress(params);
    this.logger.debug(
      `[${EVENT}] [record] userId=${params.userId} bookFileId=${params.bookFileId} deviceId=${sanitizeLogValue(params.deviceId, 24)} progress=${params.progress} - audiobook progress recorded`,
    );
  }

  async finalizeDueSessions(): Promise<{ finalized: number; skipped: number }> {
    const result = await this.repo.finalizeDueSessions();
    if (result.finalized > 0 || result.skipped > 0) {
      this.logger.log(`[${EVENT}] [finalize] finalized=${result.finalized} skipped=${result.skipped} - audiobook sessions finalized`);
    }
    return { finalized: result.finalized, skipped: result.skipped };
  }

  private emitAudiobookProgress(target: { userId: number; bookId: number; bookFileId: number; progress: number }): void {
    this.achievementEvents.emit(ACHIEVEMENT_EVENT_BOOK_PROGRESS_CHANGED, {
      userId: target.userId,
      bookId: target.bookId,
      bookFileId: target.bookFileId,
      progress: target.progress,
      source: 'audiobook',
    });
  }
}
