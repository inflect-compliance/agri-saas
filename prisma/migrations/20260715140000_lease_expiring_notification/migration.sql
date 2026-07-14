-- Land administration (roadmap 3/3) — the LEASE_EXPIRING in-app notification
-- type, fired by the daily `lease-expiry-sweep` when a parcel lease is within
-- 30 days of its endDate.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'LEASE_EXPIRING';
