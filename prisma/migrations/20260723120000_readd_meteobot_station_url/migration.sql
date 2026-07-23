-- Re-add the per-tenant Meteobot station dashboard URL that was dropped in
-- 20260722030000_drop_meteobot_station_url. The native Open-Meteo weather page
-- stays; the tenant's Meteobot dashboard is embedded on /climate via a scoped
-- CSP frame-src (validated to a meteobot.com host). Nullable — existing rows
-- default to NULL (admins re-enter their station URL).
ALTER TABLE "TenantModuleSettings" ADD COLUMN IF NOT EXISTS "meteobotStationUrl" TEXT;
