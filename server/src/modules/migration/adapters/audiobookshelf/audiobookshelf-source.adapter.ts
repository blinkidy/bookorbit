import { BadRequestException, Injectable } from '@nestjs/common';

import type { SourceAdapter, SourceExportData, SourceSnapshot, SourceValidationResult } from '../source-adapter.types';
import { AudiobookshelfApiConnector } from './audiobookshelf-api.connector';
import { AudiobookshelfBackupConnector } from './audiobookshelf-backup.connector';
import type { AudiobookshelfConnectionConfig } from './audiobookshelf-connection-config';
import { AudiobookshelfNormalizer } from './audiobookshelf-normalizer';
import type { AudiobookshelfNormalizationResult } from './audiobookshelf-source.types';

@Injectable()
export class AudiobookshelfSourceAdapter implements SourceAdapter<AudiobookshelfConnectionConfig> {
  readonly type = 'audiobookshelf';

  constructor(
    private readonly apiConnector: AudiobookshelfApiConnector,
    private readonly backupConnector: AudiobookshelfBackupConnector,
    private readonly normalizer: AudiobookshelfNormalizer,
  ) {}

  async validate(config: AudiobookshelfConnectionConfig): Promise<SourceValidationResult> {
    if (config.mode === 'backup') {
      const normalized = await this.fetchNormalizedBackup(config);
      return {
        ok: true,
        sourceType: this.type,
        sourceVersion: normalized.sourceVersion,
        missingTables: [],
        warnings: normalized.warnings,
        counts: buildCounts(normalized),
      };
    }

    // A live library can hold tens of thousands of expanded items and every user's
    // full session history. Validation only needs reachability, credentials and counts.
    const summary = await this.apiConnector.fetchSnapshotSummary(config);
    return {
      ok: true,
      sourceType: this.type,
      sourceVersion: summary.sourceVersion,
      missingTables: [],
      warnings: [],
      counts: summary.counts,
    };
  }

  async snapshot(config: AudiobookshelfConnectionConfig): Promise<SourceSnapshot> {
    if (config.mode === 'backup') {
      const normalized = await this.fetchNormalizedBackup(config);
      return {
        generatedAt: new Date().toISOString(),
        sourceType: this.type,
        sourceVersion: normalized.sourceVersion,
        counts: buildCounts(normalized),
      };
    }
    const summary = await this.apiConnector.fetchSnapshotSummary(config);
    return {
      generatedAt: new Date().toISOString(),
      sourceType: this.type,
      sourceVersion: summary.sourceVersion,
      counts: summary.counts,
    };
  }

  async exportData(config: AudiobookshelfConnectionConfig): Promise<SourceExportData> {
    return (config.mode === 'api' ? await this.fetchNormalizedApi(config) : await this.fetchNormalizedBackup(config)).data;
  }

  async fetchPathPrefixes(config: AudiobookshelfConnectionConfig): Promise<string[]> {
    if (config.mode === 'backup') return (await this.fetchNormalizedBackup(config)).pathPrefixes;
    const folders = await this.apiConnector.fetchLibraryFolders(config);
    const prefixes = new Set<string>();
    for (const folder of folders) {
      const value = folder.path.trim();
      const normalized = value !== '/' && !/^[A-Za-z]:[\\/]$/.test(value) ? value.replace(/[\\/]+$/, '') : value;
      if (normalized) prefixes.add(normalized);
    }
    return [...prefixes].sort((left, right) => left.localeCompare(right));
  }

  private async fetchNormalizedApi(config: Extract<AudiobookshelfConnectionConfig, { mode: 'api' }>): Promise<AudiobookshelfNormalizationResult> {
    let accumulator: ReturnType<AudiobookshelfNormalizer['createAccumulator']> | null = null;
    for await (const batch of this.apiConnector.streamSourceBatches(config)) {
      if (batch.kind === 'metadata') {
        accumulator = this.normalizer.createAccumulator(batch);
        continue;
      }
      if (!accumulator) throw new BadRequestException('Audiobookshelf import metadata was unavailable');
      if (batch.kind === 'libraryItems') {
        accumulator.addLibraryItems(batch.records);
      } else if (batch.kind === 'userState') {
        accumulator.addUsers([batch.user]);
        accumulator.addMediaProgress(batch.mediaProgress);
        accumulator.addBookmarks(batch.bookmarks);
      } else {
        accumulator.addPlaybackSessions(batch.records);
      }
    }
    if (!accumulator) throw new BadRequestException('Audiobookshelf import metadata was unavailable');
    return accumulator.finish();
  }

  private async fetchNormalizedBackup(
    config: Extract<AudiobookshelfConnectionConfig, { mode: 'backup' }>,
  ): Promise<AudiobookshelfNormalizationResult> {
    return this.normalizer.normalize(await this.backupConnector.fetchSourceRecords(config));
  }
}

function buildCounts(normalized: AudiobookshelfNormalizationResult): Record<string, number> {
  const { data } = normalized;
  return {
    users: data.users.length,
    books: data.books.length,
    files: data.books.reduce((total, book) => total + (book.files?.length ?? 0), 0),
    userBookStatuses: data.userBookStatuses.length,
    userFileProgress: data.userFileProgress.length,
    readingSessions: data.readingSessions.length,
    bookmarks: data.bookmarks.length,
  };
}
