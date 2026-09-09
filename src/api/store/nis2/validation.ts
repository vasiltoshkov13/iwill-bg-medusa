import type { Nis2Answers, ScopeResult } from '../../../modules/nis2/rules/types';
import {
  ALL_SECTOR_IDS,
  ASSETS_BUCKETS,
  EMPLOYEE_BUCKETS,
  INFRASTRUCTURE_NEEDS,
  ORGANIZATION_TYPES,
  SPECIAL_CONDITIONS,
  TURNOVER_BUCKETS,
} from '../../../modules/nis2/rules/sectors';
import { ContractError } from './contract';

export interface CampaignAllowlist {
  sources: string[];
  media: string[];
  campaigns: string[];
  contents: string[];
  terms: string[];
}

export const EMPTY_CAMPAIGN_ALLOWLIST: CampaignAllowlist = {
  sources: [],
  media: [],
  campaigns: [],
  contents: [],
  terms: [],
};

const ORGANIZATION_TYPE_IDS = ORGANIZATION_TYPES.map(({ id }) => String(id));
const EMPLOYEE_BUCKET_IDS = EMPLOYEE_BUCKETS.map(({ id }) => String(id));
const TURNOVER_BUCKET_IDS = TURNOVER_BUCKETS.map(({ id }) => String(id));
const ASSETS_BUCKET_IDS = ASSETS_BUCKETS.map(({ id }) => String(id));
const SPECIAL_CONDITION_IDS = SPECIAL_CONDITIONS.map(({ id }) => String(id));
const INFRASTRUCTURE_NEED_IDS = INFRASTRUCTURE_NEEDS.map(({ id }) => String(id));
const GROUP_STATUSES = ['YES', 'NO', 'UNKNOWN'];
const PREFERRED_CONTACT = ['EMAIL', 'PHONE', 'WHATSAPP'];
const UTM_PATTERN = /^[a-z0-9][a-z0-9._~-]{0,99}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SUBSECTOR_PATTERN = /^[A-Z0-9_]+$/;
const PHONE_PATTERN = /^[+\d][\d\s()./-]{5,}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PRIVACY_NOTICE_VERSION = 'nis2-privacy-2026-09-08-93ba2f3d8256';
const NOTICE_VERSION_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

const ANSWER_FIELDS = new Set([
  'organizationType',
  'sector',
  'subsector',
  'employees',
  'turnover',
  'assets',
  'groupStatus',
  'specialConditions',
]);
const ATTRIBUTION_FIELDS = new Set([
  'sessionId',
  'pagePath',
  'referrerOrigin',
  'utmSource',
  'utmMedium',
  'utmCampaign',
  'utmContent',
  'utmTerm',
]);
const ASSESSMENT_FIELDS = new Set(['answers', 'infrastructureNeeds', 'attribution', 'company_website']);
const LEAD_FIELDS = new Set([
  'assessmentId',
  'name',
  'companyName',
  'jobTitle',
  'email',
  'phone',
  'preferredContact',
  'privacyConsent',
  'privacyNoticeVersion',
  'marketingConsent',
  'marketingNoticeVersion',
  'wantsConsultation',
  'answers',
  'infrastructureNeeds',
  'attribution',
  'company_website',
]);
const CONSULTATION_FIELDS = new Set(['leadId', 'attribution', 'company_website']);

export interface Attribution {
  session_id: string | null;
  page_path: string | null;
  referrer_origin: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
}

export interface ParsedAssessment {
  answers: Nis2Answers;
  infrastructureNeeds: string[];
  attribution: Attribution;
}

export interface ParsedLead extends ParsedAssessment {
  assessment_id: string | null;
  name: string;
  company_name: string;
  job_title: string | null;
  email: string;
  phone: string | null;
  preferred_contact: string;
  privacy_consent: true;
  privacy_notice_version: string;
  marketing_consent: boolean;
  marketing_notice_version: string | null;
  wants_consultation: boolean;
}

export interface ParsedConsultation {
  lead_id: string;
  attribution: Attribution;
}

function validation(field?: string): never {
  throw new ContractError('VALIDATION_FAILED', 400, false, field);
}

