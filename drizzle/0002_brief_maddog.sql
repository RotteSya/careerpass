CREATE TABLE `messaging_bindings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`provider` enum('telegram','line','whatsapp','wechat') NOT NULL,
	`externalId` varchar(128) NOT NULL,
	`externalHandle` varchar(256),
	`boundAt` timestamp NOT NULL DEFAULT (now()),
	`isActive` boolean NOT NULL DEFAULT true,
	CONSTRAINT `messaging_bindings_id` PRIMARY KEY(`id`)
);
