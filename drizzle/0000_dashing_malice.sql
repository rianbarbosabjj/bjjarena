CREATE TABLE `arena_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`organizer_id` text NOT NULL,
	`event_id` text,
	`actor_id` text NOT NULL,
	`action` text NOT NULL,
	`resource_id` text NOT NULL,
	`details` text NOT NULL,
	`at` text NOT NULL,
	FOREIGN KEY (`organizer_id`) REFERENCES `arena_organizers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `arena_events` (
	`id` text PRIMARY KEY NOT NULL,
	`organizer_id` text NOT NULL,
	`data` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`kind` text DEFAULT 'test' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organizer_id`) REFERENCES `arena_organizers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `arena_memberships` (
	`organizer_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	PRIMARY KEY(`organizer_id`, `user_id`),
	FOREIGN KEY (`organizer_id`) REFERENCES `arena_organizers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `arena_organizers` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `arena_organizers_owner_id_unique` ON `arena_organizers` (`owner_id`);--> statement-breakpoint
CREATE TABLE `arena_profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `arena_registrations` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`athlete_id` text NOT NULL,
	`athlete_data` text NOT NULL,
	`category_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`currency` text DEFAULT 'BRL' NOT NULL,
	`regulation_version` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`payment_status` text DEFAULT 'pending' NOT NULL,
	`payment_source` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `arena_events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`athlete_id`) REFERENCES `arena_profiles`(`user_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `arena_active_registration` ON `arena_registrations` (`event_id`,`athlete_id`) WHERE "arena_registrations"."status" = 'active';