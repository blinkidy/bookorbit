import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { KoreaderAudiobookSessionService } from './koreader-audiobook-session.service';

@Injectable()
export class KoreaderAudiobookSessionFinalizerJob {
  private readonly logger = new Logger(KoreaderAudiobookSessionFinalizerJob.name);

  constructor(private readonly audiobookSessions: KoreaderAudiobookSessionService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async run(): Promise<void> {
    try {
      await this.audiobookSessions.finalizeDueSessions();
      await this.audiobookSessions.flushLateNightExternalSyncs();
    } catch (error) {
      const message = sanitizeLogValue(error instanceof Error ? error.message : 'unknown error');
      this.logger.warn(`[koreader.audiobook_session] [fail] error="${message}" - audiobook session finalizer failed`);
    }
  }
}
