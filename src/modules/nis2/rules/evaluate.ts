/**
 * NIS2 preliminary scope evaluation.
 *
 * The output is intentionally probabilistic. Nothing in this file may produce a
 * legally definitive statement about whether an organisation *is* an essential
 * or important entity — only how likely it is that it falls in scope, and why.
 */

import { NIS2_DISCLAIMER, RULES_VERSION } from './constants';
import {
  REASON_TEXTS,
  annexForSector,
  classifyEnterpriseSize,
  hasCondition,
  isPublicBody,
  sizeIndependentEssentialConditions,
  sizeIndependentScopeConditions,
} from './rules';
import type {
  AnnexClass,
  Confidence,
  EntityCategory,
  EnterpriseSize,
  Nis2Answers,
  Nis2Result,
  ReasonCode,
  ScopeResult,
} from './types';

const HEADLINES: Record<ScopeResult, string> = {
  LIKELY_IN_SCOPE: 'Висока вероятност организацията ви да попада в обхвата на NIS2.',
  POSSIBLY_IN_SCOPE: 'Възможно е организацията ви да попада в обхвата на NIS2.',
  LIKELY_OUTSIDE_STANDARD_SCOPE:
    'По предоставените данни организацията ви вероятно е извън стандартния обхват на NIS2.',
  MANUAL_REVIEW_REQUIRED:
    'Предоставените данни не са достатъчни за предварителна оценка на обхвата.',
};

const CATEGORY_EXPLANATIONS: Record<EntityCategory, string> = {
  LIKELY_ESSENTIAL:
    'По предоставените данни е възможно организацията да бъде определена като „съществен субект“. ' +
    'Окончателният статут трябва да бъде потвърден спрямо приложимото законодателство и компетентния орган.',
  LIKELY_IMPORTANT:
    'По предоставените данни е възможно организацията да бъде определена като „важен субект“. ' +
    'Окончателният статут трябва да бъде потвърден спрямо приложимото законодателство и компетентния орган.',
  UNDETERMINED:
    'По предоставените данни категорията на субекта не може да бъде определена дори предварително. ' +
    'Необходим е преглед на конкретните дейности на организацията спрямо приложимото законодателство.',
  NOT_APPLICABLE:
    'По предоставените данни организацията вероятно не попада в стандартния обхват. ' +
    'Това не изключва изисквания по договор с клиенти или партньори, които са в обхвата.',
};

interface Draft {
  scopeResult: ScopeResult;
  entityCategory: EntityCategory;
  reasonCodes: ReasonCode[];
  requiresManualReview: boolean;
}

/** Normalise possibly-partial input coming from a browser or an API client. */
export function normalizeAnswers(input: Partial<Nis2Answers> | null | undefined): Nis2Answers {
  const raw = input ?? {};
  const conditions = Array.isArray(raw.specialConditions) ? raw.specialConditions : [];
  return {
    organizationType: raw.organizationType ?? 'UNKNOWN',
    sector: raw.sector ?? 'UNKNOWN',
    subsector: raw.subsector ?? null,
    employees: raw.employees ?? 'UNKNOWN',
    turnover: raw.turnover ?? 'UNKNOWN',
    assets: raw.assets ?? 'UNKNOWN',
    groupStatus: raw.groupStatus ?? 'UNKNOWN',
    // `NONE` and `UNKNOWN` are mutually exclusive with the concrete conditions.
    specialConditions: conditions.length > 0 ? conditions : ['NONE'],
  };
}

/**
 * Evaluate a set of answers against the current rule version.
 *
 * Pure and synchronous: the same call on the server must reproduce the client
 * result exactly, which is what lets the API recompute rather than trust the
 * classification a browser submits.
 */
export function evaluateNis2(input: Partial<Nis2Answers>): Nis2Result {
  const answers = normalizeAnswers(input);
  const size = classifyEnterpriseSize(answers);
  const annex = resolveAnnex(answers);

  const draft =
    evaluateSizeIndependent(answers, size) ??
    evaluatePublicBody(answers, size, annex) ??
    evaluateStandardPath(answers, size, annex);

  const withGroup = applyGroupUncertainty(draft, answers, size);
  const reasonCodes = dedupe(withGroup.reasonCodes);

  return {
    scopeResult: withGroup.scopeResult,
    entityCategory: withGroup.entityCategory,
    confidence: deriveConfidence(withGroup, size),
    reasonCodes,
    headline: HEADLINES[withGroup.scopeResult],
    explanation: CATEGORY_EXPLANATIONS[withGroup.entityCategory],
    reasons: reasonCodes.map((code) => REASON_TEXTS[code]),
    requiresManualReview: withGroup.requiresManualReview,
    rulesVersion: RULES_VERSION,
    enterpriseSize: size,
    annexClass: annex,
    disclaimer: NIS2_DISCLAIMER,
  };
}

