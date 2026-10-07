/**
 * Ops → Medusa catalogue sync: reading the Medusa side and writing the plan.
 *
 * `plan.ts` decides; this file only loads the current catalogue in the shape the
 * planner wants and carries a plan out. Both the scheduled job and the manual
 * script go through `runOpsCatalogueSync`.
 */

import type { MedusaContainer } from '@medusajs/framework/types';
import { ContainerRegistrationKeys, Modules, ProductStatus } from '@medusajs/framework/utils';
import {
  createInventoryLevelsWorkflow,
  createProductVariantsWorkflow,
  createProductsWorkflow,
} from '@medusajs/medusa/core-flows';

import {
  planSync,
  summarisePlan,
  type MedusaProduct,
  type MedusaVariant,
  type OpsItem,
  type SyncPlan,
  type VariantCreate,
} from './plan';

export const DEFAULT_OPS_URL = 'https://iwill-ops-backend-production.up.railway.app';
export const OPS_INVENTORY_PATH = '/api/public/inventory?warehouse=BG';
const OPTION_TITLE = 'Config';

/**
 * Below this many Ops items the feed is treated as broken rather than as a real
 * catalogue, so an Ops outage can never draft the whole store.
 */
const MIN_OPS_ITEMS = 10;

export type SyncMode = 'dry-run' | 'apply';

interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

interface PriceRow { id: string; amount: number; currency_code: string }
interface LevelRow { location_id: string; stocked_quantity: number }
interface VariantState {
  priceSetId: string | null;
  prices: PriceRow[];
  inventoryItemId: string | null;
  levels: LevelRow[];
}

interface MedusaState {
  products: MedusaProduct[];
  variants: MedusaVariant[];
  byVariant: Map<string, VariantState>;
  optionByProduct: Map<string, { id: string; values: string[] }>;
}

export async function fetchOpsInventory(): Promise<OpsItem[]> {
  const baseUrl = (process.env.IWILL_OPS_API_URL || DEFAULT_OPS_URL).replace(/\/+$/, '');
  const timeoutMs = Number(process.env.IWILL_OPS_TIMEOUT_MS) || 15_000;
  const response = await fetch(`${baseUrl}${OPS_INVENTORY_PATH}`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`Ops inventory responded ${response.status}`);
  const body = (await response.json()) as { success?: boolean; items?: unknown };
  if (!body.success || !Array.isArray(body.items)) throw new Error('Ops inventory returned no items array');
  return (body.items as Record<string, unknown>[]).map((row) => ({
    sku: String(row.sku ?? ''),
    name: String(row.name ?? ''),
    price: Number(row.price) || 0,
    quantity_bg: Number(row.quantity_bg) || 0,
  }));
}

async function loadMedusaState(container: MedusaContainer): Promise<MedusaState> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({
    entity: 'product',
    fields: [
      'id',
      'handle',
      'status',
      'options.id',
      'options.title',
      'options.values.value',
      'variants.id',
      'variants.sku',
      'variants.title',
      'variants.price_set.id',
      'variants.price_set.prices.id',
      'variants.price_set.prices.amount',
      'variants.price_set.prices.currency_code',
      'variants.inventory_items.inventory_item_id',
      'variants.inventory_items.inventory.location_levels.location_id',
      'variants.inventory_items.inventory.location_levels.stocked_quantity',
    ],
  });

  const state: MedusaState = { products: [], variants: [], byVariant: new Map(), optionByProduct: new Map() };
  for (const p of data as any[]) {
    state.products.push({ id: p.id, handle: p.handle, status: p.status });
    const option = (p.options ?? []).find((o: any) => o.title === OPTION_TITLE);
    if (option) {
      state.optionByProduct.set(p.id, { id: option.id, values: (option.values ?? []).map((v: any) => v.value) });
    }
    for (const v of p.variants ?? []) {
      const prices: PriceRow[] = (v.price_set?.prices ?? []).map((pr: any) => ({
        id: pr.id,
        amount: Number(pr.amount),
        currency_code: pr.currency_code,
      }));
      const link = (v.inventory_items ?? [])[0];
      const levels: LevelRow[] = (link?.inventory?.location_levels ?? []).map((l: any) => ({
        location_id: l.location_id,
        stocked_quantity: Number(l.stocked_quantity) || 0,
      }));
      const eurPrice = prices.find((pr) => pr.currency_code === 'eur');
      state.variants.push({
        variant_id: v.id,
        sku: v.sku ?? null,
        title: v.title,
        product_id: p.id,
        price: eurPrice ? eurPrice.amount : null,
        stock: link ? levels.reduce((sum, l) => sum + l.stocked_quantity, 0) : null,
      });
      state.byVariant.set(v.id, {
        priceSetId: v.price_set?.id ?? null,
        prices,
        inventoryItemId: link?.inventory_item_id ?? null,
        levels,
      });
    }
  }
  return state;
}

