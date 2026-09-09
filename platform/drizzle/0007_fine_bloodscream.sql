CREATE TABLE `maintenance_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`identity` text NOT NULL,
	`mode` text DEFAULT 'exclusive' NOT NULL,
	`state` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`error` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `maintenance_one_running` ON `maintenance_runs` (`state`) WHERE "maintenance_runs"."state" = 'running' AND "maintenance_runs"."mode" = 'exclusive';--> statement-breakpoint
CREATE INDEX `maintenance_running` ON `maintenance_runs` (`mode`) WHERE "maintenance_runs"."state" = 'running';--> statement-breakpoint
DROP INDEX `account_provider_idx`;--> statement-breakpoint
ALTER TABLE `account` ADD `issuer` text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE `account` SET `issuer` = CASE
  WHEN `provider_id` = 'google' THEN 'https://accounts.google.com'
  WHEN `provider_id` = 'github' THEN 'local:oauth:github'
  ELSE 'legacy:' || `provider_id` END;--> statement-breakpoint
CREATE UNIQUE INDEX `account_issuer_idx` ON `account` (`issuer`,`account_id`);
