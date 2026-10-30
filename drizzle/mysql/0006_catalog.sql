CREATE TABLE `catalog_folders` (
	`id` varchar(64) NOT NULL,
	`owner_id` varchar(64) NOT NULL,
	`parent_id` varchar(64),
	`name` varchar(200) NOT NULL,
	`sort_order` int NOT NULL DEFAULT 0,
	`created_at` varchar(40) NOT NULL,
	`updated_at` varchar(40) NOT NULL,
	CONSTRAINT `catalog_folders_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `catalog_folders_owner_idx` ON `catalog_folders` (`owner_id`);
--> statement-breakpoint
CREATE TABLE `catalog_items` (
	`id` varchar(64) NOT NULL,
	`owner_id` varchar(64) NOT NULL,
	`folder_id` varchar(64) NOT NULL,
	`site_id` varchar(64) NOT NULL,
	`sort_order` int NOT NULL DEFAULT 0,
	`created_at` varchar(40) NOT NULL,
	CONSTRAINT `catalog_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_items_owner_site_uq` ON `catalog_items` (`owner_id`,`site_id`);
--> statement-breakpoint
CREATE INDEX `catalog_items_folder_idx` ON `catalog_items` (`folder_id`);
