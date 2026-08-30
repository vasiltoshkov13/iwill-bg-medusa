/**
 * Pure rule primitives for the NIS2 preliminary assessment.
 *
 * Everything in this file is deterministic and free of React/DOM/network
 * dependencies so that the same logic can run in the browser, in a Next.js
 * route handler and in the Medusa backend.
 */

import { SIZE_THRESHOLDS_EUR_M } from './constants';
import { SECTORS_BY_ID } from './sectors';
import type {
  AnnexClass,
  AssetsBucket,
  EmployeesBucket,
  EnterpriseSize,
  Nis2Answers,
  OrganizationType,
  ReasonCode,
  SectorId,
  SpecialCondition,
  TurnoverBucket,
} from './types';

/* ------------------------------------------------------------------ */
/* Tri-state logic                                                     */
/* ------------------------------------------------------------------ */

/** `true` / `false` / `null` = not known from the given answers. */
export type Tri = boolean | null;

/* ------------------------------------------------------------------ */
/* Bucket → numeric interpretation                                     */
/* ------------------------------------------------------------------ */

/**
 * A numeric interval implied by an answer bucket.
 *
 * `max` is always inclusive. `minExclusive` matters for the money buckets: an
 * answer of "€10–50 млн." means strictly more than 10 m EUR, which is what
 * separates a company that clears the small-enterprise ceiling from one that
 * sits exactly on it.
 */
export interface Range {
  min: number | null;
  max: number | null;
  minExclusive?: boolean;
}

/** Staff-count range implied by a bucket. `null` = unbounded. */
export function employeeRange(bucket: EmployeesBucket): Range {
  switch (bucket) {
    case 'E_1_9':
      return { min: 1, max: 9 };
    case 'E_10_49':
      return { min: 10, max: 49 };
    case 'E_50_249':
      return { min: 50, max: 249 };
    case 'E_250_PLUS':
      return { min: 250, max: null };
    case 'UNKNOWN':
    default:
      return { min: null, max: null };
  }
}

/** Turnover range in millions of EUR. */
export function turnoverRange(bucket: TurnoverBucket): Range {
  switch (bucket) {
    case 'T_LE_2M':
      return { min: 0, max: 2 };
    case 'T_2_10M':
      return { min: 2, max: 10, minExclusive: true };
    case 'T_10_50M':
      return { min: 10, max: 50, minExclusive: true };
    case 'T_GT_50M':
      return { min: 50, max: null, minExclusive: true };
    case 'UNKNOWN':
    default:
      return { min: null, max: null };
  }
}

/** Balance-sheet total range in millions of EUR. */
export function assetsRange(bucket: AssetsBucket): Range {
  switch (bucket) {
    case 'A_LE_2M':
      return { min: 0, max: 2 };
    case 'A_2_10M':
      return { min: 2, max: 10, minExclusive: true };
    case 'A_10_43M':
      return { min: 10, max: 43, minExclusive: true };
    case 'A_GT_43M':
      return { min: 43, max: null, minExclusive: true };
    case 'UNKNOWN':
    default:
      return { min: null, max: null };
  }
}

/** Every value in the range is certainly at or above `limit`? */
function certainlyAtLeast(range: Range, limit: number): boolean {
  return range.min !== null && range.min >= limit;
}

/** Is the value certainly / certainly-not / possibly below `limit` (strict `<`)? */
function isBelow(range: Range, limit: number): Tri {
  if (range.max !== null && range.max < limit) return true;
  if (certainlyAtLeast(range, limit)) return false;
  return null;
}

/** Is the value certainly / certainly-not / possibly `<= limit`? */
function isAtMost(range: Range, limit: number): Tri {
  if (range.max !== null && range.max <= limit) return true;
  if (range.min !== null) {
    const allAbove = range.minExclusive ? range.min >= limit : range.min > limit;
    if (allAbove) return false;
  }
  return null;
}

/** Tri-state OR: true wins, then unknown, then false. */
function triOr(a: Tri, b: Tri): Tri {
  if (a === true || b === true) return true;
  if (a === null || b === null) return null;
  return false;
}

