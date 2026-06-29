import { Injectable, Logger } from '@nestjs/common';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { KoreaderAudiobookSessionRepository } from './koreader-audiobook-session.repository';

const EVENT = 'koreader.audiobook_session';

@Injectable()
export class KoreaderAudiobookSessionService {
  private readonly logger = new Logger(KoreaderAudiobookSessionService.name);

  constructor(private readonly repo: KoreaderAudiobookSessionRepository) {}

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
    this.logger.debug(
      `[${EVENT}] [record] userId=${params.userId} bookFileId=${params.bookFileId} deviceId=${sanitizeLogValue(params.deviceId, 24)} progress=${params.progress} - audiobook progress recorded`,
    );
  }

  async finalizeDueSessions(): Promise<{ finalized: number; skipped: number }> {
    const result = await this.repo.finalizeDueSessions();
    if (result.finalized > 0 || result.skipped > 0) {
      this.logger.log(`[${EVENT}] [finalize] finalized=${result.finalized} skipped=${result.skipped} - audiobook sessions finalized`);
    }
    return result;
  }
}
