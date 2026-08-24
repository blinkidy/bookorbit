import { Injectable } from '@nestjs/common';

import type {
  SourceBook,
  SourceBookFile,
  SourceContributor,
  SourceExportData,
  SourceExportDomains,
  SourceUserBookStatus,
  SourceUserFileProgress,
} from '../source-adapter.types';
import type {
  AudiobookshelfAudioFileRecord,
  AudiobookshelfBookLibraryItemRecord,
  AudiobookshelfBookRecord,
  AudiobookshelfBookmarkRecord,
  AudiobookshelfEbookFileRecord,
  AudiobookshelfLibraryFolderRecord,
  AudiobookshelfLibraryItemRecord,
  AudiobookshelfMediaProgressRecord,
  AudiobookshelfNormalizationCounters,
  AudiobookshelfNormalizationResult,
  AudiobookshelfPlaybackSessionRecord,
  AudiobookshelfSourceRecords,
  AudiobookshelfTimestamp,
  AudiobookshelfUserRecord,
} from './audiobookshelf-source.types';

const MAX_SESSION_DURATION_SECONDS = 7 * 24 * 60 * 60;
const METADATA_PRESENT_FIELDS = [
  'title',
  'subtitle',
  'isbn10',
  'isbn13',
  'description',
  'publisher',
  'publishedYear',
  'language',
  'seriesName',
  'seriesIndex',
  'durationSeconds',
  'abridged',
] as const;

type MetadataField = (typeof METADATA_PRESENT_FIELDS)[number];

interface NormalizedBookContext {
  sourceBook: SourceBook;
  itemId: string;
  audioFiles: SourceBookFile[];
  ebookFile: SourceBookFile | null;
}

@Injectable()
export class AudiobookshelfNormalizer {
  normalize(records: AudiobookshelfSourceRecords): AudiobookshelfNormalizationResult {
    const accumulator = this.createAccumulator({
      sourceVersion: records.sourceVersion,
      libraryFolders: records.libraryFolders ?? [],
      authorsAvailable: records.authorsAvailable !== false,
      warnings: records.warnings ?? [],
      playbackSessionsAvailable: records.playbackSessions !== null,
    });
    accumulator.addUsers(records.users);
    accumulator.addLibraryItems(records.libraryItems);
    accumulator.addMediaProgress(records.mediaProgress);
    accumulator.addBookmarks(records.bookmarks);
    if (records.playbackSessions) accumulator.addPlaybackSessions(records.playbackSessions);
    return accumulator.finish();
  }

  createAccumulator(metadata: AudiobookshelfNormalizationMetadata): AudiobookshelfNormalizationAccumulator {
    return new AudiobookshelfNormalizationAccumulator(metadata);
  }
}

export interface AudiobookshelfNormalizationMetadata {
  sourceVersion: string | null;
  libraryFolders: AudiobookshelfLibraryFolderRecord[];
  authorsAvailable: boolean;
  warnings: string[];
  playbackSessionsAvailable: boolean;
}

export class AudiobookshelfNormalizationAccumulator {
  private readonly counters = createCounters();
  private readonly warnings: Set<string>;
  private readonly users: SourceExportData['users'] = [];
  private readonly sourceUserIds = new Set<string>();
  private readonly books: SourceBook[] = [];
  private readonly bookContextsById = new Map<string, NormalizedBookContext>();
  private readonly itemKindById = new Map<string, 'book' | 'podcast'>();
  private readonly bookIdByItemId = new Map<string, string>();
  private readonly userBookStatuses: SourceUserBookStatus[] = [];
  private readonly userFileProgress: SourceUserFileProgress[] = [];
  private readonly bookmarks: SourceExportData['bookmarks'] = [];
  private readonly readingSessions: SourceExportData['readingSessions'] = [];

  constructor(private readonly metadata: AudiobookshelfNormalizationMetadata) {
    this.warnings = new Set(metadata.warnings.map((warning) => warning.trim()).filter(Boolean));
  }

  addUsers(records: AudiobookshelfUserRecord[]): void {
    for (const record of records) {
      const sourceUserId = normalizeId(record.id);
      const username = normalizeRequiredText(record.username);
      if (!sourceUserId || !username) {
        this.counters.invalidUsersSkipped++;
        continue;
      }
      if (record.isActive === false) this.counters.disabledUsersIncluded++;
      this.sourceUserIds.add(sourceUserId);
      this.users.push({ sourceUserId, username, name: null, email: normalizeNullableText(record.email) });
    }
  }

