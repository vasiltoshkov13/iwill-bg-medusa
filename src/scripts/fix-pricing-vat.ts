import { ExecArgs } from "@medusajs/framework/types";
import {
  ContainerRegistrationKeys,
  Modules,
} from "@medusajs/framework/utils";
import { createTaxRatesWorkflow, updateTaxRatesWorkflow } from "@medusajs/medusa/core-flows";

const toNumber = (value: unknown): number => {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  if (value && typeof value === "object") {
    const raw = value as Record<string, unknown>;
    if ("value" in raw) return toNumber(raw.value);
    if ("numeric" in raw) return toNumber(raw.numeric);
  }
  return Number(value);
};

const normaliseMajorUnits = (amount: unknown): number => {
  const numeric = toNumber(amount);
  // IWILL prices were mistakenly seeded as cents, e.g. 57475 instead of 574.75.
  // Shipping options were seeded correctly as major units (25 / 45), so only fix large values.
  if (numeric >= 10000) {
    return Number((numeric / 100).toFixed(2));
  }
  return Number(numeric.toFixed(2));
};

export default async function fixPricingVat({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const pricing = container.resolve(Modules.PRICING);
  const tax = container.resolve(Modules.TAX);

  logger.info("=== IWILL pricing/VAT fix START ===");

  const { data: priceLinks } = await query.graph({
    entity: "product_variant_price_set",
    fields: [
      "variant_id",
      "price_set_id",
      "variant.sku",
      "price_set.prices.*",
    ],
  });

  let updatedPrices = 0;
  for (const link of priceLinks as any[]) {
    const priceSetId = link.price_set_id;
    const prices = link.price_set?.prices ?? [];

    for (const price of prices) {
      if (!price?.id) continue;
      const current = toNumber(price.amount ?? price.raw_amount);
      const next = normaliseMajorUnits(current);
      if (Math.abs(current - next) < 0.0001) continue;

      await pricing.updatePriceSets(priceSetId, {
        prices: [
          {
            id: price.id,
            amount: next,
            currency_code: price.currency_code,
          },
        ],
      });
      updatedPrices++;
      logger.info(`${link.variant?.sku ?? link.variant_id}: ${current} -> ${next} ${price.currency_code}`);
    }
  }

  const taxRegions = await tax.listTaxRegions({ country_code: "bg" }, { relations: ["tax_rates"] });
  let bgRegion = taxRegions[0];

  if (!bgRegion) {
    bgRegion = await tax.createTaxRegions({
      country_code: "bg",
      provider_id: "tp_system",
    });
    logger.info(`Created BG tax region: ${bgRegion.id}`);
  }

  const bgRates = await tax.listTaxRates({ tax_region_id: bgRegion.id });
  const defaultRate = bgRates.find((rate: any) => rate.is_default) ?? bgRates[0];

  if (defaultRate) {
    await updateTaxRatesWorkflow(container).run({
      input: {
        selector: { id: [defaultRate.id] },
        update: {
          name: "Bulgarian VAT 20%",
          code: "BG-VAT-20",
          rate: 20,
          is_default: true,
        },
      },
    });
    logger.info(`Updated BG VAT rate ${defaultRate.id} to 20% default`);
  } else {
    const { result } = await createTaxRatesWorkflow(container).run({
      input: [
        {
          tax_region_id: bgRegion.id,
          name: "Bulgarian VAT 20%",
          code: "BG-VAT-20",
          rate: 20,
          is_default: true,
        },
      ],
    });
    logger.info(`Created BG VAT rate ${result[0]?.id}`);
  }

  logger.info(`Updated product prices: ${updatedPrices}`);
  logger.info("=== IWILL pricing/VAT fix DONE ===");
}
