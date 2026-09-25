CREATE TABLE `photos` (
	`key` text PRIMARY KEY NOT NULL,
	`household` text NOT NULL,
	`bytes` integer NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `photos_household` ON `photos` (`household`);--> statement-breakpoint
ALTER TABLE `catalogue` ADD `barcode` text;--> statement-breakpoint
CREATE INDEX `catalogue_barcode` ON `catalogue` (`barcode`);--> statement-breakpoint
ALTER TABLE `households` ADD `revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `households` ADD `purged_revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `households` ADD `deleting` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `limits` ADD `expires` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `limits_expires` ON `limits` (`expires`);--> statement-breakpoint
ALTER TABLE `records` ADD `seq` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `records_household_seq` ON `records` (`household`,`seq`);--> statement-breakpoint
CREATE INDEX `records_created_by` ON `records` (`created_by`);--> statement-breakpoint
CREATE INDEX `records_updated_by` ON `records` (`updated_by`);--> statement-breakpoint
CREATE INDEX `records_deleted_updated` ON `records` (`deleted`,`updated`);--> statement-breakpoint
ALTER TABLE `users` ADD `custom_name` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `cache_expires` ON `cache` (`expires`);--> statement-breakpoint
CREATE INDEX `invitations_household` ON `invitations` (`household`);--> statement-breakpoint
CREATE INDEX `invitations_created_by` ON `invitations` (`created_by`);--> statement-breakpoint
CREATE INDEX `memberships_user` ON `memberships` (`user`);--> statement-breakpoint
CREATE INDEX `operations_household` ON `operations` (`household`);--> statement-breakpoint
CREATE INDEX `operations_user` ON `operations` (`user`);--> statement-breakpoint
CREATE INDEX `operations_created` ON `operations` (`created`);--> statement-breakpoint
UPDATE `catalogue` SET `barcode`=CAST(json_extract(`data`,'$.barcode') AS TEXT) WHERE json_valid(`data`) AND json_extract(`data`,'$.barcode') IS NOT NULL;--> statement-breakpoint
UPDATE `households` SET `revision`=1;--> statement-breakpoint
UPDATE `records` SET `seq`=1;--> statement-breakpoint
UPDATE `users` SET `custom_name`=1 WHERE `name`!=`email`;