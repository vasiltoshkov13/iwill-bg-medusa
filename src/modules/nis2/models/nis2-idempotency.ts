import { model } from '@medusajs/framework/utils';

export const NisIdempotency = model
  .define(
    { name: 'nis_idempotency', tableName: 'nis2_idempotency' },
    {
      id: model.id({ prefix: 'nis2idem' }).primaryKey(),
      endpoint_kind: model.enum(['assessment', 'lead', 'consultation']),
      idempotency_key: model.text(),
      request_digest: model.text(),
      response_status: model.number(),
      response_body: model.json(),
      domain_id: model.text(),
    },
  )
  .indexes([
    { on: ['endpoint_kind', 'idempotency_key'], unique: true },
    { on: ['domain_id'] },
  ]);