/** Tri-state AND: false wins, then unknown, then true. */
function triAnd(a: Tri, b: Tri): Tri {
  if (a === false || b === false) return false;
  if (a === null || b === null) return null;
  return true;
}

/* ------------------------------------------------------------------ */
/* Enterprise size (Commission Recommendation 2003/361/EC)             */
/* ------------------------------------------------------------------ */

/**
 * Classify enterprise size from the answer buckets.
 *
 * The classification follows the SME recommendation the NIS2 size cap relies
 * on: an enterprise falls in a class when it is below the staff headcount
 * ceiling AND at most one of the two financial ceilings is exceeded.
 *
 * Returns `UNKNOWN` whenever the answers cannot distinguish between classes
 * that would lead to different NIS2 outcomes — the engine then asks for a
 * manual review rather than guessing.
 */
export function classifyEnterpriseSize(answers: {
  employees: EmployeesBucket;
  turnover: TurnoverBucket;
  assets: AssetsBucket;
}): EnterpriseSize {
  const staff = employeeRange(answers.employees);
  const turnover = turnoverRange(answers.turnover);
  const assets = assetsRange(answers.assets);

  const t = SIZE_THRESHOLDS_EUR_M;

  // ---- LARGE: exceeds the ceilings for medium-sized enterprises.
  // Either >= 250 staff, or both financial ceilings exceeded.
  const staffBelowMedium = isBelow(staff, t.medium.staff); // < 250
  const financialsWithinMedium = triOr(
    isAtMost(turnover, t.medium.turnover), // <= 50 m
    isAtMost(assets, t.medium.assets), // <= 43 m
  );
  const isMediumOrSmaller = triAnd(staffBelowMedium, financialsWithinMedium);
  if (isMediumOrSmaller === false) return 'LARGE';

  // ---- MICRO
  const staffBelowMicro = isBelow(staff, t.micro.staff); // < 10
  const financialsWithinMicro = triOr(
    isAtMost(turnover, t.micro.turnover),
    isAtMost(assets, t.micro.assets),
  );
  const micro = triAnd(staffBelowMicro, financialsWithinMicro);

  // ---- SMALL
  const staffBelowSmall = isBelow(staff, t.small.staff); // < 50
  const financialsWithinSmall = triOr(
    isAtMost(turnover, t.small.turnover),
    isAtMost(assets, t.small.assets),
  );
  const small = triAnd(staffBelowSmall, financialsWithinSmall);

  if (micro === true) return 'MICRO';
  if (small === true) return 'SMALL';

  // Not small and not large. If we are sure the entity is not small, it is
  // medium-sized — which is exactly what the NIS2 size cap catches.
  if (small === false && isMediumOrSmaller === true) return 'MEDIUM';
  if (small === false && isMediumOrSmaller === null) {
    // Certainly at or above the medium threshold; may even be large. Treat as
    // medium for scope purposes — the category is refined by the caller.
    return 'MEDIUM';
  }

  return 'UNKNOWN';
}

/* ------------------------------------------------------------------ */
/* Sector → annex                                                      */
/* ------------------------------------------------------------------ */

export function annexForSector(sector: SectorId): AnnexClass {
  return SECTORS_BY_ID[sector]?.annex ?? 'UNKNOWN';
}

/**
 * Some organisation types imply a public-administration reading even when the
 * user picked an operational sector (e.g. a municipality running a water
 * utility). The stricter of the two readings wins.
 */
export function isPublicBody(organizationType: OrganizationType): boolean {
  return organizationType === 'STATE_ADMINISTRATION' || organizationType === 'MUNICIPALITY';
}

/* ------------------------------------------------------------------ */
/* Special conditions                                                  */
/* ------------------------------------------------------------------ */

/**
 * Conditions that make an entity essential regardless of its size
 * (NIS2 Art. 3(1)(c)-(d)).
 */
