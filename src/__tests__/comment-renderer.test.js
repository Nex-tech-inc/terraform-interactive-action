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

describe('renderPlanShow', () => {
  test('includes project name and plan summary in a code block', () => {
    const out = renderPlanShow('network-prod', '1 to add, 0 to change, 0 to destroy')
    expect(out).toContain('network-prod')
    expect(out).toContain('1 to add')
    expect(out).toContain('```')
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
