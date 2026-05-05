// Mock @actions/core and @actions/github before requiring main.js
const mockSetOutput = jest.fn()
const mockSetFailed = jest.fn()
const mockGetInput = jest.fn()
const mockCreateComment = jest.fn().mockResolvedValue({})
const mockGetOctokit = jest.fn()

jest.mock('@actions/core', () => ({
  getInput: mockGetInput,
  setOutput: mockSetOutput,
  setFailed: mockSetFailed,
}))
jest.mock('@actions/github', () => ({
  getOctokit: mockGetOctokit,
  context: { repo: { owner: 'my-org', repo: 'my-repo' } },
}))

// Helper: build a minimal valid .terraform-deployment content for use with loadConfig
const fs = require('fs')
const path = require('path')
const os = require('os')
const yaml = require('js-yaml')

function writeTempConfig(config) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-action-test-'))
  const configPath = path.join(dir, '.terraform-deployment')
  fs.writeFileSync(configPath, yaml.dump(config))
  return configPath
}

const VALID_CONFIG = {
  version: 1,
  defaults: {
    terraform_version: '1.9.0',
    aws_region: 'us-east-1',
    backend: { bucket: 'my-bucket', dynamodb_table: 'my-lock' },
  },
  projects: [
    {
      name: 'network-prod',
      dir: 'infra/network/prod',
      when_modified: ['infra/network/**'],
      backend: { key: 'network/prod.tfstate' },
      deploy: { role_arn: 'arn:aws:iam::111:role/tf', aws_region: 'us-east-1' },
    },
    {
      name: 'app-staging',
      dir: 'infra/app/staging',
      when_modified: ['infra/app/**'],
      backend: { key: 'app/staging.tfstate' },
      deploy: { role_arn: 'arn:aws:iam::222:role/tf', aws_region: 'us-east-1' },
    },
  ],
}

function buildInputs(overrides = {}) {
  const defaults = {
    'github-token': 'fake-token',
    'config-path': writeTempConfig(VALID_CONFIG),
    'comment-body': '/tf plan',
    'pr-number': '42',
    'head-sha': 'abc123',
    'changed-files': JSON.stringify(['infra/network/prod/main.tf']),
    'codeowners-content': '',
    'approved-reviewers': '[]',
    commenter: 'alice',
  }
  return { ...defaults, ...overrides }
}

function setupMocks(inputs) {
  mockGetInput.mockImplementation((key) => inputs[key] ?? '')
  mockGetOctokit.mockReturnValue({
    rest: {
      issues: { createComment: mockCreateComment },
    },
  })
}

beforeEach(() => {
  jest.resetModules()
  jest.clearAllMocks()
})

