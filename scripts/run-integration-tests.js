const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { Client } = require('pg')

const CONNECTION_TIMEOUT_MS = 3_000

const buildTestEnvironment = (sourceEnv) => {
  const env = {
    ...sourceEnv,
    TEST_TYPE: 'integration:http',
    STRIPE_API_KEY:
      sourceEnv.STRIPE_API_KEY || 'integration-test-placeholder',
  }

  if (!env.NODE_OPTIONS?.includes('--experimental-vm-modules')) {
    env.NODE_OPTIONS = [env.NODE_OPTIONS, '--experimental-vm-modules']
      .filter(Boolean)
      .join(' ')
  }

  return env
}

const candidateUsernames = (env, currentUsername) =>
  [...new Set([env.PGUSER, currentUsername(), 'postgres'])].filter(
    (username) => typeof username === 'string' && username.length > 0,
  )

const probeDatabaseUser = async (username, env) => {
  const client = new Client({
    host: env.DB_HOST || 'localhost',
    port: Number.parseInt(env.DB_PORT || '5432', 10),
    user: username,
    password: env.DB_PASSWORD || '',
    database: 'postgres',
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
  })
  let connected = false

  try {
    await client.connect()
    connected = true
    const result = await client.query(
      'select rolcreatedb or rolsuper as can_create_database from pg_roles where rolname = current_user',
    )
    return result.rows[0]?.can_create_database === true
  } catch {
    return false
  } finally {
    if (connected) {
      await client.end().catch(() => undefined)
    }
  }
}

const resolveDatabaseUsername = async (
  env,
  {
    currentUsername = () => os.userInfo().username,
    probe = probeDatabaseUser,
  } = {},
) => {
  if (env.DB_USERNAME) {
    return env.DB_USERNAME
  }

  for (const username of candidateUsernames(env, currentUsername)) {
    if (await probe(username, env)) {
      return username
    }
  }

  throw new Error(
    'Integration-test PostgreSQL preflight failed. Set DB_USERNAME (and DB_PASSWORD when required) to a PostgreSQL role that can create test databases.',
  )
}

const run = async () => {
  const env = buildTestEnvironment(process.env)
  env.DB_USERNAME = await resolveDatabaseUsername(env)

  const jestBin = path.resolve(__dirname, '../node_modules/jest/bin/jest.js')
  const child = spawn(process.execPath, [jestBin, ...process.argv.slice(2)], {
    env,
    stdio: 'inherit',
  })

  child.once('error', (error) => {
    console.error(`[integration-test runner] ${error.message}`)
    process.exitCode = 1
  })
  child.once('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal)
      return
    }
    process.exitCode = code ?? 1
  })
}

if (require.main === module) {
  run().catch((error) => {
    console.error(`[integration-test preflight] ${error.message}`)
    process.exitCode = 1
  })
}

module.exports = {
  buildTestEnvironment,
  candidateUsernames,
  probeDatabaseUser,
  resolveDatabaseUsername,
}
