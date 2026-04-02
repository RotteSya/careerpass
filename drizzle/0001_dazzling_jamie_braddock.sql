CREATE TABLE `agent_memory` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`memoryType` enum('resume','company_report','conversation','es_draft','interview_log') NOT NULL,
	`title` varchar(512) NOT NULL,
	`content` text NOT NULL,
	`metadata` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `agent_memory_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `agent_sessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`telegramChatId` varchar(64),
	`currentAgent` enum('careerpass','careerpassrecon','careerpasses','careerpassinterview') NOT NULL DEFAULT 'careerpass',
	`sessionState` json,
	`interviewMode` boolean NOT NULL DEFAULT false,
	`targetCompanyId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `agent_sessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `job_applications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`companyNameJa` varchar(255) NOT NULL,
	`companyNameEn` varchar(255),
	`position` varchar(255),
	`status` enum('researching','es_preparing','es_submitted','interview_1','interview_2','interview_final','offer','rejected','withdrawn') NOT NULL DEFAULT 'researching',
	`reconReportPath` varchar(512),
	`esFilePath` varchar(512),
	`notes` text,
	`nextActionAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `job_applications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `oauth_tokens` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`provider` enum('google','outlook') NOT NULL,
	`accessToken` text NOT NULL,
	`refreshToken` text,
	`expiresAt` timestamp,
	`scope` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `oauth_tokens_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `telegram_bindings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`telegramId` varchar(64) NOT NULL,
	`telegramUsername` varchar(128),
	`boundAt` timestamp NOT NULL DEFAULT (now()),
	`isActive` boolean NOT NULL DEFAULT true,
	CONSTRAINT `telegram_bindings_id` PRIMARY KEY(`id`),
	CONSTRAINT `telegram_bindings_userId_unique` UNIQUE(`userId`),
	CONSTRAINT `telegram_bindings_telegramId_unique` UNIQUE(`telegramId`)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `birthDate` varchar(20);--> statement-breakpoint
ALTER TABLE `users` ADD `education` enum('high_school','associate','bachelor','master','doctor','other');--> statement-breakpoint
ALTER TABLE `users` ADD `universityName` varchar(255);--> statement-breakpoint
ALTER TABLE `users` ADD `preferredLanguage` enum('zh','ja','en') DEFAULT 'ja';--> statement-breakpoint
ALTER TABLE `users` ADD `profileCompleted` boolean DEFAULT false NOT NULL;