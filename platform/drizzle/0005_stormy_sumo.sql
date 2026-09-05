CREATE TABLE `shared_objects` (
	`digest` text PRIMARY KEY NOT NULL,
	`input_bytes` integer NOT NULL,
	`state` text DEFAULT 'importing' NOT NULL
);
