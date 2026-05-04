const { minimatch } = require('minimatch')

/**
 * Parses a CODEOWNERS file content into an ordered array of rules.
 * @param {string} content
 * @returns {{ pattern: string, owners: string[] }[]}
 */
function parseCodeowners(content) {
  const rules = []
  for (const line of (content || '').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const [pattern, ...rawOwners] = trimmed.split(/\s+/)
    if (pattern && rawOwners.length > 0) {
      rules.push({ pattern, owners: rawOwners.map((o) => o.toLowerCase()) })
    }
  }
  return rules
}

/**
 * Determines whether a file path matches a CODEOWNERS-style pattern.
 * Rules:
 *   - Leading `/` means match from repo root
 *   - No slash in pattern means match anywhere (prepend `**/`)
 *   - Trailing directory (no extension, no glob) gets implicit `/**`
 * @param {string} filePath
 * @param {string} pattern
 * @returns {boolean}
 */
function matchesCodeownersPattern(filePath, pattern) {
  let p = pattern

  if (p.startsWith('/')) {
    p = p.slice(1)
  } else if (!p.includes('/')) {
    p = `**/${p}`
  }

  // Trailing directory without glob gets implicit /**
  if (!p.endsWith('**') && !p.includes('*') && !p.includes('?') && !p.includes('.')) {
    p = `${p}/**`
  } else if (p.endsWith('/')) {
    p = `${p}**`
  }

  return minimatch(filePath, p, { dot: true })
}

/**
 * Returns the required owners for a file path.
 * The last matching CODEOWNERS rule wins (GitHub semantics).
 * @param {{ pattern: string, owners: string[] }[]} rules
 * @param {string} filePath
 * @returns {string[]}
 */
function getRequiredOwners(rules, filePath) {
  let lastMatch = null
  for (const rule of rules) {
    if (matchesCodeownersPattern(filePath, rule.pattern)) {
      lastMatch = rule
    }
  }
  return lastMatch ? lastMatch.owners : []
}

/**
 * Checks whether all project files have required CODEOWNERS approval.
 * @param {string[]} projectFiles - files belonging to this project that were changed
 * @param {string} codeownersContent - raw CODEOWNERS file content
 * @param {string[]} approvedReviewers - GitHub usernames who approved the PR
 * @returns {{ approved: boolean, blockedFiles: { file: string, requiredOwners: string[] }[] }}
 */
function isProjectApproved(projectFiles, codeownersContent, approvedReviewers) {
  const rules = parseCodeowners(codeownersContent)
  const normalizedApprovers = approvedReviewers.map((r) => r.toLowerCase())

  const blockedFiles = []

  for (const file of projectFiles) {
    const required = getRequiredOwners(rules, file)
    if (required.length === 0) continue

    const hasApproval = required.some((owner) => {
      const ownerName = owner.startsWith('@') ? owner.slice(1) : owner
      return normalizedApprovers.some((a) => a === ownerName)
    })

    if (!hasApproval) {
      blockedFiles.push({ file, requiredOwners: required })
    }
  }

  return { approved: blockedFiles.length === 0, blockedFiles }
}

module.exports = {
  parseCodeowners,
  getRequiredOwners,
  matchesCodeownersPattern,
  isProjectApproved,
}
