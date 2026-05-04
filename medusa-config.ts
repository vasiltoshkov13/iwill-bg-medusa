import { loadEnv, defineConfig, Modules } from '@medusajs/framework/utils'

loadEnv(process.env.NODE_ENV || 'development', process.cwd())

module.exports = defineConfig({
  admin: {
    disable: false,
    backendUrl: process.env.MEDUSA_BACKEND_URL || "https://medusa-backend-production-bd55.up.railway.app",
  },
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    http: {
      storeCors: process.env.STORE_CORS || "https://iwill.bg,https://www.iwill.bg,https://office.iwill.bg",
      adminCors: process.env.ADMIN_CORS || "https://api.iwill.bg,https://office.iwill.bg,https://app.medusajs.com",
      authCors: process.env.AUTH_CORS || "https://api.iwill.bg,https://office.iwill.bg,https://app.medusajs.com",
      jwtSecret: process.env.JWT_SECRET || "supersecret",
      cookieSecret: process.env.COOKIE_SECRET || "supersecret",
    }
  },
  modules: [
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
  ],
})
