/** Types for the NIS2 preliminary assessment engine. */

/* ------------------------------------------------------------------ */
/* Answers                                                             */
/* ------------------------------------------------------------------ */

export type OrganizationType =
  | 'PRIVATE_ENTERPRISE'
  | 'STATE_ADMINISTRATION'
  | 'MUNICIPALITY'
  | 'EDUCATION'
  | 'RESEARCH_ORGANIZATION'
  | 'OTHER'
  | 'UNKNOWN';

/** Stable internal sector ids. Display strings live in `sectors.ts`. */
export type SectorId =
  // Annex I — sectors of high criticality
  | 'ENERGY'
  | 'TRANSPORT'
  | 'BANKING'
  | 'FINANCIAL_MARKET_INFRASTRUCTURE'
  | 'HEALTH'
  | 'DRINKING_WATER'
  | 'WASTE_WATER'
  | 'DIGITAL_INFRASTRUCTURE'
  | 'ICT_SERVICE_MANAGEMENT'
  | 'PUBLIC_ADMINISTRATION'
  | 'SPACE'
  // Annex II — other critical sectors
  | 'POSTAL_COURIER'
  | 'WASTE_MANAGEMENT'
  | 'CHEMICALS'
  | 'FOOD'
  | 'MANUFACTURING_MEDICAL_DEVICES'
  | 'MANUFACTURING_COMPUTER_ELECTRONIC_OPTICAL'
  | 'MANUFACTURING_ELECTRICAL_EQUIPMENT'
  | 'MANUFACTURING_MACHINERY'
  | 'MANUFACTURING_MOTOR_VEHICLES'
  | 'MANUFACTURING_OTHER_TRANSPORT'
  | 'DIGITAL_PROVIDERS'
  | 'RESEARCH'
  // Fallbacks
  | 'NOT_LISTED'
  | 'UNKNOWN';

export type EmployeesBucket =
  | 'E_1_9'
  | 'E_10_49'
  | 'E_50_249'
  | 'E_250_PLUS'
  | 'UNKNOWN';

export type TurnoverBucket =
  | 'T_LE_2M'
  | 'T_2_10M'
  | 'T_10_50M'
  | 'T_GT_50M'
  | 'UNKNOWN';

export type AssetsBucket =
  | 'A_LE_2M'
  | 'A_2_10M'
  | 'A_10_43M'
  | 'A_GT_43M'
  | 'UNKNOWN';

export type GroupStatus = 'YES' | 'NO' | 'UNKNOWN';

/**
 * Conditions that can bring an entity into scope irrespective of the normal
 * enterprise-size thresholds (NIS2 Art. 2(2), Art. 3(1)).
 */
export type SpecialCondition =
  | 'PUBLIC_ELECTRONIC_COMMUNICATIONS'
  | 'QUALIFIED_TRUST_SERVICE_PROVIDER'
  | 'DNS_SERVICE_PROVIDER'
  | 'TLD_NAME_REGISTRY'
  | 'CRITICAL_ENTITY_CER'
  | 'SOLE_PROVIDER_ESSENTIAL_SERVICE'
  | 'SIGNIFICANT_PUBLIC_IMPACT'
  | 'DESIGNATED_BY_AUTHORITY'
  | 'NONE'
  | 'UNKNOWN';

export interface Nis2Answers {
  organizationType: OrganizationType;
  sector: SectorId;
  /** Optional free-form subsector id (e.g. `ENERGY_ELECTRICITY`). */
  subsector?: string | null;
  employees: EmployeesBucket;
  turnover: TurnoverBucket;
  assets: AssetsBucket;
  groupStatus: GroupStatus;
  specialConditions: SpecialCondition[];
}

/* ------------------------------------------------------------------ */
/* Result                                                              */
/* ------------------------------------------------------------------ */

