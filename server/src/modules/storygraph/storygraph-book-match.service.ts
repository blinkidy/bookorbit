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

      const bookId = this.parseFirstNonAudioResult(response.html);
      if (!bookId) return null;

      return { storygraphBookId: bookId, matchMethod };
    } catch (err) {
      const error = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.warn(
        `[storygraph.book_match] [fail] userId=${userId} bookId=${book.bookId} method=${matchMethod} error="${error}" - search failed`,
      );
      return null;
    }
  }

  private parseFirstNonAudioResult(html: string): string | null {
    const $ = cheerio.load(html);
    const blocks = $('.book-title-author-and-series');

    for (let i = 0; i < blocks.length; i++) {
      const block = $(blocks[i]);
      const titleLink = block.find("a[href^='/books/']").first();
      const href = titleLink.attr('href');
      if (!href) continue;

      const idMatch = /\/books\/([^/?]+)/.exec(href);
      if (!idMatch?.[1]) continue;

      const pane = block.parent();
      const editionInfoText = pane.find('.edition-info').text().toLowerCase();
      if (editionInfoText.includes('format:') && editionInfoText.includes('audio')) continue;

      return idMatch[1];
    }

    return null;
  }
}
