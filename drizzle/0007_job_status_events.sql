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

