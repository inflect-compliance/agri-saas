-- Default UI language for NEW users is now Bulgarian.
--
-- Agrent's operators are Bulgarian farms, so a first-time user (who has
-- set no language preference) should see the app in Bulgarian. This only
-- changes the column DEFAULT for rows inserted from now on — existing
-- users keep whatever `uiLanguage` they already have (they can still switch
-- from the account menu). English remains fully supported + the i18n
-- completeness reference.
ALTER TABLE "User" ALTER COLUMN "uiLanguage" SET DEFAULT 'bg';
