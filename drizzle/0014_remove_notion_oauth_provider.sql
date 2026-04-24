-- Remove the `notion` OAuth provider after the Notion integration was dropped
-- in the April 2026 CareerPass refactor. Any legacy rows are deleted first so
-- the ENUM narrowing does not fail on existing data.

DELETE FROM `oauth_tokens` WHERE `provider` = 'notion';
DELETE FROM `oauth_provider_accounts` WHERE `provider` = 'notion';

ALTER TABLE `oauth_tokens`
  MODIFY COLUMN `provider` ENUM('google','outlook') NOT NULL;

ALTER TABLE `oauth_provider_accounts`
  MODIFY COLUMN `provider` ENUM('google','outlook') NOT NULL;
