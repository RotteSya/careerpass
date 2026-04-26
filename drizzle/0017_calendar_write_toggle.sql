-- Per-user opt-in for writing detected events to Google Calendar.
-- Default OFF: until the user enables this (via Dashboard toggle or by
-- agreeing to a Telegram prompt), CareerPass will not write to the calendar.

ALTER TABLE `users`
  ADD COLUMN `calendarWriteEnabled` boolean NOT NULL DEFAULT false;
