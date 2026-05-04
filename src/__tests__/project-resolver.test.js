const {
  resolveChangedProjects,
  isProjectAffected,
  resolveExplicitProject,
} = require('../project-resolver')

const PROJECTS = [
  {
    name: 'network-prod',
    dir: 'infra/network/prod',
    when_modified: ['infra/network/**', 'modules/vpc/**'],
  },
  {
    name: 'app-staging',
    dir: 'infra/app/staging',
    when_modified: [],
  },
]

describe('isProjectAffected', () => {
  test('matches a file against a when_modified glob', () => {
    expect(isProjectAffected(['modules/vpc/main.tf'], PROJECTS[0])).toBe(true)
  })

  test('matches a file directly under the project dir glob', () => {
    expect(isProjectAffected(['infra/network/prod/variables.tf'], PROJECTS[0])).toBe(true)
  })

  test('does not match unrelated files', () => {
    expect(isProjectAffected(['infra/app/staging/main.tf'], PROJECTS[0])).toBe(false)
  })

  test('falls back to dir/** when when_modified is empty', () => {
    expect(isProjectAffected(['infra/app/staging/variables.tf'], PROJECTS[1])).toBe(true)
  })

  test('returns false for an empty changed-files list', () => {
    expect(isProjectAffected([], PROJECTS[0])).toBe(false)
  })

  test('does not match a sibling directory with similar prefix', () => {
    expect(isProjectAffected(['infra/app/staging-v2/main.tf'], PROJECTS[1])).toBe(false)
  })
})

describe('resolveChangedProjects', () => {
  test('returns all affected projects sorted alphabetically by name', () => {
    const changed = ['infra/app/staging/main.tf', 'modules/vpc/main.tf']
    const result = resolveChangedProjects(changed, PROJECTS)
    expect(result.map((p) => p.name)).toEqual(['app-staging', 'network-prod'])
  })

  test('returns only one project when only one is affected', () => {
    const result = resolveChangedProjects(['infra/app/staging/main.tf'], PROJECTS)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('app-staging')
  })

  test('returns empty array when no project is affected', () => {
    expect(resolveChangedProjects(['README.md'], PROJECTS)).toEqual([])
  })

  test('de-duplicates if a file matches multiple patterns of the same project', () => {
    const changed = ['infra/network/prod/main.tf', 'infra/network/main.tf']
    const result = resolveChangedProjects(changed, PROJECTS)
    expect(result.filter((p) => p.name === 'network-prod')).toHaveLength(1)
  })
})

describe('resolveExplicitProject', () => {
  const config = { projects: PROJECTS }

  test('returns the matching project object', () => {
    expect(resolveExplicitProject(config, 'network-prod')).toEqual(PROJECTS[0])
  })

  test('returns null for an unknown project name', () => {
    expect(resolveExplicitProject(config, 'unknown-project')).toBeNull()
  })
})
