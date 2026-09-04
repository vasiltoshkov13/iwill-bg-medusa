import { model } from '@medusajs/framework/utils';

export const NisConsultation = model.define(
  { name: 'nis_consultation', tableName: 'nis2_consultation' },
  {
    id: model.id({ prefix: 'nis2consult' }).primaryKey(),
    lead_id: model.text(),
    session_id: model.text().nullable(),
    page_path: model.text().nullable(),
    referrer_origin: model.text().nullable(),
    utm_source: model.text().nullable(),
    utm_medium: model.text().nullable(),
    utm_campaign: model.text().nullable(),
    utm_content: model.text().nullable(),
    utm_term: model.text().nullable(),
  },
).indexes([{ on: ['lead_id'] }]);