/** Refuses plans that look like a broken feed rather than a real change. */
export function planLooksUnsafe(ops: OpsItem[], plan: SyncPlan, products: MedusaProduct[]): string | null {
  if (ops.length < MIN_OPS_ITEMS) return `Ops returned only ${ops.length} items`;
  const managed = products.length - plan.unmanaged.length;
  const drafted = plan.statuses.filter((s) => s.to === 'draft').length;
  if (managed > 0 && drafted > managed / 2) {
    return `plan would draft ${drafted} of ${managed} managed products`;
  }
  return null;
}

export async function runOpsCatalogueSync(
  container: MedusaContainer,
  mode: SyncMode,
): Promise<SyncPlan> {
  const logger = container.resolve('logger') as Logger;
  const ops = await fetchOpsInventory();
  const state = await loadMedusaState(container);
  const plan = planSync(ops, state.products, state.variants);

  const log = (event: string, extra: Record<string, unknown> = {}) =>
    logger.info(JSON.stringify({ service: 'medusa', event, mode, ...extra }));

  log('ops_catalogue_sync_planned', { ...summarisePlan(plan) });
  for (const p of plan.prices) log('ops_sync_price', { ...p });
  for (const s of plan.stock) log('ops_sync_stock', { ...s });
  for (const s of plan.statuses) log('ops_sync_status', { ...s });
  for (const c of plan.creates) {
    log('ops_sync_create', { sku: c.sku, handle: c.handle, title: c.title, price: c.price, stock: c.stock, new_product: !c.product_id });
  }
  for (const s of plan.skipped) log('ops_sync_skipped', { ...s });

  if (mode !== 'apply') return plan;

  const unsafe = planLooksUnsafe(ops, plan, state.products);
  if (unsafe) {
    logger.error(JSON.stringify({ service: 'medusa', event: 'ops_catalogue_sync_refused', reason: unsafe }));
    return plan;
  }

  await applyPlan(container, plan, state, logger);
  log('ops_catalogue_sync_applied', { ...summarisePlan(plan) });
  return plan;
}

async function applyPlan(
  container: MedusaContainer,
  plan: SyncPlan,
  state: MedusaState,
  logger: Logger,
): Promise<void> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const productSvc: any = container.resolve(Modules.PRODUCT);
  const pricingSvc: any = container.resolve(Modules.PRICING);
  const inventorySvc: any = container.resolve(Modules.INVENTORY);

  const { data: locations } = await query.graph({ entity: 'stock_location', fields: ['id'] });
  const locationId: string | undefined = (locations as any[])[0]?.id;

  // Prices. `updatePriceSets` replaces the set's whole price list, so every
  // existing price is sent back; only the EUR ones change.
  for (const change of plan.prices) {
    const v = state.byVariant.get(change.variant_id);
    if (!v?.priceSetId || !v.prices.some((p) => p.currency_code === 'eur')) {
      logger.warn(`[ops-sync] ${change.sku}: no EUR price to update`);
      continue;
    }
    await pricingSvc.updatePriceSets(v.priceSetId, {
      prices: v.prices.map((p) => ({
        id: p.id,
        currency_code: p.currency_code,
        amount: p.currency_code === 'eur' ? change.to : p.amount,
      })),
    });
  }

  // Stock: the whole quantity sits at the first location, any other is zeroed.
  for (const change of plan.stock) {
    const v = state.byVariant.get(change.variant_id);
    if (!v?.inventoryItemId) {
      logger.warn(`[ops-sync] ${change.sku}: no inventory item, stock not managed`);
      continue;
    }
    const target = locationId ?? v.levels[0]?.location_id;
    if (!target) {
      logger.warn(`[ops-sync] ${change.sku}: no stock location`);
      continue;
    }
    const updates = v.levels.map((l) => ({
      inventory_item_id: v.inventoryItemId,
      location_id: l.location_id,
      stocked_quantity: l.location_id === target ? change.to : 0,
    }));
    if (updates.length) await inventorySvc.updateInventoryLevels(updates);
    if (!v.levels.some((l) => l.location_id === target)) {
      await inventorySvc.createInventoryLevels([
        { inventory_item_id: v.inventoryItemId, location_id: target, stocked_quantity: change.to },
      ]);
    }
  }

  for (const change of plan.statuses) {
    await productSvc.updateProducts(change.product_id, {
      status: change.to === 'published' ? ProductStatus.PUBLISHED : ProductStatus.DRAFT,
    });
  }

  if (plan.creates.length) await applyCreates(container, plan.creates, state, locationId, logger);
}

