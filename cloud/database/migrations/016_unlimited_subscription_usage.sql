-- Subscription entitlement is time-based (monthly/quarterly/yearly), not
-- character-count or file-count based. Keep the legacy columns for old client
-- compatibility, but normalize every subscription to the unlimited sentinel.
UPDATE subscriptions
SET quota_total = -1,
    quota_remaining = -1,
    max_file_upload = -1,
    status = CASE
      WHEN status = 'exhausted' AND end_date > CURRENT_TIMESTAMP
        THEN CASE WHEN plan_type = 'trial' THEN 'trial' ELSE 'active' END
      ELSE status
    END,
    updated_at = CURRENT_TIMESTAMP
WHERE quota_total <> -1
   OR quota_remaining <> -1
   OR max_file_upload <> -1
   OR status = 'exhausted';
