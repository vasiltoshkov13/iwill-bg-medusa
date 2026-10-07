/**
 * Hourly Ops → Medusa catalogue sync: prices, BG stock and what is on sale.
 *
 * `OPS_CATALOGUE_SYNC` picks the mode, so the job can be watched before it is
 * trusted and stopped without a code change:
 * - unset or "dry-run": plan and log every change, write nothing
 * - "apply": write the plan to Medusa
 * - "off": do nothing
 */

import type { MedusaContainer } from '@medusajs/framework/types';

import { runOpsCatalogueSync } from '../lib/ops-sync/apply';

export default async function opsCatalogueSyncJob(container: MedusaContainer): Promise<void> {
  const setting = (process.env.OPS_CATALOGUE_SYNC || 'dry-run').toLowerCase();
  if (setting === 'off') return;

  const logger = container.resolve('logger') as { error(message: string): void };
  try {
    await runOpsCatalogueSync(container, setting === 'apply' ? 'apply' : 'dry-run');
  } catch (error) {
    // A failed run changes nothing it has not finished; the next hour retries.
    logger.error(`[ops-sync] run failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export const config = {
  name: 'ops-catalogue-sync',
  schedule: '17 * * * *',
};