async function applyCreates(
  container: MedusaContainer,
  creates: VariantCreate[],
  state: MedusaState,
  locationId: string | undefined,
  logger: Logger,
): Promise<void> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const productSvc: any = container.resolve(Modules.PRODUCT);
  const fulfillmentSvc: any = container.resolve(Modules.FULFILLMENT);

  const { data: regions } = await query.graph({ entity: 'region', fields: ['id', 'currency_code'] });
  const regionId: string | undefined = (regions as any[]).find((r) => r.currency_code === 'eur')?.id;
  const { data: channels } = await query.graph({ entity: 'sales_channel', fields: ['id', 'name'] });
  const channel = (channels as any[]).find((c) => c.name === 'Default Sales Channel') ?? (channels as any[])[0];
  const profiles = await fulfillmentSvc.listShippingProfiles();
  const shippingProfileId: string | undefined = profiles[0]?.id;
  if (!channel || !shippingProfileId) {
    logger.error('[ops-sync] no sales channel or shipping profile; skipping creates');
    return;
  }

  // Mirrors the seed: one plain EUR price and one scoped to the EUR region.
  const pricesFor = (amount: number) => [
    { amount, currency_code: 'eur' },
    ...(regionId ? [{ amount, currency_code: 'eur', rules: { region_id: regionId } }] : []),
  ];
  const variantInput = (c: VariantCreate) => ({
    title: c.title,
    sku: c.sku,
    options: { [OPTION_TITLE]: c.title },
    prices: pricesFor(c.price),
    manage_inventory: true,
  });

  const stockBySku = new Map(creates.map((c) => [c.sku, c.stock]));
  const createdVariantIds: string[] = [];

  // New products, one per handle, carrying all of their new variants.
  const newByHandle = new Map<string, VariantCreate[]>();
  for (const c of creates.filter((c) => !c.product_id)) {
    newByHandle.set(c.handle, [...(newByHandle.get(c.handle) ?? []), c]);
  }
  if (newByHandle.size) {
    const { result } = await createProductsWorkflow(container).run({
      input: {
        products: [...newByHandle.entries()].map(([handle, list]) => ({
          title: list[0].product!.title,
          handle,
          description: list[0].product!.description,
          thumbnail: list[0].product!.thumbnail,
          status: ProductStatus.PUBLISHED,
          shipping_profile_id: shippingProfileId,
          options: [{ title: OPTION_TITLE, values: list.map((c) => c.title) }],
          variants: list.map(variantInput),
          sales_channels: [{ id: channel.id }],
        })),
      },
    });
    for (const product of result as any[]) {
      for (const v of product.variants ?? []) createdVariantIds.push(v.id);
    }
  }

  // New configurations of products that already exist.
  for (const c of creates.filter((c) => c.product_id)) {
    const option = state.optionByProduct.get(c.product_id!);
    if (!option) {
      logger.warn(`[ops-sync] ${c.sku}: product ${c.handle} has no ${OPTION_TITLE} option`);
      continue;
    }
    if (!option.values.includes(c.title)) {
      // Existing values are passed by value and keep their ids.
      option.values = [...option.values, c.title];
      await productSvc.updateProductOptions(option.id, { values: option.values });
    }
    const { result } = await createProductVariantsWorkflow(container).run({
      input: { product_variants: [{ ...variantInput(c), product_id: c.product_id! }] },
    });
    for (const v of result as any[]) createdVariantIds.push(v.id);
  }

  if (!locationId || !createdVariantIds.length) return;
  const { data: rows } = await query.graph({
    entity: 'product_variant',
    fields: ['id', 'sku', 'inventory_items.inventory_item_id'],
    filters: { id: createdVariantIds },
  });
  const levels = (rows as any[]).flatMap((v) =>
    (v.inventory_items ?? []).map((link: any) => ({
      inventory_item_id: link.inventory_item_id,
      location_id: locationId,
      stocked_quantity: stockBySku.get(v.sku) ?? 0,
    })),
  );
  if (levels.length) {
    await createInventoryLevelsWorkflow(container).run({ input: { inventory_levels: levels } });
  }
}
