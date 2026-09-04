import { model } from '@medusajs/framework/utils';

export const NisOutbox = model
  .define(
    { name: 'nis_outbox', tableName: 'nis2_outbox' },
    {
      id: model.id({ prefix: 'nis2intent' }).primaryKey(),
      request_id: model.text(),
      domain_kind: model.enum(['lead', 'consultation']),
      domain_id: model.text(),
      intent_type: model.enum([
        'ops_lead',
        'visitor_summary',
        'internal_lead',
        'ops_consultation',
        'internal_consultation',
      ]),
      state: model.enum(['pending', 'processing', 'delivered', 'dead_letter']).default('pending'),
      attempt_count: model.number().default(0),
      next_attempt_at: model.dateTime(),
      last_error_class: model.enum([
        'timeout',
        'rate_limited',
        'authentication',
        'provider_4xx',
        'provider_5xx',
        'network',
        'unknown',
      ]).nullable(),
      payload: model.json(),
    },
  )
  .indexes([
    { on: ['domain_id', 'intent_type'], unique: true },
    { on: ['state', 'next_attempt_at'] },
    { on: ['request_id'] },
  ]);
