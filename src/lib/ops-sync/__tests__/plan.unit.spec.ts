import { planLooksUnsafe } from '../apply';
import { modelForSku } from '../catalogue';
import { planSync, variantTitleFromOpsName, type MedusaProduct, type MedusaVariant, type OpsItem } from '../plan';

const ops = (sku: string, price: number, quantity_bg: number, name = `${sku.split('-')[0]} cfg`): OpsItem => ({
  sku, name, price, quantity_bg,
});
const product = (id: string, handle: string, status = 'published'): MedusaProduct => ({ id, handle, status });
const variant = (id: string, product_id: string, sku: string | null, price: number | null, stock: number | null): MedusaVariant => ({
  variant_id: id, product_id, sku, title: id, price, stock,
});

describe('planSync', () => {
  it('takes the Ops price and BG stock for a matched SKU', () => {
    const plan = planSync(
      [ops('N1121-J6412-8GB-128GB', 255.75, 10)],
      [product('p1', 'n1121')],
      [variant('v1', 'p1', 'N1121-J6412-8GB-128GB', 258.33, 4)],
    );
    expect(plan.prices).toEqual([{ variant_id: 'v1', sku: 'N1121-J6412-8GB-128GB', from: 258.33, to: 255.75 }]);
    expect(plan.stock).toEqual([{ variant_id: 'v1', sku: 'N1121-J6412-8GB-128GB', from: 4, to: 10 }]);
    expect(plan.statuses).toEqual([]);
  });

  it('changes nothing when Medusa already matches', () => {
    const plan = planSync(
      [ops('N3322-X', 574.75, 11)],
      [product('p1', 'n3322')],
      [variant('v1', 'p1', 'N3322-X', 574.75, 11)],
    );
    expect(plan.prices).toEqual([]);
    expect(plan.stock).toEqual([]);
    expect(plan.statuses).toEqual([]);
  });

  it('makes a zero-priced SKU unorderable and keeps its old price', () => {
    const plan = planSync([ops('N3022-X', 0, 3)], [product('p1', 'n3022')], [variant('v1', 'p1', 'N3022-X', 368.5, 3)]);
    expect(plan.prices).toEqual([]);
    expect(plan.stock).toEqual([{ variant_id: 'v1', sku: 'N3022-X', from: 3, to: 0 }]);
    expect(plan.statuses).toEqual([{ product_id: 'p1', handle: 'n3022', from: 'published', to: 'draft' }]);
    expect(plan.skipped).toContainEqual({ sku: 'N3022-X', reason: 'zero_price' });
  });

  it('drafts a product with no BG stock left and republishes it when stock returns', () => {
    const out = planSync([ops('IBOX-3026-A', 763.13, 0)], [product('p1', 'ibox-3026')], [variant('v1', 'p1', 'IBOX-3026-A', 763.13, 2)]);
    expect(out.statuses[0].to).toBe('draft');
    const back = planSync([ops('IBOX-3026-A', 763.13, 2)], [product('p1', 'ibox-3026', 'draft')], [variant('v1', 'p1', 'IBOX-3026-A', 763.13, 0)]);
    expect(back.statuses[0].to).toBe('published');
  });

  it('keeps a product published while any variant is sellable', () => {
    const plan = planSync(
      [ops('N3161-A', 653.13, 0), ops('N3161-B', 589.88, 2)],
      [product('p1', 'n3161')],
      [variant('v1', 'p1', 'N3161-A', 653.13, 1), variant('v2', 'p1', 'N3161-B', 589.88, 2)],
    );
    expect(plan.statuses).toEqual([]);
    expect(plan.stock).toEqual([{ variant_id: 'v1', sku: 'N3161-A', from: 1, to: 0 }]);
  });

  it('zeroes a managed product variant that Ops does not list', () => {
    const plan = planSync(
      [ops('N1241-BAREBONE', 196.63, 3)],
      [product('p1', 'n1241')],
      [variant('v1', 'p1', 'N1241-BAREBONE', 196.63, 3), variant('v2', 'p1', 'N1241-GONE', 283.33, 2)],
    );
    expect(plan.stock).toEqual([{ variant_id: 'v2', sku: 'N1241-GONE', from: 2, to: 0 }]);
    expect(plan.skipped).toContainEqual({ sku: 'N1241-GONE', reason: 'not_in_ops', detail: 'n1241' });
  });

  it('leaves products with no SKU in Ops untouched', () => {
    const plan = planSync(
      [ops('N3322-X', 574.75, 11)],
      [product('p1', 'n3322'), product('p2', 'kingston-ddr4-16gb-sodimm')],
      [variant('v1', 'p1', 'N3322-X', 574.75, 11), variant('v2', 'p2', 'CBD32D4S2D8HD-16', 59, 0)],
    );
    expect(plan.unmanaged).toEqual(['kingston-ddr4-16gb-sodimm']);
    expect(plan.stock).toEqual([]);
    expect(plan.statuses).toEqual([]);
  });

  it('matches SKUs case-insensitively', () => {
    const plan = planSync([ops('n3322-x', 574.75, 11)], [product('p1', 'n3322')], [variant('v1', 'p1', 'N3322-X', 574.75, 11)]);
    expect(plan.unmanaged).toEqual([]);
    expect(plan.stock).toEqual([]);
  });

  it('creates a new product from the catalogue for an unlisted in-stock model', () => {
    const plan = planSync([ops('MC-76-I5-1235U-8GB-128GB', 861.34, 1, 'MC-76 i5-1235U 8GB RAM 128GB M.2 SSD')], [], []);
    expect(plan.creates).toHaveLength(1);
    expect(plan.creates[0]).toMatchObject({
      handle: 'mc-76', product_id: null, sku: 'MC-76-I5-1235U-8GB-128GB', title: 'i5-1235U 8GB RAM 128GB M.2 SSD', price: 861.34, stock: 1,
    });
    expect(plan.creates[0].product?.title).toContain('MC-76');
  });

  it('adds a new configuration to an existing product and publishes it', () => {
    const plan = planSync(
      [ops('IBOX-3026-NEW', 900, 2, 'IBOX-3026 i7 new')],
      [product('p1', 'ibox-3026', 'draft')],
      [variant('v1', 'p1', 'IBOX-3026-OLD', 763.13, 0)],
    );
    expect(plan.creates[0]).toMatchObject({ handle: 'ibox-3026', product_id: 'p1', product: null });
    expect(plan.statuses).toEqual([{ product_id: 'p1', handle: 'ibox-3026', from: 'draft', to: 'published' }]);
  });

  it('never creates a model it has no copy for, or one out of stock or unpriced', () => {
    const plan = planSync(
      [ops('IBOX-601-I7', 424.88, 2), ops('MC-41-A', 287.34, 0), ops('MC-74J-A', 0, 1)],
      [], [],
    );
    expect(plan.creates).toEqual([]);
    expect(plan.skipped).toEqual([
      { sku: 'IBOX-601-I7', reason: 'no_catalogue_entry', detail: 'IBOX cfg' },
      { sku: 'MC-74J-A', reason: 'zero_price' },
    ]);
  });
});

