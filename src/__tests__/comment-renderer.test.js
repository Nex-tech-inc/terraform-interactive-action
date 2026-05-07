const {
  renderPlanQueued,
  renderApplyBlocked,
  renderApplyQueued,
  renderApplySuccess,
  renderNoChangedProjects,
  renderUnknownProject,
  renderCommandError,
  renderConfigError,
  renderPlanShow,
  renderApplyFailed,
  renderLockBlocked,
  renderUnlockResult,
  renderLockMismatch,
} = require('../comment-renderer')

const PROJECT = { name: 'network-prod' }

describe('renderPlanQueued', () => {
  test('includes project name in backticks', () => {
    expect(renderPlanQueued([PROJECT])).toContain('`network-prod`')
  })
  test('mentions Plan', () => {
    expect(renderPlanQueued([PROJECT])).toMatch(/[Pp]lan/)
  })
  test('lists multiple project names', () => {
    const out = renderPlanQueued([PROJECT, { name: 'app-staging' }])
    expect(out).toContain('`network-prod`')
    expect(out).toContain('`app-staging`')
  })
})

describe('renderApplyBlocked', () => {
  test('says Blocked', () => {
    expect(renderApplyBlocked([{ project: PROJECT, reason: 'Missing @network-team' }])).toMatch(/[Bb]locked/)
  })
  test('includes the project name and reason', () => {
    const out = renderApplyBlocked([{ project: PROJECT, reason: 'Missing @network-team' }])
    expect(out).toContain('network-prod')
    expect(out).toContain('Missing @network-team')
  })
})

describe('renderApplyQueued', () => {
  test('includes project name and Apply', () => {
    const out = renderApplyQueued([PROJECT])
    expect(out).toContain('`network-prod`')
    expect(out).toMatch(/[Aa]pply/)
  })
})

describe('renderApplySuccess', () => {
  test('mentions the requester with @', () => {
    expect(renderApplySuccess([PROJECT], 'alice')).toContain('@alice')
  })
  test('mentions merged or merge', () => {
    expect(renderApplySuccess([PROJECT], 'alice')).toMatch(/merg/i)
  })
})

describe('renderNoChangedProjects', () => {
  test('mentions .terraform-deployment', () => {
    expect(renderNoChangedProjects()).toContain('.terraform-deployment')
  })
})

describe('renderUnknownProject', () => {
  test('includes the unknown name', () => {
    expect(renderUnknownProject('bad-name')).toContain('bad-name')
  })
})

describe('renderCommandError', () => {
  test('includes the error message', () => {
    expect(renderCommandError('bad command')).toContain('bad command')
  })
  test('lists supported /tf commands', () => {
    expect(renderCommandError('x')).toContain('/tf plan')
    expect(renderCommandError('x')).toContain('/tf apply')
  })
})

describe('renderConfigError', () => {
  test('includes the error message', () => {
    expect(renderConfigError('version must be 1')).toContain('version must be 1')
  })
})


describe('renderApplyFailed', () => {
  test('includes project name and error', () => {
    const out = renderApplyFailed('network-prod', 'timeout error')
    expect(out).toContain('network-prod')
    expect(out).toContain('timeout error')
  })
  test('says the PR will not be merged', () => {
    expect(renderApplyFailed('x', 'err')).toMatch(/not be merged/i)
  })
})

describe('renderLockBlocked', () => {
  test('includes project name, PR number, locker, and timestamp', () => {
    const result = renderLockBlocked('s3-bucket', 42, 'alice', '2026-05-04T18:00:00Z')
    expect(result).toContain('s3-bucket')
    expect(result).toContain('#42')
    expect(result).toContain('@alice')
    expect(result).toContain('2026-05-04T18:00:00Z')
    expect(result).toContain('/tf unlock')
  })
})

describe('renderUnlockResult', () => {
  test('lists released projects and commenter', () => {
    const result = renderUnlockResult(['s3-bucket', 'vpc'], 'bob')
    expect(result).toContain('s3-bucket')
    expect(result).toContain('vpc')
    expect(result).toContain('@bob')
  })

  test('handles empty list (nothing to unlock)', () => {
    const result = renderUnlockResult([], 'bob')
    expect(result).toContain('No active locks')
  })
})

describe('renderLockMismatch', () => {
  test('includes project name and run /tf plan instruction', () => {
    const result = renderLockMismatch('s3-bucket')
    expect(result).toContain('s3-bucket')
    expect(result).toContain('/tf plan')
  })
})
