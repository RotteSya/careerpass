CREATE TABLE `email_auth` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`email` varchar(320) NOT NULL,
	`passwordHash` varchar(255) NOT NULL,
	`verifyToken` varchar(128),
	`verifyTokenExpiresAt` timestamp,
	`verifiedAt` timestamp,
	`resetToken` varchar(128),
	`resetTokenExpiresAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `email_auth_id` PRIMARY KEY(`id`),
	CONSTRAINT `email_auth_userId_unique` UNIQUE(`userId`),
	CONSTRAINT `email_auth_email_unique` UNIQUE(`email`)
);
