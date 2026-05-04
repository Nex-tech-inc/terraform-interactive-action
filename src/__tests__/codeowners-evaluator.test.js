const {
  parseCodeowners,
  getRequiredOwners,
  matchesCodeownersPattern,
  isProjectApproved,
} = require('../codeowners-evaluator')

const CODEOWNERS_CONTENT = `
# Global fallback
* @global-team

# Network infra — owned by network team
/infra/network/ @network-team @network-lead

# App infra — owned by app team
/infra/app/ @app-team
`

describe('parseCodeowners', () => {
  test('parses rules, ignoring comments and blank lines', () => {
    const rules = parseCodeowners(CODEOWNERS_CONTENT)
    expect(rules).toHaveLength(3)
  })

  test('stores pattern and lowercase owners', () => {
    const rules = parseCodeowners('* @Global-Team')
    expect(rules[0]).toEqual({ pattern: '*', owners: ['@global-team'] })
  })

  test('handles multiple owners on a single rule', () => {
    const rules = parseCodeowners('/infra/network/ @network-team @network-lead')
    expect(rules[0].owners).toEqual(['@network-team', '@network-lead'])
  })

  test('returns empty array for empty content', () => {
    expect(parseCodeowners('')).toEqual([])
    expect(parseCodeowners('# only comments\n')).toEqual([])
  })
})

describe('matchesCodeownersPattern', () => {
  test('matches a rooted pattern against a deep file path', () => {
    expect(matchesCodeownersPattern('infra/network/prod/main.tf', '/infra/network/')).toBe(true)
  })

  test('matches a bare filename pattern anywhere', () => {
    expect(matchesCodeownersPattern('src/utils/helper.js', '*.js')).toBe(true)
  })

  test('does not match a sibling path', () => {
    expect(matchesCodeownersPattern('infra/app/staging/main.tf', '/infra/network/')).toBe(false)
  })

  test('wildcard * matches any file', () => {
    expect(matchesCodeownersPattern('modules/vpc/main.tf', '*')).toBe(true)
  })
})

describe('getRequiredOwners', () => {
  const rules = parseCodeowners(CODEOWNERS_CONTENT)

  test('last matching rule wins (specific before global)', () => {
    const owners = getRequiredOwners(rules, 'infra/network/prod/main.tf')
    expect(owners).toEqual(['@network-team', '@network-lead'])
  })

  test('falls back to global rule when no specific rule matches', () => {
    const owners = getRequiredOwners(rules, 'modules/vpc/main.tf')
    expect(owners).toEqual(['@global-team'])
  })

  test('returns empty array when no rule matches at all', () => {
    const owners = getRequiredOwners([], 'modules/vpc/main.tf')
    expect(owners).toEqual([])
  })
})

describe('isProjectApproved', () => {
  const codeowners = '/infra/network/ @network-team\n'

  test('approved when a required owner has approved', () => {
    const result = isProjectApproved(
      ['infra/network/prod/main.tf'],
      codeowners,
      ['network-team']
    )
    expect(result.approved).toBe(true)
    expect(result.blockedFiles).toHaveLength(0)
  })

  test('blocked when required owner has NOT approved', () => {
    const result = isProjectApproved(
      ['infra/network/prod/main.tf'],
      codeowners,
      ['some-other-user']
    )
    expect(result.approved).toBe(false)
    expect(result.blockedFiles).toHaveLength(1)
    expect(result.blockedFiles[0].file).toBe('infra/network/prod/main.tf')
  })

  test('approved when no CODEOWNERS rule covers the files', () => {
    const result = isProjectApproved(['infra/network/prod/main.tf'], '', [])
    expect(result.approved).toBe(true)
  })

  test('approved when the approver login matches without @ prefix', () => {
    const result = isProjectApproved(
      ['infra/network/prod/main.tf'],
      '/infra/network/ @network-team\n',
      ['Network-Team'] // case-insensitive match
    )
    expect(result.approved).toBe(true)
  })

  test('considers all files: blocked if any file is uncovered', () => {
    const multiOwner = '/infra/network/ @network-team\n/infra/app/ @app-team\n'
    const result = isProjectApproved(
      ['infra/network/prod/main.tf', 'infra/app/staging/main.tf'],
      multiOwner,
      ['network-team'] // app-team not present
    )
    expect(result.approved).toBe(false)
    expect(result.blockedFiles.map((b) => b.file)).toContain('infra/app/staging/main.tf')
  })
})
