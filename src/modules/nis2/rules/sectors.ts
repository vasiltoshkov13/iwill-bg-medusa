/**
 * Human-readable Bulgarian catalogue for the checker UI.
 *
 * Only stable internal ids (`SectorId`, `OrganizationType`, buckets, …) are ever
 * passed to the rule engine or stored — never the Bulgarian display strings.
 */

import type {
  AnnexClass,
  AssetsBucket,
  EmployeesBucket,
  InfrastructureNeed,
  OrganizationType,
  SectorId,
  SpecialCondition,
  TurnoverBucket,
} from './types';

export interface Option<T extends string> {
  id: T;
  label: string;
  /** Optional short helper text shown under the option. */
  hint?: string;
}

/* ------------------------------------------------------------------ */
/* Step 1 — organization type                                          */
/* ------------------------------------------------------------------ */

export const ORGANIZATION_TYPES: Option<OrganizationType>[] = [
  { id: 'PRIVATE_ENTERPRISE', label: 'Частно предприятие' },
  { id: 'STATE_ADMINISTRATION', label: 'Държавна / публична администрация' },
  { id: 'MUNICIPALITY', label: 'Община / общинска структура' },
  { id: 'EDUCATION', label: 'Образователна организация' },
  { id: 'RESEARCH_ORGANIZATION', label: 'Научноизследователска организация' },
  { id: 'OTHER', label: 'Друга организация' },
  { id: 'UNKNOWN', label: 'Не съм сигурен' },
];

/* ------------------------------------------------------------------ */
/* Step 2 — sector                                                     */
/* ------------------------------------------------------------------ */

export interface SectorOption extends Option<SectorId> {
  annex: AnnexClass;
}

export interface SectorGroup {
  id: string;
  label: string;
  sectors: SectorOption[];
}

/**
 * Grouped so the UI stays short. Groups mix Annex I and Annex II on purpose —
 * users think in industries, not in annexes; the annex is resolved internally.
 */
export const SECTOR_GROUPS: SectorGroup[] = [
  {
    id: 'energy-utilities',
    label: 'Енергетика и комунални услуги',
    sectors: [
      { id: 'ENERGY', label: 'Енергетика (ток, топлинна енергия, нефт, газ, водород)', annex: 'ANNEX_I' },
      { id: 'DRINKING_WATER', label: 'Питейна вода', annex: 'ANNEX_I' },
      { id: 'WASTE_WATER', label: 'Отпадъчни води', annex: 'ANNEX_I' },
      { id: 'WASTE_MANAGEMENT', label: 'Управление на отпадъци', annex: 'ANNEX_II' },
    ],
  },
  {
    id: 'transport-logistics',
    label: 'Транспорт и логистика',
    sectors: [
      { id: 'TRANSPORT', label: 'Транспорт (въздушен, железопътен, воден, автомобилен)', annex: 'ANNEX_I' },
      { id: 'POSTAL_COURIER', label: 'Пощенски и куриерски услуги', annex: 'ANNEX_II' },
    ],
  },
  {
    id: 'finance',
    label: 'Финанси',
    sectors: [
      { id: 'BANKING', label: 'Банкиране', annex: 'ANNEX_I' },
      { id: 'FINANCIAL_MARKET_INFRASTRUCTURE', label: 'Инфраструктура на финансовите пазари', annex: 'ANNEX_I' },
    ],
  },
  {
    id: 'health',
    label: 'Здравеопазване',
    sectors: [
      { id: 'HEALTH', label: 'Здравеопазване (лечебни заведения, лаборатории, фармация)', annex: 'ANNEX_I' },
      { id: 'MANUFACTURING_MEDICAL_DEVICES', label: 'Производство на медицински изделия', annex: 'ANNEX_II' },
    ],
  },
  {
    id: 'digital',
    label: 'Цифрова инфраструктура и услуги',
    sectors: [
      {
        id: 'DIGITAL_INFRASTRUCTURE',
        label: 'Цифрова инфраструктура',
        hint: 'Дата центрове, облачни услуги, CDN, DNS, TLD регистри, доверителни услуги, електронни съобщителни мрежи',
        annex: 'ANNEX_I',
      },
      {
        id: 'ICT_SERVICE_MANAGEMENT',
        label: 'Управлявани ИКТ услуги (MSP / MSSP)',
        hint: 'Аутсорсинг на ИТ или на киберсигурност за клиенти',
        annex: 'ANNEX_I',
      },
      {
        id: 'DIGITAL_PROVIDERS',
        label: 'Онлайн пазари, търсачки и социални платформи',
        annex: 'ANNEX_II',
      },
    ],
  },
  {
    id: 'manufacturing',
    label: 'Производство',
    sectors: [
      { id: 'FOOD', label: 'Производство, преработка и дистрибуция на храни', annex: 'ANNEX_II' },
      { id: 'CHEMICALS', label: 'Химикали (производство, търговия, дистрибуция)', annex: 'ANNEX_II' },
      { id: 'MANUFACTURING_COMPUTER_ELECTRONIC_OPTICAL', label: 'Компютърна, електронна и оптична техника', annex: 'ANNEX_II' },
      { id: 'MANUFACTURING_ELECTRICAL_EQUIPMENT', label: 'Електрически съоръжения', annex: 'ANNEX_II' },
      { id: 'MANUFACTURING_MACHINERY', label: 'Машини и оборудване', annex: 'ANNEX_II' },
      { id: 'MANUFACTURING_MOTOR_VEHICLES', label: 'Автомобили, ремаркета и полуремаркета', annex: 'ANNEX_II' },
      { id: 'MANUFACTURING_OTHER_TRANSPORT', label: 'Друго транспортно оборудване', annex: 'ANNEX_II' },
    ],
  },
  {
    id: 'public-science',
    label: 'Публичен сектор и наука',
    sectors: [
      { id: 'PUBLIC_ADMINISTRATION', label: 'Публична администрация', annex: 'PUBLIC_ADMINISTRATION' },
      { id: 'RESEARCH', label: 'Научни изследвания', annex: 'ANNEX_II' },
      { id: 'SPACE', label: 'Космически сектор', annex: 'ANNEX_I' },
    ],
  },
  {
    id: 'other',
    label: 'Друго',
    sectors: [
      { id: 'NOT_LISTED', label: 'Нито един от изброените сектори', annex: 'NOT_LISTED' },
      { id: 'UNKNOWN', label: 'Не съм сигурен', annex: 'UNKNOWN' },
    ],
  },
];

