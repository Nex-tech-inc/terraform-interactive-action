const { parseCommand } = require('../command-parser')

describe('parseCommand', () => {
  test('parses /tf plan with no project', () => {
    expect(parseCommand('/tf plan')).toEqual({
      command: 'plan',
      project: null,
      valid: true,
      error: null,
    })
  })

  test('parses /tf plan with project name', () => {
    expect(parseCommand('/tf plan network-prod')).toEqual({
      command: 'plan',
      project: 'network-prod',
      valid: true,
      error: null,
    })
  })

  test('parses /tf apply with no project', () => {
    expect(parseCommand('/tf apply')).toEqual({
      command: 'apply',
      project: null,
      valid: true,
      error: null,
    })
  })

  test('parses /tf apply with project name', () => {
    expect(parseCommand('/tf apply network-prod')).toEqual({
      command: 'apply',
      project: 'network-prod',
      valid: true,
      error: null,
    })
  })

  test('rejects /tf show (not implemented)', () => {
    const result = parseCommand('/tf show network-prod')
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/Unrecognized command/)
  })

  test('rejects unsupported subcommand', () => {
    const result = parseCommand('/tf destroy network-prod')
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/Unrecognized command/)
  })

  test('rejects non-tf comment', () => {
    const result = parseCommand('LGTM!')
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/Unrecognized command/)
  })

  test('is case-insensitive for the subcommand', () => {
    expect(parseCommand('/tf PLAN')).toMatchObject({ command: 'plan', valid: true })
  })

  test('trims surrounding whitespace', () => {
    expect(parseCommand('  /tf plan  ')).toMatchObject({ command: 'plan', project: null, valid: true })
  })

  test('parses /tf plan from first line of multi-line comment', () => {
    expect(parseCommand('/tf plan network-prod\n\n(some note)')).toMatchObject({
      command: 'plan',
      project: 'network-prod',
      valid: true,
    })
  })
})
