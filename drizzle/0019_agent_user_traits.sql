-- Agent-curated traits about the user, persisted across sessions so the
-- chat agent remembers things like preferred nickname. One row per user;
-- written from agent flow only, not from registration / billing.

CREATE TABLE `agent_user_traits` (
  `userId` INT NOT NULL PRIMARY KEY,
  `nickname` VARCHAR(64) NULL,
  `notes` JSON NULL,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
