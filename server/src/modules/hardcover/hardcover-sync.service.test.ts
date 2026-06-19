import { Logger } from '@nestjs/common';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { HardcoverSyncService } from './hardcover-sync.service';

const mockRepo = {
  findBookState: vi.fn(),
  findBookStatesByBookIds: vi.fn(),
  upsertBookState: vi.fn(),
  updateLastSyncedAt: vi.fn(),
  findSyncableBooks: vi.fn(),
  findSyncableBook: vi.fn(),
  clearBookMatch: vi.fn(),
};

const mockClient = {
  query: vi.fn(),
};

const mockMatchService = {
  matchBook: vi.fn(),
  resolveManualInput: vi.fn(),
  getEditions: vi.fn(),
};

const mockSettingsService = {
  getTokenForUser: vi.fn(),
  getSettings: vi.fn(),
};

function makeService() {
  return new HardcoverSyncService(mockRepo as any, mockClient as any, mockMatchService as any, mockSettingsService as any);
}

const defaultSettings = {
  tokenConfigured: true,
  enabled: true,
  autoSyncOnStatusChange: true,
  autoSyncOnProgressUpdate: true,
  autoSyncOnRatingChange: true,
  privacySettingId: 3,
};

const readingBook = {
  bookId: 1,
  isbn13: '9781234567890',
  isbn10: null,
  title: 'Book One',
  authorName: 'Author One',
  hardcoverMetadataId: null,
  status: 'reading',
  startedAt: new Date('2024-01-01'),
  finishedAt: null,
  rating: null,
  progress: 42,
};

