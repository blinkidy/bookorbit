import { Inject, Injectable } from '@nestjs/common';
import type { UserSettings } from '@bookorbit/types';
import { and, asc, eq, lte, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { splitReadingSessionByDay, type ReadingDailyStatsSegment } from '../../common/utils/reading-daily-stats.utils';
import { resolveTimeZone } from '../../common/utils/timezone.utils';
import { DB } from '../../db';
import * as schema from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type PendingAudiobookSession = typeof schema.kosyncAudiobookSessions.$inferSelect;

const MIN_SESSION_SECONDS = 10;
export const KOSYNC_AUDIOBOOK_IDLE_MS = 10 * 60 * 1000;
const FINALIZE_LIMIT = 100;

@Injectable()
export class KoreaderAudiobookSessionRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async recordProgress(params: {
    userId: number;
    bookFileId: number;
    bookId: number;
    libraryId: number;
    device: string;
    deviceId: string;
    progress: number;
    observedAt?: Date;
  }): Promise<void> {
    const observedAt = params.observedAt ?? new Date();

    await this.db.transaction(async (tx) => {
      let pending = await this.findPendingForKey(tx, params.userId, params.bookFileId, params.deviceId);

      if (pending && observedAt.getTime() - pending.lastProgressAt.getTime() >= KOSYNC_AUDIOBOOK_IDLE_MS) {
        await this.finalizePending(tx, pending);
        await this.deletePending(tx, pending.id);
        pending = null;
      }

      if (pending) {
        await tx
          .update(schema.kosyncAudiobookSessions)
          .set({
            bookId: params.bookId,
            libraryId: params.libraryId,
            device: params.device,
            lastProgressAt: observedAt,
            latestProgress: params.progress,
            updatedAt: observedAt,
          })
          .where(eq(schema.kosyncAudiobookSessions.id, pending.id));
        return;
      }

      await tx.insert(schema.kosyncAudiobookSessions).values({
        userId: params.userId,
        bookFileId: params.bookFileId,
        bookId: params.bookId,
        libraryId: params.libraryId,
        device: params.device,
        deviceId: params.deviceId,
        startedAt: observedAt,
        lastProgressAt: observedAt,
        startProgress: params.progress,
        latestProgress: params.progress,
        createdAt: observedAt,
        updatedAt: observedAt,
      });
    });
  }

  async finalizeDueSessions(now = new Date()): Promise<{ finalized: number; skipped: number }> {
    const cutoff = new Date(now.getTime() - KOSYNC_AUDIOBOOK_IDLE_MS);

    return this.db.transaction(async (tx) => {
      const due = await tx
        .select()
        .from(schema.kosyncAudiobookSessions)
        .where(lte(schema.kosyncAudiobookSessions.lastProgressAt, cutoff))
        .orderBy(asc(schema.kosyncAudiobookSessions.lastProgressAt), asc(schema.kosyncAudiobookSessions.id))
        .limit(FINALIZE_LIMIT);

      let finalized = 0;
      let skipped = 0;
      for (const pending of due) {
        const saved = await this.finalizePending(tx, pending);
        await this.deletePending(tx, pending.id);
        if (saved) {
          finalized += 1;
        } else {
          skipped += 1;
        }
      }

      return { finalized, skipped };
    });
  }

  private async findPendingForKey(tx: Tx, userId: number, bookFileId: number, deviceId: string): Promise<PendingAudiobookSession | null> {
    const [row] = await tx
      .select()
      .from(schema.kosyncAudiobookSessions)
      .where(
        and(
          eq(schema.kosyncAudiobookSessions.userId, userId),
          eq(schema.kosyncAudiobookSessions.bookFileId, bookFileId),
          eq(schema.kosyncAudiobookSessions.deviceId, deviceId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  private async deletePending(tx: Tx, id: number): Promise<void> {
    await tx.delete(schema.kosyncAudiobookSessions).where(eq(schema.kosyncAudiobookSessions.id, id));
  }

  private async finalizePending(tx: Tx, pending: PendingAudiobookSession): Promise<boolean> {
    const durationSeconds = Math.floor((pending.lastProgressAt.getTime() - pending.startedAt.getTime()) / 1000);
    if (durationSeconds < MIN_SESSION_SECONDS) return false;

    const progressDelta = round2(Math.max(-100, Math.min(100, pending.latestProgress - pending.startProgress)));
    const sessionId = this.buildSessionId(pending);
    const [inserted] = await tx
      .insert(schema.readingSessions)
      .values({
        userId: pending.userId,
        bookFileId: pending.bookFileId,
        bookId: pending.bookId,
        sessionId,
        source: 'audiobook',
        startedAt: pending.startedAt,
        endedAt: pending.lastProgressAt,
        durationSeconds,
        progressDelta,
        endProgress: pending.latestProgress,
      })
      .onConflictDoNothing({ target: [schema.readingSessions.userId, schema.readingSessions.sessionId] })
      .returning({ id: schema.readingSessions.id });

    if (!inserted) return false;

    const timeZone = await this.resolveUserTimeZone(tx, pending.userId);
    await this.upsertDailyStats(tx, {
      userId: pending.userId,
      libraryId: pending.libraryId,
      startedAt: pending.startedAt,
      endedAt: pending.lastProgressAt,
      durationSeconds,
      progressDelta,
      timeZone,
    });
    return true;
  }

  private buildSessionId(pending: PendingAudiobookSession): string {
    const startedAtSeconds = Math.floor(pending.startedAt.getTime() / 1000);
    return `abs:${pending.deviceId.slice(0, 8)}:${pending.bookFileId}:${startedAtSeconds}`;
  }

  private async resolveUserTimeZone(tx: Tx, userId: number): Promise<string> {
    const [row] = await tx.select({ settings: schema.users.settings }).from(schema.users).where(eq(schema.users.id, userId)).limit(1);
    return resolveTimeZone((row?.settings as unknown as UserSettings | undefined)?.timezone, 'UTC');
  }

  private async upsertDailyStats(
    tx: Tx,
    params: {
      userId: number;
      libraryId: number;
      startedAt: Date;
      endedAt: Date;
      durationSeconds: number;
      progressDelta: number | null;
      timeZone: string;
    },
  ): Promise<void> {
    const { userId, libraryId, startedAt, endedAt, durationSeconds, progressDelta, timeZone } = params;
    await tx.execute(sql`select pg_advisory_xact_lock(${userId}::int, ${libraryId}::int)`);
    const segments = splitReadingSessionByDay({ startedAt, endedAt, durationSeconds, progressDelta }, timeZone);
    await this.insertDailyStatsSegments(tx, userId, libraryId, segments);
  }

  private async insertDailyStatsSegments(tx: Tx, userId: number, libraryId: number, segments: ReadingDailyStatsSegment[]): Promise<void> {
    if (segments.length === 0) return;

    const now = new Date();
    await tx
      .insert(schema.userReadingDailyStats)
      .values(
        segments.map((segment) => ({
          userId,
          libraryId,
          day: segment.day,
          readingSeconds: segment.readingSeconds,
          progressDelta: segment.progressDelta,
          sessionsCount: segment.sessionsCount,
          updatedAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: [schema.userReadingDailyStats.userId, schema.userReadingDailyStats.libraryId, schema.userReadingDailyStats.day],
        set: {
          readingSeconds: sql`${schema.userReadingDailyStats.readingSeconds} + excluded.reading_seconds`,
          progressDelta: sql`${schema.userReadingDailyStats.progressDelta} + excluded.progress_delta`,
          sessionsCount: sql`${schema.userReadingDailyStats.sessionsCount} + excluded.sessions_count`,
          updatedAt: now,
        },
      });
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