const SIZE_INDEPENDENT_ESSENTIAL: SpecialCondition[] = [
  'QUALIFIED_TRUST_SERVICE_PROVIDER',
  'TLD_NAME_REGISTRY',
  'DNS_SERVICE_PROVIDER',
];

/**
 * Conditions that disapply the size cap without by themselves settling the
 * essential/important category (NIS2 Art. 2(2)).
 */
const SIZE_INDEPENDENT_SCOPE: SpecialCondition[] = [
  'PUBLIC_ELECTRONIC_COMMUNICATIONS',
  'SOLE_PROVIDER_ESSENTIAL_SERVICE',
  'SIGNIFICANT_PUBLIC_IMPACT',
];

export function hasCondition(answers: Nis2Answers, condition: SpecialCondition): boolean {
  return answers.specialConditions.includes(condition);
}

export function sizeIndependentEssentialConditions(answers: Nis2Answers): SpecialCondition[] {
  return SIZE_INDEPENDENT_ESSENTIAL.filter((c) => hasCondition(answers, c));
}

export function sizeIndependentScopeConditions(answers: Nis2Answers): SpecialCondition[] {
  return SIZE_INDEPENDENT_SCOPE.filter((c) => hasCondition(answers, c));
}

/* ------------------------------------------------------------------ */
/* Reason code → Bulgarian explanation                                 */
/* ------------------------------------------------------------------ */

export const REASON_TEXTS: Record<ReasonCode, string> = {
  SECTOR_ANNEX_I:
    'Посоченият сектор е сред секторите с висока критичност (Приложение I към NIS2).',
  SECTOR_ANNEX_II:
    'Посоченият сектор е сред другите критични сектори (Приложение II към NIS2).',
  SECTOR_NOT_LISTED:
    'Посоченият сектор не е сред изрично изброените в приложенията към NIS2.',
  SECTOR_UNKNOWN:
    'Секторът не е уточнен, което не позволява надеждна предварителна оценка.',
  PUBLIC_ADMIN_CENTRAL:
    'Организациите от централната държавна администрация попадат в обхвата независимо от размера си.',
  PUBLIC_ADMIN_LOCAL:
    'За общинските и регионалните структури обхватът зависи от начина, по който националното законодателство ги определя.',
  SIZE_LARGE:
    'По предоставените данни организацията надхвърля праговете за средно предприятие.',
  SIZE_MEDIUM:
    'По предоставените данни организацията отговаря на критериите за средно предприятие.',
  SIZE_SMALL:
    'По предоставените данни организацията е малко предприятие.',
  SIZE_MICRO:
    'По предоставените данни организацията е микропредприятие.',
  SIZE_UNKNOWN:
    'Данните за брой служители и финансови показатели не са достатъчни за определяне на размера на предприятието.',
  SIZE_INDEPENDENT_ESSENTIAL:
    'Посочен е вид дейност, при който обхватът се прилага независимо от размера на организацията.',
  SIZE_INDEPENDENT_SCOPE:
    'Посочено е специално обстоятелство, при което праговете за размер на предприятието не се прилагат.',
  CRITICAL_ENTITY_CER:
    'Организацията е посочена като критичен субект по реда за устойчивост на критичните субекти.',
  DESIGNATED_BY_AUTHORITY:
    'Организацията е посочена като изрично определена от компетентен орган.',
  SOLE_PROVIDER:
    'Посочено е, че организацията е единствен доставчик на услуга от съществено значение.',
  SIGNIFICANT_IMPACT_RISK:
    'Посочено е, че прекъсване на услугата би имало съществено обществено въздействие или би създало системен риск.',
  GROUP_LINKED_ENTERPRISES:
    'Организацията е част от група или има свързани предприятия — размерът се изчислява на консолидирана основа и може да е по-висок.',
  GROUP_STATUS_UNKNOWN:
    'Не е ясно дали организацията е част от група — това може да промени изчислението на размера на предприятието.',
  SUPPLY_CHAIN_INDIRECT:
    'Дори извън прекия обхват, изисквания могат да достигнат организацията по веригата на доставки, чрез договори с клиенти в обхвата.',
};
