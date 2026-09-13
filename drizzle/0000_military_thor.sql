CREATE TABLE `cache` (
	`key` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `catalogue` (
	`id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`retrieved` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `households` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`settings` text DEFAULT '{}' NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`household` text NOT NULL,
	`hash` text NOT NULL,
	`expires` integer NOT NULL,
	`revoked` integer DEFAULT 0 NOT NULL,
	`used_by` text,
	`created_by` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invitations_hash_unique` ON `invitations` (`hash`);--> statement-breakpoint
CREATE TABLE `limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `memberships` (
	`household` text NOT NULL,
	`user` text NOT NULL,
	`role` text NOT NULL,
	PRIMARY KEY(`household`, `user`)
);
--> statement-breakpoint
CREATE TABLE `operations` (
	`id` text PRIMARY KEY NOT NULL,
	`user` text NOT NULL,
	`household` text NOT NULL,
	`result` text NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `records` (
	`id` text PRIMARY KEY NOT NULL,
	`household` text NOT NULL,
	`kind` text NOT NULL,
	`data` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`deleted` integer DEFAULT 0 NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`created` integer NOT NULL,
	`updated` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`preferences` text DEFAULT '{}' NOT NULL,
	`created` integer NOT NULL
);
