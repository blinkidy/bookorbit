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
}

// StoryGraph's search results can surface sparse, user-submitted duplicate entries above the
// canonical, well-populated book page. We can't tell them apart from the search listing alone,
// so we fetch a few top candidates and pick the one that looks most canonical.
const MAX_MATCH_CANDIDATES = 3;

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

      const candidateIds = this.parseNonAudioResultIds(response.html, MAX_MATCH_CANDIDATES);
      if (candidateIds.length === 0) return null;

      const bookId = candidateIds.length === 1 ? candidateIds[0]! : await this.pickBestCandidate(userId, cookies, candidateIds);

      return { storygraphBookId: bookId, matchMethod };
    } catch (err) {
      const error = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.warn(
        `[storygraph.book_match] [fail] userId=${userId} bookId=${book.bookId} method=${matchMethod} error="${error}" - search failed`,
      );
      return null;
    }
  }

  private parseNonAudioResultIds(html: string, limit: number): string[] {
    const $ = cheerio.load(html);
    const blocks = $('.book-title-author-and-series');
    const ids: string[] = [];

    for (let i = 0; i < blocks.length && ids.length < limit; i++) {
      const block = $(blocks[i]);
      const titleLink = block.find("a[href^='/books/']").first();
      const href = titleLink.attr('href');
      if (!href) continue;

      const idMatch = /\/books\/([^/?]+)/.exec(href);
      if (!idMatch?.[1]) continue;

      const pane = block.parent();
      const editionInfoText = pane.find('.edition-info').text().toLowerCase();
      if (editionInfoText.includes('format:') && editionInfoText.includes('audio')) continue;

      ids.push(idMatch[1]);
    }

    return ids;
  }

  /**
   * Fetches each candidate's own book page and picks the one that looks most canonical:
   * not a "user-added" placeholder, and with the most editions tracked against it.
   * Falls back to the first candidate if every fetch fails.
   */
  private async pickBestCandidate(userId: number, cookies: StorygraphCookies, candidateIds: string[]): Promise<string> {
    let best: { id: string; score: number } | null = null;

    for (const id of candidateIds) {
      try {
        const response = await this.client.get(userId, cookies, `/books/${id}`);
        if (response.redirectedToSignIn || response.status !== 200) continue;

        const score = this.scoreCandidateQuality(this.parseCandidateQuality(response.html));
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
    return {
      editionCount: editionMatch ? parseInt(editionMatch[1]!, 10) : 1,
      isUserAdded: /user-added/i.test(text),
    };
  }

  private scoreCandidateQuality(quality: CandidateQuality): number {
    return (quality.isUserAdded ? 0 : 1_000_000) + quality.editionCount;
  }
}
