import { Logger } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ACHIEVEMENT_EVENT_BOOK_PROGRESS_CHANGED, type AchievementEventsService } from '../achievement/achievement-events.service';
import type { KoreaderAudiobookSessionRepository } from './koreader-audiobook-session.repository';
import { KoreaderAudiobookSessionService } from './koreader-audiobook-session.service';

describe('KoreaderAudiobookSessionService', () => {
  let service: KoreaderAudiobookSessionService;
  let repo: {
    recordProgress: ReturnType<typeof vi.fn>;
    finalizeDueSessions: ReturnType<typeof vi.fn>;
  };
  let achievementEvents: {
    emit: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    repo = {
      recordProgress: vi.fn().mockResolvedValue([]),
      finalizeDueSessions: vi.fn().mockResolvedValue({ finalized: 0, skipped: 0, syncTargets: [] }),
    };
    achievementEvents = {
      emit: vi.fn(),
    };

    vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    service = new KoreaderAudiobookSessionService(
      repo as unknown as KoreaderAudiobookSessionRepository,
      achievementEvents as unknown as AchievementEventsService,
    );
  });

  it('emits every ABS-KoSync write with the audiobook source for provider debouncing', async () => {
    await service.recordProgress({
      userId: 12,
      bookFileId: 44,
      bookId: 55,
      libraryId: 3,
      device: 'ABS-Kosync',
      deviceId: 'abs-kosync-bedroom',
      progress: 37.5,
    });

    expect(achievementEvents.emit).toHaveBeenCalledWith(ACHIEVEMENT_EVENT_BOOK_PROGRESS_CHANGED, {
      userId: 12,
      bookId: 55,
      bookFileId: 44,
      progress: 37.5,
      source: 'audiobook',
    });
  });

  it('finalizes reading sessions without emitting a second provider progress event', async () => {
    repo.finalizeDueSessions.mockResolvedValue({ finalized: 1, skipped: 0, syncTargets: [] });

    const result = await service.finalizeDueSessions();

    expect(result).toEqual({ finalized: 1, skipped: 0 });
    expect(achievementEvents.emit).not.toHaveBeenCalled();
  });
});
