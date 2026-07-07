-- Per-tenant Meteobot station embed/link URL (#14). Table already carries the
-- RLS trio (tenant-scoped), so a nullable column needs no policy change.
ALTER TABLE "TenantModuleSettings" ADD COLUMN "meteobotStationUrl" TEXT;
