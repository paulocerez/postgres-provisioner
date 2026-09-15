CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` integer NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`target_uuid` text,
	`target_name` text,
	`details` text
);
--> statement-breakpoint
CREATE INDEX `audit_log_at_idx` ON `audit_log` ("at" desc);--> statement-breakpoint
CREATE TABLE `database_meta` (
	`coolify_uuid` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`project` text,
	`owner` text,
	`notes` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`status` text NOT NULL,
	`input` text NOT NULL,
	`steps` text NOT NULL,
	`result_uuid` text,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
