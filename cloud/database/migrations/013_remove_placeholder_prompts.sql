-- Remove migration-time prompt placeholders that can otherwise be returned as
-- if they were usable Skill content. Real prompts must be imported through the
-- prompt administration/import workflow.
DELETE FROM prompts
WHERE content_encrypted = 'placeholder'
  AND content_hash = 'placeholder';
