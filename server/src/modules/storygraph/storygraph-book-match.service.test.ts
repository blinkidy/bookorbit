import { describe, it, expect, vi, beforeEach } from 'vitest';

import { StorygraphBookMatchService } from './storygraph-book-match.service';

const mockRepo = {
  findBookState: vi.fn(),
  upsertBookState: vi.fn(),
};

const mockClient = {
  get: vi.fn(),
};

function makeService() {
  return new StorygraphBookMatchService(mockRepo as any, mockClient as any);
}

const cookies = { sessionCookie: 'sess', rememberToken: 'remember' };

const baseBook = {
  bookId: 42,
  isbn13: '9781234567890',
  isbn10: null,
  title: 'Test Book',
  authorName: 'Test Author',
  status: 'reading',
  progress: null,
};

function searchHtml(bookId: string, format = 'Hardcover'): string {
  return `
    <div class="pane">
      <div class="book-title-author-and-series">
        <a href="/books/${bookId}">Test Book</a>
      </div>
      <div class="edition-info"><p>Format: ${format}</p></div>
    </div>
  `;
}

function bookPageHtml(opts: { editions: number; userAdded?: boolean }): string {
  return `<html><body><p>${opts.editions} edition${opts.editions === 1 ? '' : 's'}</p>${opts.userAdded ? '<span>user-added</span>' : ''}</body></html>`;
}

