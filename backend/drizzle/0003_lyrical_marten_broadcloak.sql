CREATE TABLE `database_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`coolify_uuid` text NOT NULL,
	`platform` text NOT NULL,
	`project_id` text NOT NULL,
	`project_name` text NOT NULL,
	`env_key` text NOT NULL,
	`targets` text NOT NULL,
	`url_kind` text NOT NULL,
	`linked_by` text NOT NULL,
	`linked_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `database_links_uuid_idx` ON `database_links` (`coolify_uuid`);--> statement-breakpoint
CREATE UNIQUE INDEX `database_links_uuid_project_key_idx` ON `database_links` (`coolify_uuid`,`platform`,`project_id`,`env_key`);