function objectValue(value: unknown, field?: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) validation(field);
  return value as Record<string, unknown>;
}

function rejectUnknown(raw: Record<string, unknown>, allowed: Set<string>, prefix = ''): void {
  const unknown = Object.keys(raw).find((key) => !allowed.has(key));
  if (unknown) validation(prefix ? prefix.slice(0, -1) : undefined);
}

function honeypot(raw: Record<string, unknown>): void {
  const value = raw.company_website;
  if (value === undefined || value === '') return;
  if (value === null || typeof value !== 'string') validation('company_website');
  if (value.trim() !== '') validation();
}

function requiredString(field: string, value: unknown, maxLength: number): string {
  if (typeof value !== 'string') validation(field);
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > maxLength) validation(field);
  return trimmed;
}

function nullableString(field: string, value: unknown, maxLength: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') validation(field);
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLength) validation(field);
  return trimmed;
}

function oneOf(field: string, value: unknown, allowed: string[]): string {
  if (typeof value !== 'string') validation(field);
  const trimmed = value.trim();
  if (!allowed.includes(trimmed)) validation(field);
  return trimmed;
}

function booleanValue(field: string, value: unknown): boolean {
  if (typeof value !== 'boolean') validation(field);
  return value;
}

export function parseAnswers(input: unknown): Nis2Answers {
  const raw = objectValue(input, 'answers');
  rejectUnknown(raw, ANSWER_FIELDS, 'answers.');

  const subsector = nullableString('answers.subsector', raw.subsector, 80);
  if (subsector !== null && !SUBSECTOR_PATTERN.test(subsector)) validation('answers.subsector');

  if (!Array.isArray(raw.specialConditions)) validation('answers.specialConditions');
  if (raw.specialConditions.length < 1 || raw.specialConditions.length > 10) {
    validation('answers.specialConditions');
  }
  const specialConditions = raw.specialConditions.map((value) =>
    oneOf('answers.specialConditions', value, SPECIAL_CONDITION_IDS),
  );
  if (new Set(specialConditions).size !== specialConditions.length) validation('answers.specialConditions');
  if (
    (specialConditions.includes('NONE') || specialConditions.includes('UNKNOWN')) &&
    specialConditions.length > 1
  ) {
    validation('answers.specialConditions');
  }

  return {
    organizationType: oneOf(
      'answers.organizationType',
      raw.organizationType,
      ORGANIZATION_TYPE_IDS,
    ) as Nis2Answers['organizationType'],
    sector: oneOf('answers.sector', raw.sector, ALL_SECTOR_IDS as unknown as string[]) as Nis2Answers['sector'],
    subsector,
    employees: oneOf('answers.employees', raw.employees, EMPLOYEE_BUCKET_IDS) as Nis2Answers['employees'],
    turnover: oneOf('answers.turnover', raw.turnover, TURNOVER_BUCKET_IDS) as Nis2Answers['turnover'],
    assets: oneOf('answers.assets', raw.assets, ASSETS_BUCKET_IDS) as Nis2Answers['assets'],
    groupStatus: oneOf('answers.groupStatus', raw.groupStatus, GROUP_STATUSES) as Nis2Answers['groupStatus'],
    specialConditions: specialConditions as Nis2Answers['specialConditions'],
  };
}

export function parseInfrastructureNeeds(input: unknown): string[] {
  if (!Array.isArray(input)) validation('infrastructureNeeds');
  if (input.length > 11) validation('infrastructureNeeds');
  const needs = input.map((value) => oneOf('infrastructureNeeds', value, INFRASTRUCTURE_NEED_IDS));
  if (new Set(needs).size !== needs.length) validation('infrastructureNeeds');
  return needs;
}

function nullableUuid(field: string, value: unknown): string | null {
  const normalized = nullableString(field, value, 36);
  if (normalized !== null && !UUID_V4.test(normalized)) validation(field);
  return normalized;
}

function referrerOrigin(value: unknown): string | null {
  const normalized = nullableString('attribution.referrerOrigin', value, 255);
  if (normalized === null) return null;
  try {
    const parsed = new URL(normalized);
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash ||
      parsed.origin !== normalized
    ) {
      validation('attribution.referrerOrigin');
    }
    return parsed.origin;
  } catch {
    validation('attribution.referrerOrigin');
  }
}