  addLibraryItems(records: AudiobookshelfLibraryItemRecord[]): void {
    for (const item of records) {
      const itemId = normalizeId(item.id);
      if (!itemId) {
        this.counters.invalidBooksSkipped++;
        continue;
      }
      if (this.itemKindById.has(itemId)) {
        this.counters.invalidBooksSkipped++;
        continue;
      }
      if (item.mediaType !== 'book') {
        this.itemKindById.set(itemId, 'podcast');
        this.counters.podcastItemsSkipped++;
        continue;
      }

      const context = normalizeBook(item);
      if (!context || this.bookContextsById.has(context.sourceBook.sourceBookId)) {
        this.counters.invalidBooksSkipped++;
        continue;
      }

      this.itemKindById.set(itemId, 'book');
      this.bookIdByItemId.set(itemId, context.sourceBook.sourceBookId);
      this.bookContextsById.set(context.sourceBook.sourceBookId, context);
      this.books.push(context.sourceBook);
    }
  }

  addMediaProgress(records: AudiobookshelfMediaProgressRecord[]): void {
    for (const progress of records) {
      if (normalizeMediaItemType(progress.mediaItemType) !== 'book') {
        this.counters.podcastProgressSkipped++;
        continue;
      }

      const sourceUserId = normalizeId(progress.userId);
      const sourceBookId = normalizeId(progress.mediaItemId);
      const context = sourceBookId ? this.bookContextsById.get(sourceBookId) : null;
      if (!sourceUserId || !this.sourceUserIds.has(sourceUserId) || !context) {
        this.counters.orphanedProgressSkipped++;
        continue;
      }

      const audioPercentage = calculateAudioPercentage(progress, context.sourceBook.durationSeconds);
      const ebookPercentage = fractionToPercentage(progress.ebookProgress);
      const statusPercentage = progress.isFinished === true ? 100 : Math.max(audioPercentage ?? 0, ebookPercentage ?? 0);
      const updatedAt = normalizeTimestamp(progress.lastUpdate) ?? normalizeTimestamp(progress.updatedAt);
      // A resume position is evidence of reading even when the server reports no percentage,
      // otherwise the imported file progress would contradict an "unread" status.
      const hasResumePosition = hasEpubLocation(progress) || hasPositiveAudioPosition(progress);

      this.userBookStatuses.push({
        sourceUserId,
        sourceBookId: context.sourceBook.sourceBookId,
        status: progress.isFinished === true ? 'read' : statusPercentage > 0 || hasResumePosition ? 'reading' : 'unread',
        percentage: statusPercentage,
        startedAt: normalizeTimestamp(progress.startedAt) ?? normalizeTimestamp(progress.createdAt),
        finishedAt: progress.isFinished === true ? normalizeTimestamp(progress.finishedAt) : null,
        updatedAt,
      });

      const audioProgress = normalizeAudioProgress(progress, context, sourceUserId, updatedAt);
      if (audioProgress) {
        this.userFileProgress.push(audioProgress);
      } else if (hasPositiveAudioPosition(progress)) {
        this.counters.unresolvedAudioProgressSkipped++;
      }

      const ebookProgress = normalizeEbookProgress(progress, context, sourceUserId, updatedAt);
      if (ebookProgress.progress) this.userFileProgress.push(ebookProgress.progress);
      if (ebookProgress.unsupported) this.counters.unsupportedEbookProgressSkipped++;
    }
  }

  addBookmarks(records: AudiobookshelfBookmarkRecord[]): void {
    for (const bookmark of records) {
      const sourceUserId = normalizeId(bookmark.userId);
      const itemId = normalizeId(bookmark.libraryItemId);
      if (itemId && this.itemKindById.get(itemId) === 'podcast') {
        this.counters.podcastBookmarksSkipped++;
        continue;
      }

      const sourceBookId = itemId ? this.bookIdByItemId.get(itemId) : null;
      if (!sourceUserId || !this.sourceUserIds.has(sourceUserId) || !sourceBookId) {
        this.counters.orphanedBookmarksSkipped++;
        continue;
      }
      if (!Number.isFinite(bookmark.time) || bookmark.time < 0) {
        this.counters.invalidBookmarksSkipped++;
        continue;
      }

      this.bookmarks.push({
        sourceUserId,
        sourceBookId,
        title: normalizeNullableText(bookmark.title),
        cfi: null,
        positionSeconds: bookmark.time,
        createdAt: normalizeTimestamp(bookmark.createdAt),
      });
    }
  }

