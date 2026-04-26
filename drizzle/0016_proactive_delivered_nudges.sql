-- Persist proactive nudge delivery records so the 23h cooldown survives
-- server restarts and works across multiple processes. Replaces the
-- previous in-process Map in server/proactive/scheduler.ts.

CREATE TABLE `delivered_nudges` (
  `id` int AUTO_INCREMENT PRIMARY KEY NOT NULL,
  `userId` int NOT NULL,
  `deliveryKey` varchar(64) NOT NULL,
  `deliveredAt` timestamp NOT NULL DEFAULT (now()),
  UNIQUE INDEX `delivered_nudges_user_key_unique` (`userId`, `deliveryKey`),
  INDEX `delivered_nudges_delivered_at_idx` (`deliveredAt`)
);
