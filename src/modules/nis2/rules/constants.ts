/**
 * Central constants for the NIS2 preliminary assessment engine.
 *
 * IMPORTANT: every value that encodes a legal threshold lives here so that a
 * future amendment to the Bulgarian Закон за киберсигурност (ЗКС) or to the EU
 * SME recommendation can be applied in one place, together with a bump of
 * RULES_VERSION.
 */

/**
 * Version of the rule set. Stored with every submitted assessment so historical
 * results stay interpretable after the rules change.
 *
 * Format: BG-NIS2-<YYYY>-<MM>-v<n>
 */
export const RULES_VERSION = 'BG-NIS2-2026-08-v1';

/**
 * Enterprise-size ceilings from Commission Recommendation 2003/361/EC
 * (Annex, Article 2), which NIS2 (Art. 2(1)) and the Bulgarian ЗКС use to
 * decide whether an entity is caught by the size cap.
 *
 * All values are in millions of EUR. Bulgaria applies the EUR-denominated
 * ceilings directly, so no BGN conversion is performed in the engine.
 */
export const SIZE_THRESHOLDS_EUR_M = {
  /** Micro: < 10 staff and turnover or balance-sheet total <= 2 m EUR */
  micro: { staff: 10, turnover: 2, assets: 2 },
  /** Small: < 50 staff and turnover or balance-sheet total <= 10 m EUR */
  small: { staff: 50, turnover: 10, assets: 10 },
  /** Medium: < 250 staff and (turnover <= 50 m EUR or balance sheet <= 43 m EUR) */
  medium: { staff: 250, turnover: 50, assets: 43 },
} as const;

/**
 * Mandatory disclaimer shown with every result. The checker is an informational
 * screening tool, never a legal determination of entity status.
 */
export const NIS2_DISCLAIMER =
  'Тази проверка е предварителна информационна оценка въз основа на предоставените данни ' +
  'и не представлява правна консултация или официално определяне на статута на организацията.';

/**
 * Reference to the publication of the amendments in the State Gazette.
 * Deliberately states only the promulgation, not an entry-into-force date,
 * because the applicable entry-into-force rule must be verified against the
 * final text of the law.
 */
export const ZKS_PROMULGATION_NOTE =
  'Измененията в Закона за киберсигурност са обнародвани в ДВ бр. 17 от 13 февруари 2026 г.';

/** Official sources linked from the campaign pages. */
export const NIS2_OFFICIAL_SOURCES = [
  {
    label: 'Закон за киберсигурност (lex.bg)',
    href: 'https://lex.bg/bg/laws/ldoc/2137209871',
  },
  {
    label: 'Директива (ЕС) 2022/2555 (NIS2), EUR-Lex',
    href: 'https://eur-lex.europa.eu/legal-content/BG/TXT/?uri=CELEX%3A32022L2555',
  },
  {
    label: 'Национален координатор по киберсигурност',
    href: 'https://www.cybersecurity.bg/',
  },
] as const;