describe('StorygraphBookMatchService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRepo.upsertBookState.mockResolvedValue({});
  });

  it('returns the cached match without making a request when state has no error', async () => {
    mockRepo.findBookState.mockResolvedValue({ storygraphBookId: 'abc-123', matchError: null });
    const result = await makeService().matchBook(1, cookies, baseBook);
    expect(result).toEqual({ storygraphBookId: 'abc-123', matchMethod: 'cached' });
    expect(mockClient.get).not.toHaveBeenCalled();
    expect(mockRepo.upsertBookState).not.toHaveBeenCalled();
  });

  it('re-searches when cached state has a match error', async () => {
    mockRepo.findBookState.mockResolvedValue({ storygraphBookId: null, matchError: 'no_match' });
    mockClient.get.mockResolvedValue({ status: 200, redirectedToSignIn: false, html: searchHtml('abc-123') });
    const result = await makeService().matchBook(1, cookies, baseBook);
    expect(result).toEqual({ storygraphBookId: 'abc-123', matchMethod: 'isbn' });
  });

  it('searches by isbn13 first', async () => {
    mockRepo.findBookState.mockResolvedValue(undefined);
    mockClient.get.mockResolvedValue({ status: 200, redirectedToSignIn: false, html: searchHtml('isbn-match') });
    const result = await makeService().matchBook(1, cookies, baseBook);
    expect(result).toEqual({ storygraphBookId: 'isbn-match', matchMethod: 'isbn' });
    expect(mockClient.get).toHaveBeenCalledWith(1, cookies, expect.stringContaining(encodeURIComponent(baseBook.isbn13!)));
  });

  it('falls back to isbn10 when isbn13 search finds nothing', async () => {
    mockRepo.findBookState.mockResolvedValue(undefined);
    mockClient.get
      .mockResolvedValueOnce({ status: 200, redirectedToSignIn: false, html: '<html></html>' })
      .mockResolvedValueOnce({ status: 200, redirectedToSignIn: false, html: searchHtml('isbn10-match') });
    const book = { ...baseBook, isbn10: '1234567890' };
    const result = await makeService().matchBook(1, cookies, book);
    expect(result).toEqual({ storygraphBookId: 'isbn10-match', matchMethod: 'isbn' });
  });

  it('falls back to title+author search when no isbn is available', async () => {
    mockRepo.findBookState.mockResolvedValue(undefined);
    mockClient.get.mockResolvedValue({ status: 200, redirectedToSignIn: false, html: searchHtml('title-match') });
    const book = { ...baseBook, isbn13: null, isbn10: null };
    const result = await makeService().matchBook(1, cookies, book);
    expect(result).toEqual({ storygraphBookId: 'title-match', matchMethod: 'title' });
    expect(mockClient.get).toHaveBeenCalledWith(1, cookies, expect.stringContaining(encodeURIComponent('Test Book Test Author')));
  });

  it('skips audio editions and picks the first non-audio result', async () => {
    mockRepo.findBookState.mockResolvedValue(undefined);
    const html = searchHtml('audio-book', 'Audio') + searchHtml('text-book', 'Hardcover');
    mockClient.get.mockResolvedValue({ status: 200, redirectedToSignIn: false, html });
    const result = await makeService().matchBook(1, cookies, baseBook);
    expect(result).toEqual({ storygraphBookId: 'text-book', matchMethod: 'isbn' });
  });

  it('returns null and records no_match when the session is invalid', async () => {
    mockRepo.findBookState.mockResolvedValue(undefined);
    mockClient.get.mockResolvedValue({ status: 200, redirectedToSignIn: true, html: '' });
    const result = await makeService().matchBook(1, cookies, baseBook);
    expect(result).toBeNull();
    expect(mockRepo.upsertBookState).toHaveBeenCalledWith(expect.objectContaining({ matchError: 'no_match' }));
  });

  it('returns null and records no_match when no results are found anywhere', async () => {
    mockRepo.findBookState.mockResolvedValue(undefined);
    mockClient.get.mockResolvedValue({ status: 200, redirectedToSignIn: false, html: '<html></html>' });
    const book = { ...baseBook, isbn13: null, isbn10: null, title: null };
    const result = await makeService().matchBook(1, cookies, book);
    expect(result).toBeNull();
    expect(mockRepo.upsertBookState).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 1, bookId: 42, storygraphBookId: null, matchError: 'no_match' }),
    );
  });

  it('stores the match result to cache on success', async () => {
    mockRepo.findBookState.mockResolvedValue(undefined);
    mockClient.get.mockResolvedValue({ status: 200, redirectedToSignIn: false, html: searchHtml('cached-result') });
    await makeService().matchBook(1, cookies, baseBook);
    expect(mockRepo.upsertBookState).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 1, bookId: 42, storygraphBookId: 'cached-result', matchMethod: 'isbn', matchError: null }),
    );
  });

  it('prefers a canonical multi-edition entry over a user-added single-edition duplicate', async () => {
    mockRepo.findBookState.mockResolvedValue(undefined);
    const searchResultsHtml = searchHtml('user-added-id') + searchHtml('canonical-id');
    mockClient.get
      .mockResolvedValueOnce({ status: 200, redirectedToSignIn: false, html: searchResultsHtml })
      .mockResolvedValueOnce({ status: 200, redirectedToSignIn: false, html: bookPageHtml({ editions: 1, userAdded: true }) })
      .mockResolvedValueOnce({ status: 200, redirectedToSignIn: false, html: bookPageHtml({ editions: 17 }) });

    const result = await makeService().matchBook(1, cookies, baseBook);

    expect(result).toEqual({ storygraphBookId: 'canonical-id', matchMethod: 'isbn' });
    expect(mockClient.get).toHaveBeenCalledTimes(3);
    expect(mockClient.get).toHaveBeenNthCalledWith(2, 1, cookies, '/books/user-added-id');
    expect(mockClient.get).toHaveBeenNthCalledWith(3, 1, cookies, '/books/canonical-id');
  });

  it('falls back to the first candidate when every candidate page fetch fails', async () => {
    mockRepo.findBookState.mockResolvedValue(undefined);
    const searchResultsHtml = searchHtml('first-id') + searchHtml('second-id');
    mockClient.get
      .mockResolvedValueOnce({ status: 200, redirectedToSignIn: false, html: searchResultsHtml })
      .mockRejectedValueOnce(new Error('network error'))
      .mockRejectedValueOnce(new Error('network error'));

    const result = await makeService().matchBook(1, cookies, baseBook);

    expect(result).toEqual({ storygraphBookId: 'first-id', matchMethod: 'isbn' });
  });

  it('caps candidate evaluation at the configured maximum', async () => {
    mockRepo.findBookState.mockResolvedValue(undefined);
    const searchResultsHtml = searchHtml('id-1') + searchHtml('id-2') + searchHtml('id-3') + searchHtml('id-4');
    mockClient.get.mockImplementation((_userId: number, _cookies: unknown, path: string) => {
      if (path.startsWith('/browse')) return Promise.resolve({ status: 200, redirectedToSignIn: false, html: searchResultsHtml });
      return Promise.resolve({ status: 200, redirectedToSignIn: false, html: bookPageHtml({ editions: 1 }) });
    });

    await makeService().matchBook(1, cookies, baseBook);

    // 1 search request + at most 3 candidate page fetches (MAX_MATCH_CANDIDATES), not 4
    expect(mockClient.get).toHaveBeenCalledTimes(4);
  });
});
