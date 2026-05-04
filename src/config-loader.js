const fs = require('fs')
const yaml = require('js-yaml')

/**
 * Loads and validates .terraform-deployment from disk.
 * @param {string} configPath
 * @returns {object} validated config
 */
function loadConfig(configPath = '.terraform-deployment') {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`)
  }
  const raw = fs.readFileSync(configPath, 'utf8')
  const config = yaml.load(raw)
  return validateConfig(config)
}

/**
 * Validates a parsed config object. Throws descriptive errors on violation.
 * @param {object} config
 * @returns {object} the same config if valid
 */
function validateConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('Config must be a YAML object')
  }
  if (config.version !== 1) {
    throw new Error('Config version must be 1')
  }
  if (!Array.isArray(config.projects) || config.projects.length === 0) {
    throw new Error('Config must define at least one project under `projects:`')
  }

  const names = new Set()
  const defaultBackendKey = config.defaults?.backend?.key

  for (const project of config.projects) {
    if (!project.name) throw new Error('Each project must have a name')
    if (!project.dir) throw new Error(`Project "${project.name}" must have a dir`)
    if (!project.deploy?.role_arn) {
      throw new Error(`Project "${project.name}" must have deploy.role_arn`)
    }
    if (!project.backend?.key && !defaultBackendKey) {
      throw new Error(
        `Project "${project.name}" must have backend.key (or set a default in defaults.backend.key)`
      )
    }
    if (names.has(project.name)) {
      throw new Error(`Duplicate project name: "${project.name}"`)
    }
    names.add(project.name)
  }

  return config
}

/**
 * Merges top-level defaults with a single project entry.
 * Project-level values take precedence over defaults.
 * @param {object} defaults - config.defaults (may be empty object)
 * @param {object} project  - raw project entry from config.projects
 * @returns {object} resolved project
 */
function mergeWithDefaults(defaults, project) {
  return {
    name: project.name,
    dir: project.dir,
    workspace: project.workspace || 'default',
    when_modified: project.when_modified || [],
    terraform_version:
      project.terraform_version || defaults.terraform_version || '1.9.0',
    backend: {
      bucket: project.backend?.bucket || defaults.backend?.bucket || '',
      key: project.backend?.key || defaults.backend?.key || '',
      region:
        project.backend?.region ||
        defaults.backend?.region ||
        defaults.aws_region ||
        'us-east-1',
      dynamodb_table:
        project.backend?.dynamodb_table || defaults.backend?.dynamodb_table || '',
    },
    deploy: {
      role_arn: project.deploy.role_arn,
      account_id: project.deploy.account_id || '',
      aws_region:
        project.deploy.aws_region || defaults.aws_region || 'us-east-1',
    },
    policies: {
      require_apply_before_merge:
        project.policies?.require_apply_before_merge ??
        defaults.policies?.require_apply_before_merge ??
        true,
    },
  }
}

/**
 * Resolves a project by name, merging with defaults.
 * @param {object} config
 * @param {string} name
 * @returns {object|null} resolved project or null if not found
 */
function resolveProject(config, name) {
  const raw = config.projects.find((p) => p.name === name)
  if (!raw) return null
  return mergeWithDefaults(config.defaults || {}, raw)
}

module.exports = { loadConfig, validateConfig, resolveProject, mergeWithDefaults }
