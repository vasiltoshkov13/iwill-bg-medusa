/**
 * Request validation shared by the NIS2 store routes.
 *
 * Mirrors the storefront's validator: closed enumerations only, so nothing that
 * reaches the database can contain a value the rule engine does not understand.
 */

import {
  ALL_SECTOR_IDS,
  ASSETS_BUCKETS,
  EMPLOYEE_BUCKETS,
  INFRASTRUCTURE_NEEDS,
  ORGANIZATION_TYPES,
  SPECIAL_CONDITIONS,
  TURNOVER_BUCKETS,
} from '../../../modules/nis2/rules/sectors';
import type { Nis2Answers } from '../../../modules/nis2/rules/types';

export class ValidationError extends Error {
  readonly field: string;
  constructor(field: string, message: string) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
  }
}

const ORGANIZATION_TYPE_IDS = ORGANIZATION_TYPES.map((o) => String(o.id));
const EMPLOYEE_BUCKET_IDS = EMPLOYEE_BUCKETS.map((o) => String(o.id));
const TURNOVER_BUCKET_IDS = TURNOVER_BUCKETS.map((o) => String(o.id));
const ASSETS_BUCKET_IDS = ASSETS_BUCKETS.map((o) => String(o.id));
const SPECIAL_CONDITION_IDS = SPECIAL_CONDITIONS.map((o) => String(o.id));
const INFRASTRUCTURE_NEED_IDS = INFRASTRUCTURE_NEEDS.map((o) => String(o.id));
const GROUP_STATUSES = ['YES', 'NO', 'UNKNOWN'];

function oneOf(field: string, value: unknown, allowed: string[]): string {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new ValidationError(field, `Invalid value for "${field}".`);
  }
  return value;
}

export function optionalText(field: string, value: unknown, maxLength = 200): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw new ValidationError(field, `"${field}" must be a string.`);
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLength) throw new ValidationError(field, `"${field}" is too long.`);
  return trimmed;
}

export function requiredText(field: string, value: unknown, maxLength = 200): string {
  const text = optionalText(field, value, maxLength);
  if (!text) throw new ValidationError(field, `"${field}" is required.`);
  return text;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function email(field: string, value: unknown): string {
  const address = requiredText(field, value, 254).toLowerCase();
  if (!EMAIL_PATTERN.test(address)) throw new ValidationError(field, 'Invalid email address.');
  return address;
}

export function booleanFlag(value: unknown): boolean {
  return value === true;
}

export function stringArray(field: string, value: unknown, maxItems = 32): string[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw new ValidationError(field, `"${field}" must be an array.`);
  if (value.length > maxItems) throw new ValidationError(field, `"${field}" has too many items.`);
  return value.map((item, index) => requiredText(`${field}[${index}]`, item, 120));
}

export function parseAnswers(input: unknown): Nis2Answers {
  if (typeof input !== 'object' || input === null) {
    throw new ValidationError('answers', 'Missing assessment answers.');
  }
  const raw = input as Record<string, unknown>;
  const conditions = Array.isArray(raw.specialConditions) ? raw.specialConditions : [];

  return {
    organizationType: oneOf('organizationType', raw.organizationType, ORGANIZATION_TYPE_IDS),
    sector: oneOf('sector', raw.sector, ALL_SECTOR_IDS as unknown as string[]),
    subsector: optionalText('subsector', raw.subsector, 80),
    employees: oneOf('employees', raw.employees, EMPLOYEE_BUCKET_IDS),
    turnover: oneOf('turnover', raw.turnover, TURNOVER_BUCKET_IDS),
    assets: oneOf('assets', raw.assets, ASSETS_BUCKET_IDS),
    groupStatus: oneOf('groupStatus', raw.groupStatus, GROUP_STATUSES),
    specialConditions: conditions.map((value, index) =>
      oneOf(`specialConditions[${index}]`, value, SPECIAL_CONDITION_IDS),
    ),
  } as Nis2Answers;
}

export function parseInfrastructureNeeds(input: unknown): string[] {
  if (input === null || input === undefined) return [];
  if (!Array.isArray(input)) {
    throw new ValidationError('infrastructureNeeds', 'Invalid infrastructure needs.');
  }
  const needs = input.map((value, index) =>
    oneOf(`infrastructureNeeds[${index}]`, value, INFRASTRUCTURE_NEED_IDS),
  );
  return Array.from(new Set(needs));
}

export interface Attribution {
  session_id: string | null;
  page_path: string | null;
  referrer: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
}

/** Normalise the camelCase attribution the storefront sends to column names. */
export function parseAttribution(input: unknown): Attribution {
  const raw = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  return {
    session_id: optionalText('sessionId', raw.sessionId, 64),
    page_path: optionalText('pagePath', raw.pagePath, 512),
    referrer: optionalText('referrer', raw.referrer, 512),
    utm_source: optionalText('utmSource', raw.utmSource, 128),
    utm_medium: optionalText('utmMedium', raw.utmMedium, 128),
    utm_campaign: optionalText('utmCampaign', raw.utmCampaign, 128),
    utm_content: optionalText('utmContent', raw.utmContent, 128),
    utm_term: optionalText('utmTerm', raw.utmTerm, 128),
  };
}
