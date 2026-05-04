/**
 * Builds a flat execution payload array for use in GitHub Actions matrix strategy.
 * Each entry maps to one Terraform project to plan.
 * @param {object[]} resolvedProjects - merged project objects from mergeWithDefaults
 * @returns {object[]}
 */
function buildPlanPayload(resolvedProjects) {
  return resolvedProjects.map((p) => ({
    name: p.name,
    dir: p.dir,
    workspace: p.workspace,
    terraform_version: p.terraform_version,
    backend_bucket: p.backend.bucket,
    backend_key: p.backend.key,
    backend_region: p.backend.region,
    backend_dynamodb_table: p.backend.dynamodb_table || '',
    role_arn: p.deploy.role_arn,
    aws_region: p.deploy.aws_region,
  }))
}

/**
 * Builds an apply execution payload. Identical shape to plan payload;
 * the apply workflow downloads the pre-saved plan artifact by name.
 * @param {object[]} resolvedProjects
 * @returns {object[]}
 */
function buildApplyPayload(resolvedProjects) {
  return buildPlanPayload(resolvedProjects)
}

/**
 * Builds a payload describing why each project is blocked from apply.
 * @param {{ project: object, reason: string }[]} blockedProjects
 * @returns {{ name: string, reason: string }[]}
 */
function buildBlockedPayload(blockedProjects) {
  return blockedProjects.map(({ project, reason }) => ({
    name: project.name,
    reason,
  }))
}

module.exports = { buildPlanPayload, buildApplyPayload, buildBlockedPayload }
