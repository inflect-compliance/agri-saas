-- T00 — per-user UI language preference.
--
-- Seeds the `NEXT_LOCALE` cookie (read by the next-intl request config)
-- so a returning user's device renders in their persisted locale.
-- NOT NULL DEFAULT 'en' keeps every existing row on English — the
-- prior hardcoded behaviour — so the change is behaviour-preserving.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "uiLanguage" TEXT NOT NULL DEFAULT 'en';
