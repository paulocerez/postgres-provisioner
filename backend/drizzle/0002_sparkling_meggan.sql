CREATE TABLE `database_allowlist` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`coolify_uuid` text NOT NULL,
	`cidr` text NOT NULL,
	`label` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `database_allowlist_uuid_idx` ON `database_allowlist` (`coolify_uuid`);--> statement-breakpoint
CREATE UNIQUE INDEX `database_allowlist_uuid_cidr_idx` ON `database_allowlist` (`coolify_uuid`,`cidr`);