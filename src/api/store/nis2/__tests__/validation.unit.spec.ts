import { ContractError } from '../contract';
import {
  EMPTY_CAMPAIGN_ALLOWLIST,
  loadCampaignAllowlist,
  loadMarketingNoticeVersion,
  parseLegacyAnswers,
  parseLegacyAttribution,
  parseLegacyInfrastructureNeeds,
  parseAssessmentBody,
  parseConsultationBody,
  parseLeadBody,
  qualificationFor,
} from '../validation';

const answers = {
  organizationType: 'PRIVATE_ENTERPRISE',
  sector: 'FOOD',
  subsector: null,
  employees: 'E_50_249',
  turnover: 'T_10_50M',
  assets: 'A_10_43M',
  groupStatus: 'NO',
  specialConditions: ['NONE'],
};

const attribution = {
  sessionId: '5d9cac03-85c8-44a9-a218-b427a42de85e',
  pagePath: '/nis2',
  referrerOrigin: 'https://example.com',
  utmSource: 'google',
  utmMedium: 'cpc',
  utmCampaign: 'nis2-bg',
  utmContent: null,
  utmTerm: null,
};

const allowlist = {
  sources: ['google'],
  media: ['cpc'],
  campaigns: ['nis2-bg'],
  contents: [],
  terms: [],
};

const leadBody = {
  assessmentId: null,
  name: ' Име ',
  companyName: ' Организация ',
  jobTitle: null,
  email: 'NAME@EXAMPLE.BG',
  phone: null,
  preferredContact: 'EMAIL',
  privacyConsent: true,
  privacyNoticeVersion: 'nis2-privacy-2026-09-08-93ba2f3d8256',
  marketingConsent: false,
  marketingNoticeVersion: null,
  wantsConsultation: false,
  answers,
  infrastructureNeeds: ['NETWORK_SEGMENTATION_VLAN'],
  attribution,
  company_website: '',
};

