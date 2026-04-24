-- P0 hardening: add uniqueness/idempotency constraints and indexes for the
-- hot paths used by OAuth, Gmail processing, job boards, and billing.
--
-- Migration risk: unique indexes below require existing duplicate rows to be
-- cleaned first. Run duplicate diagnostics before applying to production.

ALTER TABLE `oauth_tokens`
  ADD UNIQUE INDEX `oauth_tokens_user_provider_unique` (`userId`, `provider`);

ALTER TABLE `oauth_provider_accounts`
  ADD UNIQUE INDEX `oauth_provider_accounts_user_provider_unique` (`userId`, `provider`),
  ADD UNIQUE INDEX `oauth_provider_accounts_provider_email_unique` (`provider`, `accountEmail`);

ALTER TABLE `job_applications`
  ADD INDEX `job_applications_user_updated_idx` (`userId`, `updatedAt`),
  ADD INDEX `job_applications_user_company_idx` (`userId`, `companyNameJa`);

ALTER TABLE `job_status_events`
  ADD INDEX `job_status_events_user_job_created_idx` (`userId`, `jobApplicationId`, `createdAt`),
  ADD UNIQUE INDEX `job_status_events_user_mail_message_unique` (`userId`, `mailMessageId`);

ALTER TABLE `billing_company_ledger`
  ADD UNIQUE INDEX `billing_company_ledger_user_company_unique` (`userId`, `companyKey`),
  ADD INDEX `billing_company_ledger_user_first_seen_idx` (`userId`, `firstSeenAt`);

CREATE TABLE `calendar_event_syncs` (
  `id` int AUTO_INCREMENT PRIMARY KEY NOT NULL,
  `userId` int NOT NULL,
  `provider` enum('google','outlook') NOT NULL,
  `mailMessageId` varchar(128) NOT NULL,
  `calendarEventId` varchar(256) NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE INDEX `calendar_event_syncs_user_provider_message_unique` (`userId`, `provider`, `mailMessageId`)
);
