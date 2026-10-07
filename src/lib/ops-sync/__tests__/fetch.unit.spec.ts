import { fetchOpsInventory, netOfVat } from '../apply';

describe('fetchOpsInventory', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  it('takes VAT out of the confirmed gross price', () => {
    expect(netOfVat(975)).toBe(812.5);
    expect(netOfVat(290)).toBe(241.67);
    // Adding VAT back and rounding to the cent restores the Ops price.
    for (const gross of [975, 290, 979, 2280, 535.55]) {
      expect(Math.round(netOfVat(gross) * 1.2 * 100) / 100).toBe(gross);
    }
  });

  it('prices from current_selling_price and never from the legacy price', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        items: [
          { sku: 'N3322-X', name: 'N3322 x', price: 574.75, current_selling_price: 975, quantity_bg: 11 },
          { sku: 'N3022-X', name: 'N3022 x', price: 368.5, current_selling_price: null, quantity_bg: 3 },
        ],
      }),
    }) as unknown as typeof fetch;

    const items = await fetchOpsInventory();
    expect(items).toEqual([
      { sku: 'N3322-X', name: 'N3322 x', price: 812.5, quantity_bg: 11 },
      { sku: 'N3022-X', name: 'N3022 x', price: 0, quantity_bg: 3 },
    ]);
  });
});
