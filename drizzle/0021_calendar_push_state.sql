-- Calendar Push: real-time main path state.
--
-- `calendar_watch_states` — one row per (user, provider, calendarId).
-- Tracks the Google Calendar `events.watch` channel and the rolling
-- syncToken consumed by `events.list` for incremental sync.
--
-- `calendar_event_ingestions` — events read via push + syncToken.
-- Idempotent on (userId, provider, calendarId, googleEventId) so retries
-- and out-of-order webhook deliveries don't double-write.
--
-- This is distinct from the existing `calendar_event_syncs` table, which
-- maps mail messages → calendar event IDs (mail-to-calendar write path).

CREATE TABLE `calendar_watch_states` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `userId` INT NOT NULL,
  `provider` ENUM('google') NOT NULL DEFAULT 'google',
  `calendarId` VARCHAR(256) NOT NULL DEFAULT 'primary',
  `channelId` VARCHAR(128) NOT NULL,
  `resourceId` VARCHAR(256) NOT NULL,
  `resourceUri` TEXT NULL,
  `syncToken` TEXT NULL,
  `expiration` TIMESTAMP NULL,
  `status` ENUM('active','expired','stopped','error') NOT NULL DEFAULT 'active',
  `lastMessageNumber` VARCHAR(64) NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `calendar_watch_user_calendar_unique` (`userId`, `provider`, `calendarId`),
  KEY `calendar_watch_channel_resource_idx` (`channelId`, `resourceId`)
);

CREATE TABLE `calendar_event_ingestions` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `userId` INT NOT NULL,
  `provider` ENUM('google') NOT NULL DEFAULT 'google',
  `calendarId` VARCHAR(256) NOT NULL,
  `googleEventId` VARCHAR(512) NOT NULL,
  `status` VARCHAR(64) NULL,
  `summary` TEXT NULL,
  `description` TEXT NULL,
  `location` TEXT NULL,
  `startAt` TIMESTAMP NULL,
  `endAt` TIMESTAMP NULL,
  `parsedJson` JSON NULL,
  `isRelevant` BOOLEAN NOT NULL DEFAULT FALSE,
  `jobStatusEventId` INT NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `calendar_ingest_user_event_unique` (`userId`, `provider`, `calendarId`, `googleEventId`),
  KEY `calendar_ingest_user_start_idx` (`userId`, `startAt`)
);