describe('main.js orchestration', () => {
  test('/tf plan with changed files queues plan and sets action=plan output', async () => {
    const inputs = buildInputs({
      'comment-body': '/tf plan',
      'changed-files': JSON.stringify(['infra/network/prod/main.tf']),
    })
    setupMocks(inputs)

    await require('../main')

    const actionOutput = mockSetOutput.mock.calls.find(([k]) => k === 'action')
    expect(actionOutput[1]).toBe('plan')

    const projectsOutput = mockSetOutput.mock.calls.find(([k]) => k === 'projects')
    const projects = JSON.parse(projectsOutput[1])
    expect(projects).toHaveLength(1)
    expect(projects[0].name).toBe('network-prod')

    expect(mockCreateComment).toHaveBeenCalledTimes(1)
    expect(mockCreateComment.mock.calls[0][0].body).toMatch(/Plan.*queued/i)
  })

  test('/tf plan <project> queues only the named project', async () => {
    const inputs = buildInputs({
      'comment-body': '/tf plan app-staging',
      'changed-files': JSON.stringify(['infra/network/prod/main.tf']), // different project changed
    })
    setupMocks(inputs)

    await require('../main')

    const projectsOutput = mockSetOutput.mock.calls.find(([k]) => k === 'projects')
    const projects = JSON.parse(projectsOutput[1])
    expect(projects).toHaveLength(1)
    expect(projects[0].name).toBe('app-staging')
  })

  test('/tf plan with no matching changed files posts no-projects comment and action=none', async () => {
    const inputs = buildInputs({
      'comment-body': '/tf plan',
      'changed-files': JSON.stringify(['README.md']),
    })
    setupMocks(inputs)

    await require('../main')

    const actionOutput = mockSetOutput.mock.calls.find(([k]) => k === 'action')
    expect(actionOutput[1]).toBe('none')
    expect(mockCreateComment.mock.calls[0][0].body).toMatch(/No matching Terraform projects/i)
  })

  test('/tf apply is blocked when CODEOWNERS approval is missing', async () => {
    const codeowners = '/infra/network/ @network-team\n'
    const inputs = buildInputs({
      'comment-body': '/tf apply',
      'changed-files': JSON.stringify(['infra/network/prod/main.tf']),
      'codeowners-content': codeowners,
      'approved-reviewers': JSON.stringify(['some-other-user']),
    })
    setupMocks(inputs)

    await require('../main')

    const actionOutput = mockSetOutput.mock.calls.find(([k]) => k === 'action')
    expect(actionOutput[1]).toBe('blocked')
    expect(mockCreateComment.mock.calls[0][0].body).toMatch(/Blocked/i)
    expect(mockCreateComment.mock.calls[0][0].body).toContain('network-prod')
  })

  test('/tf apply succeeds when all targeted projects are CODEOWNERS-approved', async () => {
    const codeowners = '/infra/network/ @network-team\n'
    const inputs = buildInputs({
      'comment-body': '/tf apply',
      'changed-files': JSON.stringify(['infra/network/prod/main.tf']),
      'codeowners-content': codeowners,
      'approved-reviewers': JSON.stringify(['network-team']),
    })
    setupMocks(inputs)

    await require('../main')

    const actionOutput = mockSetOutput.mock.calls.find(([k]) => k === 'action')
    expect(actionOutput[1]).toBe('apply')

    const projectsOutput = mockSetOutput.mock.calls.find(([k]) => k === 'projects')
    const projects = JSON.parse(projectsOutput[1])
    expect(projects[0].name).toBe('network-prod')
    expect(mockCreateComment.mock.calls[0][0].body).toMatch(/Apply.*queued/i)
  })

  test('/tf apply blocks the entire set when one of two projects is unapproved', async () => {
    const codeowners = '/infra/network/ @network-team\n/infra/app/ @app-team\n'
    const inputs = buildInputs({
      'comment-body': '/tf apply',
      'changed-files': JSON.stringify([
        'infra/network/prod/main.tf',
        'infra/app/staging/main.tf',
      ]),
      'codeowners-content': codeowners,
      'approved-reviewers': JSON.stringify(['network-team']), // app-team missing
    })
    setupMocks(inputs)

    await require('../main')

    const actionOutput = mockSetOutput.mock.calls.find(([k]) => k === 'action')
    expect(actionOutput[1]).toBe('blocked')

    const blockedOutput = mockSetOutput.mock.calls.find(([k]) => k === 'blocked-projects')
    const blocked = JSON.parse(blockedOutput[1])
    expect(blocked.map((b) => b.name)).toContain('app-staging')
    expect(blocked.map((b) => b.name)).not.toContain('network-prod')
  })

  test('unknown /tf command posts error comment and action=none', async () => {
    const inputs = buildInputs({ 'comment-body': '/tf destroy everything' })
    setupMocks(inputs)

    await require('../main')

    const actionOutput = mockSetOutput.mock.calls.find(([k]) => k === 'action')
    expect(actionOutput[1]).toBe('none')
    expect(mockCreateComment.mock.calls[0][0].body).toMatch(/Unrecognized command/i)
  })

  test('missing config file posts config error and action=none', async () => {
    const inputs = buildInputs({ 'config-path': '/tmp/does-not-exist/.terraform-deployment' })
    setupMocks(inputs)

    await require('../main')

    const actionOutput = mockSetOutput.mock.calls.find(([k]) => k === 'action')
    expect(actionOutput[1]).toBe('none')
    expect(mockCreateComment.mock.calls[0][0].body).toMatch(/Config Error/i)
  })

  test('unknown project name in /tf plan <project> posts unknown-project comment', async () => {
    const inputs = buildInputs({ 'comment-body': '/tf plan nonexistent-project' })
    setupMocks(inputs)

    await require('../main')

    const actionOutput = mockSetOutput.mock.calls.find(([k]) => k === 'action')
    expect(actionOutput[1]).toBe('none')
    expect(mockCreateComment.mock.calls[0][0].body).toMatch(/Unknown project/i)
    expect(mockCreateComment.mock.calls[0][0].body).toContain('nonexistent-project')
  })
})