/** Flat lookup of every sector option by id. */
export const SECTORS_BY_ID: Record<SectorId, SectorOption> = SECTOR_GROUPS.reduce(
  (acc, group) => {
    for (const sector of group.sectors) acc[sector.id] = sector;
    return acc;
  },
  {} as Record<SectorId, SectorOption>,
);

export const ALL_SECTOR_IDS = Object.keys(SECTORS_BY_ID) as SectorId[];

/* ------------------------------------------------------------------ */
/* Steps 3–5 — size buckets                                            */
/* ------------------------------------------------------------------ */

export const EMPLOYEE_BUCKETS: Option<EmployeesBucket>[] = [
  { id: 'E_1_9', label: '1–9' },
  { id: 'E_10_49', label: '10–49' },
  { id: 'E_50_249', label: '50–249' },
  { id: 'E_250_PLUS', label: '250+' },
  { id: 'UNKNOWN', label: 'Не знам' },
];

export const TURNOVER_BUCKETS: Option<TurnoverBucket>[] = [
  { id: 'T_LE_2M', label: 'До €2 млн.' },
  { id: 'T_2_10M', label: '€2–10 млн.' },
  { id: 'T_10_50M', label: '€10–50 млн.' },
  { id: 'T_GT_50M', label: 'Над €50 млн.' },
  { id: 'UNKNOWN', label: 'Не знам / не желая да посоча' },
];

export const ASSETS_BUCKETS: Option<AssetsBucket>[] = [
  { id: 'A_LE_2M', label: 'До €2 млн.' },
  { id: 'A_2_10M', label: '€2–10 млн.' },
  { id: 'A_10_43M', label: '€10–43 млн.' },
  { id: 'A_GT_43M', label: 'Над €43 млн.' },
  { id: 'UNKNOWN', label: 'Не знам / не желая да посоча' },
];

/* ------------------------------------------------------------------ */
/* Step 7 — special conditions                                         */
/* ------------------------------------------------------------------ */

