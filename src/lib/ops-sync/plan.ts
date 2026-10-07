/**
 * Ops → Medusa catalogue sync: the pure planning step.
 *
 * IWILL Ops is the source of truth for what the online store sells and at what
 * price. Given an Ops inventory snapshot and the current Medusa catalogue, this
 * works out every change the store needs; `apply.ts` carries the plan out. It
 * does no I/O, so the same plan can be logged as a dry run, unit tested, or
 * computed off-box against live data before anything is written.
 *
 * Rules (agreed with the store owner, 2026-10-07):
 * - Price: the Ops `current_selling_price` (manually confirmed, EUR, VAT
 *   included), stored in Medusa before VAT; never the legacy `selling_price`.
 * - Sellable = BG warehouse stock > 0 and a confirmed price > 0. A SKU without
 *   one is given stock 0 so it cannot be ordered at a stale Medusa price.
 * - A product with at least one variant SKU in Ops is "managed": it is published
 *   while any variant is sellable and set to draft otherwise. A managed product's
 *   variants that are missing from Ops get stock 0.
 * - Products with no SKU in Ops at all (the RAM/SSD add-ons until they are added
 *   to Ops) are left exactly as they are.
 * - An in-stock, priced Ops SKU missing from Medusa is added as a variant under
 *   its model's product, which is created from `CATALOGUE` when it does not exist
 *   yet. Models without a catalogue entry are reported, never auto-created, so a
 *   product cannot go on sale without real copy and photos.
 */

import { CATALOGUE, modelForSku, type CatalogueEntry, type ProductCopy } from './catalogue';

export interface OpsItem {
  sku: string;
  name: string;
  price: number;
  quantity_bg: number;
}

export interface MedusaVariant {
  variant_id: string;
  sku: string | null;
  title: string;
  product_id: string;
  /** Current EUR amount, or null when the variant has no EUR price. */
  price: number | null;
  /** Stocked quantity summed over locations, or null without an inventory item. */
  stock: number | null;
}

export interface MedusaProduct {
  id: string;
  handle: string;
  status: string;
}

export interface PriceChange { variant_id: string; sku: string; from: number | null; to: number }
export interface StockChange { variant_id: string; sku: string; from: number | null; to: number }
export interface StatusChange { product_id: string; handle: string; from: string; to: 'published' | 'draft' }
export interface VariantCreate {
  sku: string;
  title: string;
  price: number;
  stock: number;
  handle: string;
  /** Set when the product already exists in Medusa. */
  product_id: string | null;
  /** Set when the product has to be created. */
  product: ProductCopy | null;
}
export type SkipReason = 'zero_price' | 'no_catalogue_entry' | 'not_in_ops';
export interface Skip { sku: string; reason: SkipReason; detail?: string }

export interface SyncPlan {
  prices: PriceChange[];
  stock: StockChange[];
  statuses: StatusChange[];
  creates: VariantCreate[];
  skipped: Skip[];
  /** Handles left untouched because none of their SKUs exist in Ops. */
  unmanaged: string[];
}

const eur = (n: number) => Math.round(n * 100) / 100;

export function variantTitleFromOpsName(name: string): string {
  // Ops names lead with the model ("N1221 J6412 4GB RAM 64GB SSD"); the product
  // already carries the model, so the variant keeps only the configuration.
  const rest = name.trim().split(/\s+/).slice(1).join(' ');
  return (rest || name.trim()).replace(/\(no RAM \/ no SSD\)/i, '(без RAM/SSD)');
}

export function planSync(
  opsItems: OpsItem[],
  products: MedusaProduct[],
  variants: MedusaVariant[],
  catalogue: Record<string, CatalogueEntry> = CATALOGUE,
): SyncPlan {
  const plan: SyncPlan = { prices: [], stock: [], statuses: [], creates: [], skipped: [], unmanaged: [] };

  const opsBySku = new Map<string, OpsItem>();
  for (const item of opsItems) {
    if (item.sku) opsBySku.set(item.sku.trim().toUpperCase(), item);
  }
  const key = (sku: string | null) => (sku ?? '').trim().toUpperCase();

  const variantsByProduct = new Map<string, MedusaVariant[]>();
  for (const v of variants) {
    const list = variantsByProduct.get(v.product_id) ?? [];
    list.push(v);
    variantsByProduct.set(v.product_id, list);
  }

  const knownSkus = new Set(variants.map((v) => key(v.sku)).filter(Boolean));
  const productByHandle = new Map(products.map((p) => [p.handle, p]));
  // Products that will hold a sellable variant once new variants are created.
  const gainsSellable = new Set<string>();

  // New SKUs first, so a product that only gains stock through a new variant is
  // published rather than drafted below.
  for (const item of opsItems) {
    const sku = key(item.sku);
    if (!sku || knownSkus.has(sku)) continue;
    if (item.quantity_bg <= 0) continue;
    if (!(item.price > 0)) {
      plan.skipped.push({ sku: item.sku, reason: 'zero_price' });
      continue;
    }
    const model = modelForSku(sku, catalogue);
    if (!model) {
      plan.skipped.push({ sku: item.sku, reason: 'no_catalogue_entry', detail: item.name });
      continue;
    }
    const existing = productByHandle.get(model.handle) ?? null;
    if (!existing && !model.product) {
      plan.skipped.push({ sku: item.sku, reason: 'no_catalogue_entry', detail: item.name });
      continue;
    }
    plan.creates.push({
      sku: item.sku,
      title: variantTitleFromOpsName(item.name),
      price: eur(item.price),
      stock: item.quantity_bg,
      handle: model.handle,
      product_id: existing?.id ?? null,
      product: existing ? null : model.product!,
    });
    if (existing) gainsSellable.add(existing.id);
  }

  for (const product of products) {
    const own = variantsByProduct.get(product.id) ?? [];
    const managed = gainsSellable.has(product.id) || own.some((v) => opsBySku.has(key(v.sku)));
    if (!managed) {
      plan.unmanaged.push(product.handle);
      continue;
    }

    let sellable = gainsSellable.has(product.id);
    for (const v of own) {
      const item = opsBySku.get(key(v.sku));
      let targetStock: number;
      if (!item) {
        targetStock = 0;
        plan.skipped.push({ sku: v.sku ?? v.variant_id, reason: 'not_in_ops', detail: product.handle });
      } else if (!(item.price > 0)) {
        targetStock = 0;
        plan.skipped.push({ sku: item.sku, reason: 'zero_price' });
      } else {
        targetStock = Math.max(0, item.quantity_bg);
        const to = eur(item.price);
        if (v.price === null || eur(v.price) !== to) {
          plan.prices.push({ variant_id: v.variant_id, sku: item.sku, from: v.price, to });
        }
      }
      if (v.stock !== targetStock) {
        plan.stock.push({ variant_id: v.variant_id, sku: v.sku ?? v.variant_id, from: v.stock, to: targetStock });
      }
      if (targetStock > 0) sellable = true;
    }

    const to = sellable ? 'published' : 'draft';
    if (product.status !== to) {
      plan.statuses.push({ product_id: product.id, handle: product.handle, from: product.status, to });
    }
  }

  return plan;
}

export function summarisePlan(plan: SyncPlan): Record<string, number> {
  return {
    price_changes: plan.prices.length,
    stock_changes: plan.stock.length,
    status_changes: plan.statuses.length,
    variants_created: plan.creates.length,
    products_created: new Set(plan.creates.filter((c) => c.product).map((c) => c.handle)).size,
    skipped: plan.skipped.length,
    unmanaged_products: plan.unmanaged.length,
  };
}
