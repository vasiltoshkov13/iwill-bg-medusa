const {
  buildTestEnvironment,
  resolveDatabaseUsername,
} = require('../../../scripts/run-integration-tests')

describe('integration-test database username resolution', () => {
  it('preserves an explicitly configured database username without probing', async () => {
    const probe = jest.fn()

    await expect(
      resolveDatabaseUsername(
        { DB_USERNAME: 'ci_database_user' },
        { currentUsername: () => 'local_user', probe },
      ),
    ).resolves.toBe('ci_database_user')
    expect(probe).not.toHaveBeenCalled()
  })

  it('selects the first local PostgreSQL role that accepts a connection', async () => {
    const probe = jest.fn(async (username) => username === 'local_user')

    await expect(
      resolveDatabaseUsername(
        { PGUSER: 'missing_pg_user' },
        { currentUsername: () => 'local_user', probe },
      ),
    ).resolves.toBe('local_user')
    expect(probe.mock.calls.map(([username]) => username)).toEqual([
      'missing_pg_user',
      'local_user',
    ])
  })

  it('falls back to the Medusa default postgres role when the OS role is unavailable', async () => {
    const probe = jest.fn(async (username) => username === 'postgres')

    await expect(
      resolveDatabaseUsername(
        {},
        { currentUsername: () => 'runner', probe },
      ),
    ).resolves.toBe('postgres')
    expect(probe.mock.calls.map(([username]) => username)).toEqual([
      'runner',
      'postgres',
    ])
  })

  it('fails fast with an actionable error when no candidate can connect', async () => {
    const probe = jest.fn(async () => false)

    await expect(
      resolveDatabaseUsername(
        {},
        { currentUsername: () => 'runner', probe },
      ),
    ).rejects.toThrow(
      'Set DB_USERNAME (and DB_PASSWORD when required) to a PostgreSQL role that can create test databases.',
    )
  })

  it('provides test-only runtime defaults without replacing explicit configuration', () => {
    expect(buildTestEnvironment({})).toEqual(
      expect.objectContaining({
        TEST_TYPE: 'integration:http',
        STRIPE_API_KEY: 'integration-test-placeholder',
        NODE_OPTIONS: '--experimental-vm-modules',
      }),
    )
    expect(
      buildTestEnvironment({
        STRIPE_API_KEY: 'configured-test-key',
        NODE_OPTIONS: '--trace-warnings --experimental-vm-modules',
      }),
    ).toEqual(
      expect.objectContaining({
        STRIPE_API_KEY: 'configured-test-key',
        NODE_OPTIONS: '--trace-warnings --experimental-vm-modules',
      }),
    )
  })
})
