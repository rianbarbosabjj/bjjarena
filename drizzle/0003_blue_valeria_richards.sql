CREATE TABLE `arena_plan_selections` (
	`organizer_id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`catalog_version` text NOT NULL,
	`entitlements` text NOT NULL,
	`status` text DEFAULT 'test' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`selected_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organizer_id`) REFERENCES `arena_organizers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `arena_organizers` ADD `onboarding_version` integer DEFAULT 0 NOT NULL;