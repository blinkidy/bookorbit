import { Logger } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ACHIEVEMENT_EVENT_BOOK_PROGRESS_CHANGED, type AchievementEventsService } from '../achievement/achievement-events.service';
import { isLateNightFlushWindow, type KoreaderAudiobookSessionRepository } from './koreader-audiobook-session.repository';
import { KoreaderAudiobookSessionService } from './koreader-audiobook-session.service';

const syncTarget = {
  userId: 12,
  bookId: 55,
  bookFileId: 44,
  progress: 37.5,
};

describe('KoreaderAudiobookSessionService', () => {
  let service: KoreaderAudiobookSessionService;
  let repo: {
    recordProgress: ReturnType<typeof vi.fn>;
    finalizeDueSessions: ReturnType<typeof vi.fn>;
    flushLateNightExternalSyncs: ReturnType<typeof vi.fn>;
  };
  let achievementEvents: {
    emit: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    repo = {
      recordProgress: vi.fn().mockResolvedValue([]),
      finalizeDueSessions: vi.fn().mockResolvedValue({ finalized: 0, skipped: 0, syncTargets: [] }),
      flushLateNightExternalSyncs: vi.fn().mockResolvedValue([]),
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

  it('emits delayed progress syncs returned while recording a new audiobook write', async () => {
    repo.recordProgress.mockResolvedValue([syncTarget]);

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

  it('emits progress syncs when idle audiobook sessions finalize', async () => {
    repo.finalizeDueSessions.mockResolvedValue({ finalized: 1, skipped: 0, syncTargets: [syncTarget] });

    const result = await service.finalizeDueSessions();

    expect(result).toEqual({ finalized: 1, skipped: 0 });
    expect(achievementEvents.emit).toHaveBeenCalledWith(ACHIEVEMENT_EVENT_BOOK_PROGRESS_CHANGED, {
      userId: 12,
      bookId: 55,
      bookFileId: 44,
      progress: 37.5,
      source: 'audiobook',
    });
  });

  it('emits one late-night progress sync per repository target', async () => {
    repo.flushLateNightExternalSyncs.mockResolvedValue([syncTarget]);

    const count = await service.flushLateNightExternalSyncs();

    expect(count).toBe(1);
    expect(achievementEvents.emit).toHaveBeenCalledWith(ACHIEVEMENT_EVENT_BOOK_PROGRESS_CHANGED, {
      userId: 12,
      bookId: 55,
      bookFileId: 44,
      progress: 37.5,
      source: 'audiobook',
    });
  });
});

describe('isLateNightFlushWindow', () => {
  it('matches 11:59 PM in the user timezone', () => {
    expect(isLateNightFlushWindow(new Date('2026-06-29T06:59:00.000Z'), 'America/Phoenix')).toBe(true);
  });

  it('does not match other local minutes', () => {
    expect(isLateNightFlushWindow(new Date('2026-06-29T06:58:00.000Z'), 'America/Phoenix')).toBe(false);
  });
});