/* ------------------------------------------------------------------ */
/* Branches                                                            */
/* ------------------------------------------------------------------ */

/**
 * A public body always reads as public administration, even if the user picked
 * an operational sector such as drinking water for a municipal utility.
 */
function resolveAnnex(answers: Nis2Answers): AnnexClass {
  if (isPublicBody(answers.organizationType)) return 'PUBLIC_ADMINISTRATION';
  return annexForSector(answers.sector);
}

/** Conditions that bring an entity into scope regardless of its size. */
function evaluateSizeIndependent(answers: Nis2Answers, size: EnterpriseSize): Draft | null {
  const reasonCodes: ReasonCode[] = [];

  const alwaysEssential = sizeIndependentEssentialConditions(answers);
  if (alwaysEssential.length > 0) {
    reasonCodes.push('SIZE_INDEPENDENT_ESSENTIAL');
    return {
      scopeResult: 'LIKELY_IN_SCOPE',
      entityCategory: 'LIKELY_ESSENTIAL',
      reasonCodes,
      requiresManualReview: false,
    };
  }

  if (hasCondition(answers, 'CRITICAL_ENTITY_CER')) {
    return {
      scopeResult: 'LIKELY_IN_SCOPE',
      entityCategory: 'LIKELY_ESSENTIAL',
      reasonCodes: ['CRITICAL_ENTITY_CER'],
      requiresManualReview: false,
    };
  }

  if (hasCondition(answers, 'DESIGNATED_BY_AUTHORITY')) {
    return {
      scopeResult: 'LIKELY_IN_SCOPE',
      entityCategory: 'UNDETERMINED',
      reasonCodes: ['DESIGNATED_BY_AUTHORITY'],
      requiresManualReview: true,
    };
  }

  if (hasCondition(answers, 'PUBLIC_ELECTRONIC_COMMUNICATIONS')) {
    // In scope regardless of size; essential once medium-sized or larger.
    const essential = size === 'MEDIUM' || size === 'LARGE';
    return {
      scopeResult: 'LIKELY_IN_SCOPE',
      entityCategory: essential ? 'LIKELY_ESSENTIAL' : 'LIKELY_IMPORTANT',
      reasonCodes: ['SIZE_INDEPENDENT_SCOPE', sizeReason(size)],
      requiresManualReview: size === 'UNKNOWN',
    };
  }

  const otherScopeConditions = sizeIndependentScopeConditions(answers);
  if (otherScopeConditions.length > 0) {
    const reasons: ReasonCode[] = ['SIZE_INDEPENDENT_SCOPE'];
    if (otherScopeConditions.includes('SOLE_PROVIDER_ESSENTIAL_SERVICE')) reasons.push('SOLE_PROVIDER');
    if (otherScopeConditions.includes('SIGNIFICANT_PUBLIC_IMPACT')) reasons.push('SIGNIFICANT_IMPACT_RISK');
    return {
      scopeResult: 'POSSIBLY_IN_SCOPE',
      entityCategory: 'UNDETERMINED',
      reasonCodes: reasons,
      requiresManualReview: true,
    };
  }

  return null;
}

/** Public administration and municipal structures. */
function evaluatePublicBody(
  answers: Nis2Answers,
  size: EnterpriseSize,
  annex: AnnexClass,
): Draft | null {
  const isPublic = annex === 'PUBLIC_ADMINISTRATION' || answers.sector === 'PUBLIC_ADMINISTRATION';
  if (!isPublic) return null;

  if (answers.organizationType === 'MUNICIPALITY') {
    return {
      scopeResult: 'POSSIBLY_IN_SCOPE',
      entityCategory: 'UNDETERMINED',
      reasonCodes: ['PUBLIC_ADMIN_LOCAL'],
      requiresManualReview: true,
    };
  }

  // Central-government administration: in scope irrespective of size.
  return {
    scopeResult: 'LIKELY_IN_SCOPE',
    entityCategory: 'LIKELY_ESSENTIAL',
    reasonCodes: ['PUBLIC_ADMIN_CENTRAL'],
    requiresManualReview: false,
  };
}