export type ScopeResult =
  | 'LIKELY_IN_SCOPE'
  | 'POSSIBLY_IN_SCOPE'
  | 'LIKELY_OUTSIDE_STANDARD_SCOPE'
  | 'MANUAL_REVIEW_REQUIRED';

export type EntityCategory =
  | 'LIKELY_ESSENTIAL'
  | 'LIKELY_IMPORTANT'
  | 'UNDETERMINED'
  | 'NOT_APPLICABLE';

export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW';

export type EnterpriseSize = 'MICRO' | 'SMALL' | 'MEDIUM' | 'LARGE' | 'UNKNOWN';

export type AnnexClass =
  | 'ANNEX_I'
  | 'ANNEX_II'
  | 'PUBLIC_ADMINISTRATION'
  | 'NOT_LISTED'
  | 'UNKNOWN';

/** Machine-readable justifications. Bulgarian text lives in `rules.ts`. */
export type ReasonCode =
  | 'SECTOR_ANNEX_I'
  | 'SECTOR_ANNEX_II'
  | 'SECTOR_NOT_LISTED'
  | 'SECTOR_UNKNOWN'
  | 'PUBLIC_ADMIN_CENTRAL'
  | 'PUBLIC_ADMIN_LOCAL'
  | 'SIZE_LARGE'
  | 'SIZE_MEDIUM'
  | 'SIZE_SMALL'
  | 'SIZE_MICRO'
  | 'SIZE_UNKNOWN'
  | 'SIZE_INDEPENDENT_ESSENTIAL'
  | 'SIZE_INDEPENDENT_SCOPE'
  | 'CRITICAL_ENTITY_CER'
  | 'DESIGNATED_BY_AUTHORITY'
  | 'SOLE_PROVIDER'
  | 'SIGNIFICANT_IMPACT_RISK'
  | 'GROUP_LINKED_ENTERPRISES'
  | 'GROUP_STATUS_UNKNOWN'
  | 'SUPPLY_CHAIN_INDIRECT';

export interface Nis2Result {
  scopeResult: ScopeResult;
  entityCategory: EntityCategory;
  confidence: Confidence;
  reasonCodes: ReasonCode[];
  /** Short Bulgarian headline, e.g. "Висока вероятност ... да попада в обхвата". */
  headline: string;
  /** Cautious secondary paragraph explaining the likely category. */
  explanation: string;
  /** Bulgarian bullet points, one per reason code. */
  reasons: string[];
  requiresManualReview: boolean;
  rulesVersion: string;
  /** Derived enterprise size, exposed for transparency and analytics. */
  enterpriseSize: EnterpriseSize;
  annexClass: AnnexClass;
  disclaimer: string;
}

/* ------------------------------------------------------------------ */
/* Infrastructure qualification (commercial, separate from legal scope) */
/* ------------------------------------------------------------------ */

export type InfrastructureNeed =
  | 'CORPORATE_NETWORK_FIREWALL_VPN'
  | 'NETWORK_SEGMENTATION_VLAN'
  | 'PRODUCTION_HMI_TOUCH_PANEL'
  | 'SCADA_OT'
  | 'INDUSTRIAL_EDGE_COMPUTING'
  | 'SECURE_REMOTE_ACCESS'
  | 'BACKUP_BUSINESS_CONTINUITY'
  | 'MONITORING_LOGGING'
  | 'LEGACY_WORKSTATION_REPLACEMENT'
  | 'NEW_PRODUCTION_LINE'
  | 'NOT_SURE_WANT_CONSULTATION';

export type SolutionCategoryId =
  | 'NETWORK_SECURITY'
  | 'PRODUCTION_OT'
  | 'TOUCH_PANEL_HMI'
  | 'INDUSTRIAL_COMPUTING'
  | 'SECURE_REMOTE_ACCESS'
  | 'BUSINESS_CONTINUITY';

export interface SolutionRecommendation {
  categoryId: SolutionCategoryId;
  title: string;
  /** What IWILL proposes to review — never a product SKU. */
  body: string;
  href: string;
}
