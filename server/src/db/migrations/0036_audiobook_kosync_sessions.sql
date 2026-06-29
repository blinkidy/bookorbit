ALTER TABLE "reading_sessions" DROP CONSTRAINT "reading_sessions_source_chk";--> statement-breakpoint
ALTER TABLE "reading_sessions" ADD CONSTRAINT "reading_sessions_source_chk" CHECK ("reading_sessions"."source" in ('web', 'koreader', 'manual', 'kobo', 'audiobook'));--> statement-breakpoint
CREATE TABLE "kosync_audiobook_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"book_file_id" integer NOT NULL,
	"book_id" integer NOT NULL,
	"library_id" integer NOT NULL,
	"device" varchar(100) NOT NULL,
	"device_id" varchar(100) NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"last_progress_at" timestamp with time zone NOT NULL,
	"start_progress" real NOT NULL,
	"latest_progress" real NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kas_start_progress_range_chk" CHECK ("kosync_audiobook_sessions"."start_progress" >= 0 and "kosync_audiobook_sessions"."start_progress" <= 100),
	CONSTRAINT "kas_latest_progress_range_chk" CHECK ("kosync_audiobook_sessions"."latest_progress" >= 0 and "kosync_audiobook_sessions"."latest_progress" <= 100),
	CONSTRAINT "kas_last_after_started_chk" CHECK ("kosync_audiobook_sessions"."last_progress_at" >= "kosync_audiobook_sessions"."started_at")
);
--> statement-breakpoint
ALTER TABLE "kosync_audiobook_sessions" ADD CONSTRAINT "kosync_audiobook_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kosync_audiobook_sessions" ADD CONSTRAINT "kosync_audiobook_sessions_book_file_id_book_files_id_fk" FOREIGN KEY ("book_file_id") REFERENCES "public"."book_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kosync_audiobook_sessions" ADD CONSTRAINT "kosync_audiobook_sessions_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kosync_audiobook_sessions" ADD CONSTRAINT "kosync_audiobook_sessions_library_id_libraries_id_fk" FOREIGN KEY ("library_id") REFERENCES "public"."libraries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "kas_user_file_device_uidx" ON "kosync_audiobook_sessions" USING btree ("user_id","book_file_id","device_id");--> statement-breakpoint
CREATE INDEX "kas_last_progress_at_idx" ON "kosync_audiobook_sessions" USING btree ("last_progress_at");--> statement-breakpoint
CREATE INDEX "kas_user_id_idx" ON "kosync_audiobook_sessions" USING btree ("user_id");
