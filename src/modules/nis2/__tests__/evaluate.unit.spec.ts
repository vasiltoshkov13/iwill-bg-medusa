import { evaluateNis2 } from '../rules/evaluate';
import type { Nis2Answers, OrganizationType } from '../rules/types';

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

const nonPublicOrganizationTypes: OrganizationType[] = [
  'PRIVATE_ENTERPRISE',
  'EDUCATION',
  'RESEARCH_ORGANIZATION',
  'OTHER',
  'UNKNOWN',
];

describe('NIS2 public-body and group-scope safeguards', () => {
  it.each(nonPublicOrganizationTypes)(
    'never treats %s plus a public-administration sector as central administration',
    (organizationType) => {
      const result = evaluateNis2({
        ...microAnswers,
        organizationType,
        sector: 'PUBLIC_ADMINISTRATION',
      });

      expect(result.reasonCodes).not.toContain('PUBLIC_ADMIN_CENTRAL');
      expect(result.reasonCodes).not.toContain('PUBLIC_ADMIN_LOCAL');
      expect(result.entityCategory).not.toBe('LIKELY_ESSENTIAL');
    },
  );

  it('preserves central-state and municipal public-body behavior', () => {
    const central = evaluateNis2({
      ...microAnswers,
      organizationType: 'STATE_ADMINISTRATION',
      sector: 'FOOD',
    });
    const municipality = evaluateNis2({
      ...microAnswers,
      organizationType: 'MUNICIPALITY',
      sector: 'PUBLIC_ADMINISTRATION',
    });

    expect(central).toEqual(expect.objectContaining({
      scopeResult: 'LIKELY_IN_SCOPE',
      entityCategory: 'LIKELY_ESSENTIAL',
      annexClass: 'PUBLIC_ADMINISTRATION',
      reasonCodes: ['PUBLIC_ADMIN_CENTRAL'],
    }));
    expect(municipality).toEqual(expect.objectContaining({
      scopeResult: 'POSSIBLY_IN_SCOPE',
      entityCategory: 'UNDETERMINED',
      annexClass: 'PUBLIC_ADMINISTRATION',
      reasonCodes: ['PUBLIC_ADMIN_LOCAL'],
    }));
  });

  it.each(['YES', 'UNKNOWN'] as const)(
    'keeps a %s-group micro entity in an unlisted sector outside standard scope',
    (groupStatus) => {
      const result = evaluateNis2({ ...microAnswers, groupStatus });

      expect(result).toEqual(expect.objectContaining({
        scopeResult: 'LIKELY_OUTSIDE_STANDARD_SCOPE',
        entityCategory: 'NOT_APPLICABLE',
        annexClass: 'NOT_LISTED',
        requiresManualReview: false,
      }));
      expect(result.reasonCodes).toContain('SECTOR_NOT_LISTED');
      expect(result.reasonCodes).not.toContain('GROUP_LINKED_ENTERPRISES');
      expect(result.reasonCodes).not.toContain('GROUP_STATUS_UNKNOWN');
    },
  );

  it('still widens an Annex I micro entity whose only exclusion is its standalone size', () => {
    const result = evaluateNis2({
      ...microAnswers,
      sector: 'ENERGY',
      groupStatus: 'YES',
    });

    expect(result).toEqual(expect.objectContaining({
      scopeResult: 'POSSIBLY_IN_SCOPE',
      entityCategory: 'UNDETERMINED',
      annexClass: 'ANNEX_I',
      requiresManualReview: true,
    }));
    expect(result.reasonCodes).toContain('GROUP_LINKED_ENTERPRISES');
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
