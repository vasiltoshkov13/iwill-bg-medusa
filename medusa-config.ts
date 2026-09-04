import { loadEnv, defineConfig, Modules } from '@medusajs/framework/utils'
import {
  loadCampaignAllowlist,
  loadMarketingNoticeVersion,
} from './src/api/store/nis2/validation'

loadEnv(process.env.NODE_ENV || 'development', process.cwd())

// Validate optional campaign taxonomy before Medusa starts accepting traffic.
loadCampaignAllowlist()
loadMarketingNoticeVersion()

const isProduction = process.env.NODE_ENV === 'production'

/**
 * Read a required secret from the environment.
 *
 * In production the secret MUST be provided — the previous shared literal
 * ("supersecret") let anyone forge admin/customer JWTs and session cookies,
 * so we refuse to boot without a real value. In development we fall back to a
 * stable placeholder so local `medusa develop` keeps working.
 */
const requireSecret = (name: string): string => {
  const value = process.env[name]
  if (value) {
    return value
  }
  if (isProduction) {
    throw new Error(
      `${name} is not set. Configure it as an environment variable before starting Medusa in production.`
    )
  }
  return `dev-insecure-${name.toLowerCase()}`
}

const redisUrl = process.env.REDIS_URL

module.exports = defineConfig({
  admin: {
    disable: false,
    backendUrl: process.env.MEDUSA_BACKEND_URL || "https://medusa-backend-production-bd55.up.railway.app",
  },
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    redisUrl,
    http: {
      storeCors: process.env.STORE_CORS || "https://iwill.bg,https://www.iwill.bg,https://office.iwill.bg",
      adminCors: process.env.ADMIN_CORS || "https://api.iwill.bg,https://office.iwill.bg,https://app.medusajs.com",
      authCors: process.env.AUTH_CORS || "https://api.iwill.bg,https://office.iwill.bg,https://app.medusajs.com",
      jwtSecret: requireSecret("JWT_SECRET"),
      cookieSecret: requireSecret("COOKIE_SECRET"),
    }
  },
  modules: [
    {
      resolve: "./src/modules/nis2",
    },
    {
      resolve: "@medusajs/payment",
      options: {
        providers: [
          {
            resolve: "@medusajs/payment-stripe",
            id: "stripe",
            options: {
              apiKey: process.env.STRIPE_API_KEY,
            },
          },
        ],
      },
    },
    // When a Redis instance is available, use it for the event bus, workflow
    // engine, cache and distributed locking. This is required to run Medusa
    // reliably with more than one process/replica; without it these fall back
    // to in-memory implementations that are not shared across instances.
    ...(redisUrl
      ? [
          {
            resolve: "@medusajs/event-bus-redis",
            key: Modules.EVENT_BUS,
            options: { redisUrl },
          },
          {
            resolve: "@medusajs/workflow-engine-redis",
            key: Modules.WORKFLOW_ENGINE,
            options: { redis: { url: redisUrl } },
          },
          {
            resolve: "@medusajs/cache-redis",
            key: Modules.CACHE,
            options: { redisUrl },
          },
          {
            resolve: "@medusajs/locking",
            key: Modules.LOCKING,
            options: {
              providers: [
                {
                  resolve: "@medusajs/locking-redis",
                  id: "locking-redis",
                  is_default: true,
                  options: { redisUrl },
                },
              ],
            },
          },
        ]
      : []),
  ],
})
