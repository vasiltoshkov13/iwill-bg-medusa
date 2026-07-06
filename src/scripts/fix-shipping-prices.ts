/**
 * Fix shipping option prices that were entered in cents instead of major units.
 *
 * The live store had every shipping option (Speedy, Econt, Same Day, BoxNow)
 * priced at 590 — i.e. €590 per delivery — which inflated a €574.75 order to
 * €1,397.70 and flowed straight into the Stripe PaymentIntent. The intended
 * value was 5.90, so any shipping price that looks like cents (>= 100) is
 * divided by 100.
 *
 * Run with: npx medusa exec ./src/scripts/fix-shipping-prices.ts
 *
 * The script is idempotent — already-correct prices (< 100) are left untouched.
 */
import { ExecArgs } from "@medusajs/framework/types";
import {
  ContainerRegistrationKeys,
  Modules,
} from "@medusajs/framework/utils";

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

// Any shipping price at or above this threshold is treated as a cents value
// that should be scaled down to major units. Real courier prices for BG are a
// few euros, so this is a safe cut-off.
const CENTS_THRESHOLD = 100;

export default async function fixShippingPrices({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const pricing = container.resolve(Modules.PRICING);

  logger.info("=== IWILL shipping price fix START ===");

  const { data: shippingOptions } = await query.graph({
    entity: "shipping_option",
    fields: [
      "id",
      "name",
      "price_set.id",
      "price_set.prices.id",
      "price_set.prices.amount",
      "price_set.prices.raw_amount",
      "price_set.prices.currency_code",
    ],
  });

  let updated = 0;
  let inspected = 0;

  for (const option of shippingOptions as any[]) {
    const priceSetId = option.price_set?.id;
    const prices = option.price_set?.prices ?? [];

    for (const price of prices) {
      if (!price?.id || !priceSetId) continue;
      inspected++;

      const current = toNumber(price.amount ?? price.raw_amount);
      if (!Number.isFinite(current) || current < CENTS_THRESHOLD) {
        continue;
      }

      const next = Number((current / 100).toFixed(2));

      await pricing.updatePriceSets(priceSetId, {
        prices: [
          {
            id: price.id,
            amount: next,
            currency_code: price.currency_code,
          },
        ],
      });
      updated++;
      logger.info(
        `${option.name}: ${current} -> ${next} ${price.currency_code}`
      );
    }
  }

  logger.info(`Inspected ${inspected} shipping prices, corrected ${updated}.`);
  logger.info("=== IWILL shipping price fix DONE ===");
}
