/**
 * Run the Ops → Medusa catalogue sync once, outside the hourly schedule.
 *
 *   npx medusa exec ./src/scripts/ops-catalogue-sync.ts            # dry run
 *   npx medusa exec ./src/scripts/ops-catalogue-sync.ts apply      # write
 */
import type { ExecArgs } from '@medusajs/framework/types';

import { runOpsCatalogueSync } from '../lib/ops-sync/apply';

export default async function opsCatalogueSync({ container, args }: ExecArgs) {
  await runOpsCatalogueSync(container, args?.[0] === 'apply' ? 'apply' : 'dry-run');
}
