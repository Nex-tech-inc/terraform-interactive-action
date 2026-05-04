const {
  buildPlanPayload,
  buildApplyPayload,
  buildBlockedPayload,
} = require('../execution-payload')

const RESOLVED_PROJECT = {
  name: 'network-prod',
  dir: 'infra/network/prod',
  workspace: 'default',
  terraform_version: '1.9.0',
  backend: {
    bucket: 'org-terraform-state',
    key: 'network/prod.tfstate',
    region: 'us-east-1',
    dynamodb_table: 'terraform-locks',
  },
  deploy: {
    role_arn: 'arn:aws:iam::111111111111:role/github-terraform-prod',
    account_id: '111111111111',
    aws_region: 'us-east-1',
  },
}

describe('buildPlanPayload', () => {
  test('produces a flat payload with all required fields', () => {
    const [payload] = buildPlanPayload([RESOLVED_PROJECT])
    expect(payload).toEqual({
      name: 'network-prod',
      dir: 'infra/network/prod',
      workspace: 'default',
      terraform_version: '1.9.0',
      backend_bucket: 'org-terraform-state',
      backend_key: 'network/prod.tfstate',
      backend_region: 'us-east-1',
      backend_dynamodb_table: 'terraform-locks',
      role_arn: 'arn:aws:iam::111111111111:role/github-terraform-prod',
      aws_region: 'us-east-1',
    })
  })

  test('handles empty dynamodb_table as empty string', () => {
    const project = {
      ...RESOLVED_PROJECT,
      backend: { ...RESOLVED_PROJECT.backend, dynamodb_table: '' },
    }
    const [payload] = buildPlanPayload([project])
    expect(payload.backend_dynamodb_table).toBe('')
  })

  test('returns one entry per project', () => {
    const results = buildPlanPayload([RESOLVED_PROJECT, { ...RESOLVED_PROJECT, name: 'app-staging' }])
    expect(results).toHaveLength(2)
  })
})

describe('buildApplyPayload', () => {
  test('returns the same shape as buildPlanPayload', () => {
    expect(buildApplyPayload([RESOLVED_PROJECT])).toEqual(buildPlanPayload([RESOLVED_PROJECT]))
  })
})

describe('buildBlockedPayload', () => {
  test('returns name and reason for each blocked project', () => {
    const result = buildBlockedPayload([
      { project: RESOLVED_PROJECT, reason: 'Missing approval from @network-team' },
    ])
    expect(result).toEqual([
      { name: 'network-prod', reason: 'Missing approval from @network-team' },
    ])
  })

  test('returns one entry per blocked project', () => {
    const blocked = [
      { project: RESOLVED_PROJECT, reason: 'reason A' },
      { project: { ...RESOLVED_PROJECT, name: 'app-staging' }, reason: 'reason B' },
    ]
    expect(buildBlockedPayload(blocked)).toHaveLength(2)
  })
})
