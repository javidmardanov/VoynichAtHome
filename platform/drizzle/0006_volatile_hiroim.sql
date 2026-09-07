CREATE TABLE `operation_health` (
	`name` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`last_started_at` integer NOT NULL,
	`last_success_at` integer,
	`last_failure_at` integer,
	`last_error` text
);
