ALTER TABLE "hardcover_user_settings" ADD COLUMN "device_progress_sync_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "hardcover_user_settings" ADD COLUMN "device_progress_sync_delay_minutes" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "storygraph_user_settings" ADD COLUMN "device_progress_sync_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "storygraph_user_settings" ADD COLUMN "device_progress_sync_delay_minutes" integer DEFAULT 10 NOT NULL;