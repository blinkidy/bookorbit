import { describe, it, expect, vi, beforeEach } from 'vitest';

import { HardcoverBookMatchService } from './hardcover-book-match.service';

const mockRepo = {
  findBookState: vi.fn(),
  upsertBookState: vi.fn(),
};

const mockClient = {
  query: vi.fn(),
};

function makeService() {
  return new HardcoverBookMatchService(mockRepo as any, mockClient as any);
}

const baseBook = {
  bookId: 42,
  isbn13: '9781234567890',
  isbn10: null,
  title: 'Test Book',
  authorName: 'Test Author',
  hardcoverMetadataId: null,
  status: 'reading',
  startedAt: null,
  finishedAt: null,
  rating: null,
  progress: null,
  pageCount: null,
  format: null,
  audioPositionSeconds: null,
};

describe('HardcoverBookMatchService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRepo.upsertBookState.mockResolvedValue({});
  });

  it('returns cached match when state exists and no error', async () => {
    mockRepo.findBookState.mockResolvedValue({
      hardcoverBookId: 100,
      hardcoverEditionId: 200,
      matchError: null,
    });
    mockClient.query.mockResolvedValue({
      books: [{ id: 100, editions: [{ id: 200, pages: 320 }] }],
    });
    const result = await makeService().matchBook(1, 'tok', baseBook);
    expect(result).toEqual({
      hardcoverBookId: 100,
      hardcoverEditionId: 200,
      editionPages: 320,
      editionAudioSeconds: null,
      editionIsAudio: false,
      matchMethod: 'cached',
    });
    expect(mockClient.query).toHaveBeenCalledTimes(1);
    expect(mockRepo.upsertBookState).not.toHaveBeenCalled();
  });

  it('keeps the cached edition even when it has no page count (no silent swap)', async () => {
    mockRepo.findBookState.mockResolvedValue({
      hardcoverBookId: 100,
      hardcoverEditionId: 200,
      matchError: null,
    });
    mockClient.query.mockResolvedValue({
      books: [
        {
          id: 100,
          editions: [
            { id: 200, pages: null, isbn_13: null, isbn_10: null, audio_seconds: null },
            { id: 201, pages: 544, isbn_13: null, isbn_10: null, audio_seconds: null },
          ],
        },
      ],
    });

    const result = await makeService().matchBook(1, 'tok', baseBook);

    expect(result).toEqual({
      hardcoverBookId: 100,
      hardcoverEditionId: 200,
      editionPages: null,
      editionAudioSeconds: null,
      editionIsAudio: false,
      matchMethod: 'cached',
    });
    expect(mockRepo.upsertBookState).not.toHaveBeenCalled();
  });

  it('re-points a cached match when the cached edition no longer exists on Hardcover', async () => {
    mockRepo.findBookState.mockResolvedValue({
      hardcoverBookId: 100,
      hardcoverEditionId: 200,
      matchError: null,
    });
    mockClient.query.mockResolvedValue({
      books: [{ id: 100, editions: [{ id: 301, pages: 410, isbn_13: '9781234567890', isbn_10: null, audio_seconds: null }] }],
    });

    const result = await makeService().matchBook(1, 'tok', { ...baseBook, isbn13: '9781234567890', pageCount: 410 });

    expect(result?.hardcoverEditionId).toBe(301);
    expect(mockRepo.upsertBookState).toHaveBeenCalledWith(
      expect.objectContaining({ hardcoverBookId: 100, hardcoverEditionId: 301, matchMethod: 'cached' }),
    );
  });

  it('re-queries when cached state has match error', async () => {
    mockRepo.findBookState.mockResolvedValue({ hardcoverBookId: null, matchError: 'no_match' });
    mockClient.query.mockResolvedValue({ books: [{ id: 99, editions: [{ id: 55 }] }] });
    const result = await makeService().matchBook(1, 'tok', baseBook);
    expect(result?.hardcoverBookId).toBe(99);
    expect(result?.matchMethod).toBe('isbn');
  });

  it('matches by metadata_id when hardcoverMetadataId is set', async () => {
    mockRepo.findBookState.mockResolvedValue(undefined);
    mockClient.query.mockResolvedValue({ books: [{ id: 77 }] });
    const book = { ...baseBook, hardcoverMetadataId: '77', isbn13: null };
    const result = await makeService().matchBook(1, 'tok', book);
    expect(result?.matchMethod).toBe('metadata_id');
    expect(result?.hardcoverBookId).toBe(77);
  });

  it('matches by metadata slug when hardcoverMetadataId is not numeric', async () => {
    mockRepo.findBookState.mockResolvedValue(undefined);
    mockClient.query.mockResolvedValue({ books: [{ id: 686104, editions: [{ id: 30673405, pages: 382 }] }] });
    const book = { ...baseBook, hardcoverMetadataId: 'fyrebirds', isbn13: null };

    const result = await makeService().matchBook(1, 'tok', book);

    expect(result).toEqual({
      hardcoverBookId: 686104,
      hardcoverEditionId: 30673405,
      editionPages: 382,
      editionAudioSeconds: null,
      editionIsAudio: false,
      matchMethod: 'metadata_id',
    });
    expect(mockClient.query).toHaveBeenCalledWith(
      1,
      'tok',
      expect.stringContaining('query FindBookBySlug'),
      expect.objectContaining({ slug: 'fyrebirds' }),
    );
  });

  it('falls back to isbn13 when metadata_id fails', async () => {
    mockRepo.findBookState.mockResolvedValue(undefined);
    mockClient.query.mockRejectedValueOnce(new Error('not found')).mockResolvedValueOnce({ books: [{ id: 88, editions: [{ id: 11 }] }] });
    const book = { ...baseBook, hardcoverMetadataId: '99' };
    const result = await makeService().matchBook(1, 'tok', book);
    expect(result?.hardcoverBookId).toBe(88);
    expect(result?.matchMethod).toBe('isbn');
  });

  it('falls back to title+author when isbn fails', async () => {
    mockRepo.findBookState.mockResolvedValue(undefined);
    mockClient.query
      .mockResolvedValueOnce({ books: [] })
      .mockResolvedValueOnce({ search: { ids: [123] } })
      .mockResolvedValueOnce({ books: [{ id: 123 }] });
    const result = await makeService().matchBook(1, 'tok', baseBook);
    expect(result?.matchMethod).toBe('title');
    expect(result?.hardcoverBookId).toBe(123);
    expect(mockClient.query).toHaveBeenNthCalledWith(
      2,
      1,
      'tok',
      expect.stringContaining('query SearchBooks'),
      expect.objectContaining({ query: 'Test Book Test Author' }),
    );
  });

  it('preserves Hardcover search ranking when hydrating title matches', async () => {
    mockRepo.findBookState.mockResolvedValue(undefined);
    mockClient.query
      .mockResolvedValueOnce({ books: [] })
      .mockResolvedValueOnce({ search: { ids: [123, 456] } })
      .mockResolvedValueOnce({
        books: [
          { id: 456, editions: [{ id: 40 }] },
          { id: 123, editions: [{ id: 30 }] },
        ],
      });

    const result = await makeService().matchBook(1, 'tok', baseBook);

    expect(result).toEqual({
      hardcoverBookId: 123,
      hardcoverEditionId: 30,
      editionPages: null,
      editionAudioSeconds: null,
      editionIsAudio: false,
      matchMethod: 'title',
    });
  });

  it('returns null and stores no_match when all strategies fail', async () => {
    mockRepo.findBookState.mockResolvedValue(undefined);
    mockClient.query.mockResolvedValue({ books: [] });
    const result = await makeService().matchBook(1, 'tok', baseBook);
    expect(result).toBeNull();
    expect(mockRepo.upsertBookState).toHaveBeenCalledWith(expect.objectContaining({ matchError: 'no_match' }));
  });

  it('stores match result to cache on success', async () => {
    mockRepo.findBookState.mockResolvedValue(undefined);
    mockClient.query.mockResolvedValue({ books: [{ id: 5, editions: [{ id: 6 }] }] });
    await makeService().matchBook(1, 'tok', baseBook);
    expect(mockRepo.upsertBookState).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 1,
        bookId: 42,
        hardcoverBookId: 5,
        hardcoverEditionId: 6,
        matchMethod: 'isbn',
      }),
    );
  });

  it('does not hardcode editions(limit: 1) on the metadata_id lookup', async () => {
    mockRepo.findBookState.mockResolvedValue(undefined);
    mockClient.query.mockResolvedValue({ books: [{ id: 700, editions: [{ id: 901, pages: 512 }] }] });

    await makeService().matchBook(1, 'tok', { ...baseBook, hardcoverMetadataId: '700', isbn13: null, isbn10: null });

    const queryArg = mockClient.query.mock.calls[0][2] as string;
    expect(queryArg).toContain('query FindBookById');
    expect(queryArg).not.toContain('editions(limit: 1)');
  });

  it('selects the ISBN-matching edition on a metadata_id match instead of the first (audiobook) edition', async () => {
    mockRepo.findBookState.mockResolvedValue(undefined);
    mockClient.query.mockResolvedValue({
      books: [
        {
          id: 700,
          editions: [
            { id: 900, pages: null, isbn_13: '9990000000000', isbn_10: null, audio_seconds: 36000 },
            { id: 901, pages: 512, isbn_13: '9781234567890', isbn_10: null, audio_seconds: null },
          ],
        },
      ],
    });

    const book = { ...baseBook, hardcoverMetadataId: '700', isbn13: '9781234567890', isbn10: null, pageCount: 512, format: 'epub' };
    const result = await makeService().matchBook(1, 'tok', book);

    expect(result).toEqual({
      hardcoverBookId: 700,
      hardcoverEditionId: 901,
      editionPages: 512,
      editionAudioSeconds: null,
      editionIsAudio: false,
      matchMethod: 'metadata_id',
    });
  });

  it('selects the closest page-count, non-audiobook edition on a title match', async () => {
    mockRepo.findBookState.mockResolvedValue(undefined);
    mockClient.query.mockResolvedValueOnce({ search: { ids: [123] } }).mockResolvedValueOnce({
      books: [
        {
          id: 123,
          editions: [
            { id: 800, pages: null, isbn_13: null, isbn_10: null, audio_seconds: 50000 },
            { id: 801, pages: 405, isbn_13: null, isbn_10: null, audio_seconds: null },
            { id: 802, pages: 980, isbn_13: null, isbn_10: null, audio_seconds: null },
          ],
        },
      ],
    });

    const book = { ...baseBook, isbn13: null, isbn10: null, pageCount: 400, format: 'epub' };
    const result = await makeService().matchBook(1, 'tok', book);

    expect(result).toEqual({
      hardcoverBookId: 123,
      hardcoverEditionId: 801,
      editionPages: 405,
      editionAudioSeconds: null,
      editionIsAudio: false,
      matchMethod: 'title',
    });
  });

  it('marks editionIsAudio when the local file is an audiobook and the best edition is the audio one', async () => {
    mockRepo.findBookState.mockResolvedValue(undefined);
    mockClient.query.mockResolvedValue({
      books: [
        {
          id: 700,
          editions: [
            { id: 900, pages: 320, isbn_13: null, isbn_10: null, audio_seconds: null, reading_format_id: 1 },
            { id: 901, pages: null, isbn_13: null, isbn_10: null, audio_seconds: 36000, reading_format_id: 2 },
          ],
        },
      ],
    });

    const book = { ...baseBook, isbn13: null, isbn10: null, hardcoverMetadataId: '700', format: 'm4b' };
    const result = await makeService().matchBook(1, 'tok', book);

    expect(result).toEqual({
      hardcoverBookId: 700,
      hardcoverEditionId: 901,
      editionPages: null,
      editionAudioSeconds: 36000,
      editionIsAudio: true,
      matchMethod: 'metadata_id',
    });
  });

  it('reports editionIsAudio for a cached audio edition that is still tracked on Hardcover', async () => {
    mockRepo.findBookState.mockResolvedValue({
      hardcoverBookId: 100,
      hardcoverEditionId: 200,
      matchError: null,
    });
    mockClient.query.mockResolvedValue({
      books: [{ id: 100, editions: [{ id: 200, pages: null, isbn_13: null, isbn_10: null, audio_seconds: 36000, reading_format_id: 2 }] }],
    });

    const result = await makeService().matchBook(1, 'tok', baseBook);

    expect(result).toEqual({
      hardcoverBookId: 100,
      hardcoverEditionId: 200,
      editionPages: null,
      editionAudioSeconds: 36000,
      editionIsAudio: true,
      matchMethod: 'cached',
    });
  });

  describe('resolveManualInput', () => {
    it('resolves a numeric id directly', async () => {
      mockClient.query.mockResolvedValue({ books: [{ id: 700, title: 'Fyrebirds', editions: [{ id: 901, pages: 512 }] }] });

      const result = await makeService().resolveManualInput(1, 'tok', '700', baseBook);

      expect(result).toEqual({ hardcoverBookId: 700, hardcoverEditionId: 901, title: 'Fyrebirds' });
      expect(mockClient.query).toHaveBeenCalledWith(1, 'tok', expect.stringContaining('query FindBookById'), { id: 700 });
    });

    it('resolves a slug when the input is not numeric', async () => {
      mockClient.query.mockResolvedValue({ books: [{ id: 686104, title: 'Fyrebirds', editions: [{ id: 30673405, pages: 382 }] }] });

      const result = await makeService().resolveManualInput(1, 'tok', 'fyrebirds', baseBook);

      expect(result).toEqual({ hardcoverBookId: 686104, hardcoverEditionId: 30673405, title: 'Fyrebirds' });
      expect(mockClient.query).toHaveBeenCalledWith(1, 'tok', expect.stringContaining('query FindBookBySlug'), { slug: 'fyrebirds' });
    });

    it('extracts the id from a Hardcover URL', async () => {
      mockClient.query.mockResolvedValue({ books: [{ id: 700, title: 'Fyrebirds', editions: [] }] });

      const result = await makeService().resolveManualInput(1, 'tok', 'https://hardcover.app/books/700', baseBook);

      expect(result?.hardcoverBookId).toBe(700);
      expect(mockClient.query).toHaveBeenCalledWith(1, 'tok', expect.stringContaining('query FindBookById'), { id: 700 });
    });

    it('extracts the slug from a Hardcover URL', async () => {
      mockClient.query.mockResolvedValue({ books: [{ id: 686104, title: 'Fyrebirds', editions: [] }] });

      const result = await makeService().resolveManualInput(1, 'tok', 'https://hardcover.app/books/fyrebirds', baseBook);

      expect(result?.hardcoverBookId).toBe(686104);
      expect(mockClient.query).toHaveBeenCalledWith(1, 'tok', expect.stringContaining('query FindBookBySlug'), { slug: 'fyrebirds' });
    });

    it('returns null when the book cannot be found', async () => {
      mockClient.query.mockResolvedValue({ books: [] });

      const result = await makeService().resolveManualInput(1, 'tok', '999999', baseBook);

      expect(result).toBeNull();
    });

    it('returns null on empty input', async () => {
      const result = await makeService().resolveManualInput(1, 'tok', '   ', baseBook);

      expect(result).toBeNull();
      expect(mockClient.query).not.toHaveBeenCalled();
    });

    it('returns null when the query throws', async () => {
      mockClient.query.mockRejectedValue(new Error('network error'));

      const result = await makeService().resolveManualInput(1, 'tok', '700', baseBook);

      expect(result).toBeNull();
    });
  });

  describe('getEditions', () => {
    it('maps raw editions to the public shape', async () => {
      mockClient.query.mockResolvedValue({
        books: [
          {
            id: 700,
            editions: [
              { id: 1, pages: 320, audio_seconds: null, reading_format_id: 1, release_date: '2019-05-01' },
              { id: 2, pages: null, audio_seconds: 36000, reading_format_id: 2, release_date: '2020-01-15' },
              { id: 3, pages: 300, audio_seconds: null, reading_format_id: 4, release_date: null },
            ],
          },
        ],
      });

      const result = await makeService().getEditions(1, 'tok', 700);

      expect(result).toEqual([
        { id: 1, format: 'Physical', pages: 320, audioSeconds: null, isAudio: false, year: 2019 },
        { id: 2, format: 'Audiobook', pages: null, audioSeconds: 36000, isAudio: true, year: 2020 },
        { id: 3, format: 'E-book', pages: 300, audioSeconds: null, isAudio: false, year: null },
      ]);
    });

    it('returns an empty array when the book has no editions', async () => {
      mockClient.query.mockResolvedValue({ books: [] });

      const result = await makeService().getEditions(1, 'tok', 700);

      expect(result).toEqual([]);
    });

    it('returns an empty array when the query throws', async () => {
      mockClient.query.mockRejectedValue(new Error('network error'));

      const result = await makeService().getEditions(1, 'tok', 700);

      expect(result).toEqual([]);
    });
  });
});
