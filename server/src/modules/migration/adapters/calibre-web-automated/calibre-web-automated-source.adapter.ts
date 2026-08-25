import { BadRequestException, Injectable } from '@nestjs/common';

import type { SourceAdapter, SourceExportData, SourceSnapshot, SourceValidationResult } from '../source-adapter.types';
import type { CalibreWebAutomatedConnectionConfig } from './calibre-web-automated-connection-config';
import { CalibreWebAutomatedNormalizer } from './calibre-web-automated-normalizer';
import { CalibreWebAutomatedSnapshotConnector } from './calibre-web-automated-snapshot.connector';
import type { CalibreWebAutomatedNormalizationResult } from './calibre-web-automated-source.types';

@Injectable()
export class CalibreWebAutomatedSourceAdapter implements SourceAdapter<CalibreWebAutomatedConnectionConfig> {
  readonly type = 'calibre_web_automated';

  constructor(
    private readonly connector: CalibreWebAutomatedSnapshotConnector,
    private readonly normalizer: CalibreWebAutomatedNormalizer,
  ) {}

  async validate(config: CalibreWebAutomatedConnectionConfig): Promise<SourceValidationResult> {
    const normalized = await this.fetchNormalized(config);
    return {
      ok: true,
      sourceType: this.type,
      sourceVersion: normalized.sourceVersion,
      missingTables: [],
      warnings: normalized.warnings,
      counts: buildCounts(normalized),
    };
  }

  async snapshot(config: CalibreWebAutomatedConnectionConfig): Promise<SourceSnapshot> {
    const normalized = await this.fetchNormalized(config);
    return {
      generatedAt: new Date().toISOString(),
      sourceType: this.type,
      sourceVersion: normalized.sourceVersion,
      counts: buildCounts(normalized),
    };
  }

  async exportData(config: CalibreWebAutomatedConnectionConfig): Promise<SourceExportData> {
    return (await this.fetchNormalized(config)).data;
  }

  async fetchPathPrefixes(config: CalibreWebAutomatedConnectionConfig): Promise<string[]> {
    return (await this.fetchNormalized(config)).pathPrefixes;
  }

  private async fetchNormalized(config: CalibreWebAutomatedConnectionConfig): Promise<CalibreWebAutomatedNormalizationResult> {
    let combined: CalibreWebAutomatedNormalizationResult | null = null;
    for await (const records of this.connector.streamSourceRecordBatches(config)) {
      const batch = this.normalizer.normalize(records, combined == null);
      if (!combined) {
        combined = batch;
        continue;
      }
      combined.data.books.push(...batch.data.books);
      combined.data.userBookStatuses.push(...batch.data.userBookStatuses);
      combined.data.userFileProgress.push(...batch.data.userFileProgress);
      combined.data.shelfBooks.push(...batch.data.shelfBooks);
      combined.pathPrefixes = [...new Set([...combined.pathPrefixes, ...batch.pathPrefixes])].sort((left, right) => left.localeCompare(right));
      combined.compatibilityWarnings = [...new Set([...combined.compatibilityWarnings, ...batch.compatibilityWarnings])];
      for (const [category, count] of Object.entries(batch.counters)) {
        combined.counters[category] = (combined.counters[category] ?? 0) + count;
      }
    }
    if (!combined) throw new BadRequestException('Calibre-Web Automated snapshot did not produce an import batch');
    combined.warnings = [
      ...combined.compatibilityWarnings,
      ...Object.entries(combined.counters).map(([category, count]) => `${count} source rows reported ${category.replaceAll('_', ' ')}`),
    ];
    return combined;
  }
}

function buildCounts(normalized: CalibreWebAutomatedNormalizationResult): Record<string, number> {
  const { data } = normalized;
  return {
    users: data.users.length,
    books: data.books.length,
    files: data.books.reduce((total, book) => total + (book.files?.length ?? 0), 0),
    userBookStatuses: data.userBookStatuses.length,
    userFileProgress: data.userFileProgress.length,
    shelves: data.shelves.length,
    shelfBooks: data.shelfBooks.length,
  };
}