function allowlistedUtm(
  field: string,
  value: unknown,
  allowlist: string[],
): string | null {
  const normalized = nullableString(field, value, 100);
  if (normalized === null) return null;
  if (!UTM_PATTERN.test(normalized)) validation(field);
  return allowlist.includes(normalized) ? normalized : null;
}

export function parseAttribution(
  input: unknown,
  allowlist: CampaignAllowlist = EMPTY_CAMPAIGN_ALLOWLIST,
): Attribution {
  if (input === undefined) {
    return {
      session_id: null,
      page_path: null,
      referrer_origin: null,
      utm_source: null,
      utm_medium: null,
      utm_campaign: null,
      utm_content: null,
      utm_term: null,
    };
  }
  const raw = objectValue(input, 'attribution');
  rejectUnknown(raw, ATTRIBUTION_FIELDS, 'attribution.');
  const pagePath = nullableString('attribution.pagePath', raw.pagePath, 5);
  if (pagePath !== null && pagePath !== '/nis2') validation('attribution.pagePath');

  return {
    session_id: nullableUuid('attribution.sessionId', raw.sessionId),
    page_path: pagePath,
    referrer_origin: referrerOrigin(raw.referrerOrigin),
    utm_source: allowlistedUtm('attribution.utmSource', raw.utmSource, allowlist.sources),
    utm_medium: allowlistedUtm('attribution.utmMedium', raw.utmMedium, allowlist.media),
    utm_campaign: allowlistedUtm('attribution.utmCampaign', raw.utmCampaign, allowlist.campaigns),
    utm_content: allowlistedUtm('attribution.utmContent', raw.utmContent, allowlist.contents),
    utm_term: allowlistedUtm('attribution.utmTerm', raw.utmTerm, allowlist.terms),
  };
}

export function parseAssessmentBody(
  input: unknown,
  allowlist: CampaignAllowlist = EMPTY_CAMPAIGN_ALLOWLIST,
): ParsedAssessment {
  const raw = objectValue(input);
  rejectUnknown(raw, ASSESSMENT_FIELDS);
  honeypot(raw);
  return {
    answers: parseAnswers(raw.answers),
    infrastructureNeeds: parseInfrastructureNeeds(raw.infrastructureNeeds),
    attribution: parseAttribution(raw.attribution, allowlist),
  };
}

export function parseLeadBody(
  input: unknown,
  allowlist: CampaignAllowlist = EMPTY_CAMPAIGN_ALLOWLIST,
): ParsedLead {
  const raw = objectValue(input);
  rejectUnknown(raw, LEAD_FIELDS);
  honeypot(raw);

  if (raw.privacyConsent !== true) {
    throw new ContractError('CONSENT_REQUIRED', 400, false, 'privacyConsent');
  }
  if (typeof raw.privacyNoticeVersion !== 'string' || raw.privacyNoticeVersion !== PRIVACY_NOTICE_VERSION) {
    validation('privacyNoticeVersion');
  }
  const privacyNoticeVersion = raw.privacyNoticeVersion;
  const marketingConsent = booleanValue('marketingConsent', raw.marketingConsent);
  const marketingNoticeVersion = nullableString('marketingNoticeVersion', raw.marketingNoticeVersion, 64);
  if ((marketingConsent && marketingNoticeVersion === null) || (!marketingConsent && marketingNoticeVersion !== null)) {
    validation('marketingNoticeVersion');
  }
  if (marketingConsent) {
    const approvedVersion = loadMarketingNoticeVersion();
    if (approvedVersion === null) {
      throw new ContractError('PERSISTENCE_UNAVAILABLE', 503, true);
    }
    if (marketingNoticeVersion !== approvedVersion) validation('marketingNoticeVersion');
  }

  const preferredContact = oneOf('preferredContact', raw.preferredContact, PREFERRED_CONTACT);
  const phone = nullableString('phone', raw.phone, 40);
  if (phone !== null && (!PHONE_PATTERN.test(phone) || phone.length < 6)) validation('phone');
  if ((preferredContact === 'PHONE' || preferredContact === 'WHATSAPP') && phone === null) {
    validation('phone');
  }

  const address = requiredString('email', raw.email, 254).toLowerCase();
  if (!EMAIL_PATTERN.test(address)) validation('email');
  const assessmentId = nullableString('assessmentId', raw.assessmentId, 64);
  if (assessmentId !== null && !/^nis2asm_[A-Za-z0-9]+$/.test(assessmentId)) validation('assessmentId');

  return {
    assessment_id: assessmentId,
    name: requiredString('name', raw.name, 120),
    company_name: requiredString('companyName', raw.companyName, 160),
    job_title: nullableString('jobTitle', raw.jobTitle, 120),
    email: address,
    phone,
    preferred_contact: preferredContact,
    privacy_consent: true,
    privacy_notice_version: privacyNoticeVersion,
    marketing_consent: marketingConsent,
    marketing_notice_version: marketingNoticeVersion,
    wants_consultation: booleanValue('wantsConsultation', raw.wantsConsultation),
    answers: parseAnswers(raw.answers),
    infrastructureNeeds: parseInfrastructureNeeds(raw.infrastructureNeeds),
    attribution: parseAttribution(raw.attribution, allowlist),
  };
}

