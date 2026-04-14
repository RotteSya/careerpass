CREATE TABLE `waitlist_users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`email` varchar(320) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `waitlist_users_id` PRIMARY KEY(`id`),
	CONSTRAINT `waitlist_users_email_unique` UNIQUE(`email`)
);
