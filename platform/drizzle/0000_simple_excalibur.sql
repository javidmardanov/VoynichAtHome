CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_user_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `account_provider_idx` ON `account` (`provider_id`,`account_id`);--> statement-breakpoint
CREATE TABLE `attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`unit_id` text NOT NULL,
	`guest_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`submitted_at` integer,
	`result_hash` text,
	`result` text,
	`state` text DEFAULT 'leased' NOT NULL,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`guest_id`) REFERENCES `guests`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attempt_unit_guest_idx` ON `attempts` (`unit_id`,`guest_id`);--> statement-breakpoint
CREATE INDEX `attempt_unit_state_idx` ON `attempts` (`unit_id`,`state`);--> statement-breakpoint
CREATE INDEX `attempt_guest_state_idx` ON `attempts` (`guest_id`,`state`);--> statement-breakpoint
CREATE INDEX `attempt_expiry_idx` ON `attempts` (`state`,`expires_at`);--> statement-breakpoint
CREATE TABLE `audit` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text,
	`action` text NOT NULL,
	`object_id` text NOT NULL,
	`detail` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`question` text NOT NULL,
	`manifest_digest` text NOT NULL,
	`manifest` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`scientific_status` text DEFAULT 'computation' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `campaigns_manifest_digest_unique` ON `campaigns` (`manifest_digest`);--> statement-breakpoint
CREATE INDEX `campaign_status_idx` ON `campaigns` (`status`);--> statement-breakpoint
CREATE TABLE `controls` (
	`id` text PRIMARY KEY NOT NULL,
	`stopped` integer DEFAULT 1 NOT NULL,
	`reason` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `credit` (
	`attempt_id` text PRIMARY KEY NOT NULL,
	`guest_id` text NOT NULL,
	`unit_id` text NOT NULL,
	`amount` integer NOT NULL,
	`checked_at` integer NOT NULL,
	FOREIGN KEY (`attempt_id`) REFERENCES `attempts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`guest_id`) REFERENCES `guests`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `credit_unit_guest_idx` ON `credit` (`unit_id`,`guest_id`);--> statement-breakpoint
CREATE INDEX `credit_guest_idx` ON `credit` (`guest_id`);--> statement-breakpoint
CREATE TABLE `guests` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text,
	`user_id` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`blocked` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `guests_token_hash_unique` ON `guests` (`token_hash`);--> statement-breakpoint
CREATE INDEX `guests_user_idx` ON `guests` (`user_id`);--> statement-breakpoint
CREATE TABLE `limits` (
	`window` text PRIMARY KEY NOT NULL,
	`assignments` integer DEFAULT 0 NOT NULL,
	`reserved_ms` integer DEFAULT 0 NOT NULL,
	`max_assignments` integer NOT NULL,
	`max_reserved_ms` integer NOT NULL,
	`max_inflight` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `membership` (
	`user_id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`joined_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `membership_team_idx` ON `membership` (`team_id`);--> statement-breakpoint
CREATE TABLE `profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`public` integer DEFAULT 0 NOT NULL,
	`moderated` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `releases` (
	`id` text PRIMARY KEY NOT NULL,
	`module_digest` text NOT NULL,
	`module_path` text NOT NULL,
	`state` text DEFAULT 'approved' NOT NULL,
	`provenance` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_user_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `teams` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`owner_id` text,
	`moderated` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `units` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`release_id` text NOT NULL,
	`specification` text NOT NULL,
	`input_digest` text NOT NULL,
	`input_key` text NOT NULL,
	`state` text DEFAULT 'open' NOT NULL,
	`credit` integer NOT NULL,
	`reserve_ms` integer NOT NULL,
	`reserved` integer DEFAULT 0 NOT NULL,
	`trusted_result` text,
	`trusted_hash` text,
	`validation_error` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`release_id`) REFERENCES `releases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `units_campaign_state_idx` ON `units` (`campaign_id`,`state`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);