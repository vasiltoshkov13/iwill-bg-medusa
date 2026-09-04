import {
  CONTRACT_VERSION,
  ContractError,
  canonicalDigest,
  parseV1Request,
  publicError,
} from '../contract';
import {
  ALL_SECTOR_IDS,
  ASSETS_BUCKETS,
  EMPLOYEE_BUCKETS,
  INFRASTRUCTURE_NEEDS,
  ORGANIZATION_TYPES,
  SPECIAL_CONDITIONS,
  TURNOVER_BUCKETS,
} from '../../../../modules/nis2/rules/sectors';
import { RULES_VERSION } from '../../../../modules/nis2/rules/constants';

const VALID_KEY = '5d9cac03-85c8-44a9-a218-b427a42de85e';

describe('NIS2-CAMPAIGN-CONTRACT 1.0.0 common API contract', () => {
  it('pins the shared rule version and every contract enum exported by the rule engine', () => {
    const ids = (values: Array<{ id: unknown }>) => values.map(({ id }) => String(id));

    expect(RULES_VERSION).toBe('BG-NIS2-2026-08-v1');
    expect(ids(ORGANIZATION_TYPES)).toEqual([
      'PRIVATE_ENTERPRISE', 'STATE_ADMINISTRATION', 'MUNICIPALITY', 'EDUCATION',
      'RESEARCH_ORGANIZATION', 'OTHER', 'UNKNOWN',
    ]);
    expect(ids(EMPLOYEE_BUCKETS)).toEqual(['E_1_9', 'E_10_49', 'E_50_249', 'E_250_PLUS', 'UNKNOWN']);
    expect(ids(TURNOVER_BUCKETS)).toEqual(['T_LE_2M', 'T_2_10M', 'T_10_50M', 'T_GT_50M', 'UNKNOWN']);
    expect(ids(ASSETS_BUCKETS)).toEqual(['A_LE_2M', 'A_2_10M', 'A_10_43M', 'A_GT_43M', 'UNKNOWN']);
    expect(new Set(ALL_SECTOR_IDS)).toEqual(new Set([
      'ENERGY', 'TRANSPORT', 'BANKING', 'FINANCIAL_MARKET_INFRASTRUCTURE', 'HEALTH',
      'DRINKING_WATER', 'WASTE_WATER', 'DIGITAL_INFRASTRUCTURE', 'ICT_SERVICE_MANAGEMENT',
      'PUBLIC_ADMINISTRATION', 'SPACE', 'POSTAL_COURIER', 'WASTE_MANAGEMENT', 'CHEMICALS',
      'FOOD', 'MANUFACTURING_MEDICAL_DEVICES', 'MANUFACTURING_COMPUTER_ELECTRONIC_OPTICAL',
      'MANUFACTURING_ELECTRICAL_EQUIPMENT', 'MANUFACTURING_MACHINERY',
      'MANUFACTURING_MOTOR_VEHICLES', 'MANUFACTURING_OTHER_TRANSPORT', 'DIGITAL_PROVIDERS',
      'RESEARCH', 'NOT_LISTED', 'UNKNOWN',
    ]));
    expect(ids(SPECIAL_CONDITIONS)).toEqual([
      'PUBLIC_ELECTRONIC_COMMUNICATIONS', 'QUALIFIED_TRUST_SERVICE_PROVIDER',
      'DNS_SERVICE_PROVIDER', 'TLD_NAME_REGISTRY', 'CRITICAL_ENTITY_CER',
      'SOLE_PROVIDER_ESSENTIAL_SERVICE', 'SIGNIFICANT_PUBLIC_IMPACT',
      'DESIGNATED_BY_AUTHORITY', 'NONE', 'UNKNOWN',
    ]);
    expect(ids(INFRASTRUCTURE_NEEDS)).toEqual([
      'CORPORATE_NETWORK_FIREWALL_VPN', 'NETWORK_SEGMENTATION_VLAN',
      'PRODUCTION_HMI_TOUCH_PANEL', 'SCADA_OT', 'INDUSTRIAL_EDGE_COMPUTING',
      'SECURE_REMOTE_ACCESS', 'BACKUP_BUSINESS_CONTINUITY', 'MONITORING_LOGGING',
      'LEGACY_WORKSTATION_REPLACEMENT', 'NEW_PRODUCTION_LINE',
      'NOT_SURE_WANT_CONSULTATION',
    ]);
  });

  it('accepts the versioned JSON request and canonical UUID v4 idempotency key', () => {
    expect(
      parseV1Request(
        {
          'content-type': 'application/json; charset=utf-8',
          'x-nis2-contract-version': CONTRACT_VERSION,
          'idempotency-key': VALID_KEY,
        },
        { hello: 'world' },
      ),
    ).toEqual({ idempotencyKey: VALID_KEY, contractVersion: CONTRACT_VERSION });
  });

  it.each([
    [{ 'content-type': 'application/json', 'x-nis2-contract-version': CONTRACT_VERSION }, 'MISSING_IDEMPOTENCY_KEY', 400],
    [
      {
        'content-type': 'application/json',
        'x-nis2-contract-version': CONTRACT_VERSION,
        'idempotency-key': 'NOT-A-UUID',
      },
      'INVALID_IDEMPOTENCY_KEY',
      400,
    ],
    [
      {
        'content-type': 'application/json',
        'x-nis2-contract-version': '2.0.0',
        'idempotency-key': VALID_KEY,
      },
      'UNSUPPORTED_CONTRACT_VERSION',
      426,
    ],
    [
      {
        'content-type': 'text/plain',
        'x-nis2-contract-version': CONTRACT_VERSION,
        'idempotency-key': VALID_KEY,
      },
      'UNSUPPORTED_MEDIA_TYPE',
      415,
    ],
  ])('rejects an invalid common request without reflecting input', (headers, code, status) => {
    expect(() => parseV1Request(headers, {})).toThrow(
      expect.objectContaining({ code, status }),
    );
  });

  it('rejects a payload over 16 KiB', () => {
    expect(() =>
      parseV1Request(
        {
          'content-type': 'application/json',
          'x-nis2-contract-version': CONTRACT_VERSION,
          'idempotency-key': VALID_KEY,
        },
        { value: 'x'.repeat(16 * 1024) },
      ),
    ).toThrow(expect.objectContaining({ code: 'PAYLOAD_TOO_LARGE', status: 413 }));
  });

  it('produces the same keyed canonical digest regardless of object-key order', () => {
    const secret = 'unit-test-secret-with-sufficient-entropy';
    expect(canonicalDigest({ b: 2, a: { d: 4, c: 3 } }, secret)).toEqual(
      canonicalDigest({ a: { c: 3, d: 4 }, b: 2 }, secret),
    );
  });

  it('returns a Bulgarian error envelope without submitted PII', () => {
    const response = publicError(
      new ContractError('VALIDATION_FAILED', 400, false, 'email'),
      'req-safe-1',
    );
    const serialized = JSON.stringify(response);

    expect(response).toEqual({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Моля, проверете отбелязаните полета.',
        retryable: false,
        field: 'email',
      },
      requestId: 'req-safe-1',
    });
    expect(serialized).not.toContain('person@example.com');
  });
});
