import { Logger } from '@nestjs/common';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { StorygraphSyncService } from './storygraph-sync.service';

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
  get: vi.fn(),
  post: vi.fn(),
  extractCsrfToken: vi.fn(),
};

const mockMatchService = {
  matchBook: vi.fn(),
};

const mockSettingsService = {
  getCookiesForUser: vi.fn(),
};

function makeService() {
  return new StorygraphSyncService(mockRepo as any, mockClient as any, mockMatchService as any, mockSettingsService as any);
}

const cookies = { sessionCookie: 'sess', rememberToken: 'remember' };

const readingBook = {
  bookId: 1,
  isbn13: '9781234567890',
  isbn10: null,
  title: 'Book One',
  authorName: 'Author One',
  format: 'epub',
  status: 'reading',
  progress: 42,
};

describe('StorygraphSyncService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRepo.findBookState.mockResolvedValue(undefined);
    mockRepo.findBookStatesByBookIds.mockResolvedValue([]);
    mockRepo.findSyncableBooks.mockResolvedValue([]);
    mockRepo.findSyncableBook.mockResolvedValue(null);
    mockRepo.upsertBookState.mockResolvedValue({});
    mockRepo.updateLastSyncedAt.mockResolvedValue(undefined);
    mockRepo.clearBookMatch.mockResolvedValue(undefined);
    mockClient.extractCsrfToken.mockReturnValue('csrf-token');
    mockClient.get.mockResolvedValue({ status: 200, html: '<html></html>', redirectedToSignIn: false });
    mockClient.post.mockResolvedValue({ status: 302, html: '', redirectedToSignIn: false });
  });

  describe('syncBook', () => {
    it('does nothing when no cookies', async () => {
      mockSettingsService.getCookiesForUser.mockResolvedValue(null);
      await makeService().syncBook(1, 1);
      expect(mockRepo.findSyncableBook).not.toHaveBeenCalled();
    });

    it('does nothing when book not found', async () => {
      mockSettingsService.getCookiesForUser.mockResolvedValue(cookies);
      mockRepo.findSyncableBook.mockResolvedValue(null);
      await makeService().syncBook(1, 1);
      expect(mockMatchService.matchBook).not.toHaveBeenCalled();
    });

    it('does nothing for unread status', async () => {
      mockSettingsService.getCookiesForUser.mockResolvedValue(cookies);
      mockRepo.findSyncableBook.mockResolvedValue({ ...readingBook, status: 'unread' });
      await expect(makeService().syncBook(1, 1)).resolves.toBe('skipped');
      expect(mockMatchService.matchBook).not.toHaveBeenCalled();
    });

    it('skips when the local sync snapshot has no changes', async () => {
      mockSettingsService.getCookiesForUser.mockResolvedValue(cookies);
      mockRepo.findSyncableBook.mockResolvedValue(readingBook);
      mockRepo.findBookState.mockResolvedValue({
        lastSyncedAt: new Date('2024-02-01T00:00:00Z'),
        lastSyncedStatus: 'reading',
        lastSyncedProgress: 42,
      });

      await expect(makeService().syncBook(1, 1)).resolves.toBe('skipped');

      expect(mockMatchService.matchBook).not.toHaveBeenCalled();
    });

    it('stores no_match error when match fails', async () => {
      const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      mockSettingsService.getCookiesForUser.mockResolvedValue(cookies);
      mockRepo.findSyncableBook.mockResolvedValue(readingBook);
      mockMatchService.matchBook.mockResolvedValue(null);
      mockRepo.findBookState.mockResolvedValue(null);
      await expect(makeService().syncBook(1, 1)).resolves.toBe('skipped');
      expect(mockRepo.upsertBookState).toHaveBeenCalledWith(
        expect.objectContaining({ syncError: 'no_match', lastSyncedAt: expect.any(Date), lastSyncedStatus: 'reading' }),
      );
      warnSpy.mockRestore();
    });

    it('skips books with no status mapping', async () => {
      mockSettingsService.getCookiesForUser.mockResolvedValue(cookies);
      mockRepo.findSyncableBook.mockResolvedValue({ ...readingBook, status: 'invalid_status' });
      await makeService().syncBook(1, 1);
      expect(mockRepo.upsertBookState).toHaveBeenCalledWith(
        expect.objectContaining({ syncError: expect.stringContaining('no_status_mapping'), lastSyncedStatus: 'invalid_status' }),
      );
    });

    it('syncs status and progress successfully', async () => {
      mockSettingsService.getCookiesForUser.mockResolvedValue(cookies);
      mockRepo.findSyncableBook.mockResolvedValue(readingBook);
      mockRepo.findBookState.mockResolvedValue(null);
      mockMatchService.matchBook.mockResolvedValue({ storygraphBookId: 'abc-123', matchMethod: 'isbn' });

      await expect(makeService().syncBook(1, 1)).resolves.toBe('synced');

      expect(mockClient.post).toHaveBeenCalledWith(
        1,
        cookies,
        expect.stringContaining('/update-status.js?book_id=abc-123&status=currently-reading'),
        {},
        'csrf-token',
      );
      expect(mockClient.post).toHaveBeenCalledWith(
        1,
        cookies,
        '/update-progress',
        expect.objectContaining({ 'read_status[progress_number]': '42', 'read_status[progress_type]': 'percentage', book_id: 'abc-123' }),
        'csrf-token',
      );
      expect(mockRepo.upsertBookState).toHaveBeenCalledWith(
        expect.objectContaining({ storygraphBookId: 'abc-123', lastSyncedStatus: 'reading', lastSyncedProgress: 42 }),
      );
    });

    it('falls back to rereading when currently-reading status update fails', async () => {
      mockSettingsService.getCookiesForUser.mockResolvedValue(cookies);
      mockRepo.findSyncableBook.mockResolvedValue(readingBook);
      mockRepo.findBookState.mockResolvedValue(null);
      mockMatchService.matchBook.mockResolvedValue({ storygraphBookId: 'abc-123', matchMethod: 'isbn' });
      mockClient.post
        .mockResolvedValueOnce({ status: 422, html: '', redirectedToSignIn: false })
        .mockResolvedValueOnce({ status: 200, html: '', redirectedToSignIn: false })
        .mockResolvedValueOnce({ status: 200, html: '', redirectedToSignIn: false });

      await expect(makeService().syncBook(1, 1)).resolves.toBe('synced');

      expect(mockClient.post).toHaveBeenNthCalledWith(2, 1, cookies, expect.stringContaining('status=rereading'), {}, 'csrf-token');
    });

    it('treats an expired session as a failure', async () => {
      mockSettingsService.getCookiesForUser.mockResolvedValue(cookies);
      mockRepo.findSyncableBook.mockResolvedValue(readingBook);
      mockRepo.findBookState.mockResolvedValue(null);
      mockMatchService.matchBook.mockResolvedValue({ storygraphBookId: 'abc-123', matchMethod: 'isbn' });
      mockClient.get.mockResolvedValue({ status: 200, html: '', redirectedToSignIn: true });

      await expect(makeService().syncBook(1, 1)).resolves.toBe('failed');

      expect(mockRepo.upsertBookState).toHaveBeenCalledWith(expect.objectContaining({ syncError: 'storygraph_session_expired' }));
    });

    it('stores error on API failure without throwing', async () => {
      mockSettingsService.getCookiesForUser.mockResolvedValue(cookies);
      mockRepo.findSyncableBook.mockResolvedValue(readingBook);
      mockRepo.findBookState.mockResolvedValue(null);
      mockMatchService.matchBook.mockResolvedValue({ storygraphBookId: 'abc-123', matchMethod: 'isbn' });
      mockClient.get.mockRejectedValue(new Error('network timeout'));

      await expect(makeService().syncBook(1, 1)).resolves.toBe('failed');
      expect(mockRepo.upsertBookState).toHaveBeenCalledWith(expect.objectContaining({ syncError: 'network timeout' }));
    });
  });

  describe('syncAll', () => {
    it('returns existing run id if already running', async () => {
      mockSettingsService.getCookiesForUser.mockResolvedValue(cookies);
      mockRepo.findSyncableBooks.mockResolvedValue([readingBook]);
      mockRepo.findBookState.mockReturnValue(new Promise(() => {}));
      const svc = makeService();
      const id1 = await svc.syncAll(1);
      const id2 = await svc.syncAll(1);
      expect(id1).toBe(id2);
      expect(mockRepo.findSyncableBooks).toHaveBeenCalledTimes(1);
    });

    it('returns 0 when no cookies', async () => {
      mockSettingsService.getCookiesForUser.mockResolvedValue(null);
      const id = await makeService().syncAll(1);
      expect(id).toBe(0);
    });

    it('calls updateLastSyncedAt on successful completion', async () => {
      mockSettingsService.getCookiesForUser.mockResolvedValue(cookies);
      mockRepo.findSyncableBooks.mockResolvedValue([]);
      const svc = makeService();
      await svc.syncAll(1);
      await Promise.resolve();
      await Promise.resolve();
      expect(mockRepo.updateLastSyncedAt).toHaveBeenCalledWith(1, expect.any(Date));
    });
  });

  describe('getSyncPendingSummary', () => {
    it('returns zero when user has no cookies', async () => {
      mockSettingsService.getCookiesForUser.mockResolvedValue(null);
      const result = await makeService().getSyncPendingSummary(1);
      expect(result).toEqual({ totalBooks: 0, pendingBooks: 0 });
      expect(mockRepo.findSyncableBooks).not.toHaveBeenCalled();
    });

    it('counts only books with unsynced changes', async () => {
      mockSettingsService.getCookiesForUser.mockResolvedValue(cookies);
      mockRepo.findSyncableBooks.mockResolvedValue([
        { ...readingBook, bookId: 10, progress: 42 },
        { ...readingBook, bookId: 11, progress: 88 },
      ]);
      mockRepo.findBookStatesByBookIds.mockResolvedValue([
        { bookId: 10, lastSyncedAt: new Date('2024-02-01T00:00:00Z'), lastSyncedStatus: 'reading', lastSyncedProgress: 42 },
        { bookId: 11, lastSyncedAt: new Date('2024-02-01T00:00:00Z'), lastSyncedStatus: 'reading', lastSyncedProgress: 10 },
      ]);

      const result = await makeService().getSyncPendingSummary(1);
      expect(result).toEqual({ totalBooks: 2, pendingBooks: 1 });
    });
  });

  describe('cancelSync', () => {
    it('does nothing if no active run', () => {
      makeService().cancelSync(1);
      expect(mockRepo.updateLastSyncedAt).not.toHaveBeenCalled();
    });

    it('clears active run when cancelled', async () => {
      mockSettingsService.getCookiesForUser.mockResolvedValue(cookies);
      mockRepo.findSyncableBooks.mockResolvedValue([]);
      const svc = makeService();
      await svc.syncAll(1);
      svc.cancelSync(1);
      expect(svc.getSyncStatus(1)).toBeNull();
    });
  });

  describe('rematchBook', () => {
    it('clears the cached match before delegating to syncBook', async () => {
      mockSettingsService.getCookiesForUser.mockResolvedValue(cookies);
      mockRepo.findSyncableBook.mockResolvedValue(readingBook);
      // clearBookMatch (tested separately on the repository) resets lastSyncedAt to null in the
      // real DB, which is what makes hasChanges() treat this as a fresh, never-synced book here.
      mockRepo.findBookState.mockResolvedValue(null);
      mockMatchService.matchBook.mockResolvedValue({ storygraphBookId: 'correct-id', matchMethod: 'isbn' });

      const result = await makeService().rematchBook(1, 1);

      expect(mockRepo.clearBookMatch).toHaveBeenCalledWith(1, 1);
      expect(result).toBe('synced');
      expect(mockRepo.upsertBookState).toHaveBeenCalledWith(expect.objectContaining({ storygraphBookId: 'correct-id' }));
    });

    it('returns skipped when the user has no cookies configured', async () => {
      mockSettingsService.getCookiesForUser.mockResolvedValue(null);

      const result = await makeService().rematchBook(1, 1);

      expect(mockRepo.clearBookMatch).toHaveBeenCalledWith(1, 1);
      expect(result).toBe('skipped');
    });
  });
});