  addPlaybackSessions(records: AudiobookshelfPlaybackSessionRecord[]): void {
    for (const session of records) {
      if (normalizeMediaItemType(session.mediaItemType) !== 'book') {
        this.counters.podcastSessionsSkipped++;
        continue;
      }

      const sourceSessionId = normalizeId(session.id);
      const sourceUserId = normalizeId(session.userId);
      const sourceBookId = normalizeId(session.mediaItemId);
      const context = sourceBookId ? this.bookContextsById.get(sourceBookId) : null;
      if (!sourceUserId || !this.sourceUserIds.has(sourceUserId) || !context) {
        this.counters.orphanedSessionsSkipped++;
        continue;
      }

      const startedAt = normalizeTimestamp(session.startedAt) ?? normalizeTimestamp(session.createdAt);
      const endedAt = normalizeTimestamp(session.updatedAt);
      const startedMs = startedAt ? Date.parse(startedAt) : Number.NaN;
      const endedMs = endedAt ? Date.parse(endedAt) : Number.NaN;
      const wallClockSeconds = (endedMs - startedMs) / 1000;
      const hasValidNumbers =
        Number.isFinite(session.duration) &&
        session.duration > 0 &&
        Number.isFinite(session.startTime) &&
        session.startTime >= 0 &&
        Number.isFinite(session.currentTime) &&
        session.currentTime >= session.startTime &&
        Number.isFinite(session.timeListening) &&
        session.timeListening > 0 &&
        session.timeListening <= MAX_SESSION_DURATION_SECONDS;

      if (
        !sourceSessionId ||
        !startedAt ||
        !endedAt ||
        !Number.isFinite(wallClockSeconds) ||
        wallClockSeconds < session.timeListening ||
        !hasValidNumbers ||
        context.audioFiles.length === 0
      ) {
        this.counters.invalidSessionsSkipped++;
        continue;
      }

      this.readingSessions.push({
        sourceSessionId,
        sourceUserId,
        sourceBookId: context.sourceBook.sourceBookId,
        bookType: 'AUDIOBOOK',
        startedAt,
        endedAt,
        durationSeconds: session.timeListening,
        progressDelta: clampPercentage(((session.currentTime - session.startTime) / session.duration) * 100),
        endProgress: clampPercentage((session.currentTime / session.duration) * 100),
        createdAt: startedAt,
      });
    }
  }

  finish(): AudiobookshelfNormalizationResult {
    appendDiagnosticWarnings(this.warnings, this.counters, !this.metadata.playbackSessionsAvailable);

    const availableDomains: SourceExportDomains = {
      metadata: true,
      authors: this.metadata.authorsAvailable,
      narrators: true,
      genres: true,
      tags: true,
      userBookStatuses: true,
      readingProgress: true,
      readingSessions: this.metadata.playbackSessionsAvailable,
      bookmarks: true,
      annotations: false,
      shelves: false,
      covers: false,
    };

    return {
      data: {
        users: this.users,
        books: this.books,
        userBookStatuses: this.userBookStatuses,
        userFileProgress: this.userFileProgress,
        readingSessions: this.readingSessions,
        bookmarks: this.bookmarks,
        annotations: [],
        shelves: [],
        shelfBooks: [],
        availableDomains,
      },
      sourceVersion: normalizeNullableText(this.metadata.sourceVersion),
      pathPrefixes: normalizePathPrefixes(this.metadata.libraryFolders.map((folder) => folder.path)),
      warnings: [...this.warnings],
      counters: this.counters,
    };
  }
}

