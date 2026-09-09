import { evaluateNis2 } from '../rules/evaluate';
import { REASON_TEXTS } from '../rules/rules';
import type { Nis2Answers, OrganizationType, SectorId } from '../rules/types';

const microAnswers: Nis2Answers = {
  organizationType: 'PRIVATE_ENTERPRISE',
  sector: 'NOT_LISTED',
  subsector: null,
  employees: 'E_1_9',
  turnover: 'T_LE_2M',
  assets: 'A_LE_2M',
  groupStatus: 'NO',
  specialConditions: ['NONE'],
};

const smallAnswers: Nis2Answers = {
  ...microAnswers,
  employees: 'E_10_49',
  turnover: 'T_2_10M',
  assets: 'A_2_10M',
};

const knownNonPublicOrganizationTypes: OrganizationType[] = [
  'PRIVATE_ENTERPRISE',
  'EDUCATION',
  'RESEARCH_ORGANIZATION',
  'OTHER',
];

const contradictionTuple = {
  scopeResult: 'MANUAL_REVIEW_REQUIRED',
  entityCategory: 'UNDETERMINED',
  confidence: 'LOW',
  requiresManualReview: true,
  reasonCodes: ['ORGANIZATION_SECTOR_CONTRADICTION'],
  rulesVersion: 'BG-NIS2-2026-09-v1',
} as const;

describe('NIS2 public-body and group-scope safeguards', () => {
  it.each(knownNonPublicOrganizationTypes)(
    'classifies %s plus public administration as a contradiction, not central administration',
    (organizationType) => {
      const result = evaluateNis2({
        ...microAnswers,
        organizationType,
        sector: 'PUBLIC_ADMINISTRATION',
      });

      expect(result).toEqual(expect.objectContaining(contradictionTuple));
      expect(result.annexClass).not.toBe('PUBLIC_ADMINISTRATION');
      expect(result.reasonCodes).not.toContain('PUBLIC_ADMIN_CENTRAL');
      expect(result.reasonCodes).not.toContain('PUBLIC_ADMIN_LOCAL');
      expect(result.reasons).toEqual([REASON_TEXTS.ORGANIZATION_SECTOR_CONTRADICTION]);
    },
  );

  it('classifies UNKNOWN plus public administration with the same incomplete-input tuple', () => {
    const result = evaluateNis2({
      ...microAnswers,
      organizationType: 'UNKNOWN',
      sector: 'PUBLIC_ADMINISTRATION',
    });

    expect(result).toEqual(expect.objectContaining(contradictionTuple));
    expect(result.annexClass).not.toBe('PUBLIC_ADMINISTRATION');
    expect(result.reasonCodes).not.toContain('PUBLIC_ADMIN_CENTRAL');
  });

  it('does not let group uncertainty upgrade a contradictory public-administration pair', () => {
    const result = evaluateNis2({
      ...microAnswers,
      organizationType: 'PRIVATE_ENTERPRISE',
      sector: 'PUBLIC_ADMINISTRATION',
      groupStatus: 'YES',
    });

    expect(result).toEqual(expect.objectContaining(contradictionTuple));
    expect(result.reasonCodes).not.toContain('GROUP_LINKED_ENTERPRISES');
    expect(result.annexClass).not.toBe('PUBLIC_ADMINISTRATION');
  });

  it.each(['PUBLIC_ADMINISTRATION', 'FOOD', 'ENERGY'] as SectorId[])(
    'keeps STATE_ADMINISTRATION plus %s on the central-administration path',
    (sector) => {
      const result = evaluateNis2({
        ...microAnswers,
        organizationType: 'STATE_ADMINISTRATION',
        sector,
      });

      expect(result).toEqual(expect.objectContaining({
        scopeResult: 'LIKELY_IN_SCOPE',
        entityCategory: 'LIKELY_ESSENTIAL',
        annexClass: 'PUBLIC_ADMINISTRATION',
        reasonCodes: ['PUBLIC_ADMIN_CENTRAL'],
      }));
    },
  );

  it.each(['PUBLIC_ADMINISTRATION', 'FOOD'] as SectorId[])(
    'keeps MUNICIPALITY plus %s on the local/manual path',
    (sector) => {
      const result = evaluateNis2({
        ...microAnswers,
        organizationType: 'MUNICIPALITY',
        sector,
      });

      expect(result).toEqual(expect.objectContaining({
        scopeResult: 'POSSIBLY_IN_SCOPE',
        entityCategory: 'UNDETERMINED',
        annexClass: 'PUBLIC_ADMINISTRATION',
        reasonCodes: ['PUBLIC_ADMIN_LOCAL'],
        requiresManualReview: true,
      }));
    },
  );

  it.each([
    ['MICRO', microAnswers, 'YES'],
    ['MICRO', microAnswers, 'UNKNOWN'],
    ['SMALL', smallAnswers, 'YES'],
    ['SMALL', smallAnswers, 'UNKNOWN'],
  ] as const)(
    'keeps a %s NOT_LISTED entity with group %s outside standard scope',
    (_size, answers, groupStatus) => {
      const result = evaluateNis2({ ...answers, groupStatus });

      expect(result).toEqual(expect.objectContaining({
        scopeResult: 'LIKELY_OUTSIDE_STANDARD_SCOPE',
        entityCategory: 'NOT_APPLICABLE',
        annexClass: 'NOT_LISTED',
        requiresManualReview: false,
      }));
      expect(result.reasonCodes).toContain('SECTOR_NOT_LISTED');
      expect(result.reasonCodes).toContain('SUPPLY_CHAIN_INDIRECT');
      expect(result.reasonCodes).not.toContain('GROUP_LINKED_ENTERPRISES');
      expect(result.reasonCodes).not.toContain('GROUP_STATUS_UNKNOWN');
    },
  );

  it.each(['ANNEX_I', 'ANNEX_II'] as const)(
    'still widens an %s micro entity whose only exclusion is its standalone size',
    (annex) => {
      const result = evaluateNis2({
        ...microAnswers,
        sector: annex === 'ANNEX_I' ? 'ENERGY' : 'FOOD',
        groupStatus: 'YES',
      });

      expect(result).toEqual(expect.objectContaining({
        scopeResult: 'POSSIBLY_IN_SCOPE',
        entityCategory: 'UNDETERMINED',
        annexClass: annex,
        requiresManualReview: true,
      }));
      expect(result.reasonCodes).toContain('GROUP_LINKED_ENTERPRISES');
    },
  );

  it('does not widen an Annex I micro entity that is not part of a group', () => {
    const result = evaluateNis2({
      ...microAnswers,
      sector: 'ENERGY',
      groupStatus: 'NO',
    });

    expect(result).toEqual(expect.objectContaining({
      scopeResult: 'LIKELY_OUTSIDE_STANDARD_SCOPE',
      entityCategory: 'NOT_APPLICABLE',
      annexClass: 'ANNEX_I',
      requiresManualReview: false,
    }));
    expect(result.reasonCodes).not.toContain('GROUP_LINKED_ENTERPRISES');
  });

  it('lets an independent special condition widen an otherwise unlisted grouped micro entity', () => {
    const result = evaluateNis2({
      ...microAnswers,
      groupStatus: 'YES',
      specialConditions: ['SOLE_PROVIDER_ESSENTIAL_SERVICE'],
    });

    expect(result.scopeResult).toBe('POSSIBLY_IN_SCOPE');
    expect(result.reasonCodes).toEqual(expect.arrayContaining([
      'SIZE_INDEPENDENT_SCOPE',
      'SOLE_PROVIDER',
      'GROUP_LINKED_ENTERPRISES',
    ]));
  });
});