describe('NIS2-CAMPAIGN-CONTRACT 1.0.0 request validation', () => {
  it('parses a complete assessment and persists only allowlisted attribution', () => {
    expect(
      parseAssessmentBody(
        {
          answers,
          infrastructureNeeds: ['NETWORK_SEGMENTATION_VLAN'],
          attribution: { ...attribution, utmContent: 'unapproved' },
          company_website: '',
        },
        allowlist,
      ),
    ).toEqual(
      expect.objectContaining({
        answers,
        infrastructureNeeds: ['NETWORK_SEGMENTATION_VLAN'],
        attribution: expect.objectContaining({
          session_id: attribution.sessionId,
          page_path: '/nis2',
          referrer_origin: 'https://example.com',
          utm_source: 'google',
          utm_content: null,
        }),
      }),
    );
  });

  it('normalizes contact fields and enforces independent consent versions', () => {
    expect(parseLeadBody(leadBody, allowlist)).toEqual(
      expect.objectContaining({
        name: 'Име',
        company_name: 'Организация',
        email: 'name@example.bg',
        privacy_consent: true,
        privacy_notice_version: 'nis2-privacy-2026-09-08-93ba2f3d8256',
        marketing_consent: false,
        marketing_notice_version: null,
      }),
    );
  });

  it('accepts marketing consent only with the configured approved notice version', () => {
    process.env.NIS2_MARKETING_NOTICE_VERSION = 'approved-marketing-v1';
    try {
      expect(
        parseLeadBody(
          {
            ...leadBody,
            marketingConsent: true,
            marketingNoticeVersion: 'approved-marketing-v1',
          },
          allowlist,
        ),
      ).toEqual(
        expect.objectContaining({
          marketing_consent: true,
          marketing_notice_version: 'approved-marketing-v1',
        }),
      );
    } finally {
      delete process.env.NIS2_MARKETING_NOTICE_VERSION;
    }
  });

  it('trims enum strings before closed-enum validation', () => {
    const parsed = parseAssessmentBody({
      answers: { ...answers, organizationType: ' PRIVATE_ENTERPRISE ', groupStatus: ' NO ' },
      infrastructureNeeds: [' NETWORK_SEGMENTATION_VLAN '],
    });

    expect(parsed.answers.organizationType).toBe('PRIVATE_ENTERPRISE');
    expect(parsed.answers.groupStatus).toBe('NO');
    expect(parsed.infrastructureNeeds).toEqual(['NETWORK_SEGMENTATION_VLAN']);
  });

  it.each([
    'PRIVATE_ENTERPRISE',
    'EDUCATION',
    'RESEARCH_ORGANIZATION',
    'OTHER',
    'UNKNOWN',
  ])('accepts PUBLIC_ADMINISTRATION for non-public organization type %s', (organizationType) => {
    expect(parseAssessmentBody({
      answers: { ...answers, organizationType, sector: 'PUBLIC_ADMINISTRATION' },
      infrastructureNeeds: [],
    }).answers).toEqual(expect.objectContaining({ organizationType, sector: 'PUBLIC_ADMINISTRATION' }));
  });

  it.each(['STATE_ADMINISTRATION', 'MUNICIPALITY'])(
    'accepts PUBLIC_ADMINISTRATION for public-body organization type %s',
    (organizationType) => {
      expect(parseAssessmentBody({
        answers: { ...answers, organizationType, sector: 'PUBLIC_ADMINISTRATION' },
        infrastructureNeeds: [],
      }).answers).toEqual(expect.objectContaining({ organizationType, sector: 'PUBLIC_ADMINISTRATION' }));
    },
  );

  it.each([
    [{ ...leadBody, privacyConsent: false }, 'CONSENT_REQUIRED', 'privacyConsent'],
    [{ ...leadBody, privacyNoticeVersion: 'nis2-privacy-2026-09-04' }, 'VALIDATION_FAILED', 'privacyNoticeVersion'],
    [{ ...leadBody, privacyNoticeVersion: 'nis2-privacy-2026-09-08-5090901008de' }, 'VALIDATION_FAILED', 'privacyNoticeVersion'],
    [{ ...leadBody, privacyNoticeVersion: 'nis2-privacy-2026-09-08-93ba2f3d8256-changed' }, 'VALIDATION_FAILED', 'privacyNoticeVersion'],
    [{ ...leadBody, privacyNoticeVersion: ' nis2-privacy-2026-09-08-93ba2f3d8256 ' }, 'VALIDATION_FAILED', 'privacyNoticeVersion'],
    [{ ...leadBody, privacyNoticeVersion: 'nis2-privacy-unknown' }, 'VALIDATION_FAILED', 'privacyNoticeVersion'],
    [{ ...leadBody, privacyNoticeVersion: undefined }, 'VALIDATION_FAILED', 'privacyNoticeVersion'],
    [{ ...leadBody, marketingConsent: true, marketingNoticeVersion: null }, 'VALIDATION_FAILED', 'marketingNoticeVersion'],
    [{ ...leadBody, preferredContact: 'PHONE', phone: null }, 'VALIDATION_FAILED', 'phone'],
    [{ ...leadBody, phone: '12345' }, 'VALIDATION_FAILED', 'phone'],
    [{ ...leadBody, unexpected: 'person@example.bg' }, 'VALIDATION_FAILED', undefined],
    [{ ...leadBody, answers: { ...answers, unexpected: 'private-value' } }, 'VALIDATION_FAILED', 'answers'],
    [{ ...leadBody, answers: { ...answers, specialConditions: ['NONE', 'UNKNOWN'] } }, 'VALIDATION_FAILED', 'answers.specialConditions'],
    [{ ...leadBody, infrastructureNeeds: ['NETWORK_SEGMENTATION_VLAN', 'NETWORK_SEGMENTATION_VLAN'] }, 'VALIDATION_FAILED', 'infrastructureNeeds'],
  ])('rejects invalid lead data without reflecting submitted values', (body, code, field) => {
    expect(() => parseLeadBody(body, EMPTY_CAMPAIGN_ALLOWLIST)).toThrow(
      expect.objectContaining({ code, field }),
    );
  });

  it('treats the honeypot as a generic validation failure with no field', () => {
    expect(() => parseLeadBody({ ...leadBody, company_website: 'https://bot.invalid' }, allowlist)).toThrow(
      expect.objectContaining({ code: 'VALIDATION_FAILED', field: undefined }),
    );
  });

  it('rejects a whitespace-only honeypot on every v1 submission type', () => {
    const whitespace = ' \t\r\n ';

    expect(() => parseAssessmentBody({
      answers,
      infrastructureNeeds: [],
      company_website: whitespace,
    }, allowlist)).toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED', field: undefined }));
    expect(() => parseLeadBody({ ...leadBody, company_website: whitespace }, allowlist)).toThrow(
      expect.objectContaining({ code: 'VALIDATION_FAILED', field: undefined }),
    );
    expect(() => parseConsultationBody({
      leadId: 'nis2lead_01JTEST',
      attribution: {},
      company_website: whitespace,
    }, allowlist)).toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED', field: undefined }));
  });

  it('rejects a null honeypot and a non-object body without inventing field identifiers', () => {
    expect(() => parseLeadBody({ ...leadBody, company_website: null }, allowlist)).toThrow(
      expect.objectContaining({ code: 'VALIDATION_FAILED', field: 'company_website' }),
    );
    expect(() => parseAssessmentBody([])).toThrow(
      expect.objectContaining({ code: 'VALIDATION_FAILED', field: undefined }),
    );
  });

  it('keeps legacy request compatibility while reducing unsafe attribution', () => {
    expect(
      parseLegacyAnswers({
        ...answers,
        specialConditions: undefined,
        unexpected: 'ignored-for-compatibility',
      }).specialConditions,
    ).toEqual([]);
    expect(
      parseLegacyInfrastructureNeeds(['NETWORK_SEGMENTATION_VLAN', 'NETWORK_SEGMENTATION_VLAN']),
    ).toEqual(['NETWORK_SEGMENTATION_VLAN']);
    expect(
      parseLegacyAttribution(
        {
          sessionId: 'not-a-uuid',
          pagePath: '/nis2?private=value',
          referrer: 'https://example.com/private/path?email=person@example.bg',
          utmSource: 'unapproved',
        },
        allowlist,
      ),
    ).toEqual(
      expect.objectContaining({
        session_id: null,
        page_path: null,
        referrer: null,
        referrer_origin: 'https://example.com',
        utm_source: null,
      }),
    );
  });

  it('never reflects an attacker-controlled unknown field name', () => {
    const privateFieldName = 'person@example.bg';

    try {
      parseLeadBody({ ...leadBody, [privateFieldName]: 'private value' }, allowlist);
      throw new Error('Expected validation to fail.');
    } catch (error) {
      expect(error).toEqual(
        expect.objectContaining<Partial<ContractError>>({
          code: 'VALIDATION_FAILED',
          field: undefined,
        }),
      );
      expect(JSON.stringify(error)).not.toContain(privateFieldName);
    }
  });

  it('treats an invalid campaign allowlist as server configuration failure', () => {
    expect(() => loadCampaignAllowlist('{"sources":"not-an-array"}')).toThrow(
      'Invalid NIS2_CAMPAIGN_ALLOWLIST configuration.',
    );
    try {
      loadCampaignAllowlist('{"sources":"not-an-array"}');
    } catch (error) {
      expect(error).not.toBeInstanceOf(ContractError);
    }
    expect(() => loadMarketingNoticeVersion('Not valid!')).toThrow(
      'Invalid NIS2_MARKETING_NOTICE_VERSION configuration.',
    );
  });

  it.each([
    ['https://example.com/path', 'attribution.referrerOrigin'],
    ['https://user@example.com', 'attribution.referrerOrigin'],
    ['example.com', 'attribution.referrerOrigin'],
    ['NOT-A-UUID', 'attribution.sessionId'],
    ['/nis2?email=person@example.bg', 'attribution.pagePath'],
  ])('rejects unsafe attribution without returning its value', (value, field) => {
    const key = field.split('.')[1] as keyof typeof attribution;
    expect(() => parseAssessmentBody({ answers, infrastructureNeeds: [], attribution: { [key]: value } }, allowlist)).toThrow(
      expect.objectContaining({ code: 'VALIDATION_FAILED', field }),
    );
  });

  it('accepts a consultation only for a canonical lead id', () => {
    expect(parseConsultationBody({ leadId: 'nis2lead_01JTEST', attribution: {} }, allowlist)).toEqual(
      expect.objectContaining({ lead_id: 'nis2lead_01JTEST' }),
    );
    expect(() => parseConsultationBody({ leadId: 'lead-private@example.bg', attribution: {} }, allowlist)).toThrow(
      expect.objectContaining({ code: 'VALIDATION_FAILED', field: 'leadId' }),
    );
  });

  it.each([
    ['LIKELY_IN_SCOPE', ['NETWORK_SEGMENTATION_VLAN'], 'qualified'],
    ['MANUAL_REVIEW_REQUIRED', ['SCADA_OT'], 'qualified'],
    ['LIKELY_OUTSIDE_STANDARD_SCOPE', ['SCADA_OT'], 'unqualified'],
    ['LIKELY_IN_SCOPE', ['NOT_SURE_WANT_CONSULTATION'], 'unqualified'],
  ])('classifies %s with selected needs as %s', (scopeResult, needs, expected) => {
    expect(qualificationFor(scopeResult, needs)).toBe(expected);
  });
});
