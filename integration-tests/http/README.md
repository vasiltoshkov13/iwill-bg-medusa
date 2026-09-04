# Integration Tests

The `medusa-test-utils` package provides utility functions to create integration tests for your API routes and workflows.

For example:

```ts
import { medusaIntegrationTestRunner } from "medusa-test-utils"

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    describe("Custom endpoints", () => {
      describe("GET /store/custom", () => {
        it("returns correct message", async () => {
          const response = await api.get(
            `/store/custom`
          )
  
          expect(response.status).toEqual(200)
          expect(response.data).toHaveProperty("message")
          expect(response.data.message).toEqual("Hello, World!")
        })
      })
    })
  }
})
```

Learn more in [this documentation](https://docs.medusajs.com/learn/debugging-and-testing/testing-tools/integration-tests).

Run all HTTP suites with `npm run test:integration:http`. The repository runner performs a short PostgreSQL preflight so a missing `DB_USERNAME` fails fast or selects a local `CREATEDB` role instead of timing out inside Medusa's hooks. Set `DB_USERNAME` and `DB_PASSWORD` explicitly for CI or non-local PostgreSQL.