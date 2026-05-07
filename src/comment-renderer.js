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
    `- \`/tf apply <project>\` — apply a specific project\n`

  )
}

function renderConfigError(error) {
  return `❌ **Config Error**: ${error}\n\nCheck your \`.terraform-deployment\` file.`
}


function renderApplyFailed(projectName, error) {
  return (
    `❌ **Apply Failed** for \`${projectName}\`: ${error}\n\n` +
    `The PR will not be merged. Fix the issue and re-run \`/tf apply\`.`
  )
}

function renderLockBlocked(projectName, lockPrNumber, lockedBy, lockedAt) {
  return (
    `🔒 **Project \`${projectName}\` is locked by PR #${lockPrNumber}** (@${lockedBy}, since ${lockedAt}).\n\n` +
    `Run \`/tf unlock\` in this PR to steal the lock if that PR is abandoned.`
  )
}

function renderUnlockResult(releasedProjects, commenter) {
  if (releasedProjects.length === 0) {
    return `🔓 **Terraform Unlock** by @${commenter}: No active locks found — nothing to release.`
  }
  const names = releasedProjects.map((p) => `\`${p}\``).join(', ')
  return `🔓 **Terraform Unlock** by @${commenter}: Released locks for ${names}.`
}

function renderLockMismatch(projectName) {
  return (
    `⚠️ **Lock mismatch for \`${projectName}\`**: This PR does not own the current lock.\n\n` +
    `Run \`/tf plan\` on this PR to acquire the lock before applying.`
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
  renderApplyFailed,
  renderLockBlocked,
  renderUnlockResult,
  renderLockMismatch,
}
