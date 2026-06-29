ALTER TABLE "kosync_audiobook_sessions" ADD COLUMN "last_external_sync_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "kosync_audiobook_sessions" ADD COLUMN "last_external_sync_progress" real;--> statement-breakpoint
ALTER TABLE "kosync_audiobook_sessions" ADD CONSTRAINT "kas_last_external_sync_progress_range_chk" CHECK ("kosync_audiobook_sessions"."last_external_sync_progress" is null or ("kosync_audiobook_sessions"."last_external_sync_progress" >= 0 and "kosync_audiobook_sessions"."last_external_sync_progress" <= 100));
