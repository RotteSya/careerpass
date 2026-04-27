-- Store company recruiting portal details and manual portal-check history.

ALTER TABLE `job_applications`
  ADD COLUMN `portalUrl` varchar(1024),
  ADD COLUMN `portalAccountHint` varchar(255),
  ADD COLUMN `lastPortalCheckedAt` timestamp NULL,
  ADD COLUMN `portalCheckIntervalDays` int NOT NULL DEFAULT 7,
  ADD COLUMN `portalStatusCheckEnabled` boolean NOT NULL DEFAULT false;

ALTER TABLE `job_status_events`
  MODIFY COLUMN `source` enum('gmail','manual','agent','portal') NOT NULL;
