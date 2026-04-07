ALTER TABLE `oauth_tokens`
  MODIFY COLUMN `provider` ENUM('google','outlook','notion') NOT NULL;

ALTER TABLE `oauth_provider_accounts`
  MODIFY COLUMN `provider` ENUM('google','outlook','notion') NOT NULL;
