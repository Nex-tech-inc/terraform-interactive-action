const { minimatch } = require('minimatch')

/**
 * Returns all configured projects that are affected by the given list of changed files.
 * Results are sorted alphabetically by project name and de-duplicated.
 * @param {string[]} changedFiles
 * @param {object[]} projects - raw project entries from config.projects
 * @returns {object[]}
 */
function resolveChangedProjects(changedFiles, projects) {
  const seen = new Set()
  const matched = []

  for (const project of projects) {
    if (!seen.has(project.name) && isProjectAffected(changedFiles, project)) {
      seen.add(project.name)
      matched.push(project)
    }
  }

  return matched.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Returns true if any of the changedFiles matches the project's when_modified
 * patterns, or falls back to `<dir>/**` when when_modified is empty.
 * @param {string[]} changedFiles
 * @param {object} project - raw project entry
 * @returns {boolean}
 */
function isProjectAffected(changedFiles, project) {
  const patterns =
    project.when_modified && project.when_modified.length > 0
      ? project.when_modified
      : [`${project.dir}/**`]

  return changedFiles.some((file) =>
    patterns.some((pattern) => minimatch(file, pattern, { dot: true }))
  )
}

/**
 * Looks up a project entry by name in config.projects.
 * Returns the raw project object (not merged) so the caller can merge with defaults.
 * @param {object} config
 * @param {string} name
 * @returns {object|null}
 */
function resolveExplicitProject(config, name) {
  return config.projects.find((p) => p.name === name) || null
}

module.exports = { resolveChangedProjects, isProjectAffected, resolveExplicitProject }
