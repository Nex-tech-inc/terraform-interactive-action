const { validateConfig, resolveProject, mergeWithDefaults } = require('../config-loader')

const VALID_CONFIG = {
  version: 1,
  defaults: {
    terraform_version: '1.9.0',
    aws_region: 'us-east-1',
    backend: {
      bucket: 'org-terraform-state',
      dynamodb_table: 'terraform-locks',
    },
    policies: { require_apply_before_merge: true },
  },
  projects: [
    {
      name: 'network-prod',
      dir: 'infra/network/prod',
      when_modified: ['infra/network/**', 'modules/vpc/**'],
      workspace: 'prod',
      backend: { key: 'network/prod.tfstate' },
      deploy: {
        role_arn: 'arn:aws:iam::111111111111:role/github-terraform-prod',
        account_id: '111111111111',
        aws_region: 'us-east-1',
      },
    },
  ],
}

describe('validateConfig', () => {
  test('accepts a valid config without throwing', () => {
    expect(() => validateConfig(VALID_CONFIG)).not.toThrow()
  })

  test('rejects null or non-object config', () => {
    expect(() => validateConfig(null)).toThrow(/must be a YAML object/)
    expect(() => validateConfig('string')).toThrow(/must be a YAML object/)
  })

  test('rejects version other than 1', () => {
    expect(() => validateConfig({ ...VALID_CONFIG, version: 2 })).toThrow(/version must be 1/)
  })

  test('rejects missing projects array', () => {
    expect(() => validateConfig({ version: 1 })).toThrow(/at least one project/)
    expect(() => validateConfig({ version: 1, projects: [] })).toThrow(/at least one project/)
  })

  test('rejects project missing a name', () => {
    const cfg = {
      version: 1,
      projects: [{ dir: 'x', deploy: { role_arn: 'arn:aws:iam::111:role/tf' }, backend: { key: 'k' } }],
    }
    expect(() => validateConfig(cfg)).toThrow(/must have a name/)
  })

  test('rejects project missing a dir', () => {
    const cfg = {
      version: 1,
      projects: [{ name: 'x', deploy: { role_arn: 'arn:aws:iam::111:role/tf' }, backend: { key: 'k' } }],
    }
    expect(() => validateConfig(cfg)).toThrow(/must have a dir/)
  })

  test('rejects project missing deploy.role_arn', () => {
    const cfg = {
      version: 1,
      projects: [{ name: 'x', dir: 'infra/x', backend: { key: 'k' }, deploy: {} }],
    }
    expect(() => validateConfig(cfg)).toThrow(/deploy.role_arn/)
  })

  test('rejects project missing backend key when no default key exists', () => {
    const cfg = {
      version: 1,
      projects: [{ name: 'x', dir: 'infra/x', backend: {}, deploy: { role_arn: 'arn:aws:iam::111:role/tf' } }],
    }
    expect(() => validateConfig(cfg)).toThrow(/backend.key/)
  })

  test('rejects duplicate project names', () => {
    const cfg = {
      version: 1,
      projects: [VALID_CONFIG.projects[0], { ...VALID_CONFIG.projects[0] }],
    }
    expect(() => validateConfig(cfg)).toThrow(/Duplicate project name/)
  })
})

describe('mergeWithDefaults', () => {
  const project = VALID_CONFIG.projects[0]
  const defaults = VALID_CONFIG.defaults

  test('inherits bucket and dynamodb_table from defaults', () => {
    const result = mergeWithDefaults(defaults, project)
    expect(result.backend.bucket).toBe('org-terraform-state')
    expect(result.backend.dynamodb_table).toBe('terraform-locks')
  })

  test('inherits terraform_version from defaults', () => {
    expect(mergeWithDefaults(defaults, project).terraform_version).toBe('1.9.0')
  })

  test('project workspace overrides default', () => {
    expect(mergeWithDefaults(defaults, project).workspace).toBe('prod')
  })

  test('defaults workspace to "default" when not specified', () => {
    const p = { ...project }
    delete p.workspace
    expect(mergeWithDefaults(defaults, p).workspace).toBe('default')
  })

  test('project-level deploy region overrides default', () => {
    const p = { ...project, deploy: { ...project.deploy, aws_region: 'eu-west-1' } }
    expect(mergeWithDefaults(defaults, p).deploy.aws_region).toBe('eu-west-1')
  })

  test('falls back to defaults aws_region for deploy when project does not specify', () => {
    const p = { ...project, deploy: { role_arn: project.deploy.role_arn } }
    expect(mergeWithDefaults(defaults, p).deploy.aws_region).toBe('us-east-1')
  })

  test('inherits policies.require_apply_before_merge from defaults', () => {
    expect(mergeWithDefaults(defaults, project).policies.require_apply_before_merge).toBe(true)
  })

  test('autoplan.enabled defaults to true when not specified', () => {
    const testProject = {
      name: 'network-prod',
      dir: 'infra/network/prod',
      backend: { key: 'network/prod.tfstate' },
      deploy: { role_arn: 'arn:aws:iam::111:role/tf', aws_region: 'us-east-1' },
    }
    const result = mergeWithDefaults({}, testProject)
    expect(result.autoplan).toEqual({ enabled: true })
  })

  test('autoplan.enabled is false when explicitly set to false', () => {
    const testProject = {
      name: 'network-prod',
      dir: 'infra/network/prod',
      autoplan: { enabled: false },
      backend: { key: 'network/prod.tfstate' },
      deploy: { role_arn: 'arn:aws:iam::111:role/tf', aws_region: 'us-east-1' },
    }
    const result = mergeWithDefaults({}, testProject)
    expect(result.autoplan).toEqual({ enabled: false })
  })

  test('autoplan.enabled is true when explicitly set to true', () => {
    const testProject = {
      name: 'network-prod',
      dir: 'infra/network/prod',
      autoplan: { enabled: true },
      backend: { key: 'network/prod.tfstate' },
      deploy: { role_arn: 'arn:aws:iam::111:role/tf', aws_region: 'us-east-1' },
    }
    const result = mergeWithDefaults({}, testProject)
    expect(result.autoplan).toEqual({ enabled: true })
  })
})

describe('resolveProject', () => {
  test('returns a merged project object by name', () => {
    const result = resolveProject(VALID_CONFIG, 'network-prod')
    expect(result).not.toBeNull()
    expect(result.name).toBe('network-prod')
    expect(result.backend.bucket).toBe('org-terraform-state')
  })

  test('returns null for an unknown project name', () => {
    expect(resolveProject(VALID_CONFIG, 'does-not-exist')).toBeNull()
  })
})
