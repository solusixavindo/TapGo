-- TapGo anti-abuse registration monitoring queries.
-- Read-only. Do not run cleanup/update/delete from this file.

-- 1. Banyak akun dari device fingerprint yang sama.
SELECT
  device_fingerprint_hash,
  COUNT(*) AS account_count,
  MIN(created_at) AS first_seen_at,
  MAX(created_at) AS last_seen_at,
  ARRAY_AGG(user_id ORDER BY created_at DESC) AS user_ids
FROM registration_events
WHERE device_fingerprint_hash IS NOT NULL
GROUP BY device_fingerprint_hash
HAVING COUNT(*) > 1
ORDER BY account_count DESC, last_seen_at DESC;

-- 2. Banyak akun dari IP sama dalam 24 jam.
SELECT
  ip_address,
  COUNT(*) AS registrations_24h,
  MIN(created_at) AS first_seen_at,
  MAX(created_at) AS last_seen_at,
  ARRAY_AGG(user_id ORDER BY created_at DESC) AS user_ids
FROM registration_events
WHERE created_at >= NOW() - INTERVAL '24 hours'
  AND ip_address IS NOT NULL
GROUP BY ip_address
HAVING COUNT(*) >= 5
ORDER BY registrations_24h DESC, last_seen_at DESC;

-- 3. Referral code dipakai berulang cepat.
SELECT
  referral_code_used,
  COUNT(*) AS referred_registrations_24h,
  MIN(created_at) AS first_seen_at,
  MAX(created_at) AS last_seen_at,
  ARRAY_AGG(user_id ORDER BY created_at DESC) AS user_ids
FROM registration_events
WHERE created_at >= NOW() - INTERVAL '24 hours'
  AND referral_code_used IS NOT NULL
GROUP BY referral_code_used
HAVING COUNT(*) >= 10
ORDER BY referred_registrations_24h DESC, last_seen_at DESC;

-- 4. Bonus Basic farming risk: user baru dengan PPOB registration bonus
-- dari IP/device yang sama.
SELECT
  COALESCE(re.device_fingerprint_hash, 'NO_DEVICE') AS device_group,
  COALESCE(re.ip_address::text, 'NO_IP') AS ip_group,
  COUNT(*) AS basic_bonus_accounts,
  SUM(wt.amount) AS total_basic_ppob_bonus,
  MIN(re.created_at) AS first_seen_at,
  MAX(re.created_at) AS last_seen_at,
  ARRAY_AGG(re.user_id ORDER BY re.created_at DESC) AS user_ids
FROM registration_events re
JOIN wallets w ON w.user_id = re.user_id
JOIN wallet_transactions wt ON wt.wallet_id = w.id
WHERE wt.type = 'REGISTRATION_BONUS'
  AND wt.reference_type = 'BASIC_REGISTRATION'
GROUP BY COALESCE(re.device_fingerprint_hash, 'NO_DEVICE'), COALESCE(re.ip_address::text, 'NO_IP')
HAVING COUNT(*) > 1
ORDER BY basic_bonus_accounts DESC, total_basic_ppob_bonus DESC;

-- 5. Open abuse flags for admin review.
SELECT
  af.id,
  af.user_id,
  af.flag_type,
  af.severity,
  af.status,
  af.reason,
  af.created_at,
  re.normalized_phone,
  re.device_fingerprint_hash,
  re.ip_address,
  re.referral_code_used
FROM abuse_flags af
LEFT JOIN registration_events re ON re.id = af.registration_event_id
WHERE af.status = 'OPEN'
ORDER BY
  CASE af.severity WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END,
  af.created_at DESC;

