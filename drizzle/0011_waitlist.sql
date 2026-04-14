CREATE TABLE IF NOT EXISTS `waitlist` (
  `id` int AUTO_INCREMENT PRIMARY KEY NOT NULL,
  `email` varchar(255) NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  UNIQUE KEY `waitlist_email_unique` (`email`)
);
