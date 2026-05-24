-- Audit S6 — Vendor / Third-Party Risk Management (2026-05-24)
--
-- Add `VENDOR_REVIEW_DUE` to the `NotificationType` enum. The
-- corresponding daily cron sweeps overdue vendors and fires one
-- notification per vendor (routed to ownerUserId).

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'VENDOR_REVIEW_DUE';
