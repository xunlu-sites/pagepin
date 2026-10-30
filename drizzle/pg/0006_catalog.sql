CREATE TABLE "catalog_folders" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"parent_id" text,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "catalog_folders_owner_idx" ON "catalog_folders" ("owner_id");
--> statement-breakpoint
CREATE TABLE "catalog_items" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"folder_id" text NOT NULL,
	"site_id" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_items_owner_site_uq" ON "catalog_items" ("owner_id","site_id");
--> statement-breakpoint
CREATE INDEX "catalog_items_folder_idx" ON "catalog_items" ("folder_id");