describe('unlock command', () => {
  test('sets action=unlock and returns all config projects', async () => {
    const inputs = buildInputs({
      'comment-body': '/tf unlock',
      'changed-files': JSON.stringify(['README.md']), // no matching projects — doesn't matter for unlock
    })
    setupMocks(inputs)

    await require('../main')

    const actionOutput = mockSetOutput.mock.calls.find(([k]) => k === 'action')
    expect(actionOutput[1]).toBe('unlock')

    const projectsOutput = mockSetOutput.mock.calls.find(([k]) => k === 'projects')
    expect(projectsOutput).toBeDefined()
    const projects = JSON.parse(projectsOutput[1])
    expect(projects.some((p) => p.name === 'network-prod')).toBe(true)
    expect(projects.some((p) => p.name === 'app-staging')).toBe(true)

    // unlock should NOT post a comment (the workflow handles messaging)
    expect(mockCreateComment).not.toHaveBeenCalled()
  })

  test('/tf unlock <project> returns only the named project', async () => {
    const inputs = buildInputs({
      'comment-body': '/tf unlock app-staging',
      'changed-files': JSON.stringify(['README.md']),
    })
    setupMocks(inputs)

    await require('../main')

    const actionOutput = mockSetOutput.mock.calls.find(([k]) => k === 'action')
    expect(actionOutput[1]).toBe('unlock')

    const projectsOutput = mockSetOutput.mock.calls.find(([k]) => k === 'projects')
    const projects = JSON.parse(projectsOutput[1])
    expect(projects).toHaveLength(1)
    expect(projects[0].name).toBe('app-staging')
    expect(mockCreateComment).not.toHaveBeenCalled()
  })

  test('/tf unlock with unknown project posts unknown-project comment', async () => {
    const inputs = buildInputs({
      'comment-body': '/tf unlock nonexistent-project',
      'changed-files': JSON.stringify(['README.md']),
    })
    setupMocks(inputs)

    await require('../main')

    const actionOutput = mockSetOutput.mock.calls.find(([k]) => k === 'action')
    expect(actionOutput[1]).toBe('none')
    expect(mockCreateComment).toHaveBeenCalledTimes(1)
    expect(mockCreateComment.mock.calls[0][0].body).toMatch(/Unknown project/i)
  })
})

const AUTOPLAN_CONFIG = {
  version: 1,
  defaults: {
    terraform_version: '1.9.0',
    aws_region: 'us-east-1',
    backend: { bucket: 'my-bucket' },
  },
  projects: [
    {
      name: 'network-prod',
      dir: 'infra/network/prod',
      when_modified: ['infra/network/**'],
      backend: { key: 'network/prod.tfstate' },
      deploy: { role_arn: 'arn:aws:iam::111:role/tf', aws_region: 'us-east-1' },
    },
    {
      name: 'app-staging',
      dir: 'infra/app/staging',
      when_modified: ['infra/app/**'],
      backend: { key: 'app/staging.tfstate' },
      deploy: { role_arn: 'arn:aws:iam::222:role/tf', aws_region: 'us-east-1' },
      autoplan: { enabled: false },
    },
  ],
}

function buildAutoplanInputs(overrides = {}) {
  const defaults = {
    'github-token': 'fake-token',
    'config-path': writeTempConfig(AUTOPLAN_CONFIG),
    trigger: 'autoplan',
    'comment-body': '',
    'pr-number': '42',
    'head-sha': 'abc123',
    'changed-files': JSON.stringify(['infra/network/prod/main.tf']),
    'codeowners-content': '',
    'approved-reviewers': '[]',
    commenter: 'alice',
  }
  return { ...defaults, ...overrides }
}

describe('autoplan trigger', () => {
  test('outputs action=plan for changed projects with autoplan enabled', async () => {
    const inputs = buildAutoplanInputs()
    setupMocks(inputs)

    await require('../main')

    const actionOutput = mockSetOutput.mock.calls.find(([k]) => k === 'action')
    expect(actionOutput[1]).toBe('plan')
    const projectsOutput = mockSetOutput.mock.calls.find(([k]) => k === 'projects')
    const projects = JSON.parse(projectsOutput[1])
    expect(projects).toHaveLength(1)
    expect(projects[0].name).toBe('network-prod')
    expect(mockCreateComment).not.toHaveBeenCalled()
  })

  test('outputs action=none silently when no changed projects match', async () => {
    const inputs = buildAutoplanInputs({
      'changed-files': JSON.stringify(['README.md']),
    })
    setupMocks(inputs)

    await require('../main')

    const actionOutput = mockSetOutput.mock.calls.find(([k]) => k === 'action')
    expect(actionOutput[1]).toBe('none')
    expect(mockCreateComment).not.toHaveBeenCalled()
  })

  test('skips projects with autoplan.enabled=false', async () => {
    const inputs = buildAutoplanInputs({
      'changed-files': JSON.stringify(['infra/app/staging/main.tf']),
    })
    setupMocks(inputs)

    await require('../main')

    const actionOutput = mockSetOutput.mock.calls.find(([k]) => k === 'action')
    expect(actionOutput[1]).toBe('none')
    expect(mockCreateComment).not.toHaveBeenCalled()
  })
})