export const SPECIAL_CONDITIONS: Option<SpecialCondition>[] = [
  {
    id: 'PUBLIC_ELECTRONIC_COMMUNICATIONS',
    label: 'Предоставяме обществени електронни съобщителни мрежи или услуги',
    hint: 'Телеком оператор, интернет доставчик, обществена мобилна или фиксирана услуга',
  },
  {
    id: 'QUALIFIED_TRUST_SERVICE_PROVIDER',
    label: 'Квалифициран доставчик на удостоверителни услуги',
    hint: 'Например квалифициран електронен подпис или електронен печат',
  },
  { id: 'DNS_SERVICE_PROVIDER', label: 'Доставчик на DNS услуги' },
  { id: 'TLD_NAME_REGISTRY', label: 'Регистър на имена на домейни от първо ниво (TLD)' },
  {
    id: 'CRITICAL_ENTITY_CER',
    label: 'Организацията е определена като критичен субект',
    hint: 'По реда за устойчивост на критичните субекти (Директива CER)',
  },
  {
    id: 'SOLE_PROVIDER_ESSENTIAL_SERVICE',
    label: 'Единствен доставчик сме на услуга от съществено значение',
    hint: 'В страната или в даден регион няма алтернативен доставчик',
  },
  {
    id: 'SIGNIFICANT_PUBLIC_IMPACT',
    label: 'Прекъсване на услугата ни би имало съществено въздействие',
    hint: 'Върху общественото здраве, обществената безопасност или би създало системен риск',
  },
  {
    id: 'DESIGNATED_BY_AUTHORITY',
    label: 'Организацията е изрично определена от компетентен орган',
  },
  { id: 'NONE', label: 'Нито едно от изброените' },
  { id: 'UNKNOWN', label: 'Не знам' },
];

/**
 * Special conditions are the least approachable step, so they are only shown
 * when earlier answers make them plausible. Users who are filtered out are
 * treated as `NONE`, which never widens scope on its own.
 */
export function shouldAskSpecialConditions(input: {
  sector: SectorId;
  organizationType: OrganizationType;
  employees: EmployeesBucket;
}): boolean {
  // Digital / telecom-adjacent sectors: the size-independent cases live here.
  if (
    input.sector === 'DIGITAL_INFRASTRUCTURE' ||
    input.sector === 'ICT_SERVICE_MANAGEMENT' ||
    input.sector === 'DIGITAL_PROVIDERS'
  ) {
    return true;
  }

  // Small organisations in a listed sector: a special condition is the only
  // realistic route into scope, so it is worth one extra question.
  const isSmall = input.employees === 'E_1_9' || input.employees === 'E_10_49';
  const listed =
    SECTORS_BY_ID[input.sector]?.annex === 'ANNEX_I' ||
    SECTORS_BY_ID[input.sector]?.annex === 'ANNEX_II';
  if (isSmall && listed) return true;

  // Utilities and public bodies are frequently designated or sole providers.
  if (
    input.sector === 'ENERGY' ||
    input.sector === 'DRINKING_WATER' ||
    input.sector === 'WASTE_WATER' ||
    input.sector === 'TRANSPORT' ||
    input.sector === 'HEALTH' ||
    input.sector === 'PUBLIC_ADMINISTRATION'
  ) {
    return true;
  }
  if (input.organizationType === 'STATE_ADMINISTRATION' || input.organizationType === 'MUNICIPALITY') {
    return true;
  }

  // Sector unknown or not listed: give the user a route to flag a special case.
  if (input.sector === 'UNKNOWN' || input.sector === 'NOT_LISTED') return true;

  return false;
}

/* ------------------------------------------------------------------ */
/* Phase 2 — infrastructure qualification                              */
/* ------------------------------------------------------------------ */

export const INFRASTRUCTURE_NEEDS: Option<InfrastructureNeed>[] = [
  { id: 'CORPORATE_NETWORK_FIREWALL_VPN', label: 'Корпоративна мрежа / Firewall / VPN' },
  { id: 'NETWORK_SEGMENTATION_VLAN', label: 'Мрежова сегментация / VLAN' },
  { id: 'PRODUCTION_HMI_TOUCH_PANEL', label: 'Производство / HMI / Touch Panel PC' },
  { id: 'SCADA_OT', label: 'SCADA / OT инфраструктура' },
  { id: 'INDUSTRIAL_EDGE_COMPUTING', label: 'Индустриални компютри / Edge' },
  { id: 'SECURE_REMOTE_ACCESS', label: 'Сигурен отдалечен достъп' },
  { id: 'BACKUP_BUSINESS_CONTINUITY', label: 'Backup / Business Continuity' },
  { id: 'MONITORING_LOGGING', label: 'Monitoring / Logging' },
  { id: 'LEGACY_WORKSTATION_REPLACEMENT', label: 'Подмяна на остарели производствени станции' },
  { id: 'NEW_PRODUCTION_LINE', label: 'Нова производствена линия / автоматизация' },
  { id: 'NOT_SURE_WANT_CONSULTATION', label: 'Не сме сигурни — искаме консултация' },
];