function normalizeBook(item: AudiobookshelfBookLibraryItemRecord): NormalizedBookContext | null {
  const sourceBookId = normalizeId(item.book.id);
  if (!sourceBookId) return null;

  const audioFiles = normalizeAudioFiles(sourceBookId, item.book.audioFiles ?? []);
  const ebookFile = item.book.ebookFile ? normalizeEbookFile(sourceBookId, item.book.ebookFile) : null;
  const files = ebookFile ? [...audioFiles, ebookFile] : audioFiles;
  const authors = normalizeAuthors(item.book);
  const narrators = normalizeNarrators(item.book.narrators ?? []);
  const firstSeries = item.book.series?.find((series) => normalizeRequiredText(series.name)) ?? null;
  const { isbn10, isbn13 } = normalizeIsbn(item.book.isbn);
  const asin = normalizeAsin(item.book.asin);
  const asinMetadataField = audioFiles.length > 0 ? 'audibleId' : 'amazonId';

  const metadata = {
    title: normalizeNullableText(item.book.title),
    subtitle: normalizeNullableText(item.book.subtitle),
    isbn10,
    isbn13,
    description: normalizeNullableText(item.book.description),
    publisher: normalizeNullableText(item.book.publisher),
    publishedYear: normalizePublishedYear(item.book.publishedYear),
    language: normalizeNullableText(item.book.language),
    seriesName: firstSeries ? normalizeNullableText(firstSeries.name) : null,
    seriesIndex: firstSeries ? normalizeSeriesIndex(firstSeries.sequence) : null,
    durationSeconds: normalizeNonNegativeNumber(item.book.duration),
    abridged: item.book.abridged == null ? null : item.book.abridged === true,
  } satisfies Record<MetadataField, string | number | boolean | null>;

  // Audiobookshelf metadata is frequently sparser than an enriched BookOrbit library, so a
  // field only counts as present when it carries a value. Listing it unconditionally would
  // overlay NULL and erase good target metadata.
  const presentFields = [...METADATA_PRESENT_FIELDS.filter((field) => metadata[field] !== null), ...(asin ? [asinMetadataField] : [])];

  const sourceBook: SourceBook = {
    sourceBookId,
    ...metadata,
    author: authors.length > 0 ? authors.map((author) => author.name).join(', ') : null,
    asin,
    ...(asin ? (asinMetadataField === 'audibleId' ? { audibleId: asin } : { amazonId: asin }) : {}),
    authors,
    narrators,
    filePath: normalizeNullableText(item.path),
    fileHash: null,
    files,
    genres: normalizeStringList(item.book.genres ?? []),
    tags: normalizeStringList(item.book.tags ?? []),
    presentFields,
  };

  return {
    sourceBook,
    itemId: normalizeId(item.id)!,
    audioFiles,
    ebookFile,
  };
}

function normalizeAudioFiles(sourceBookId: string, records: AudiobookshelfAudioFileRecord[]): SourceBookFile[] {
  const usedSourceFileIds = new Set<string>();
  const ordered = records
    .map((record, originalIndex) => ({ record, originalIndex }))
    .filter(({ record }) => record.exclude !== true && record.invalid !== true)
    .sort((left, right) => {
      const leftIndex = normalizeOrder(left.record.index);
      const rightIndex = normalizeOrder(right.record.index);
      if (leftIndex !== null && rightIndex !== null && leftIndex !== rightIndex) return leftIndex - rightIndex;
      if (leftIndex !== null && rightIndex === null) return -1;
      if (leftIndex === null && rightIndex !== null) return 1;
      return left.originalIndex - right.originalIndex;
    });

  return ordered.map(({ record }, sortOrder) => {
    const filePath = normalizeNullableText(record.metadata.path);
    const fileSubPath =
      normalizeRelativePath(record.metadata.relPath) ?? normalizeRelativePath(record.metadata.filename) ?? normalizeRelativePath(filePath);
    const baseSourceFileId = buildSourceFileId(sourceBookId, 'audio', record.ino, fileSubPath, sortOrder);
    const sourceFileId = ensureUniqueSourceFileId(baseSourceFileId, fileSubPath, sortOrder, usedSourceFileIds);
    return {
      sourceFileId,
      sourceBookId,
      filePath,
      fileHash: null,
      fileName: normalizeNullableText(record.metadata.filename) ?? fileNameFromPath(filePath),
      fileSubPath,
      durationSeconds: normalizeNonNegativeNumber(record.duration),
      format: normalizeFormat(record.metadata.ext) ?? normalizeFormat(record.format),
      sortOrder,
    };
  });
}

