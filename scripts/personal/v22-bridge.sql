-- BookOrbit v2.2 migration bridge for the blinkidy personal fork DB.
-- Brings a fork-lineage database (last applied = upstream 0036) up to ci-port/v2.2's
-- schema (0047) WITHOUT re-creating objects the fork already has (storygraph, hardcover,
-- kosync_audiobook_sessions). Then records migrations 0037-0047 as applied so the app's
-- migrator skips everything on boot (drizzle decides by max(created_at), confirmed).
--
-- Safe to run more than once: every statement is idempotent, and the whole thing is one
-- transaction, so any error rolls the entire bridge back and leaves the DB untouched.

BEGIN;

-- ── 0037: cascade on the book_files (book_id, library_folder_id) FK ──────────────
ALTER TABLE "book_files" DROP CONSTRAINT IF EXISTS "book_files_book_folder_consistency_fk";
ALTER TABLE "book_files" ADD CONSTRAINT "book_files_book_folder_consistency_fk"
  FOREIGN KEY ("book_id","library_folder_id") REFERENCES "public"."books"("id","library_folder_id")
  ON DELETE cascade ON UPDATE cascade;

-- ── 0038: user_book_notes + nullable rating (tombstones) ─────────────────────────
CREATE TABLE IF NOT EXISTS "user_book_notes" (
  "user_id" integer NOT NULL,
  "book_id" integer NOT NULL,
  "note" text,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "user_book_notes_user_id_book_id_pk" PRIMARY KEY("user_id","book_id"),
  CONSTRAINT "user_book_notes_note_length_chk" CHECK ("note" is null or char_length("note") <= 10000)
);
ALTER TABLE "user_book_ratings" DROP CONSTRAINT IF EXISTS "user_book_ratings_rating_range_chk";
ALTER TABLE "user_book_ratings" ALTER COLUMN "rating" DROP NOT NULL;
DO $$ BEGIN
  ALTER TABLE "user_book_notes" ADD CONSTRAINT "user_book_notes_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "user_book_notes" ADD CONSTRAINT "user_book_notes_book_id_books_id_fk"
    FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "ubn_user_id_idx" ON "user_book_notes" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "ubn_book_id_idx" ON "user_book_notes" USING btree ("book_id");
CREATE INDEX IF NOT EXISTS "ubn_book_user_idx" ON "user_book_notes" USING btree ("book_id","user_id");
DO $$ BEGIN
  ALTER TABLE "user_book_ratings" ADD CONSTRAINT "user_book_ratings_rating_range_chk"
    CHECK ("rating" is null or ("rating" >= 1 and "rating" <= 5));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 0039: smart_scopes.sync_to_kobo ─────────────────────────────────────────────
ALTER TABLE "smart_scopes" ADD COLUMN IF NOT EXISTS "sync_to_kobo" boolean DEFAULT false NOT NULL;

-- ── 0040: readwise_user_settings ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "readwise_user_settings" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL,
  "api_token" text,
  "enabled" boolean DEFAULT true NOT NULL,
  "last_synced_annotation_id" integer DEFAULT 0 NOT NULL,
  "disabled_reason" text,
  "last_synced_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "readwise_user_settings_user_id_unique" UNIQUE("user_id")
);
DO $$ BEGIN
  ALTER TABLE "readwise_user_settings" ADD CONSTRAINT "readwise_user_settings_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 0041: readwise annotations index ────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "annotations_user_id_id_idx" ON "annotations" USING btree ("user_id","id");

-- ── 0042 (storygraph tables): SKIPPED — already present from the fork ────────────

-- ── 0043: storygraph sync indexes (fork lacked these) ───────────────────────────
CREATE INDEX IF NOT EXISTS "storygraph_book_state_user_sync_override_idx"
  ON "storygraph_book_state" USING btree ("user_id","sync_override","book_id");
CREATE INDEX IF NOT EXISTS "storygraph_book_state_user_sync_error_idx"
  ON "storygraph_book_state" USING btree ("user_id","book_id") WHERE "sync_error" is not null;

-- ── 0044: book_metadata.published_date ──────────────────────────────────────────
ALTER TABLE "book_metadata" ADD COLUMN IF NOT EXISTS "published_date" date;
CREATE INDEX IF NOT EXISTS "bm_published_date_idx" ON "book_metadata" USING btree ("published_date");
CREATE INDEX IF NOT EXISTS "bm_published_date_sort_idx"
  ON "book_metadata" USING btree (coalesce("published_date", make_date("published_year", 1, 1)));
DO $$ BEGIN
  ALTER TABLE "book_metadata" ADD CONSTRAINT "book_metadata_published_date_range_chk"
    CHECK ("published_date" is null or (extract(year from "published_date") >= 1000 and extract(year from "published_date") <= 2200));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 0045: kobo_devices (id, user_id) unique (needed by 0046 FK) ──────────────────
