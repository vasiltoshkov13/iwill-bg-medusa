/**
 * One-off update for N1241 and N1121 product prices, specs, and inventory.
 *
 * Run with: npx medusa exec ./src/scripts/update-prices.ts
 */
import { ExecArgs } from "@medusajs/framework/types";
import {
  ContainerRegistrationKeys,
  Modules,
} from "@medusajs/framework/utils";
const eur = (n: number) => Math.round(n * 100);

type VariantUpdate = {
  sku: string;
  newSku?: string;
  title?: string;
  price?: number;
  stock?: number;
  productHandle?: string;
  productDescription?: string;
};

const UPDATES: VariantUpdate[] = [
  {
    sku: "N1241-N100-8GB-64GB",
    price: 283.33,
    stock: 2,
  },
  {
    sku: "N1121-J6412-16GB-64GB",
    newSku: "N1121-J6412-8GB-128GB",
    title: "J6412 8GB DDR4 128GB SSD",
    price: 258.33,
    productHandle: "n1121",
    productDescription:
      "Nano-N1121 — firewall мини PC с Intel J6412, 8GB DDR4, 128GB SSD, 3× 2.5G Ethernet, TPM 2.0. pfSense/OPNsense/Proxmox.",
  },
];

export default async function updatePrices({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const productSvc = container.resolve(Modules.PRODUCT);
  const pricingSvc = container.resolve(Modules.PRICING);
  const inventorySvc = container.resolve(Modules.INVENTORY);

  logger.info("=== Update prices START ===");

  for (const upd of UPDATES) {
    logger.info(`Processing ${upd.sku}...`);

    const { data: variants } = await query.graph({
      entity: "product_variant",
      fields: [
        "id",
        "sku",
        "title",
        "product_id",
        "product.handle",
        "options.id",
        "options.value",
        "options.option.title",
      ],
      filters: { sku: upd.sku },
    });

    if (!variants.length) {
      logger.warn(`Variant ${upd.sku} not found, skipping`);
      continue;
    }

    const variant = variants[0];

    // Update variant fields (sku, title)
    const variantUpdate: any = {};
    if (upd.newSku) variantUpdate.sku = upd.newSku;
    if (upd.title) variantUpdate.title = upd.title;

    if (Object.keys(variantUpdate).length) {
      await productSvc.updateProductVariants(variant.id, variantUpdate);
      logger.info(`  Updated variant fields`);
    }

    // Update Config option value if title changed
    if (upd.title) {
      const configOpt = (variant.options || []).find(
        (o: any) => o.option?.title === "Config"
      );
      if (configOpt) {
        await productSvc.updateProductOptionValues(configOpt.id, {
          value: upd.title,
        });
        logger.info(`  Updated Config option value`);
      }
    }

    // Update product handle/description
    if (upd.productHandle || upd.productDescription) {
      const productPatch: any = {};
      if (upd.productHandle) productPatch.handle = upd.productHandle;
      if (upd.productDescription)
        productPatch.description = upd.productDescription;
      await productSvc.updateProducts(variant.product_id, productPatch);
      logger.info(`  Updated product`);
    }

    // Update prices (find price set linked to variant)
    if (upd.price !== undefined) {
      const { data: priceLinks } = await query.graph({
        entity: "product_variant_price_set",
        fields: ["variant_id", "price_set_id", "price_set.prices.*"],
        filters: { variant_id: variant.id },
      });

      const priceSetId = priceLinks[0]?.price_set_id;
      if (priceSetId) {
        const existing = priceLinks[0].price_set?.prices ?? [];
        for (const p of existing) {
          await pricingSvc.updatePrices([
            { id: p.id, amount: eur(upd.price) },
          ]);
        }
        logger.info(`  Updated ${existing.length} prices to ${upd.price} EUR`);
      } else {
        logger.warn(`  No price set linked to variant`);
      }
    }

    // Update inventory
    if (upd.stock !== undefined) {
      const items = await inventorySvc.listInventoryItems({
        sku: upd.newSku ?? upd.sku,
      });
      if (items[0]) {
        // Update SKU on inventory item if renamed
        if (upd.newSku) {
          await inventorySvc.updateInventoryItems(items[0].id, {
            sku: upd.newSku,
          });
        }
        const levels = await inventorySvc.listInventoryLevels({
          inventory_item_id: items[0].id,
        });
        for (const lvl of levels) {
          await inventorySvc.updateInventoryLevels([
            {
              inventory_item_id: items[0].id,
              location_id: lvl.location_id,
              stocked_quantity: upd.stock,
            },
          ]);
        }
        logger.info(`  Set stock to ${upd.stock}`);
      } else {
        // Try original sku in case rename hasn't applied yet
        const fallback = await inventorySvc.listInventoryItems({
          sku: upd.sku,
        });
        if (fallback[0]) {
          if (upd.newSku) {
            await inventorySvc.updateInventoryItems(fallback[0].id, {
              sku: upd.newSku,
            });
          }
          const levels = await inventorySvc.listInventoryLevels({
            inventory_item_id: fallback[0].id,
          });
          for (const lvl of levels) {
            await inventorySvc.updateInventoryLevels([
              {
                inventory_item_id: fallback[0].id,
                location_id: lvl.location_id,
                stocked_quantity: upd.stock,
              },
            ]);
          }
          logger.info(`  Set stock to ${upd.stock} (via original sku)`);
        } else {
          logger.warn(`  No inventory item for sku`);
        }
      }
    }
  }

  logger.info("=== Update prices DONE ===");
}