function normalizeEbookFile(sourceBookId: string, record: AudiobookshelfEbookFileRecord): SourceBookFile {
  const filePath = normalizeNullableText(record.metadata.path);
  const fileSubPath =
    normalizeRelativePath(record.metadata.relPath) ?? normalizeRelativePath(record.metadata.filename) ?? normalizeRelativePath(filePath);
  return {
    sourceFileId: buildSourceFileId(sourceBookId, 'ebook', record.ino, fileSubPath, 0),
    sourceBookId,
    filePath,
    fileHash: null,
    fileName: normalizeNullableText(record.metadata.filename) ?? fileNameFromPath(filePath),
    fileSubPath,
    durationSeconds: null,
    format: normalizeFormat(record.ebookFormat) ?? normalizeFormat(record.metadata.ext),
    sortOrder: 0,
  };
}

function normalizeAuthors(book: AudiobookshelfBookRecord): SourceContributor[] {
  const structured = (book.authors ?? []).flatMap((author, displayOrder) => {
    const name = normalizeRequiredText(author.name);
    if (!name) return [];
    return [
      {
        sourceContributorId: normalizeId(author.id),
        name,
        sortName: normalizeNullableText(author.sortName),
        description: normalizeNullableText(author.description),
        displayOrder,
      },
    ];
  });
  if (structured.length > 0) return deduplicateContributors(structured);

  const legacyName = normalizeRequiredText(book.authorName);
  if (!legacyName) return [];
  return [{ sourceContributorId: null, name: legacyName, sortName: null, description: null, displayOrder: 0 }];
}

function normalizeNarrators(narrators: string[]): SourceContributor[] {
  const contributors = narrators.flatMap((value, displayOrder) => {
    const name = normalizeRequiredText(value);
    if (!name) return [];
    return [{ sourceContributorId: null, name, sortName: null, description: null, displayOrder }];
  });
  return deduplicateContributors(contributors);
}

function deduplicateContributors(contributors: SourceContributor[]): SourceContributor[] {
  const seen = new Set<string>();
  const deduplicated: SourceContributor[] = [];
  for (const contributor of contributors) {
    const key = contributor.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduplicated.push({ ...contributor, displayOrder: deduplicated.length });
  }
  return deduplicated;
}

function normalizeAudioProgress(
  progress: AudiobookshelfMediaProgressRecord,
  context: NormalizedBookContext,
  sourceUserId: string,
  updatedAt: string | null,
): SourceUserFileProgress | null {
  const absolutePosition = normalizeNonNegativeNumber(progress.currentTime);
  if (absolutePosition === null || absolutePosition <= 0 || context.audioFiles.length === 0) return null;

  const resolved = resolveAudioPosition(context.audioFiles, absolutePosition);
  if (!resolved) return null;
  return {
    sourceUserId,
    sourceBookId: context.sourceBook.sourceBookId,
    sourceFileId: resolved.file.sourceFileId,
    percentage: calculateAudioPercentage(progress, context.sourceBook.durationSeconds),
    cfi: null,
    pageNumber: null,
    positionSeconds: resolved.localSeconds,
    updatedAt,
  };
}

function resolveAudioPosition(files: SourceBookFile[], absolutePosition: number): { file: SourceBookFile; localSeconds: number } | null {
  if (files.length === 1) {
    const file = files[0];
    const duration = positiveNumber(file.durationSeconds);
    return { file, localSeconds: duration === null ? absolutePosition : Math.min(absolutePosition, duration) };
  }

  let offset = 0;
  for (let index = 0; index < files.length; index++) {
    const file = files[index];
    const duration = positiveNumber(file.durationSeconds);
    if (duration === null) return null;
    const end = offset + duration;
    if (absolutePosition < end) return { file, localSeconds: absolutePosition - offset };
    if (absolutePosition === end && index < files.length - 1) return { file: files[index + 1], localSeconds: 0 };
    if (index === files.length - 1) return { file, localSeconds: duration };
    offset = end;
  }
  return null;
}

