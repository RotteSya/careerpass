-- Drop dead tables left over from the larger STAR/recon agent surface that was
-- removed when the project was scoped down to "inbox monitoring + schedule
-- reminders" only. None of the remaining code reads or writes these tables:
--   * `waitlist`      — landing-page waitlist, no longer collected
--   * `agent_user_traits` — agent nickname/notes, only the deleted STAR flow wrote here
--   * `agent_memory`  — agent long-term memory, only the deleted agent runner wrote here

DROP TABLE IF EXISTS `waitlist`;
DROP TABLE IF EXISTS `agent_user_traits`;
DROP TABLE IF EXISTS `agent_memory`;
