/**
 * Which Medusa product an Ops SKU belongs to, and the store copy for models the
 * sync may create.
 *
 * Ops SKUs start with the model ("MC-74J-J6412-8GB-128GB"), and a model maps to
 * one storefront product handle — the same handle as the catalogue page on
 * iwill.bg, so the "Купи онлайн" button and the store page line up.
 *
 * `product` is only needed for a model whose product does not exist in Medusa
 * yet. Its copy is condensed from the storefront catalogue (src/data/products.ts
 * in iwill-bg-storefront); keep the two in step when a model is added here.
 */

export interface ProductCopy {
  title: string;
  description: string;
  thumbnail: string;
}

export interface CatalogueEntry {
  handle: string;
  product?: ProductCopy;
}

const img = (dir: string, file = '1.jpg') => `https://www.iwill.bg/products/${dir}/${file}`;

/** Keyed by SKU prefix, without the trailing dash. */
export const CATALOGUE: Record<string, CatalogueEntry> = {
  // Products already in Medusa: new configurations land as variants.
  'N3322': { handle: 'n3322' },
  'N3022': { handle: 'n3022' },
  'N3161': { handle: 'n3161' },
  'N1241': { handle: 'n1241' },
  'N1522': { handle: 'n1522' },
  'N1121': { handle: 'n1121' },
  '1U8L-B75': { handle: '1u8l-b75' },
  'NS-1U6L-ADL': { handle: '1u6l-adl' },
  '2U6L-ADL': { handle: '2u6l-adl' },
  'IBOX-3026': { handle: 'ibox-3026' },
  'IBOX-3126': { handle: 'ibox-3126' },
  'IBOX-3226': { handle: 'ibox-3226' },
  'ITPC-A215C': { handle: 'itpc-a215c' },
  'ITPC-A500': { handle: 'itpc-a500' },
  'ITPC-A600': { handle: 'itpc-a600' },
  'ITPC-B156-CP2': { handle: 'itpc-b156-cp2' },

  // Models with a catalogue page and photos but no store product yet.
  'N1221': {
    handle: 'n1221',
    product: {
      title: 'IWILL Nano-N1221 Mini PC – безвентилаторен мини компютър Intel Celeron J6412, 2× HDMI 4K',
      description:
        'Nano-N1221 — икономичен безвентилаторен мини компютър с Intel Celeron J6412 (Elkhart Lake), 2× HDMI 4K@60Hz и 2× RJ45 LAN. За офис, digital signage и thin client.',
      thumbnail: img('N1221'),
    },
  },
  'MC-41': {
    handle: 'mc-41',
    product: {
      title: 'IWILL MC-41 – мрежова платформа за firewall Intel Celeron J1900, 4× Gigabit LAN',
      description:
        'MC-41 — компактна безвентилаторна x86 платформа за базов firewall, router, VPN gateway и мрежов мониторинг. Intel Celeron J1900, 4× Gigabit Ethernet. Софтуерът (pfSense, OPNsense и др.) е по избор на клиента.',
      thumbnail: img('MC-41', '1.webp'),
    },
  },
  'MC-74J': {
    handle: 'mc-74j',
    product: {
      title: 'IWILL MC-74J – безвентилаторна мрежова платформа Intel Celeron J6412, 4× Intel Gigabit LAN',
      description:
        'MC-74J — безвентилаторна мрежова платформа с embedded-class Intel Celeron J6412 и 4× Intel Gigabit Ethernet. За firewall, router, VPN gateway, SD-WAN и edge внедрявания.',
      thumbnail: img('MC-74J', '1.webp'),
    },
  },
  'MC-76': {
    handle: 'mc-76',
    product: {
      title: 'IWILL MC-76 – мрежова платформа Intel Core i5-1235U, 6× 2.5G LAN, DDR5',
      description:
        'MC-76 — високопроизводителна безвентилаторна мрежова платформа с 10-ядрен Intel Core i5-1235U, 6× 2.5 Gigabit Ethernet и до 64 GB DDR5. За multi-WAN firewall, UTM/NGFW, SD-WAN и виртуализация.',
      thumbnail: img('MC-76', '1.webp'),
    },
  },
  'N5-PLUS': {
    handle: 'n5-plus',
    product: {
      title: 'IWILL N5 Plus Mini PC – безвентилаторен мини компютър, 3 дисплея, 4K',
      description:
        'N5 Plus — компактен безвентилаторен мини компютър с поддръжка на 4K и три дисплейни изхода (1× DisplayPort + 2× HDMI). За мултимедийни и офис приложения.',
      thumbnail: img('N5-PLUS'),
    },
  },
};

/** Longest-prefix match, so "MC-74J-…" never resolves to an "MC-74" entry. */
export function modelForSku(
  sku: string,
  catalogue: Record<string, CatalogueEntry> = CATALOGUE,
): CatalogueEntry | null {
  const upper = sku.trim().toUpperCase();
  let best: string | null = null;
  for (const prefix of Object.keys(catalogue)) {
    const p = prefix.toUpperCase();
    if ((upper === p || upper.startsWith(`${p}-`)) && (!best || p.length > best.length)) best = prefix;
  }
  return best ? catalogue[best] : null;
}