export function parseConsultationBody(
  input: unknown,
  allowlist: CampaignAllowlist = EMPTY_CAMPAIGN_ALLOWLIST,
): ParsedConsultation {
  const raw = objectValue(input);
  rejectUnknown(raw, CONSULTATION_FIELDS);
  honeypot(raw);
  const leadId = requiredString('leadId', raw.leadId, 64);
  if (!/^nis2lead_[A-Za-z0-9]+$/.test(leadId)) validation('leadId');
  return { lead_id: leadId, attribution: parseAttribution(raw.attribution, allowlist) };
}

export function qualificationFor(
  scopeResult: string,
  infrastructureNeeds: string[],
): 'qualified' | 'review_required' | 'unqualified' {
  const concreteNeed = infrastructureNeeds.some((need) => need !== 'NOT_SURE_WANT_CONSULTATION');
  if (!concreteNeed || scopeResult === 'LIKELY_OUTSIDE_STANDARD_SCOPE') return 'unqualified';
  if (
    scopeResult === 'LIKELY_IN_SCOPE' ||
    scopeResult === 'POSSIBLY_IN_SCOPE' ||
    scopeResult === 'MANUAL_REVIEW_REQUIRED'
  ) {
    return 'qualified';
  }
  return 'review_required';
}

export function loadCampaignAllowlist(serialized = process.env.NIS2_CAMPAIGN_ALLOWLIST): CampaignAllowlist {
  if (!serialized) return EMPTY_CAMPAIGN_ALLOWLIST;
  try {
    const raw = objectValue(JSON.parse(serialized), 'NIS2_CAMPAIGN_ALLOWLIST');
    rejectUnknown(raw, new Set(['sources', 'media', 'campaigns', 'contents', 'terms']));
    const result = {} as CampaignAllowlist;
    for (const key of ['sources', 'media', 'campaigns', 'contents', 'terms'] as const) {
      const values = raw[key];
      if (!Array.isArray(values) || values.some((value) => typeof value !== 'string' || !UTM_PATTERN.test(value))) {
        validation(`NIS2_CAMPAIGN_ALLOWLIST.${key}`);
      }
      result[key] = Array.from(new Set(values as string[]));
    }
    return result;
  } catch {
    throw new Error('Invalid NIS2_CAMPAIGN_ALLOWLIST configuration.');
  }
}

export function loadMarketingNoticeVersion(
  serialized = process.env.NIS2_MARKETING_NOTICE_VERSION,
): string | null {
  if (serialized === undefined) return null;
  if (!NOTICE_VERSION_PATTERN.test(serialized)) {
    throw new Error('Invalid NIS2_MARKETING_NOTICE_VERSION configuration.');
  }
  return serialized;
}

