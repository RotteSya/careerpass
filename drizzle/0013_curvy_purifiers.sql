ALTER TABLE `job_applications` ADD `contactInfo` varchar(255);--> statement-breakpoint
ALTER TABLE `job_applications` ADD `priority` enum('high','medium','low') DEFAULT 'medium' NOT NULL;