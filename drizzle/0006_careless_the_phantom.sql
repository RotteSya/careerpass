CREATE TABLE `job_status_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`jobApplicationId` int,
	`source` enum('gmail','manual','agent') NOT NULL,
	`prevStatus` varchar(32),
	`nextStatus` varchar(32),
	`mailMessageId` varchar(128),
	`mailFrom` text,
	`mailSubject` text,
	`mailSnippet` text,
	`reason` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `job_status_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `oauth_provider_accounts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`provider` enum('google','outlook') NOT NULL,
	`accountEmail` varchar(320) NOT NULL,
	`lastHistoryId` varchar(64),
	`watchExpiration` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `oauth_provider_accounts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `calendarColorBriefing` varchar(2) DEFAULT '9';--> statement-breakpoint
ALTER TABLE `users` ADD `calendarColorInterview` varchar(2) DEFAULT '6';--> statement-breakpoint
ALTER TABLE `users` ADD `calendarColorDeadline` varchar(2) DEFAULT '11';