describe('catalogue', () => {
  it('prefers the longest model prefix', () => {
    expect(modelForSku('MC-74J-J6412-8GB-128GB', { 'MC-74': { handle: 'mc-74' }, 'MC-74J': { handle: 'mc-74j' } })?.handle).toBe('mc-74j');
    expect(modelForSku('NS-1U6L-ADL-I3-32GB-128GB')?.handle).toBe('1u6l-adl');
    expect(modelForSku('N12210-X')).toBeNull();
  });

  it('drops the model from Ops names for the variant title', () => {
    expect(variantTitleFromOpsName('N1221 J6412 4GB RAM 64GB SSD')).toBe('J6412 4GB RAM 64GB SSD');
    expect(variantTitleFromOpsName('N5-Plus 1COM Barebone (no RAM / no SSD)')).toBe('1COM Barebone (без RAM/SSD)');
  });
});

describe('planLooksUnsafe', () => {
  const many = Array.from({ length: 20 }, (_, i) => ops(`X-${i}`, 1, 1));
  it('refuses a near-empty Ops feed', () => {
    expect(planLooksUnsafe([ops('A', 1, 1)], planSync([], [], []), [])).toMatch(/only 1 items/);
  });
  it('refuses a plan that drafts most of the store', () => {
    const products = [product('p1', 'a'), product('p2', 'b'), product('p3', 'c')];
    const plan = { prices: [], stock: [], creates: [], skipped: [], unmanaged: [],
      statuses: products.slice(0, 2).map((p) => ({ product_id: p.id, handle: p.handle, from: 'published', to: 'draft' as const })) };
    expect(planLooksUnsafe(many, plan, products)).toMatch(/draft 2 of 3/);
  });
  it('accepts an ordinary plan', () => {
    expect(planLooksUnsafe(many, planSync([], [], []), [])).toBeNull();
  });
});
