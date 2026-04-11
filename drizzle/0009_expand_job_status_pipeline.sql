ALTER TABLE `job_applications`
MODIFY COLUMN `status` enum(
  'researching',
  'applied',
  'briefing',
  'es_preparing',
  'es_submitted',
  'document_screening',
  'written_test',
  'interview_1',
  'interview_2',
  'interview_3',
  'interview_4',
  'interview_final',
  'offer',
  'rejected',
  'withdrawn'
) NOT NULL DEFAULT 'researching';
