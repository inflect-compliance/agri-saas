-- Add PENDING_REVIEW to WorkItemStatus (#6). A completed field operation
-- lands here awaiting reviewer approval before it is finalised (RESOLVED).
-- Placed before RESOLVED to match the schema enum order.
ALTER TYPE "WorkItemStatus" ADD VALUE IF NOT EXISTS 'PENDING_REVIEW' BEFORE 'RESOLVED';