describe('HardcoverSyncService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRepo.findBookState.mockResolvedValue(undefined);
    mockRepo.findBookStatesByBookIds.mockResolvedValue([]);
    mockRepo.findSyncableBooks.mockResolvedValue([]);
    mockRepo.findSyncableBook.mockResolvedValue(null);
    mockRepo.upsertBookState.mockResolvedValue({});
    mockRepo.updateLastSyncedAt.mockResolvedValue(undefined);
    mockRepo.clearBookMatch.mockResolvedValue(undefined);
    mockSettingsService.getSettings.mockResolvedValue(defaultSettings);
  });

  describe('syncBook', () => {
    it('does nothing when no token', async () => {
      mockSettingsService.getTokenForUser.mockResolvedValue(null);
      await makeService().syncBook(1, 1);
      expect(mockRepo.findSyncableBook).not.toHaveBeenCalled();
    });

    it('does nothing when book not found', async () => {
      mockSettingsService.getTokenForUser.mockResolvedValue('tok');
      mockRepo.findSyncableBook.mockResolvedValue(null);
      await makeService().syncBook(1, 1);
      expect(mockMatchService.matchBook).not.toHaveBeenCalled();
    });

    it('does nothing for unread status', async () => {
      mockSettingsService.getTokenForUser.mockResolvedValue('tok');
      mockRepo.findSyncableBook.mockResolvedValue({ ...readingBook, status: 'unread' });
      await expect(makeService().syncBook(1, 1)).resolves.toBe('skipped');
      expect(mockMatchService.matchBook).not.toHaveBeenCalled();
    });

    it('skips when the local sync snapshot has no changes', async () => {
      mockSettingsService.getTokenForUser.mockResolvedValue('tok');
      mockRepo.findSyncableBook.mockResolvedValue(readingBook);
      mockRepo.findBookState.mockResolvedValue({
        lastSyncedAt: new Date('2024-02-01T00:00:00Z'),
        lastSyncedStatus: 'reading',
        lastSyncedProgress: 42,
        lastSyncedRating: null,
        lastSyncedStartedAt: '2024-01-01',
        lastSyncedFinishedAt: null,
      });

      await expect(makeService().syncBook(1, 1)).resolves.toBe('skipped');

      expect(mockMatchService.matchBook).not.toHaveBeenCalled();
      expect(mockClient.query).not.toHaveBeenCalled();
    });

    it('retries an unchanged snapshot when a Hardcover metadata id was added after a failed match', async () => {
      const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const bookWithMetadataId = { ...readingBook, hardcoverMetadataId: 'fyrebirds' };
      mockSettingsService.getTokenForUser.mockResolvedValue('tok');
      mockRepo.findSyncableBook.mockResolvedValue(bookWithMetadataId);
      mockRepo.findBookState.mockResolvedValue({
        hardcoverBookId: null,
        syncError: 'no_match',
        lastSyncedAt: new Date('2024-02-01T00:00:00Z'),
        lastSyncedStatus: 'reading',
        lastSyncedProgress: 42,
        lastSyncedRating: null,
        lastSyncedStartedAt: '2024-01-01',
        lastSyncedFinishedAt: null,
      });
      mockMatchService.matchBook.mockResolvedValue(null);

      await expect(makeService().syncBook(1, 1)).resolves.toBe('skipped');

      expect(mockMatchService.matchBook).toHaveBeenCalledWith(1, 'tok', bookWithMetadataId);
      warnSpy.mockRestore();
    });

    it('stores no_match error when match fails', async () => {
      const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      mockSettingsService.getTokenForUser.mockResolvedValue('tok');
      mockRepo.findSyncableBook.mockResolvedValue(readingBook);
      mockMatchService.matchBook.mockResolvedValue(null);
      mockRepo.findBookState.mockResolvedValue(null);
      await expect(makeService().syncBook(1, 1)).resolves.toBe('skipped');
      expect(mockRepo.upsertBookState).toHaveBeenCalledWith(
        expect.objectContaining({
          syncError: 'no_match',
          lastSyncedAt: expect.any(Date),
          lastSyncedStatus: 'reading',
          lastSyncedProgress: 42,
          lastSyncedStartedAt: '2024-01-01',
        }),
      );
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[hardcover.sync_book] [fail] userId=1 bookId=1'));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('errorClass=MatchError error="no_match"'));
      warnSpy.mockRestore();
    });

    it('syncs book successfully', async () => {
      mockSettingsService.getTokenForUser.mockResolvedValue('tok');
      mockRepo.findSyncableBook.mockResolvedValue(readingBook);
      mockRepo.findBookState.mockResolvedValue(null);
      mockMatchService.matchBook.mockResolvedValue({ hardcoverBookId: 10, hardcoverEditionId: 20, matchMethod: 'isbn' });
      mockClient.query
        .mockResolvedValueOnce({ insert_user_book: { user_book: { id: 55 }, error: null } })
        .mockResolvedValueOnce({ update_user_book: { user_book: { id: 55 }, error: null } })
        .mockResolvedValueOnce({ user_book_reads: [] })
        .mockResolvedValueOnce({ insert_user_book_read: { user_book_read: { id: 77 }, error: null } });
      await expect(makeService().syncBook(1, 1)).resolves.toBe('synced');
      expect(mockRepo.upsertBookState).toHaveBeenCalledWith(
        expect.objectContaining({
          hardcoverUserBookId: 55,
          hardcoverReadId: 77,
          lastSyncedStatus: 'reading',
        }),
      );
    });

    it('updates the active unfinished read when cached read id is stale', async () => {
      mockSettingsService.getTokenForUser.mockResolvedValue('tok');
      mockRepo.findSyncableBook.mockResolvedValue(readingBook);
      mockRepo.findBookState.mockResolvedValue({ hardcoverReadId: 501 });
      mockMatchService.matchBook.mockResolvedValue({ hardcoverBookId: 10, hardcoverEditionId: 20, editionPages: 300, matchMethod: 'cached' });
      mockClient.query
        .mockResolvedValueOnce({ insert_user_book: { user_book: { id: 55 }, error: null } })
        .mockResolvedValueOnce({ update_user_book: { user_book: { id: 55 }, error: null } })
        .mockResolvedValueOnce({
          user_book_reads: [
            { id: 777, started_at: '2024-01-01', finished_at: null, progress_pages: null },
            { id: 501, started_at: '2024-01-01', finished_at: '2024-01-02', progress_pages: 12 },
          ],
        })
        .mockResolvedValueOnce({ update_user_book_read: { user_book_read: { id: 777 }, error: null } });

      await makeService().syncBook(1, 1);

      expect(mockClient.query).toHaveBeenNthCalledWith(
        4,
        1,
        'tok',
        expect.stringContaining('mutation UpdateUserBookRead'),
        expect.objectContaining({ id: 777 }),
      );
      expect(mockRepo.upsertBookState).toHaveBeenCalledWith(expect.objectContaining({ hardcoverReadId: 777 }));
    });

    it('syncs progress to sibling unfinished reads to avoid page 0 in Hardcover UI', async () => {
      const logSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
      mockSettingsService.getTokenForUser.mockResolvedValue('tok');
      mockRepo.findSyncableBook.mockResolvedValue(readingBook);
      mockRepo.findBookState.mockResolvedValue({ hardcoverReadId: 900 });
      mockMatchService.matchBook.mockResolvedValue({ hardcoverBookId: 10, hardcoverEditionId: 20, editionPages: 300, matchMethod: 'cached' });
      mockClient.query
        .mockResolvedValueOnce({ insert_user_book: { user_book: { id: 55 }, error: null } })
        .mockResolvedValueOnce({ update_user_book: { user_book: { id: 55 }, error: null } })
        .mockResolvedValueOnce({
          user_book_reads: [
            { id: 900, started_at: '2024-01-01', finished_at: null, progress_pages: null },
            { id: 899, started_at: '2024-01-01', finished_at: null, progress_pages: null },
          ],
        })
        .mockResolvedValueOnce({ update_user_book_read: { user_book_read: { id: 900 }, error: null } })
        .mockResolvedValueOnce({ update_user_book_read: { user_book_read: { id: 899 }, error: null } });

      await makeService().syncBook(1, 1);

      expect(mockClient.query).toHaveBeenNthCalledWith(
        5,
        1,
        'tok',
        expect.stringContaining('mutation UpdateUserBookRead'),
        expect.objectContaining({ id: 899, object: expect.objectContaining({ progress_pages: 126 }) }),
      );
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[hardcover.sync_progress] [end] userId=1 bookId=1'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('progress=42 progressPages=126 progressSeconds=null - progress sent to Hardcover'));
      logSpy.mockRestore();
    });

    it('keeps progress pending when edition pages are unavailable', async () => {
      mockSettingsService.getTokenForUser.mockResolvedValue('tok');
      mockRepo.findSyncableBook.mockResolvedValue(readingBook);
      mockRepo.findBookState.mockResolvedValue(null);
      mockMatchService.matchBook.mockResolvedValue({ hardcoverBookId: 10, hardcoverEditionId: 20, editionPages: null, matchMethod: 'cached' });
      mockClient.query
        .mockResolvedValueOnce({ insert_user_book: { user_book: { id: 55 }, error: null } })
        .mockResolvedValueOnce({ update_user_book: { user_book: { id: 55 }, error: null } })
        .mockResolvedValueOnce({ user_book_reads: [] })
        .mockResolvedValueOnce({ insert_user_book_read: { user_book_read: { id: 77 }, error: null } });

      await makeService().syncBook(1, 1);

      expect(mockRepo.upsertBookState).toHaveBeenCalledWith(expect.objectContaining({ lastSyncedProgress: null }));
    });

    it('sends progress_seconds (not progress_pages) when the matched edition is an audiobook', async () => {
      const audioBook = { ...readingBook, audioPositionSeconds: 4521.7 };
      mockSettingsService.getTokenForUser.mockResolvedValue('tok');
      mockRepo.findSyncableBook.mockResolvedValue(audioBook);
      mockRepo.findBookState.mockResolvedValue(null);
      mockMatchService.matchBook.mockResolvedValue({
        hardcoverBookId: 10,
        hardcoverEditionId: 20,
        editionPages: null,
        editionIsAudio: true,
        matchMethod: 'cached',
      });
      mockClient.query
        .mockResolvedValueOnce({ insert_user_book: { user_book: { id: 55 }, error: null } })
        .mockResolvedValueOnce({ update_user_book: { user_book: { id: 55 }, error: null } })
        .mockResolvedValueOnce({ user_book_reads: [] })
        .mockResolvedValueOnce({ insert_user_book_read: { user_book_read: { id: 77 }, error: null } });

      await expect(makeService().syncBook(1, 1)).resolves.toBe('synced');

      expect(mockClient.query).toHaveBeenNthCalledWith(
        4,
        1,
        'tok',
        expect.stringContaining('mutation InsertUserBookRead'),
        expect.objectContaining({ object: expect.objectContaining({ progress_seconds: 4522 }) }),
      );
      expect(mockClient.query.mock.calls[3]![3].object).not.toHaveProperty('progress_pages');
      // The real bug: progress was previously dropped to null for audio editions, making the
      // book look permanently "pending" even though the sync otherwise succeeded.
      expect(mockRepo.upsertBookState).toHaveBeenCalledWith(expect.objectContaining({ lastSyncedProgress: audioBook.progress }));
    });

    it('keeps progress pending for an audio edition when there is no local listening position yet', async () => {
      const audioBook = { ...readingBook, audioPositionSeconds: null };
      mockSettingsService.getTokenForUser.mockResolvedValue('tok');
      mockRepo.findSyncableBook.mockResolvedValue(audioBook);
      mockRepo.findBookState.mockResolvedValue(null);
      mockMatchService.matchBook.mockResolvedValue({
        hardcoverBookId: 10,
        hardcoverEditionId: 20,
        editionPages: null,
        editionIsAudio: true,
        matchMethod: 'cached',
      });
      mockClient.query
        .mockResolvedValueOnce({ insert_user_book: { user_book: { id: 55 }, error: null } })
        .mockResolvedValueOnce({ update_user_book: { user_book: { id: 55 }, error: null } })
        .mockResolvedValueOnce({ user_book_reads: [] })
        .mockResolvedValueOnce({ insert_user_book_read: { user_book_read: { id: 77 }, error: null } });

      await makeService().syncBook(1, 1);

      expect(mockRepo.upsertBookState).toHaveBeenCalledWith(expect.objectContaining({ lastSyncedProgress: null }));
    });

    it('stores error on API failure without throwing', async () => {
      mockSettingsService.getTokenForUser.mockResolvedValue('tok');
      mockRepo.findSyncableBook.mockResolvedValue(readingBook);
      mockMatchService.matchBook.mockResolvedValue({ hardcoverBookId: 10, hardcoverEditionId: null, matchMethod: 'isbn' });
      mockClient.query.mockRejectedValue(new Error('timeout'));
      await makeService().syncBook(1, 1);
      expect(mockRepo.upsertBookState).toHaveBeenCalledWith(expect.objectContaining({ syncError: 'timeout' }));
    });

    it('skips books with no status mapping', async () => {
      mockSettingsService.getTokenForUser.mockResolvedValue('tok');
      mockRepo.findSyncableBook.mockResolvedValue({ ...readingBook, status: 'invalid_status' });
      await makeService().syncBook(1, 1);
      expect(mockRepo.upsertBookState).toHaveBeenCalledWith(
        expect.objectContaining({
          syncError: expect.stringContaining('no_status_mapping'),
          lastSyncedAt: expect.any(Date),
          lastSyncedStatus: 'invalid_status',
        }),
      );
    });
  });

  describe('rematchBook', () => {
    it('clears the cached match before re-syncing', async () => {
      mockSettingsService.getTokenForUser.mockResolvedValue('tok');
      mockRepo.findSyncableBook.mockResolvedValue(readingBook);
      mockRepo.findBookState.mockResolvedValue(null);
      mockMatchService.matchBook.mockResolvedValue(null);

      const result = await makeService().rematchBook(1, 1);

      expect(mockRepo.clearBookMatch).toHaveBeenCalledWith(1, 1);
      expect(result).toBe('skipped');
    });
  });

  describe('linkBookManually', () => {
    it('returns failure when no token', async () => {
      mockSettingsService.getTokenForUser.mockResolvedValue(null);
      const result = await makeService().linkBookManually(1, 1, '700');
      expect(result).toEqual({ success: false });
      expect(mockRepo.findSyncableBook).not.toHaveBeenCalled();
    });

    it('returns failure when the book is not found', async () => {
      mockSettingsService.getTokenForUser.mockResolvedValue('tok');
      mockRepo.findSyncableBook.mockResolvedValue(null);
      const result = await makeService().linkBookManually(1, 1, '700');
      expect(result).toEqual({ success: false });
    });

    it('returns failure when resolution fails', async () => {
      mockSettingsService.getTokenForUser.mockResolvedValue('tok');
      mockRepo.findSyncableBook.mockResolvedValue(readingBook);
      mockMatchService.resolveManualInput.mockResolvedValue(null);
      const result = await makeService().linkBookManually(1, 1, 'bad-input');
      expect(result).toEqual({ success: false });
      expect(mockRepo.upsertBookState).not.toHaveBeenCalled();
    });

    it('stores the manual match and re-syncs on success', async () => {
      mockSettingsService.getTokenForUser.mockResolvedValue('tok');
      mockRepo.findSyncableBook.mockResolvedValue(readingBook);
      mockRepo.findBookState.mockResolvedValue(null);
      mockMatchService.resolveManualInput.mockResolvedValue({ hardcoverBookId: 700, hardcoverEditionId: 901, title: 'Fyrebirds' });
      mockMatchService.matchBook.mockResolvedValue({ hardcoverBookId: 700, hardcoverEditionId: 901, matchMethod: 'cached' });
      mockClient.query
        .mockResolvedValueOnce({ insert_user_book: { user_book: { id: 55 }, error: null } })
        .mockResolvedValueOnce({ update_user_book: { user_book: { id: 55 }, error: null } })
        .mockResolvedValueOnce({ user_book_reads: [] })
        .mockResolvedValueOnce({ insert_user_book_read: { user_book_read: { id: 77 }, error: null } });

      const result = await makeService().linkBookManually(1, 1, 'https://hardcover.app/books/700');

      expect(result).toEqual({ success: true, hardcoverBookId: 700, title: 'Fyrebirds' });
      expect(mockRepo.upsertBookState).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 1, bookId: 1, hardcoverBookId: 700, hardcoverEditionId: 901, matchMethod: 'manual' }),
      );
    });
  });

  describe('listEditions', () => {
    it('returns an empty array when there is no token', async () => {
      mockSettingsService.getTokenForUser.mockResolvedValue(null);
      const result = await makeService().listEditions(1, 1);
      expect(result).toEqual([]);
    });

    it('returns an empty array when the book has no hardcoverBookId', async () => {
      mockSettingsService.getTokenForUser.mockResolvedValue('tok');
      mockRepo.findBookState.mockResolvedValue(null);
      const result = await makeService().listEditions(1, 1);
      expect(result).toEqual([]);
      expect(mockMatchService.getEditions).not.toHaveBeenCalled();
    });

    it('delegates to the match service when a hardcoverBookId is cached', async () => {
      mockSettingsService.getTokenForUser.mockResolvedValue('tok');
      mockRepo.findBookState.mockResolvedValue({ hardcoverBookId: 700 });
      mockMatchService.getEditions.mockResolvedValue([{ id: 901, format: 'Physical', pages: 512, audioSeconds: null, isAudio: false, year: 2019 }]);

      const result = await makeService().listEditions(1, 1);

      expect(mockMatchService.getEditions).toHaveBeenCalledWith(1, 'tok', 700);
      expect(result).toHaveLength(1);
    });
  });

  describe('setEdition', () => {
    it('returns failure when no token', async () => {
      mockSettingsService.getTokenForUser.mockResolvedValue(null);
      const result = await makeService().setEdition(1, 1, 901);
      expect(result).toEqual({ success: false });
    });

    it('returns failure when the book has no hardcoverBookId yet', async () => {
      mockSettingsService.getTokenForUser.mockResolvedValue('tok');
      mockRepo.findBookState.mockResolvedValue(null);
      const result = await makeService().setEdition(1, 1, 901);
      expect(result).toEqual({ success: false });
      expect(mockRepo.upsertBookState).not.toHaveBeenCalled();
    });

    it('stores the new edition and re-syncs on success', async () => {
      mockSettingsService.getTokenForUser.mockResolvedValue('tok');
      mockRepo.findBookState.mockResolvedValue({ hardcoverBookId: 700 });
      mockRepo.findSyncableBook.mockResolvedValue(readingBook);
      mockMatchService.matchBook.mockResolvedValue({ hardcoverBookId: 700, hardcoverEditionId: 902, matchMethod: 'cached' });
      mockClient.query
        .mockResolvedValueOnce({ insert_user_book: { user_book: { id: 55 }, error: null } })
        .mockResolvedValueOnce({ update_user_book: { user_book: { id: 55 }, error: null } })
        .mockResolvedValueOnce({ user_book_reads: [] })
        .mockResolvedValueOnce({ insert_user_book_read: { user_book_read: { id: 77 }, error: null } });

      const result = await makeService().setEdition(1, 1, 902);

      expect(result).toEqual({ success: true });
      expect(mockRepo.upsertBookState).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 1, bookId: 1, hardcoverBookId: 700, hardcoverEditionId: 902, matchMethod: 'manual' }),
      );
    });
  });

  describe('listLinkedBooks', () => {
    it('returns linked book state for currently-reading books', async () => {
      mockRepo.findSyncableBooks.mockResolvedValue([{ ...readingBook, bookId: 10, title: 'Book Ten', authorName: 'Author One' }]);
      mockRepo.findBookStatesByBookIds.mockResolvedValue([
        { bookId: 10, hardcoverBookId: 700, hardcoverEditionId: 901, matchMethod: 'isbn', matchError: null },
      ]);

      const result = await makeService().listLinkedBooks(1);

      expect(result).toEqual([
        {
          bookId: 10,
          title: 'Book Ten',
          authorName: 'Author One',
          hardcoverBookId: 700,
          hardcoverEditionId: 901,
          matchMethod: 'isbn',
          matchError: null,
        },
      ]);
    });

    it('returns unmatched placeholders for books with no cached state', async () => {
      mockRepo.findSyncableBooks.mockResolvedValue([{ ...readingBook, bookId: 11, title: 'Book Eleven', authorName: 'Author One' }]);
      mockRepo.findBookStatesByBookIds.mockResolvedValue([]);

      const result = await makeService().listLinkedBooks(1);

      expect(result).toEqual([
        {
          bookId: 11,
          title: 'Book Eleven',
          authorName: 'Author One',
          hardcoverBookId: null,
          hardcoverEditionId: null,
          matchMethod: null,
          matchError: null,
        },
      ]);
    });

    it('only includes books currently being read, not finished/want-to-read ones', async () => {
      mockRepo.findSyncableBooks.mockResolvedValue([
        { ...readingBook, bookId: 10, title: 'Reading Now', status: 'reading' },
        { ...readingBook, bookId: 11, title: 'Rereading Now', status: 'rereading' },
        { ...readingBook, bookId: 12, title: 'Already Read', status: 'read' },
        { ...readingBook, bookId: 13, title: 'Want To Read', status: 'want_to_read' },
      ]);
      mockRepo.findBookStatesByBookIds.mockResolvedValue([]);

      const result = await makeService().listLinkedBooks(1);

      expect(result.map((book) => book.bookId)).toEqual([10, 11]);
    });
  });

  describe('syncAll', () => {
    it('returns existing run id if already running', async () => {
      mockSettingsService.getTokenForUser.mockResolvedValue('tok');
      mockRepo.findSyncableBooks.mockResolvedValue([readingBook]);
      mockRepo.findBookState.mockReturnValue(new Promise(() => {})); // blocks runSyncAll
      const svc = makeService();
      const id1 = await svc.syncAll(1);
      const id2 = await svc.syncAll(1);
      expect(id1).toBe(id2);
      expect(mockRepo.findSyncableBooks).toHaveBeenCalledTimes(1);
    });

    it('creates in-memory run and returns run id', async () => {
      mockSettingsService.getTokenForUser.mockResolvedValue('tok');
      mockRepo.findSyncableBooks.mockResolvedValue([]);
      const id = await makeService().syncAll(1);
      expect(id).toBeGreaterThan(0);
    });

    it('returns 0 when no token', async () => {
      mockSettingsService.getTokenForUser.mockResolvedValue(null);
      const id = await makeService().syncAll(1);
      expect(id).toBe(0);
    });

    it('calls updateLastSyncedAt on successful completion', async () => {
      mockSettingsService.getTokenForUser.mockResolvedValue('tok');
      mockRepo.findSyncableBooks.mockResolvedValue([]);
      const svc = makeService();
      await svc.syncAll(1);
      await Promise.resolve(); // flush runSyncAll microtasks
      await Promise.resolve();
      expect(mockRepo.updateLastSyncedAt).toHaveBeenCalledWith(1, expect.any(Date));
    });

    it('clears active sync and does not call updateLastSyncedAt when runSyncAll crashes', async () => {
      mockSettingsService.getTokenForUser.mockResolvedValue('tok');
      mockRepo.findSyncableBooks.mockResolvedValue([readingBook]);
      mockRepo.findBookState.mockRejectedValue(new Error('DB crash'));
      const svc = makeService();
      await svc.syncAll(1);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(svc.getSyncStatus(1)).toBeNull();
      expect(mockRepo.updateLastSyncedAt).not.toHaveBeenCalled();
    });
  });

  describe('getSyncStatus', () => {
    it('returns null when no active run', () => {
      expect(makeService().getSyncStatus(1)).toBeNull();
    });

    it('returns status after syncAll is called', async () => {
      mockSettingsService.getTokenForUser.mockResolvedValue('tok');
      mockRepo.findSyncableBooks.mockResolvedValue([readingBook]);
      mockRepo.findBookState.mockReturnValue(new Promise(() => {})); // blocks runSyncAll
      const svc = makeService();
      await svc.syncAll(1);
      const result = svc.getSyncStatus(1);
      expect(result).not.toBeNull();
      expect(result?.status).toBe('running');
    });
  });

  describe('getSyncPendingSummary', () => {
    it('returns zero when user has no token', async () => {
      mockSettingsService.getTokenForUser.mockResolvedValue(null);
      const result = await makeService().getSyncPendingSummary(1);
      expect(result).toEqual({ totalBooks: 0, pendingBooks: 0 });
      expect(mockRepo.findSyncableBooks).not.toHaveBeenCalled();
    });

    it('counts only books with unsynced changes', async () => {
      mockSettingsService.getTokenForUser.mockResolvedValue('tok');
      mockRepo.findSyncableBooks.mockResolvedValue([
        { ...readingBook, bookId: 10, progress: 42 },
        { ...readingBook, bookId: 11, progress: 88 },
      ]);
      mockRepo.findBookStatesByBookIds.mockResolvedValue([
        {
          bookId: 10,
          lastSyncedAt: new Date('2024-02-01T00:00:00Z'),
          lastSyncedStatus: 'reading',
          lastSyncedProgress: 42,
          lastSyncedRating: null,
          lastSyncedStartedAt: '2024-01-01',
          lastSyncedFinishedAt: null,
        },
        {
          bookId: 11,
          lastSyncedAt: new Date('2024-02-01T00:00:00Z'),
          lastSyncedStatus: 'reading',
          lastSyncedProgress: 10,
          lastSyncedRating: null,
          lastSyncedStartedAt: '2024-01-01',
          lastSyncedFinishedAt: null,
        },
      ]);

      const result = await makeService().getSyncPendingSummary(1);
      expect(result).toEqual({ totalBooks: 2, pendingBooks: 1 });
      expect(mockRepo.findBookStatesByBookIds).toHaveBeenCalledWith(1, [10, 11]);
    });
  });

  describe('cancelSync', () => {
    it('does nothing if no active run', () => {
      makeService().cancelSync(1);
      expect(mockRepo.updateLastSyncedAt).not.toHaveBeenCalled();
    });

    it('clears active run when cancelled', async () => {
      mockSettingsService.getTokenForUser.mockResolvedValue('tok');
      mockRepo.findSyncableBooks.mockResolvedValue([]);
      const svc = makeService();
      await svc.syncAll(1);
      svc.cancelSync(1);
      expect(svc.getSyncStatus(1)).toBeNull();
    });
  });
});
