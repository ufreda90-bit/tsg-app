-- Performance indexes for common Intervention filters (status, technicians, date ranges)
CREATE INDEX IF NOT EXISTS "Intervention_status_idx" ON "Intervention"("status");
CREATE INDEX IF NOT EXISTS "Intervention_technicianId_idx" ON "Intervention"("technicianId");
CREATE INDEX IF NOT EXISTS "Intervention_secondaryTechnicianId_idx" ON "Intervention"("secondaryTechnicianId");
CREATE INDEX IF NOT EXISTS "Intervention_startAt_idx" ON "Intervention"("startAt");
CREATE INDEX IF NOT EXISTS "Intervention_endAt_idx" ON "Intervention"("endAt");
