CREATE TABLE `billing_accounts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`billingMode` enum('monthly','company') NOT NULL DEFAULT 'company',
	`companyPlanLimit` int DEFAULT 10,
	`cycleStartedAt` timestamp NOT NULL,
	`cycleEndsAt` timestamp,
	`trialStartedAt` timestamp NOT NULL,
	`trialEndsAt` timestamp NOT NULL,
	`graceEndsAt` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `billing_accounts_id` PRIMARY KEY(`id`),
	CONSTRAINT `billing_accounts_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE TABLE `billing_company_ledger` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`companyKey` varchar(255) NOT NULL,
	`companyName` varchar(255) NOT NULL,
	`firstStatus` varchar(32),
	`countable` boolean NOT NULL DEFAULT true,
	`firstSeenAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `billing_company_ledger_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `billing_notifications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`day10SentAt` timestamp,
	`day13SentAt` timestamp,
	`suspensionSentAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `billing_notifications_id` PRIMARY KEY(`id`),
	CONSTRAINT `billing_notifications_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
ALTER TABLE `job_applications` MODIFY COLUMN `status` enum('researching','applied','briefing','es_preparing','es_submitted','document_screening','written_test','interview_1','interview_2','interview_3','interview_4','interview_final','offer','rejected','withdrawn') NOT NULL DEFAULT 'researching';