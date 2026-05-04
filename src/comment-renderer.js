function renderPlanQueued(projects) {
  const names = projects.map((p) => `\`${p.name}\``).join(', ')
  return `🔍 **Terraform Plan** queued for: ${names}\n\nResults will be posted when the workflow completes.`
}

function renderApplyBlocked(blockedProjects) {
  const lines = blockedProjects
    .map(({ project, reason }) => `- \`${project.name}\`: ${reason}`)
    .join('\n')
  return (
    `🚫 **Terraform Apply Blocked**\n\n` +
    `The following projects are not ready for apply:\n${lines}\n\n` +
    `All targeted projects must satisfy CODEOWNERS approval before apply can proceed.`
  )
}

function renderApplyQueued(projects) {
  const names = projects.map((p) => `\`${p.name}\``).join(', ')
  return `🚀 **Terraform Apply** queued for: ${names}\n\nResults will be posted when the workflow completes.`
}

function renderApplySuccess(projects, requester) {
  const names = projects.map((p) => `\`${p.name}\``).join(', ')
  return (
    `✅ **Terraform Apply Succeeded** for: ${names}\n\n` +
    `Apply triggered by @${requester}. This PR will now be automatically merged and the branch will be deleted.`
  )
}

function renderNoChangedProjects() {
  return (
    `ℹ️ **No matching Terraform projects** found for the files changed in this PR.\n\n` +
    `Check that your \`.terraform-deployment\` config covers the modified files.`
  )
}

function renderUnknownProject(name) {
  return (
    `❌ **Unknown project**: \`${name}\`\n\n` +
    `No project with that name is defined in \`.terraform-deployment\`.`
  )
}

function renderCommandError(error) {
  return (
    `❌ **Command Error**: ${error}\n\n` +
    `Supported commands:\n` +
    `- \`/tf plan\` — plan all projects affected by this PR\n` +
    `- \`/tf plan <project>\` — plan a specific project\n` +
    `- \`/tf apply\` — apply all projects affected by this PR\n` +
    `- \`/tf apply <project>\` — apply a specific project\n` +
    `- \`/tf show <project>\` — show the latest saved plan for a project`
  )
}

function renderConfigError(error) {
  return `❌ **Config Error**: ${error}\n\nCheck your \`.terraform-deployment\` file.`
}

function renderPlanShow(projectName, planSummary) {
  return `📋 **Plan for \`${projectName}\`**\n\n\`\`\`\n${planSummary}\n\`\`\``
}

function renderApplyFailed(projectName, error) {
  return (
    `❌ **Apply Failed** for \`${projectName}\`: ${error}\n\n` +
    `The PR will not be merged. Fix the issue and re-run \`/tf apply\`.`
  )
}

module.exports = {
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
}
