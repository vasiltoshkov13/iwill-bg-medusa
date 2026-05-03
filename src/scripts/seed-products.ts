/**
 * IWILL Products Seed — products only, correct price set linkage
 */
import { ExecArgs } from "@medusajs/framework/types";
import {
  ContainerRegistrationKeys,
  Modules,
  ProductStatus,
} from "@medusajs/framework/utils";
import {
  createInventoryLevelsWorkflow,
  createProductsWorkflow,
  deleteProductsWorkflow,
} from "@medusajs/medusa/core-flows";

const eur = (n: number) => Math.round(n * 100);
const REGION_ID = "reg_01KMBSKKSCARW99Y8H8TEC8YS5";
const SC_ID = "sc_01KM6ZYJK3F43VAX7TSFRGQAHY"; // Default Sales Channel

const BG_STOCK: Record<string, number> = {
  "N3322-I5-1235U-16GB-128GB":        12,
  "N3022-I5-8260U-16GB-64GB":          3,
  "N1522-BAREBONE":                     1,
  "N1121-J6412-8GB-128GB":             10,
  "N1241-BAREBONE":                     1,
  "N1241-N100-8GB-64GB":                2,
  "N3161-I5-1235U-16GB-128GB":          1,
  "N3161-I7-1255U-32GB-64GB":           2,
  "NS-1U6L-ADL-I3-32GB-128GB":          1,
  "1U8L-B75-I5-8GB-64GB":               1,
  "2U6L-ADL-I7-64GB-2TB":               1,
  "IBOX-3026-I7-1165G7-8GB-64GB":       2,
  "IBOX-3026-I7-1165G7-32GB-256GB":     5,
  "IBOX-3126-I5-1135G7-16GB-128GB":     1,
  "IBOX-3226-I7-1255U-16GB-128GB":     10,
  "IBOX-3226-I7-1255U-32GB-512GB":      3,
  "ITPC-A215C-I5-8260U-8GB-64GB":       1,
  "ITPC-A500-I5-8260U-8GB-64GB":        2,
  "ITPC-A600-I5-8260U-8GB-64GB":        1,
  "ITPC-B156-CP2-I5-8GB-64GB":          3,
};

function mkVariant(sku: string, title: string, price: number) {
  return {
    title,
    sku,
    options: { Config: title },
    prices: [
      { amount: eur(price), currency_code: "eur" },
      { amount: eur(price), currency_code: "eur", region_id: REGION_ID },
    ],
    manage_inventory: true,
  };
}

function mkProduct(
  title: string, handle: string, desc: string,
  thumbnail: string, spId: string,
  variants: ReturnType<typeof mkVariant>[]
) {
  return {
    title, handle, description: desc,
    status: ProductStatus.PUBLISHED,
    shipping_profile_id: spId,
    thumbnail,
    options: [{ title: "Config", values: variants.map(v => v.title) }],
    variants,
    sales_channels: [{ id: SC_ID }],
  };
}

