import type {
  SubscriberArgs,
  SubscriberConfig,
} from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

type OrderPlacedData = {
  id?: string
  order_id?: string
}

type Address = {
  first_name?: string | null
  last_name?: string | null
  phone?: string | null
  city?: string | null
}

type OrderForNotification = {
  id: string
  display_id?: string | number | null
  email?: string | null
  currency_code?: string | null
  total?: number | string | null
  metadata?: Record<string, unknown> | null
  shipping_address?: Address | null
  billing_address?: Address | null
}

const PAYMENT_LABELS: Record<string, string> = {
  bank_transfer: "Bank Transfer",
  cod: "Cash on Delivery",
  card: "Card (Stripe)",
}

function getOrderId(data: OrderPlacedData) {
  return data.id || data.order_id
}

function formatName(address?: Address | null) {
  return [address?.first_name, address?.last_name].filter(Boolean).join(" ").trim()
}

function formatTotal(total: OrderForNotification["total"], currencyCode?: string | null) {
  const currency = (currencyCode || "eur").toUpperCase()
  const numeric = Number(total)

  if (!Number.isFinite(numeric)) {
    return `${currency} ${String(total ?? "")}`.trim()
  }

  try {
    return new Intl.NumberFormat("bg-BG", {
      style: "currency",
      currency,
    }).format(numeric)
  } catch {
    return `${currency} ${numeric.toFixed(2)}`
  }
}

function getPaymentLabel(metadata?: Record<string, unknown> | null) {
  const method = String(metadata?.payment_method || "")
  return PAYMENT_LABELS[method] || method || "Unknown"
}

async function fetchOrder(container: SubscriberArgs["container"], orderId: string) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY) as {
    graph: (input: unknown) => Promise<{ data?: OrderForNotification[] }>
  }

  const { data } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "display_id",
      "email",
      "currency_code",
      "total",
      "metadata",
      "shipping_address.first_name",
      "shipping_address.last_name",
      "shipping_address.phone",
      "shipping_address.city",
      "billing_address.first_name",
      "billing_address.last_name",
      "billing_address.phone",
      "billing_address.city",
    ],
    filters: { id: orderId },
  })

  return data?.[0]
}

export default async function orderPlacedNotificationHandler({
  event: { data },
  container,
}: SubscriberArgs<OrderPlacedData>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as {
    info: (message: string) => void
    warn: (message: string) => void
    error: (message: string) => void
  }
  const notifyUrl = process.env.ORDER_NOTIFY_WEBHOOK_URL
  const orderId = getOrderId(data)

  if (!notifyUrl) {
    logger.warn("ORDER_NOTIFY_WEBHOOK_URL is not configured; skipping order notification")
    return
  }

  if (!orderId) {
    logger.warn("order.placed event did not include an order id; skipping order notification")
    return
  }

  try {
    const order = await fetchOrder(container, orderId)

    if (!order) {
      logger.warn(`Order ${orderId} was not found for notification`)
      return
    }

    const shippingAddress = order.shipping_address || order.billing_address
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)

    const response = await fetch(notifyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-iwill-notification-source": "medusa-order-placed",
      },
      body: JSON.stringify({
        orderId: order.display_id || order.id,
        name: formatName(shippingAddress) || "IWILL customer",
        email: order.email || "",
        phone: shippingAddress?.phone || "",
        city: shippingAddress?.city || "",
        courier: String(order.metadata?.courier || ""),
        courierOffice: String(order.metadata?.courier_office || ""),
        payment: getPaymentLabel(order.metadata),
        total: formatTotal(order.total, order.currency_code),
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout))

    if (!response.ok) {
      logger.error(`Order notification failed for ${order.id}: ${response.status} ${await response.text()}`)
      return
    }

    logger.info(`Order notification sent for ${order.id}`)
  } catch (error) {
    logger.error(`Order notification failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