// Compatibility helpers retained for legacy unversioned routes during migration.
export class ValidationError extends Error {
  constructor(readonly field: string, message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export function optionalText(field: string, value: unknown, maxLength = 200): string | null {
  try {
    return nullableString(field, value, maxLength);
  } catch {
    throw new ValidationError(field, `Invalid value for "${field}".`);
  }
}

export function requiredText(field: string, value: unknown, maxLength = 200): string {
  try {
    return requiredString(field, value, maxLength);
  } catch {
    throw new ValidationError(field, `Invalid value for "${field}".`);
  }
}

export function email(field: string, value: unknown): string {
  const address = requiredText(field, value, 254).toLowerCase();
  if (!EMAIL_PATTERN.test(address)) throw new ValidationError(field, 'Invalid email address.');
  return address;
}

export function booleanFlag(value: unknown): boolean {
  return value === true;
}

function legacyOneOf(field: string, value: unknown, allowed: string[]): string {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new ValidationError(field, `Invalid value for "${field}".`);
  }
  return value;
}

export function parseLegacyAnswers(input: unknown): Nis2Answers {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new ValidationError('answers', 'Missing assessment answers.');
  }
  const raw = input as Record<string, unknown>;
  const conditions = Array.isArray(raw.specialConditions) ? raw.specialConditions : [];

  return {
    organizationType: legacyOneOf('organizationType', raw.organizationType, ORGANIZATION_TYPE_IDS),
    sector: legacyOneOf('sector', raw.sector, ALL_SECTOR_IDS as unknown as string[]),
    subsector: optionalText('subsector', raw.subsector, 80),
    employees: legacyOneOf('employees', raw.employees, EMPLOYEE_BUCKET_IDS),
    turnover: legacyOneOf('turnover', raw.turnover, TURNOVER_BUCKET_IDS),
    assets: legacyOneOf('assets', raw.assets, ASSETS_BUCKET_IDS),
    groupStatus: legacyOneOf('groupStatus', raw.groupStatus, GROUP_STATUSES),
    specialConditions: conditions.map((value, index) =>
      legacyOneOf(`specialConditions[${index}]`, value, SPECIAL_CONDITION_IDS),
    ),
  } as Nis2Answers;
}

export function parseLegacyInfrastructureNeeds(input: unknown): string[] {
  if (input === null || input === undefined) return [];
  if (!Array.isArray(input)) {
    throw new ValidationError('infrastructureNeeds', 'Invalid infrastructure needs.');
  }
  const needs = input.map((value, index) =>
    legacyOneOf(`infrastructureNeeds[${index}]`, value, INFRASTRUCTURE_NEED_IDS),
  );
  return Array.from(new Set(needs));
}

function legacyOrigin(value: unknown): string | null {
  let normalized: string | null;
  try {
    normalized = optionalText('referrer', value, 512);
  } catch {
    return null;
  }
  if (normalized === null) return null;
  try {
    const parsed = new URL(normalized);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function legacyUtm(value: unknown, allowlist: string[]): string | null {
  let normalized: string | null;
  try {
    normalized = optionalText('utm', value, 100);
  } catch {
    return null;
  }
  if (normalized === null || !UTM_PATTERN.test(normalized)) return null;
  return allowlist.includes(normalized) ? normalized : null;
}

export function parseLegacyAttribution(
  input: unknown,
  allowlist: CampaignAllowlist = loadCampaignAllowlist(),
) {
  const raw = (typeof input === 'object' && input !== null && !Array.isArray(input)
    ? input
    : {}) as Record<string, unknown>;
  const sessionId = typeof raw.sessionId === 'string' && UUID_V4.test(raw.sessionId)
    ? raw.sessionId
    : null;
  const pagePath = raw.pagePath === '/nis2' ? '/nis2' : null;
  const origin = legacyOrigin(raw.referrerOrigin ?? raw.referrer);

  return {
    session_id: sessionId,
    page_path: pagePath,
    referrer: null,
    referrer_origin: origin,
    utm_source: legacyUtm(raw.utmSource, allowlist.sources),
    utm_medium: legacyUtm(raw.utmMedium, allowlist.media),
    utm_campaign: legacyUtm(raw.utmCampaign, allowlist.campaigns),
    utm_content: legacyUtm(raw.utmContent, allowlist.contents),
    utm_term: legacyUtm(raw.utmTerm, allowlist.terms),
  };
}