export default async function seedIwillProducts({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const fulfillmentSvc = container.resolve(Modules.FULFILLMENT);
  const inventorySvc = container.resolve(Modules.INVENTORY);

  logger.info("=== IWILL Products Seed START ===");

  // Get shipping profile
  const profiles = await fulfillmentSvc.listShippingProfiles();
  const spId = profiles[0]?.id;
  if (!spId) throw new Error("No shipping profile");
  logger.info(`Using shipping profile: ${spId}`);

  // Delete existing products
  const { data: existing } = await query.graph({ entity: "product", fields: ["id", "title"] });
  logger.info(`Deleting ${existing.length} existing products...`);
  if (existing.length > 0) {
    await deleteProductsWorkflow(container).run({
      input: { ids: existing.map((p: any) => p.id) },
    });
  }

  // Get stock location
  const { data: locations } = await query.graph({ entity: "stock_location", fields: ["id", "name"] });
  const locId = locations[0]?.id;
  logger.info(`Stock location: ${locId}`);

  // Create products
  logger.info("Creating products...");
  const { result } = await createProductsWorkflow(container).run({
    input: {
      products: [
        // ── MINI PC ──────────────────────────────────────────────
        mkProduct("Nano-N3322", "n3322",
          "Nano-N3322 — мини компютър с Intel i5-1235U (Alder Lake), 16GB DDR5, 128GB NVMe SSD, 3× 2.5G LAN, 3× HDMI 4K@60Hz. Пасивно охлаждане.",
          "https://www.iwill.bg/products/N3322/1.jpg", spId,
          [mkVariant("N3322-I5-1235U-16GB-128GB", "i5-1235U 16GB DDR5 128GB NVMe", 574.75)]),

        mkProduct("Nano-N3022", "n3022",
          "Nano-N3022 с Intel i5-8260U, 16GB DDR4, 64GB SATA SSD, 2× Gigabit LAN, 2× HDMI. Пасивно охлаждане.",
          "https://www.iwill.bg/products/N3022/1.jpg", spId,
          [mkVariant("N3022-I5-8260U-16GB-64GB", "i5-8260U 16GB DDR4 64GB SSD", 368.50)]),

        mkProduct("IWILL N1522", "n1522",
          "N1522 Barebone с Intel N150, 9-36V DC захранване, 2× M.2, 8× USB, 2× HDMI 4K. Без RAM и SSD — добавете по избор.",
          "https://www.iwill.bg/products/N1522/1.jpg", spId,
          [mkVariant("N1522-BAREBONE", "Intel N150 Barebone (без RAM/SSD)", 195.25)]),

        mkProduct("Nano-N1121", "n1121",
          "Nano-N1121 — firewall мини PC с Intel J6412, 8GB DDR4, 128GB SSD, 3× 2.5G Ethernet, TPM 2.0. pfSense/OPNsense/Proxmox.",
          "https://www.iwill.bg/products/N1121/1.jpg", spId,
          [mkVariant("N1121-J6412-8GB-128GB", "J6412 8GB DDR4 128GB SSD", 258.33)]),

        // ── N1241 (2 варианта) ───────────────────────────────────
        mkProduct("Nano-N1241", "n1241",
          "Nano-N1241 — мини рутер с Intel N100, 4× 2.5G LAN, TPM 2.0. Идеален за pfSense/OPNsense. Два варианта: Barebone и готов.",
          "https://www.iwill.bg/products/N1241/1.jpg", spId, [
            mkVariant("N1241-BAREBONE",      "Intel N100 Barebone + WiFi AC7260",  196.63),
            mkVariant("N1241-N100-8GB-64GB", "N100 8GB DDR4 64GB SSD",             283.33),
          ]),

        // ── N3161 (2 варианта) ───────────────────────────────────
        mkProduct("Nano-N3161", "n3161",
          "Nano-N3161 — firewall appliance с Intel Alder Lake 12th Gen, 6× 2.5G LAN, PoE опция. Хардуерен bypass.",
          "https://www.iwill.bg/products/N3161/1.jpg", spId, [
            mkVariant("N3161-I5-1235U-16GB-128GB", "i5-1235U 16GB DDR4 128GB NVMe", 653.13),
            mkVariant("N3161-I7-1255U-32GB-64GB",  "i7-1255U 32GB DDR4 64GB NVMe",  589.88),
          ]),

        // ── RACKMOUNT ────────────────────────────────────────────
        mkProduct("1U6L-ADL Rackmount Firewall", "1u6l-adl",
          "1U Rackmount Firewall с Intel i3-12100T (Alder Lake Desktop), 32GB DDR4, 128GB SSD, 6× 1G LAN с хардуерен bypass.",
          "https://www.iwill.bg/products/1U6L-ADL/1.jpg", spId,
          [mkVariant("NS-1U6L-ADL-I3-32GB-128GB", "i3-12100T 32GB DDR4 128GB SSD", 1028.50)]),

        mkProduct("1U8L-B75 Rackmount Server", "1u8l-b75",
          "1U8L-B75 с Intel i5-3450U, 8GB DDR3, 64GB mSATA, 8× Gigabit LAN. 19\" rack монтаж.",
          "https://www.iwill.bg/products/1U8L-B75/1.jpg", spId,
          [mkVariant("1U8L-B75-I5-8GB-64GB", "i5-3450U 8GB DDR3 64GB mSATA", 640.75)]),

        mkProduct("2U6L-ADL Rackmount Firewall", "2u6l-adl",
          "2U Rackmount Firewall с Intel i7-12700U (Alder Lake), 64GB DDR4, 2TB NVMe SSD, 6× 1G LAN с bypass.",
          "https://www.iwill.bg/products/2U6L-ADL/1.jpg", spId,
          [mkVariant("2U6L-ADL-I7-64GB-2TB", "i7-12700U 64GB DDR4 2TB NVMe", 1243.00)]),

        // ── INDUSTRIAL ───────────────────────────────────────────
        mkProduct("IBOX-3026", "ibox-3026",
          "IBOX-3026 — индустриален компютър с Intel i7-1165G7 (Tiger Lake), 4× RS232 COM порта, DC 9-36V, -20°C до 60°C.",
          "https://www.iwill.bg/products/IBOX-3026/1.jpg", spId, [
            mkVariant("IBOX-3026-I7-1165G7-8GB-64GB",   "i7-1165G7 8GB DDR4 64GB SSD",   763.13),
            mkVariant("IBOX-3026-I7-1165G7-32GB-256GB", "i7-1165G7 32GB DDR4 256GB NVMe", 838.75),
          ]),

        mkProduct("IBOX-3126", "ibox-3126",
          "IBOX-3126 с Intel i5-1135G7 (Tiger Lake), 16GB DDR4, 128GB SSD, 3× 2.5G LAN, 2× RS232/485, DC 9-36V.",
          "https://www.iwill.bg/products/IBOX-3126/1.jpg", spId,
          [mkVariant("IBOX-3126-I5-1135G7-16GB-128GB", "i5-1135G7 16GB DDR4 128GB SSD", 544.50)]),

        mkProduct("IBOX-3226", "ibox-3226",
          "IBOX-3226 — индустриален компютър с Intel i7-1255U (Alder Lake), 4× HDMI 4K@60Hz. Идеален за Video Wall.",
          "https://www.iwill.bg/products/IBOX-3226/1.jpg", spId, [
            mkVariant("IBOX-3226-I7-1255U-16GB-128GB", "i7-1255U 16GB DDR4 128GB SSD",  660.00),
            mkVariant("IBOX-3226-I7-1255U-32GB-512GB", "i7-1255U 32GB DDR4 512GB NVMe", 921.25),
          ]),

        // ── TOUCH SCREENS ────────────────────────────────────────
        mkProduct("ITPC-A215C", "itpc-a215c",
          "21.5\" индустриален тъч панел PC — Intel i5-8260U, 8GB DDR4, 64GB SSD, Full HD IPS, 10-point капацитивен тъч, DC 9-36V.",
          "https://www.iwill.bg/products/ITPC-A215C/1.jpg", spId,
          [mkVariant("ITPC-A215C-I5-8260U-8GB-64GB", "i5-8260U 8GB DDR4 64GB SSD", 709.50)]),

        mkProduct("ITPC-A500", "itpc-a500",
          "15\" индустриален тъч панел PC — Intel i5-8260U, 8GB DDR4, 64GB SSD, 350 cd/m² резистивен тъч, DC 9-36V.",
          "https://www.iwill.bg/products/ITPC-A500/1.jpg", spId,
          [mkVariant("ITPC-A500-I5-8260U-8GB-64GB", "i5-8260U 8GB DDR4 64GB SSD", 617.38)]),

        mkProduct("ITPC-A600", "itpc-a600",
          "17\" индустриален тъч панел PC — Intel i5-8260U, 8GB DDR4, 64GB SSD, резистивен тъч, DC 9-36V.",
          "https://www.iwill.bg/products/ITPC-A600/1.jpg", spId,
          [mkVariant("ITPC-A600-I5-8260U-8GB-64GB", "i5-8260U 8GB DDR4 64GB SSD", 640.75)]),

        mkProduct("ITPC-B156-CP2", "itpc-b156-cp2",
          "15.6\" тъч панел PC — Intel i5-4300U, 8GB DDR3L, 64GB mSATA, Full HD IPS, IP65, капацитивен Full Bonding тъч, DC 9-36V.",
          "https://www.iwill.bg/products/ITPC-B156-CP2/1.jpg", spId,
          [mkVariant("ITPC-B156-CP2-I5-8GB-64GB", "i5-4300U 8GB DDR3L 64GB mSATA", 467.50)]),
      ],
    },
  });

  logger.info(`Created ${result.length} products`);

  // Inventory
  if (locId) {
    const levels: any[] = [];
    for (const product of result) {
      for (const variant of product.variants || []) {
        const qty = BG_STOCK[variant.sku ?? ""] ?? 0;
        if (qty > 0) {
          const items = await inventorySvc.listInventoryItems({ sku: variant.sku });
          if (items[0]) {
            levels.push({ inventory_item_id: items[0].id, location_id: locId, stocked_quantity: qty });
          }
        }
      }
    }
    if (levels.length) {
      await createInventoryLevelsWorkflow(container).run({ input: { input: levels } });
      logger.info(`Set inventory for ${levels.length} variants`);
    }
  }

  logger.info("=== DONE ===");
}
