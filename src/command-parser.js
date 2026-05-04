/**
 * Parses a /tf PR comment body into a structured command intent.
 * @param {string} body - The raw comment body text
 * @returns {{ command: string|null, project: string|null, valid: boolean, error: string|null }}
 */
function parseCommand(body) {
  const firstLine = (body || '').split('\n').map((l) => l.trim()).find((l) => l.length > 0) || ''
  const match = firstLine.match(/^\/tf\s+(plan|apply)(?:\s+(\S+))?$/i)

  if (!match) {
    return {
      command: null,
      project: null,
      valid: false,
      error: 'Unrecognized command. Supported: `/tf plan [project]`, `/tf apply [project]`',
    }
  }

  const command = match[1].toLowerCase()
  const project = match[2] || null

  return { command, project, valid: true, error: null }
}

module.exports = { parseCommand }
