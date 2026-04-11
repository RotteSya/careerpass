-- One-time migration for legacy statuses to the new canonical pipeline.
-- researching -> applied
-- es_submitted -> document_screening
-- rejected -> withdrawn (using辞退 as the single terminal non-offer status in UI)

UPDATE `job_applications`
SET `status` = 'applied'
WHERE `status` = 'researching';

UPDATE `job_applications`
SET `status` = 'document_screening'
WHERE `status` = 'es_submitted';

UPDATE `job_applications`
SET `status` = 'withdrawn'
WHERE `status` = 'rejected';

UPDATE `job_status_events`
SET `prevStatus` = 'applied'
WHERE `prevStatus` = 'researching';

UPDATE `job_status_events`
SET `nextStatus` = 'applied'
WHERE `nextStatus` = 'researching';

UPDATE `job_status_events`
SET `prevStatus` = 'document_screening'
WHERE `prevStatus` = 'es_submitted';

UPDATE `job_status_events`
SET `nextStatus` = 'document_screening'
WHERE `nextStatus` = 'es_submitted';

UPDATE `job_status_events`
SET `prevStatus` = 'withdrawn'
WHERE `prevStatus` = 'rejected';

UPDATE `job_status_events`
SET `nextStatus` = 'withdrawn'
WHERE `nextStatus` = 'rejected';
