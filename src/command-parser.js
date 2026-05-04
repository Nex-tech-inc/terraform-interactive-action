/**
 * Parses a /tf PR comment body into a structured command intent.
 * @param {string} body - The raw comment body text
 * @returns {{ command: string|null, project: string|null, valid: boolean, error: string|null }}
 */
function parseCommand(body) {
  const trimmed = (body || '').trim()
  const match = trimmed.match(/^\/tf\s+(plan|apply|show)(?:\s+(\S+))?$/i)

  if (!match) {
    return {
      command: null,
      project: null,
      valid: false,
      error:
        'Unrecognized command. Supported: `/tf plan [project]`, `/tf apply [project]`, `/tf show <project>`',
    }
  }

  const command = match[1].toLowerCase()
  const project = match[2] || null

  if (command === 'show' && !project) {
    return {
      command,
      project: null,
      valid: false,
      error: '`/tf show` requires a project name. Usage: `/tf show <project>`',
    }
  }

  return { command, project, valid: true, error: null }
}

module.exports = { parseCommand }