DO $$ BEGIN
  ALTER TABLE "kobo_devices" ADD CONSTRAINT "kobo_devices_id_user_id_unique" UNIQUE("id","user_id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; END $$;

-- ── 0046: kobo device snapshot tables ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "kobo_device_library_snapshots" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL,
  "device_id" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "kobo_device_library_snapshots_device_id_unique" UNIQUE("device_id")
);
CREATE TABLE IF NOT EXISTS "kobo_device_snapshot_books" (
  "snapshot_id" integer NOT NULL,
  "book_id" integer NOT NULL,
  "synced" boolean DEFAULT false NOT NULL,
  "pending_delete" boolean DEFAULT false NOT NULL,
  "is_new" boolean DEFAULT true NOT NULL,
  "removed_by_device" boolean DEFAULT false NOT NULL,
  "needs_legacy_numeric_removal" boolean DEFAULT false NOT NULL,
  "file_hash" varchar(64),
  "delivery_hash" varchar(64),
  "metadata_hash" varchar(64),
  CONSTRAINT "kobo_device_snapshot_books_snapshot_id_book_id_pk" PRIMARY KEY("snapshot_id","book_id")
);
ALTER TABLE "kobo_library_snapshots" ADD COLUMN IF NOT EXISTS "legacy_device_cutoff_at" timestamp with time zone DEFAULT now() NOT NULL;
DO $$ BEGIN
  ALTER TABLE "kobo_device_library_snapshots" ADD CONSTRAINT "kobo_device_library_snapshots_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "kobo_device_library_snapshots" ADD CONSTRAINT "kobo_device_library_snapshots_device_owner_fk"
    FOREIGN KEY ("device_id","user_id") REFERENCES "public"."kobo_devices"("id","user_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "kobo_device_snapshot_books" ADD CONSTRAINT "kobo_device_snapshot_books_snapshot_id_kobo_device_library_snapshots_id_fk"
    FOREIGN KEY ("snapshot_id") REFERENCES "public"."kobo_device_library_snapshots"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "kobo_device_snapshot_books" ADD CONSTRAINT "kobo_device_snapshot_books_book_id_books_id_fk"
    FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "kobo_device_library_snapshots_user_id_idx" ON "kobo_device_library_snapshots" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "kobo_device_snapshot_books_snapshot_synced_book_idx" ON "kobo_device_snapshot_books" USING btree ("snapshot_id","synced","book_id");

-- ── 0047 (kosync table): SKIPPED — already present from the fork ─────────────────
-- Ensure the reading_sessions source check allows 'audiobook' (no-op if already correct).
ALTER TABLE "reading_sessions" DROP CONSTRAINT IF EXISTS "reading_sessions_source_chk";
ALTER TABLE "reading_sessions" ADD CONSTRAINT "reading_sessions_source_chk"
  CHECK ("source" in ('web', 'koreader', 'manual', 'kobo', 'audiobook'));

-- ── Record migrations 0037-0047 as applied so the app migrator skips them ────────
-- Only inserts rows whose timestamp isn't already recorded, so re-running is safe.
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
SELECT v.hash, v.created_at
FROM (VALUES
  ('387993a6150aeca3b3eb193a3fb1b9bc90dd7e797975da4f8828327d662d05f8'::text, 1783316940342::bigint),
  ('ba088a0e610e1d1644ae42e5c788fa80a8122b6a95359704428ed89579fc156d', 1783397661979),
  ('56c3d1c8a55edc5d4aed482e3c86f3b88d0567033a58fa64fe736419745bd190', 1783458659132),
  ('6cd7d17eac3d38b34924991327c1b2063bf96a51fb5cdd8be8ae54e8ba74cde8', 1783465177576),
  ('c0e87d388aea794d028cdf720928491b01f0180e7f64d915d246fb0c1f8f9716', 1783469412249),
  ('1ebd200e3fc924ac628a8545757de00c89a80450c9b3808c31e0e23c2547143c', 1783475628231),
  ('27e5214335a45d6609814610f54faaab1f7a5840d8b8e27fddda22ca4ea5af08', 1783549738764),
  ('0d75b8c63433737c9c8e4e4c70b9a52022aaf3c96e67fc82910c0c46083fea61', 1783575766119),
  ('1968a6966b527df3e8f76857a7025ed759210f3f9bb85a81a13699698542235d', 1783630272168),
  ('d74022f1376004dba115ca14b9270d167ae997bc5cbb35ac034c388c2740e042', 1783630311448),
  ('0ffdab211b7c15d32099d3a2804923525a9db060860de0d42069eab798c49938', 1783683005125)
) AS v(hash, created_at)
WHERE NOT EXISTS (
  SELECT 1 FROM drizzle.__drizzle_migrations m WHERE m.created_at = v.created_at
);

COMMIT;
