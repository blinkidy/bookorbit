import { Injectable, Logger } from '@nestjs/common';
import * as cheerio from 'cheerio';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { StorygraphClientService, type StorygraphCookies } from './storygraph-client.service';
import type { BookSyncData } from './storygraph.repository';
import { StorygraphRepository } from './storygraph.repository';

export interface StorygraphBookMatch {
  storygraphBookId: string;
  matchMethod: 'isbn' | 'title' | 'cached';
}

interface CandidateQuality {
  editionCount: number;
  isUserAdded: boolean;
  isAudio: boolean;
}

// StoryGraph's search results can surface sparse, user-submitted duplicate entries (or a
// differently-formatted entry, e.g. an audiobook when the local file is text) above the entry
// that actually matches what's in the user's library. We can't tell candidates apart from the
// search listing alone, so we fetch a few top candidates' own pages and pick the best one.
const MAX_MATCH_CANDIDATES = 3;

const AUDIO_FORMATS = new Set(['m4b', 'm4a', 'mp3', 'aax', 'aacx', 'aac', 'flac', 'ogg', 'opus', 'wma', 'mka']);

@Injectable()
export class StorygraphBookMatchService {
  private readonly logger = new Logger(StorygraphBookMatchService.name);

  constructor(
    private readonly repo: StorygraphRepository,
    private readonly client: StorygraphClientService,
  ) {}

  async matchBook(userId: number, cookies: StorygraphCookies, book: BookSyncData): Promise<StorygraphBookMatch | null> {
    const cached = await this.repo.findBookState(userId, book.bookId);
    if (cached?.storygraphBookId && !cached.matchError) {
      return { storygraphBookId: cached.storygraphBookId, matchMethod: 'cached' };
    }

    let match: StorygraphBookMatch | null = null;

    if (book.isbn13) {
      match = await this.searchForBook(userId, cookies, book.isbn13, book, 'isbn');
    }

    if (!match && book.isbn10) {
      match = await this.searchForBook(userId, cookies, book.isbn10, book, 'isbn');
    }

    if (!match && book.title && book.authorName) {
      match = await this.searchForBook(userId, cookies, `${book.title} ${book.authorName}`, book, 'title');
    }

    if (match) {
      await this.repo.upsertBookState({
        userId,
        bookId: book.bookId,
        storygraphBookId: match.storygraphBookId,
        matchMethod: match.matchMethod,
        matchError: null,
      });
    } else {
      await this.repo.upsertBookState({
        userId,
        bookId: book.bookId,
        storygraphBookId: null,
        matchError: 'no_match',
      });
    }

    return match;
  }

  private async searchForBook(
    userId: number,
    cookies: StorygraphCookies,
    searchTerm: string,
    book: BookSyncData,
    matchMethod: 'isbn' | 'title',
  ): Promise<StorygraphBookMatch | null> {
    try {
      const response = await this.client.get(userId, cookies, `/browse?search_term=${encodeURIComponent(searchTerm)}`);
      if (response.redirectedToSignIn || response.status !== 200) return null;

      const candidateIds = this.parseResultIds(response.html, MAX_MATCH_CANDIDATES);
      if (candidateIds.length === 0) return null;

      const bookId = await this.pickBestCandidate(userId, cookies, candidateIds, this.localIsAudio(book.format));

      return { storygraphBookId: bookId, matchMethod };
    } catch (err) {
      const error = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.warn(
        `[storygraph.book_match] [fail] userId=${userId} bookId=${book.bookId} method=${matchMethod} error="${error}" - search failed`,
      );
      return null;
    }
  }

  private parseResultIds(html: string, limit: number): string[] {
    const $ = cheerio.load(html);
    const blocks = $('.book-title-author-and-series');
    const ids: string[] = [];

    for (let i = 0; i < blocks.length && ids.length < limit; i++) {
      const titleLink = $(blocks[i]).find("a[href^='/books/']").first();
      const href = titleLink.attr('href');
      if (!href) continue;

      const idMatch = /\/books\/([^/?]+)/.exec(href);
      if (!idMatch?.[1]) continue;

      ids.push(idMatch[1]);
    }

    return ids;
  }

  /**
   * Fetches each candidate's own book page and picks the best one: matching the local file's
   * format (text vs. audio) first, then preferring a canonical entry (not "user-added") with
   * more tracked editions. Falls back to the first candidate if every fetch fails.
   */
  private async pickBestCandidate(userId: number, cookies: StorygraphCookies, candidateIds: string[], wantAudio: boolean): Promise<string> {
    let best: { id: string; score: number } | null = null;

    for (const id of candidateIds) {
      try {
        const response = await this.client.get(userId, cookies, `/books/${id}`);
        if (response.redirectedToSignIn || response.status !== 200) continue;

        const score = this.scoreCandidateQuality(this.parseCandidateQuality(response.html), wantAudio);
        if (!best || score > best.score) best = { id, score };
      } catch {
        continue;
      }
    }

    return best?.id ?? candidateIds[0]!;
  }

  private parseCandidateQuality(html: string): CandidateQuality {
    const text = cheerio.load(html)('body').text();
    const editionMatch = /(\d+)\s+editions?\b/i.exec(text);
    const formatMatch = /Format:\s*([^\n•·|]+)/i.exec(text);
    return {
      editionCount: editionMatch ? parseInt(editionMatch[1]!, 10) : 1,
      isUserAdded: /user-added/i.test(text),
      isAudio: formatMatch ? /audio/i.test(formatMatch[1]!) : false,
    };
  }

  private scoreCandidateQuality(quality: CandidateQuality, wantAudio: boolean): number {
    const formatAligned = quality.isAudio === wantAudio;
    return (formatAligned ? 10_000_000 : 0) + (quality.isUserAdded ? 0 : 1_000_000) + quality.editionCount;
  }

  private localIsAudio(format: string | null): boolean {
    if (!format) return false;
    return AUDIO_FORMATS.has(format.toLowerCase());
  }
}