function normalizeEbookProgress(
  progress: AudiobookshelfMediaProgressRecord,
  context: NormalizedBookContext,
  sourceUserId: string,
  updatedAt: string | null,
): { progress: SourceUserFileProgress | null; unsupported: boolean } {
  const percentage = fractionToPercentage(progress.ebookProgress);
  const rawLocation = normalizeNullableText(progress.ebookLocation);
  const cfi = epubLocation(progress);
  const hasSignal = (percentage ?? 0) > 0 || cfi !== null;
  const hasInvalidLocation = rawLocation !== null && cfi === null;
  if (!hasSignal) return { progress: null, unsupported: hasInvalidLocation };
  if (!context.ebookFile || normalizeFormat(context.ebookFile.format) !== 'epub') {
    return { progress: null, unsupported: true };
  }

  return {
    progress: {
      sourceUserId,
      sourceBookId: context.sourceBook.sourceBookId,
      sourceFileId: context.ebookFile.sourceFileId,
      percentage: percentage ?? 0,
      cfi,
      pageNumber: null,
      positionSeconds: null,
      updatedAt,
    },
    unsupported: hasInvalidLocation,
  };
}

function calculateAudioPercentage(progress: AudiobookshelfMediaProgressRecord, bookDuration: number | null | undefined): number | null {
  const currentTime = normalizeNonNegativeNumber(progress.currentTime);
  const duration = positiveNumber(progress.duration) ?? positiveNumber(bookDuration);
  if (currentTime !== null && duration !== null) return clampPercentage((currentTime / duration) * 100);
  return fractionToPercentage(progress.progress);
}

function hasPositiveAudioPosition(progress: AudiobookshelfMediaProgressRecord): boolean {
  const currentTime = normalizeNonNegativeNumber(progress.currentTime);
  return currentTime !== null && currentTime > 0;
}

function epubLocation(progress: AudiobookshelfMediaProgressRecord): string | null {
  const rawLocation = normalizeNullableText(progress.ebookLocation);
  return rawLocation?.startsWith('epubcfi') ? rawLocation : null;
}

function hasEpubLocation(progress: AudiobookshelfMediaProgressRecord): boolean {
  return epubLocation(progress) !== null;
}