/** The ordinary Annex I / Annex II + enterprise-size path. */
function evaluateStandardPath(
  answers: Nis2Answers,
  size: EnterpriseSize,
  annex: AnnexClass,
): Draft {
  if (annex === 'UNKNOWN') {
    return {
      scopeResult: 'MANUAL_REVIEW_REQUIRED',
      entityCategory: 'UNDETERMINED',
      reasonCodes: ['SECTOR_UNKNOWN'],
      requiresManualReview: true,
    };
  }

  if (annex === 'NOT_LISTED') {
    return {
      scopeResult: 'LIKELY_OUTSIDE_STANDARD_SCOPE',
      entityCategory: 'NOT_APPLICABLE',
      reasonCodes: ['SECTOR_NOT_LISTED', 'SUPPLY_CHAIN_INDIRECT'],
      requiresManualReview: false,
    };
  }

  const sectorReason: ReasonCode = annex === 'ANNEX_I' ? 'SECTOR_ANNEX_I' : 'SECTOR_ANNEX_II';

  if (size === 'UNKNOWN') {
    return {
      scopeResult: 'MANUAL_REVIEW_REQUIRED',
      entityCategory: 'UNDETERMINED',
      reasonCodes: [sectorReason, 'SIZE_UNKNOWN'],
      requiresManualReview: true,
    };
  }

  if (size === 'MICRO' || size === 'SMALL') {
    return {
      scopeResult: 'LIKELY_OUTSIDE_STANDARD_SCOPE',
      entityCategory: 'NOT_APPLICABLE',
      reasonCodes: [sectorReason, sizeReason(size), 'SUPPLY_CHAIN_INDIRECT'],
      requiresManualReview: false,
    };
  }

  // Medium-sized entities in either annex are caught, and are important
  // entities unless the annex and size make them essential.
  const essential = annex === 'ANNEX_I' && size === 'LARGE';
  return {
    scopeResult: 'LIKELY_IN_SCOPE',
    entityCategory: essential ? 'LIKELY_ESSENTIAL' : 'LIKELY_IMPORTANT',
    reasonCodes: [sectorReason, sizeReason(size)],
    requiresManualReview: false,
  };
}

/* ------------------------------------------------------------------ */
/* Post-processing                                                     */
/* ------------------------------------------------------------------ */

/**
 * Group and linked enterprises are consolidated when computing enterprise size,
 * so a small standalone reading can be wrong. This only ever makes the result
 * more cautious, never less.
 */
function applyGroupUncertainty(draft: Draft, answers: Nis2Answers, size: EnterpriseSize): Draft {
  if (answers.groupStatus === 'NO') return draft;

  const reasonCode: ReasonCode =
    answers.groupStatus === 'YES' ? 'GROUP_LINKED_ENTERPRISES' : 'GROUP_STATUS_UNKNOWN';

  const belowThresholds = size === 'MICRO' || size === 'SMALL';
  const outsideOnSizeGrounds = draft.scopeResult === 'LIKELY_OUTSIDE_STANDARD_SCOPE' && belowThresholds;

  if (!outsideOnSizeGrounds) {
    // Group structure cannot pull an in-scope entity back out of scope; record
    // the fact without changing the verdict.
    if (draft.scopeResult === 'LIKELY_OUTSIDE_STANDARD_SCOPE') return draft;
    return { ...draft, reasonCodes: [...draft.reasonCodes, reasonCode] };
  }

  return {
    scopeResult: 'POSSIBLY_IN_SCOPE',
    entityCategory: 'UNDETERMINED',
    reasonCodes: [...draft.reasonCodes.filter((c) => c !== 'SUPPLY_CHAIN_INDIRECT'), reasonCode],
    requiresManualReview: true,
  };
}

function deriveConfidence(draft: Draft, size: EnterpriseSize): Confidence {
  if (draft.scopeResult === 'MANUAL_REVIEW_REQUIRED') return 'LOW';
  if (draft.requiresManualReview) return 'LOW';
  if (size === 'UNKNOWN') return 'LOW';
  if (draft.entityCategory === 'UNDETERMINED') return 'MEDIUM';
  if (draft.reasonCodes.includes('GROUP_LINKED_ENTERPRISES')) return 'MEDIUM';
  if (draft.reasonCodes.includes('GROUP_STATUS_UNKNOWN')) return 'MEDIUM';
  return 'HIGH';
}

function sizeReason(size: EnterpriseSize): ReasonCode {
  switch (size) {
    case 'LARGE':
      return 'SIZE_LARGE';
    case 'MEDIUM':
      return 'SIZE_MEDIUM';
    case 'SMALL':
      return 'SIZE_SMALL';
    case 'MICRO':
      return 'SIZE_MICRO';
    default:
      return 'SIZE_UNKNOWN';
  }
}

function dedupe<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}
