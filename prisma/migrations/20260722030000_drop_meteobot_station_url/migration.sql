-- Drop the per-tenant Meteobot station URL. The Climate page now renders the
-- tenant's own Open-Meteo WeatherObservation data natively; the external
-- Meteobot iframe embed (blocked by the app CSP) was removed.
ALTER TABLE "TenantModuleSettings" DROP COLUMN IF EXISTS "meteobotStationUrl";
