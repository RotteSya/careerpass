ALTER TABLE `oauth_provider_accounts`
  ADD COLUMN `lastHistoryId` varchar(64),
  ADD COLUMN `watchExpiration` timestamp;

