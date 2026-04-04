CREATE TABLE `oauth_provider_accounts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`provider` enum('google','outlook') NOT NULL,
	`accountEmail` varchar(320) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `oauth_provider_accounts_id` PRIMARY KEY(`id`),
	CONSTRAINT `oauth_provider_accounts_provider_accountEmail_unique` UNIQUE(`provider`,`accountEmail`),
	CONSTRAINT `oauth_provider_accounts_provider_userId_unique` UNIQUE(`provider`,`userId`)
);
