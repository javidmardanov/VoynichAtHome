CREATE TABLE `reports` (
	`digest` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`tier` text NOT NULL,
	`title` text NOT NULL,
	`document` text NOT NULL,
	`withdrawn` integer DEFAULT 0 NOT NULL,
	`withdrawal_reason` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `reports_campaign_idx` ON `reports` (`campaign_id`);