function normalizeMediaItemType(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeIsbn(value: string | null | undefined): { isbn10: string | null; isbn13: string | null } {
  if (!value) return { isbn10: null, isbn13: null };
  const normalized = value.replace(/[^0-9Xx]/g, '').toUpperCase();
  if (/^[0-9]{9}[0-9X]$/.test(normalized)) return { isbn10: normalized, isbn13: null };
  if (/^[0-9]{13}$/.test(normalized)) return { isbn10: null, isbn13: normalized };
  return { isbn10: null, isbn13: null };
}

function normalizeAsin(value: string | null | undefined): string | null {
  const normalized = value?.trim().toUpperCase() ?? '';
  return /^[A-Z0-9]{10}$/.test(normalized) ? normalized : null;
}

function normalizePublishedYear(value: string | number | null | undefined): number | null {
  if (value == null || value === '') return null;
  const normalized = typeof value === 'number' ? value : Number(value.trim());
  if (!Number.isInteger(normalized) || normalized < 1000 || normalized > 2200) return null;
  return normalized;
}

function normalizeSeriesIndex(value: string | number | null | undefined): number | null {
  if (value == null || value === '') return null;
  const normalized = typeof value === 'number' ? value : Number(value.trim());
  return Number.isFinite(normalized) ? normalized : null;
}

function normalizeTimestamp(value: AudiobookshelfTimestamp | undefined): string | null {
  if (value == null || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function fractionToPercentage(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return clampPercentage(value * 100);
}

function clampPercentage(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function normalizeNonNegativeNumber(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.max(0, value);
}

function positiveNumber(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  return value;
}

function normalizeOrder(value: number | null | undefined): number | null {
  return value == null || !Number.isFinite(value) ? null : value;
}

function normalizeFormat(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase().replace(/^\./, '') ?? '';
  return normalized || null;
}

function normalizeRequiredText(value: string | null | undefined): string | null {
  return normalizeNullableText(value);
}

function normalizeNullableText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeId(value: string | number | null | undefined): string | null {
  if (value == null) return null;
  return normalizeRequiredText(String(value));
}

function normalizeStringList(values: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of values) {
    const item = normalizeRequiredText(value);
    if (!item || seen.has(item)) continue;
    seen.add(item);
    normalized.push(item);
  }
  return normalized;
}

function normalizeRelativePath(value: string | null | undefined): string | null {
  const normalized = normalizeNullableText(value)?.replaceAll('\\', '/').replace(/^\/+/, '') ?? null;
  return normalized || null;
}

function fileNameFromPath(value: string | null): string | null {
  if (!value) return null;
  const parts = value.replaceAll('\\', '/').split('/');
  return normalizeNullableText(parts.at(-1));
}

function buildSourceFileId(
  sourceBookId: string,
  kind: 'audio' | 'ebook',
  inode: string | number | null | undefined,
  relativePath: string | null,
  fallbackOrder: number,
): string {
  const normalizedInode = normalizeId(inode);
  if (normalizedInode) return `${sourceBookId}:${kind}:${normalizedInode}`;
  const fallback = relativePath ?? `file-${fallbackOrder}`;
  return `${sourceBookId}:${kind}:path:${fallback}`;
}

function ensureUniqueSourceFileId(baseId: string, relativePath: string | null, fallbackOrder: number, usedIds: Set<string>): string {
  if (!usedIds.has(baseId)) {
    usedIds.add(baseId);
    return baseId;
  }
  const pathId = `${baseId}:path:${relativePath ?? `file-${fallbackOrder}`}`;
  const uniqueId = usedIds.has(pathId) ? `${pathId}:${fallbackOrder}` : pathId;
  usedIds.add(uniqueId);
  return uniqueId;
}

function normalizePathPrefixes(paths: string[]): string[] {
  const prefixes = new Set<string>();
  for (const path of paths) {
    const value = normalizeNullableText(path);
    const normalized = value && value !== '/' && !/^[A-Za-z]:[\\/]$/.test(value) ? value.replace(/[\\/]+$/, '') : value;
    if (normalized) prefixes.add(normalized);
  }
  return [...prefixes].sort((left, right) => left.localeCompare(right));
}

function createCounters(): AudiobookshelfNormalizationCounters {
  return {
    invalidUsersSkipped: 0,
    disabledUsersIncluded: 0,
    podcastItemsSkipped: 0,
    invalidBooksSkipped: 0,
    podcastProgressSkipped: 0,
    orphanedProgressSkipped: 0,
    unresolvedAudioProgressSkipped: 0,
    unsupportedEbookProgressSkipped: 0,
    podcastBookmarksSkipped: 0,
    orphanedBookmarksSkipped: 0,
    invalidBookmarksSkipped: 0,
    podcastSessionsSkipped: 0,
    orphanedSessionsSkipped: 0,
    invalidSessionsSkipped: 0,
  };
}

function appendDiagnosticWarnings(warnings: Set<string>, counters: AudiobookshelfNormalizationCounters, sessionsUnavailable: boolean): void {
  const descriptions: Array<[number, string]> = [
    [counters.invalidUsersSkipped, 'invalid users were skipped'],
    [counters.disabledUsersIncluded, 'disabled users remain available for mapping'],
    [counters.podcastItemsSkipped, 'podcast items were excluded'],
    [counters.invalidBooksSkipped, 'invalid or duplicate books were skipped'],
    [counters.podcastProgressSkipped, 'podcast progress rows were excluded'],
    [counters.orphanedProgressSkipped, 'orphaned progress rows were skipped'],
    [counters.unresolvedAudioProgressSkipped, 'audiobook positions could not be resolved safely'],
    [counters.unsupportedEbookProgressSkipped, 'unsupported ebook locations or progress rows were skipped partially or fully'],
    [counters.podcastBookmarksSkipped, 'podcast bookmarks were excluded'],
    [counters.orphanedBookmarksSkipped, 'orphaned bookmarks were skipped'],
    [counters.invalidBookmarksSkipped, 'invalid bookmarks were skipped'],
    [counters.podcastSessionsSkipped, 'podcast listening sessions were excluded'],
    [counters.orphanedSessionsSkipped, 'orphaned listening sessions were skipped'],
    [counters.invalidSessionsSkipped, 'invalid or contradictory listening sessions were skipped'],
  ];
  for (const [count, description] of descriptions) {
    if (count > 0) warnings.add(`${count} ${description}`);
  }
  if (sessionsUnavailable) warnings.add('Listening sessions are unavailable from this source snapshot');
}
