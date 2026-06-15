import { RequestContext } from '../types';
import { assertCanRead } from '../policies/common';
import { runInTenantContext } from '@/lib/db-context';
import { JournalRepository } from '../repositories/JournalRepository';

/**
 * Equipment reads. Equipment rows are minted today as journal/log link
 * targets (and now farm-task link targets); this read backs the equipment
 * picker on the farm-task form. A full Equipment CRUD surface (Assets
 * template) is a later follow-up.
 */
export async function listEquipment(ctx: RequestContext) {
    assertCanRead(ctx);
    return runInTenantContext(ctx, (db) => JournalRepository.listEquipment(db, ctx));
}
