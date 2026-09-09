ALTER TABLE `limits` ADD `requests` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `limits` ADD `max_requests` integer DEFAULT 20000 NOT NULL;--> statement-breakpoint
ALTER TABLE `units` ADD `reserved_window` text;--> statement-breakpoint
ALTER TABLE `units` ADD `input_bytes` integer DEFAULT 8000000 NOT NULL;--> statement-breakpoint
ALTER TABLE `units` ADD `attempt_limit` integer DEFAULT 6 NOT NULL;--> statement-breakpoint
ALTER TABLE `units` ADD `validation_runs` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `units` ADD `replay_wall_ms` integer DEFAULT 0 NOT NULL;