CREATE TABLE `arena_competition_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`from_version` integer NOT NULL,
	`to_version` integer NOT NULL,
	`from_roster_version` integer NOT NULL,
	`to_roster_version` integer NOT NULL,
	`actor_id` text NOT NULL,
	`reason` text NOT NULL,
	`previous_data` text NOT NULL,
	`next_data` text NOT NULL,
	`details` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `arena_events`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `arena_review_from_version` ON `arena_competition_reviews` (`event_id`,`from_version`);