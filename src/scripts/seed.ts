import { CreateInventoryLevelInput, ExecArgs } from "@medusajs/framework/types";
import {
  ContainerRegistrationKeys,
  Modules,
  ProductStatus,
} from "@medusajs/framework/utils";
import {
  createWorkflow,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import {
  createApiKeysWorkflow,
  createInventoryLevelsWorkflow,
  createProductCategoriesWorkflow,
  createProductsWorkflow,
  createRegionsWorkflow,
  createSalesChannelsWorkflow,
  createShippingOptionsWorkflow,
  createShippingProfilesWorkflow,
  createStockLocationsWorkflow,
  createTaxRegionsWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
  updateStoresStep,
  updateStoresWorkflow,
} from "@medusajs/medusa/core-flows";
import { ApiKey } from "../../.medusa/types/query-entry-points";

const updateStoreCurrencies = createWorkflow(
  "update-store-currencies",
  (input: {
    supported_currencies: { currency_code: string; is_default?: boolean }[];
    store_id: string;
  }) => {
    const normalizedInput = transform({ input }, (data) => {
      return {
        selector: { id: data.input.store_id },
        update: {
          supported_currencies: data.input.supported_currencies.map(
            (currency) => {
              return {
                currency_code: currency.currency_code,
                is_default: currency.is_default ?? false,
              };
            }
          ),
        },
      };
    });

    const stores = updateStoresStep(normalizedInput);

    return new WorkflowResponse(stores);
  }
);

export default async function seedDemoData({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const link = container.resolve(ContainerRegistrationKeys.LINK);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const fulfillmentModuleService = container.resolve(Modules.FULFILLMENT);
  const salesChannelModuleService = container.resolve(Modules.SALES_CHANNEL);
  const storeModuleService = container.resolve(Modules.STORE);

  const countries = ["bg", "gb", "de", "fr", "es", "it", "nl", "pl", "ro"];

  logger.info("Seeding store data...");
  const [store] = await storeModuleService.listStores();
  let defaultSalesChannel = await salesChannelModuleService.listSalesChannels({
    name: "Default Sales Channel",
  });

  if (!defaultSalesChannel.length) {
    const { result: salesChannelResult } = await createSalesChannelsWorkflow(
      container
    ).run({
      input: {
        salesChannelsData: [{ name: "Default Sales Channel" }],
      },
    });
    defaultSalesChannel = salesChannelResult;
  }

  await updateStoreCurrencies(container).run({
    input: {
      store_id: store.id,
      supported_currencies: [
        { currency_code: "eur", is_default: true },
        { currency_code: "bgn" },
      ],
    },
  });

  await updateStoresWorkflow(container).run({
    input: {
      selector: { id: store.id },
      update: { default_sales_channel_id: defaultSalesChannel[0].id },
    },
  });

  logger.info("Seeding region data...");
  const { result: regionResult } = await createRegionsWorkflow(container).run({
    input: {
      regions: [
        {
          name: "Europe",
          currency_code: "eur",
          countries,
          payment_providers: ["pp_system_default"],
        },
      ],
    },
  });
  const region = regionResult[0];

  logger.info("Seeding tax regions...");
  await createTaxRegionsWorkflow(container).run({
    input: countries.map((country_code) => ({
      country_code,
      provider_id: "tp_system",
    })),
  });

  logger.info("Seeding stock location...");
  const { result: stockLocationResult } = await createStockLocationsWorkflow(
    container
  ).run({
    input: {
      locations: [
        {
          name: "Sofia Warehouse",
          address: { city: "Sofia", country_code: "BG", address_1: "" },
        },
      ],
    },
  });
  const stockLocation = stockLocationResult[0];

  await updateStoresWorkflow(container).run({
    input: {
      selector: { id: store.id },
      update: { default_location_id: stockLocation.id },
    },
  });

  await link.create({
    [Modules.STOCK_LOCATION]: { stock_location_id: stockLocation.id },
    [Modules.FULFILLMENT]: { fulfillment_provider_id: "manual_manual" },
  });

  logger.info("Seeding fulfillment...");
  const shippingProfiles = await fulfillmentModuleService.listShippingProfiles({
    type: "default",
  });
  let shippingProfile = shippingProfiles.length ? shippingProfiles[0] : null;

  if (!shippingProfile) {
    const { result: shippingProfileResult } =
      await createShippingProfilesWorkflow(container).run({
        input: {
          data: [{ name: "Default Shipping Profile", type: "default" }],
        },
      });
    shippingProfile = shippingProfileResult[0];
  }

  const fulfillmentSet = await fulfillmentModuleService.createFulfillmentSets({
    name: "Sofia Warehouse Delivery",
    type: "shipping",
    service_zones: [
      {
        name: "Europe",
        geo_zones: countries.map((country_code) => ({
          country_code,
          type: "country" as const,
        })),
      },
    ],
  });

  await link.create({
    [Modules.STOCK_LOCATION]: { stock_location_id: stockLocation.id },
    [Modules.FULFILLMENT]: { fulfillment_set_id: fulfillmentSet.id },
  });

  await createShippingOptionsWorkflow(container).run({
    input: [
      {
        name: "Standard Shipping",
        price_type: "flat",
        provider_id: "manual_manual",
        service_zone_id: fulfillmentSet.service_zones[0].id,
        shipping_profile_id: shippingProfile.id,
        type: { label: "Standard", description: "5-7 business days.", code: "standard" },
        prices: [
          { currency_code: "eur", amount: 25 },
          { region_id: region.id, amount: 25 },
        ],
        rules: [
          { attribute: "enabled_in_store", value: "true", operator: "eq" },
          { attribute: "is_return", value: "false", operator: "eq" },
        ],
      },
      {
        name: "Express Shipping",
        price_type: "flat",
        provider_id: "manual_manual",
        service_zone_id: fulfillmentSet.service_zones[0].id,
        shipping_profile_id: shippingProfile.id,
        type: { label: "Express", description: "1-2 business days.", code: "express" },
        prices: [
          { currency_code: "eur", amount: 45 },
          { region_id: region.id, amount: 45 },
        ],
        rules: [
          { attribute: "enabled_in_store", value: "true", operator: "eq" },
          { attribute: "is_return", value: "false", operator: "eq" },
        ],
      },
    ],
  });

  await linkSalesChannelsToStockLocationWorkflow(container).run({
    input: { id: stockLocation.id, add: [defaultSalesChannel[0].id] },
  });

  logger.info("Seeding publishable API key...");
  let publishableApiKey: ApiKey | null = null;
  const { data } = await query.graph({
    entity: "api_key",
    fields: ["id"],
    filters: { type: "publishable" },
  });
  publishableApiKey = data?.[0];

  if (!publishableApiKey) {
    const {
      result: [publishableApiKeyResult],
    } = await createApiKeysWorkflow(container).run({
      input: {
        api_keys: [{ title: "IWILL Webshop", type: "publishable", created_by: "" }],
      },
    });
    publishableApiKey = publishableApiKeyResult as ApiKey;
  }

  await linkSalesChannelsToApiKeyWorkflow(container).run({
    input: { id: publishableApiKey.id, add: [defaultSalesChannel[0].id] },
  });

  logger.info("Seeding product categories...");
  const { result: categoryResult } = await createProductCategoriesWorkflow(
    container
  ).run({
    input: {
      product_categories: [
        { name: "Mini PC", is_active: true },
        { name: "Network Security", is_active: true },
        { name: "Industrial PC", is_active: true },
        { name: "Touch Screens", is_active: true },
        { name: "RAM", is_active: true },
        { name: "SSD", is_active: true },
        { name: "Modules", is_active: true },
      ],
    },
  });

  const catId = (name: string) =>
    categoryResult.find((c) => c.name === name)!.id;

  const sc = [{ id: defaultSalesChannel[0].id }];
  const sp = shippingProfile.id;

  // Helper: price in EUR cents
  const eur = (amount: number) => Math.round(amount * 100);

  const makeProduct = (
    title: string,
    sku: string,
    priceEur: number,
    category: string,
    description: string,
    handle: string
  ) => ({
    title,
    handle,
    description,
    status: ProductStatus.PUBLISHED,
    shipping_profile_id: sp,
    category_ids: [catId(category)],
    options: [{ title: "Config", values: ["Standard"] }],
    variants: [
      {
        title: "Standard",
        sku,
        options: { Config: "Standard" },
        prices: [{ amount: eur(priceEur), currency_code: "eur" }],
      },
    ],
    sales_channels: sc,
  });

  logger.info("Seeding IWILL products...");

  await createProductsWorkflow(container).run({
    input: {
      products: [
        // ── MINI PC ─────────────────────────────────────────────────
        makeProduct(
          "N1221 — Mini PC J6412 4GB RAM 64GB SSD",
          "N1221-J6412-4GB-64GB", 203.50, "Mini PC",
          "Compact mini PC with Intel Celeron J6412, dual HDMI 4K, TPM 2.0. 4GB RAM, 64GB SSD.",
          "n1221-j6412-4gb-64gb"
        ),
        makeProduct(
          "N3022 — Mini PC i3 10110U 8GB RAM 64GB SSD",
          "N3022-I3-10110U-8GB-64GB", 389.13, "Mini PC",
          "Compact mini PC with Intel i3-10110U Comet Lake 10th gen, dual display. 8GB RAM, 64GB SSD.",
          "n3022-i3-8gb-64gb"
        ),
        makeProduct(
          "N3022 — Mini PC i5 8260U 16GB RAM 64GB SSD",
          "N3022-I5-8260U-16GB-64GB", 368.50, "Mini PC",
          "Compact mini PC with Intel i5-8260U Comet Lake, dual display. 16GB RAM, 64GB SSD.",
          "n3022-i5-16gb-64gb"
        ),
        makeProduct(
          "N1321 — Mini PC Barebone",
          "N1321-BAREBONE", 167.75, "Mini PC",
          "Compact mini PC with Intel Alder Lake N100, dual HDMI, TPM 2.0. Barebone — no RAM/SSD.",
          "n1321-barebone"
        ),
        makeProduct(
          "N1522 — Industrial Mini PC Barebone",
          "N1522-BAREBONE", 195.25, "Mini PC",
          "Industrial mini PC with Intel N150, 2x M.2, 8x USB, 9-36V DC input. Barebone — no RAM/SSD.",
          "n1522-barebone"
        ),
        makeProduct(
          "N3322 Fan — Mini PC i5 1235U 16GB DDR5 128GB SSD",
          "N3322-I5-1235U-16GB-128GB", 574.75, "Mini PC",
          "Mini PC with Intel Alder Lake 12th gen, 3x HDMI, 3x 2.5G LAN, DDR5. i5-1235U, 16GB DDR5, 128GB SSD.",
          "n3322-i5-16gb-128gb"
        ),
        makeProduct(
          "N5 Plus — Mini PC Barebone",
          "N5-PLUS-1COM-BAREBONE", 136.13, "Mini PC",
          "Budget mini PC with Intel Pentium J3710, 4K display support. Barebone — no RAM/SSD.",
          "n5-plus-barebone"
        ),
        // ── NETWORK SECURITY ───────────────────────────────────────
        makeProduct(
          "N1121 — Firewall Mini PC J6412 16GB 64GB",
          "N1121-J6412-16GB-64GB", 255.75, "Network Security",
          "Compact firewall mini PC with Intel Celeron J6412, 3x 2.5G LAN, TPM 2.0. 16GB RAM, 64GB SSD.",
          "n1121-j6412-16gb-64gb"
        ),
        makeProduct(
          "N1241 — Firewall Router Barebone + WiFi",
          "N1241-BAREBONE", 196.63, "Network Security",
          "Mini router with Intel Alder Lake N100, 4x 2.5G LAN, TPM 2.0. Barebone with Intel AC7260 WiFi.",
          "n1241-barebone"
        ),
        makeProduct(
          "N1241 — Firewall Router N100 8GB 64GB",
          "N1241-N100-8GB-64GB", 225.50, "Network Security",
          "Mini router with Intel Alder Lake N100, 4x 2.5G LAN, TPM 2.0. 8GB RAM, 64GB SSD.",
          "n1241-n100-8gb-64gb"
        ),
        makeProduct(
          "N1241 — Firewall Router N100 8GB 128GB",
          "N1241-N1241-8GB-128GB", 385.00, "Network Security",
          "Mini router with Intel Alder Lake N100, 4x 2.5G LAN, TPM 2.0. 8GB RAM, 128GB SSD.",
          "n1241-n100-8gb-128gb"
        ),
        makeProduct(
          "N3161 — Firewall i5 1235U 16GB 128GB NVMe",
          "N3161-I5-1235U-16GB-128GB", 653.13, "Network Security",
          "Firewall appliance with Intel Alder Lake i5-1235U, 6x 2.5G LAN, PoE option. 16GB RAM, 128GB NVMe.",
          "n3161-i5-16gb-128gb"
        ),
        makeProduct(
          "N3161 — Firewall i7 1255U 32GB 64GB NVMe",
          "N3161-I7-1255U-32GB-64GB", 589.88, "Network Security",
          "Firewall appliance with Intel Alder Lake i7-1255U, 6x 2.5G LAN, PoE option. 32GB RAM, 64GB NVMe.",
          "n3161-i7-32gb-64gb"
        ),
        makeProduct(
          "N3281 — Network Appliance i5 125U Barebone",
          "N3281-N3281", 506.00, "Network Security",
          "Powerful network appliance with Intel Core Ultra, 8x 2.5G LAN, DDR5. Barebone — no RAM/SSD.",
          "n3281-i5-barebone"
        ),
        makeProduct(
          "1U6L-ADL — 1U Rackmount Firewall i3 32GB 128GB",
          "NS-1U6L-ADL-I3-32GB-128GB", 1028.50, "Network Security",
          "1U rackmount firewall with Intel Alder Lake Desktop i3-12100T, 6x 1G LAN. 32GB RAM, 128GB SSD.",
          "1u6l-adl-i3-32gb-128gb"
        ),
        makeProduct(
          "1U8L-B75 — 1U Rackmount i5 8GB 64GB",
          "1U8L-B75-I5-8GB-64GB", 640.75, "Network Security",
          "1U rackmount server with i5-3450U, 8x LAN ports. 8GB DDR3, 64GB mSATA.",
          "1u8l-b75-i5-8gb-64gb"
        ),
        makeProduct(
          "2U6L-ADL — 2U Rackmount i7 64GB 2TB",
          "2U6L-ADL-I7-64GB-2TB", 1243.00, "Network Security",
          "2U rackmount firewall with Intel Alder Lake Desktop i7-12700U, 6x 1G LAN, redundant PSU option. 64GB RAM, 2TB SSD.",
          "2u6l-adl-i7-64gb-2tb"
        ),
        // ── INDUSTRIAL PC ──────────────────────────────────────────
        makeProduct(
          "IBOX-1226 — Industrial PC",
          "IBOX-1226-1226", 204.88, "Industrial PC",
          "Compact industrial PC with Intel Celeron J6412, 3x 2.5G LAN. Standard config.",
          "ibox-1226"
        ),
        makeProduct(
          "IBOX-1326 — Industrial PC N100 8GB 64GB",
          "IBOX-1326-N100-8GB-64GB", 314.88, "Industrial PC",
          "Industrial PC with Intel Alder Lake N100, 2x HDMI, 5x COM ports. 8GB RAM, 64GB SSD.",
          "ibox-1326-n100-8gb-64gb"
        ),
        makeProduct(
          "IBOX-205 Plus — Industrial PC i5 8GB 64GB",
          "IBOX-205PLUS-I5-8GB-64GB", 248.88, "Industrial PC",
          "Industrial PC with Intel i5-4300U, DDR3L memory. 8GB RAM, 64GB mSATA.",
          "ibox-205plus-i5-8gb-64gb"
        ),
        makeProduct(
          "IBOX-3026 — Industrial PC i7 1165G7 8GB 64GB",
          "IBOX-3026-I7-1165G7-8GB-64GB", 763.13, "Industrial PC",
          "Industrial PC with Intel 11th gen Tiger Lake i7-1165G7, 2x LAN. 8GB RAM, 64GB SSD.",
          "ibox-3026-i7-8gb-64gb"
        ),
        makeProduct(
          "IBOX-3026 — Industrial PC i7 1165G7 32GB 256GB",
          "IBOX-3026-I7-1165G7-32GB-256GB", 838.75, "Industrial PC",
          "Industrial PC with Intel 11th gen Tiger Lake i7-1165G7, 2x LAN. 32GB RAM, 256GB SSD.",
          "ibox-3026-i7-32gb-256gb"
        ),
        makeProduct(
          "IBOX-3126 — Industrial PC i5 1135G7 16GB 128GB",
          "IBOX-3126-I5-1135G7-16GB-128GB", 544.50, "Industrial PC",
          "Industrial PC with Intel 11th gen Tiger Lake i5-1135G7, 3x 2.5G LAN. 16GB RAM, 128GB SSD.",
          "ibox-3126-i5-16gb-128gb"
        ),
        makeProduct(
          "IBOX-3226 — Industrial PC i7 1255U 16GB 128GB",
          "IBOX-3226-I7-1255U-16GB-128GB", 660.00, "Industrial PC",
          "Industrial PC with Intel 12th gen Alder Lake i7-1255U, 4x HDMI. 16GB RAM, 128GB SSD.",
          "ibox-3226-i7-16gb-128gb"
        ),
        makeProduct(
          "IBOX-3226 — Industrial PC i7 1255U 32GB 512GB",
          "IBOX-3226-I7-1255U-32GB-512GB", 921.25, "Industrial PC",
          "Industrial PC with Intel 12th gen Alder Lake i7-1255U, 4x HDMI. 32GB RAM, 512GB NVMe.",
          "ibox-3226-i7-32gb-512gb"
        ),
        makeProduct(
          "IBOX-601 — Industrial PC i7 6500U 16GB 128GB",
          "IBOX-601-I7-6500U-16GB-128GB", 424.88, "Industrial PC",
          "Industrial PC with Intel 6th gen i7-6500U, 3x LAN. 16GB RAM, 128GB mSATA.",
          "ibox-601-i7-16gb-128gb"
        ),
        makeProduct(
          "IBOX-605 — Industrial PC Barebone",
          "IBOX-605-BAREBONE", 309.38, "Industrial PC",
          "Industrial PC with Intel 8th gen Coffee Lake, 2x LAN. Barebone — no RAM/SSD.",
          "ibox-605-barebone"
        ),
        makeProduct(
          "IBOX-701 Plus — Industrial PC",
          "IBOX-701-701-16GB-1TB", 1471.25, "Industrial PC",
          "High-performance industrial PC with Intel 7th gen. 16GB RAM, 1TB SSD.",
          "ibox-701plus-16gb-1tb"
        ),
        makeProduct(
          "IEXP-332 — Industrial PC Barebone",
          "IEXP-332-BAREBONE", 178.75, "Industrial PC",
          "Compact industrial expansion PC. Barebone — no RAM/SSD.",
          "iexp-332-barebone"
        ),
        // ── TOUCH SCREENS ──────────────────────────────────────────
        makeProduct(
          "ITPC-A113 — 11.3\" Touch Panel J6412 4GB 64GB",
          "ITPC-A113-J6412-4GB-64GB", 537.63, "Touch Screens",
          "11.3\" industrial touch panel with Intel Celeron/Core options, DC 9-36V. J6412, 4GB RAM, 64GB SSD.",
          "itpc-a113-j6412-4gb-64gb"
        ),
        makeProduct(
          "ITPC-A215C — 21.5\" Touch Panel i5 8260U 8GB 64GB",
          "ITPC-A215C-I5-8260U-8GB-64GB", 709.50, "Touch Screens",
          "21.5\" industrial touch panel with Intel Celeron/Core options, DC 9-36V. i5-8260U, 8GB RAM, 64GB SSD.",
          "itpc-a215c-i5-8gb-64gb"
        ),
        makeProduct(
          "ITPC-A500 — 15\" Touch Panel i5 8260U 8GB 64GB",
          "ITPC-A500-I5-8260U-8GB-64GB", 617.38, "Touch Screens",
          "15\" industrial touch panel (1024×768), 350 cd/m², DC 9-36V. i5-8260U, 8GB RAM, 64GB SSD.",
          "itpc-a500-i5-8gb-64gb"
        ),
        makeProduct(
          "ITPC-A600 — 17\" Touch Panel i5 8260U 8GB 64GB",
          "ITPC-A600-I5-8260U-8GB-64GB", 640.75, "Touch Screens",
          "17\" industrial touch panel with Intel Celeron/Core options, DC 9-36V. i5-8260U, 8GB RAM, 64GB SSD.",
          "itpc-a600-i5-8gb-64gb"
        ),
        makeProduct(
          "ITPC-B156-CP2 — 15.6\" ARM Touch Panel i5 8GB 64GB",
          "ITPC-B156-CP2-I5-8GB-64GB", 467.50, "Touch Screens",
          "15.6\" ARM touch panel with Rockchip, IP65, Full Bonding. i5-4300U, 8GB DDR3L, 64GB mSATA.",
          "itpc-b156-cp2-i5-8gb-64gb"
        ),
        makeProduct(
          "ITPC-C215 — 21.5\" Intel 12th Gen Touch Panel 16GB 256GB",
          "ITPC-C215-16GB-256GB", 1281.50, "Touch Screens",
          "21.5\" Full HD Intel 12th gen touch panel, 6x COM, 2x Intel I210 LAN. i5-1235U, 16GB RAM, 256GB SSD.",
          "itpc-c215-16gb-256gb"
        ),
        // ── RAM ────────────────────────────────────────────────────
        makeProduct(
          "Oreton DDR4 16GB RAM",
          "RAM-DDR4-16GB", 31.16, "RAM",
          "Oreton DDR4 16GB RAM module. Compatible with IWILL mini PCs and industrial PCs.",
          "ram-ddr4-16gb"
        ),
        makeProduct(
          "Oreton DDR4 32GB RAM",
          "RAM-DDR4-32GB", 48.39, "RAM",
          "Oreton DDR4 32GB RAM module. Compatible with IWILL mini PCs and industrial PCs.",
          "ram-ddr4-32gb"
        ),
        makeProduct(
          "Oreton DDR4 8GB RAM",
          "RAM-DDR4-8GB", 15.41, "RAM",
          "Oreton DDR4 8GB RAM module. Compatible with IWILL mini PCs and industrial PCs.",
          "ram-ddr4-8gb"
        ),
        makeProduct(
          "Oreton DDR5 16GB RAM",
          "RAM-DDR5-16GB", 31.05, "RAM",
          "Oreton DDR5 16GB RAM module. Compatible with IWILL N3322, N3422 and DDR5-equipped models.",
          "ram-ddr5-16gb"
        ),
        makeProduct(
          "Oreton DDR5 32GB RAM",
          "RAM-DDR5-32GB", 71.31, "RAM",
          "Oreton DDR5 32GB RAM module. Compatible with IWILL N3322, N3422 and DDR5-equipped models.",
          "ram-ddr5-32gb"
        ),
        // ── SSD ────────────────────────────────────────────────────
        makeProduct(
          "Oreton M.2 SATA SSD 128GB",
          "SSD-M500-128GB", 9.67, "SSD",
          "Oreton M.2 SATA 2280 SSD 128GB (M500-128). For IWILL mini PCs and industrial PCs.",
          "ssd-m500-128gb"
        ),
        makeProduct(
          "Oreton M.2 SATA SSD 256GB",
          "SSD-M500-256GB", 34.36, "SSD",
          "Oreton M.2 SATA 2280 SSD 256GB (M500-256). For IWILL mini PCs and industrial PCs.",
          "ssd-m500-256gb"
        ),
        makeProduct(
          "Oreton M.2 SATA SSD 512GB",
          "SSD-M500-512GB", 16.01, "SSD",
          "Oreton M.2 SATA 2280 SSD 512GB (M500-512). For IWILL mini PCs and industrial PCs.",
          "ssd-m500-512gb"
        ),
        makeProduct(
          "Oreton M.2 SATA SSD 1TB",
          "SSD-M500-1TB", 67.72, "SSD",
          "Oreton M.2 SATA 2280 SSD 1TB (M500-1TB). For IWILL mini PCs and industrial PCs.",
          "ssd-m500-1tb"
        ),
        makeProduct(
          "Oreton M.2 NVMe PCIe 3x4 SSD 512GB",
          "SSD-N3000-512GB", 28.12, "SSD",
          "Oreton M.2 NVMe PCIe 3x4 SSD 512GB (N3000-512). High-speed NVMe storage.",
          "ssd-n3000-512gb"
        ),
        makeProduct(
          "Oreton M.2 NVMe PCIe 4x4 SSD 512GB",
          "SSD-N5000-512GB", 39.12, "SSD",
          "Oreton M.2 NVMe PCIe 4x4 SSD 512GB (N5000-512). High-speed Gen 4 NVMe storage.",
          "ssd-n5000-512gb"
        ),
        makeProduct(
          "Oreton M.2 NVMe PCIe 4x4 SSD 1TB",
          "SSD-N5000-1TB", 56.87, "SSD",
          "Oreton M.2 NVMe PCIe 4x4 SSD 1TB (N5000-1TB). High-speed Gen 4 NVMe storage.",
          "ssd-n5000-1tb"
        ),
        makeProduct(
          "Oreton M.2 NVMe PCIe 4x4 SSD 2TB",
          "SSD-N5000-2TB", 126.38, "SSD",
          "Oreton M.2 NVMe PCIe 4x4 SSD 2TB (N5000-2TB). High-speed Gen 4 NVMe storage.",
          "ssd-n5000-2tb"
        ),
        makeProduct(
          "Oreton mSATA SSD 128GB",
          "SSD-MT500-128GB", 29.80, "SSD",
          "Oreton mSATA SSD 128GB (MT500-128). For legacy IWILL industrial PCs with mSATA slot.",
          "ssd-mt500-128gb"
        ),
        makeProduct(
          "Oreton mSATA SSD 256GB",
          "SSD-MT500-256GB", 38.82, "SSD",
          "Oreton mSATA SSD 256GB (MT500-256). For legacy IWILL industrial PCs with mSATA slot.",
          "ssd-mt500-256gb"
        ),
        // ── MODULES ────────────────────────────────────────────────
        makeProduct(
          "Intel WiFi Module 7260HMW",
          "MOD-7260HMW", 10.31, "Modules",
          "Intel Dual Band Wireless-AC 7260 M.2 WiFi module. Compatible with IWILL N1241 and other models with M.2 E-key.",
          "mod-intel-7260hmw"
        ),
        makeProduct(
          "Quectel LTE Module EG25-G",
          "MOD-EG25-G", 24.75, "Modules",
          "Quectel EG25-G 4G LTE module for IWILL industrial PCs with M.2 or mini-PCIe slot.",
          "mod-quectel-eg25-g"
        ),
      ],
    },
  });

  logger.info("Seeding inventory levels...");
  const { data: inventoryItems } = await query.graph({
    entity: "inventory_item",
    fields: ["id"],
  });

  const inventoryLevels: CreateInventoryLevelInput[] = inventoryItems.map(
    (item) => ({
      location_id: stockLocation.id,
      stocked_quantity: 100,
      inventory_item_id: item.id,
    })
  );

  await createInventoryLevelsWorkflow(container).run({
    input: { inventory_levels: inventoryLevels },
  });

  logger.info("✅ IWILL store seeded successfully — 50 products added.");
}
