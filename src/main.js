const core = require('@actions/core')
const github = require('@actions/github')

const { parseCommand } = require('./command-parser')
const { loadConfig, resolveProject, mergeWithDefaults } = require('./config-loader')
const { resolveChangedProjects, resolveExplicitProject } = require('./project-resolver')
const { isProjectApproved } = require('./codeowners-evaluator')
const { buildPlanPayload, buildApplyPayload, buildBlockedPayload } = require('./execution-payload')
const {
  renderPlanQueued,
  renderApplyBlocked,
  renderApplyQueued,
  renderNoChangedProjects,
  renderUnknownProject,
  renderCommandError,
  renderConfigError,
} = require('./comment-renderer')

async function run() {
  try {
    const token = core.getInput('github-token', { required: true })
    const configPath = core.getInput('config-path') || '.terraform-deployment'
    const commentBody = core.getInput('comment-body', { required: true })
    const prNumber = parseInt(core.getInput('pr-number', { required: true }), 10)
    const headSha = core.getInput('head-sha', { required: true })
    const changedFiles = JSON.parse(core.getInput('changed-files', { required: true }))
    const codeownersContent = core.getInput('codeowners-content') || ''
    const approvedReviewers = JSON.parse(core.getInput('approved-reviewers') || '[]')
    const commenter = core.getInput('commenter', { required: true })

    const octokit = github.getOctokit(token)
    const { owner, repo } = github.context.repo

    // 1. Parse the /tf command
    const parsed = parseCommand(commentBody)
    if (!parsed.valid) {
      await postComment(octokit, owner, repo, prNumber, renderCommandError(parsed.error))
      core.setOutput('action', 'none')
      return
    }

    // 2. Load and validate config
    let config
    try {
      config = loadConfig(configPath)
    } catch (err) {
      await postComment(octokit, owner, repo, prNumber, renderConfigError(err.message))
      core.setOutput('action', 'none')
      return
    }

    // 2b. Dispatch: unlock early — bypasses project file-change resolution
    if (parsed.command === 'unlock') {
      if (parsed.project) {
        const raw = resolveExplicitProject(config, parsed.project)
        if (!raw) {
          await postComment(octokit, owner, repo, prNumber, renderUnknownProject(parsed.project))
          core.setOutput('action', 'none')
          return
        }
        core.setOutput('action', 'unlock')
        core.setOutput('projects', JSON.stringify([mergeWithDefaults(config.defaults || {}, raw)]))
        core.setOutput('pr-number', String(prNumber))
        core.setOutput('commenter', commenter)
        return
      }
      const allProjects = (config.projects || []).map((p) => mergeWithDefaults(config.defaults || {}, p))
      core.setOutput('action', 'unlock')
      core.setOutput('projects', JSON.stringify(allProjects))
      core.setOutput('pr-number', String(prNumber))
      core.setOutput('commenter', commenter)
      return
    }

    // 3. Resolve target projects
    let targetProjects = []
    if (parsed.project) {
      const raw = resolveExplicitProject(config, parsed.project)
      if (!raw) {
        await postComment(octokit, owner, repo, prNumber, renderUnknownProject(parsed.project))
        core.setOutput('action', 'none')
        return
      }
      targetProjects = [mergeWithDefaults(config.defaults || {}, raw)]
    } else {
      const rawChanged = resolveChangedProjects(changedFiles, config.projects)
      if (rawChanged.length === 0) {
        await postComment(octokit, owner, repo, prNumber, renderNoChangedProjects())
        core.setOutput('action', 'none')
        return
      }
      targetProjects = rawChanged.map((p) => mergeWithDefaults(config.defaults || {}, p))
    }

    // 4. Dispatch: plan
    if (parsed.command === 'plan' || parsed.command === 'show') {
      const payload = buildPlanPayload(targetProjects)
      if (parsed.command === 'plan') {
        await postComment(octokit, owner, repo, prNumber, renderPlanQueued(targetProjects))
      }
      core.setOutput('action', parsed.command)
      core.setOutput('projects', JSON.stringify(payload))
      core.setOutput('pr-number', String(prNumber))
      core.setOutput('head-sha', headSha)
      core.setOutput('commenter', commenter)
      return
    }

    // 5. Dispatch: apply — check CODEOWNERS approval for every target project
    const blockedProjects = []
    for (const project of targetProjects) {
      const projectFiles = changedFiles.filter(
        (f) => f.startsWith(`${project.dir}/`) || f === project.dir
      )
      const approval = isProjectApproved(projectFiles, codeownersContent, approvedReviewers)
      if (!approval.approved) {
        const missingOwners = [
          ...new Set(approval.blockedFiles.flatMap((b) => b.requiredOwners)),
        ]
        const reason = `Missing CODEOWNERS approval from: ${missingOwners.join(', ')}`
        blockedProjects.push({ project, reason })
      }
    }

    if (blockedProjects.length > 0) {
      await postComment(octokit, owner, repo, prNumber, renderApplyBlocked(blockedProjects))
      core.setOutput('action', 'blocked')
      core.setOutput('blocked-projects', JSON.stringify(buildBlockedPayload(blockedProjects)))
      return
    }

    // 6. All projects approved — queue apply
    const applyPayload = buildApplyPayload(targetProjects)
    await postComment(octokit, owner, repo, prNumber, renderApplyQueued(targetProjects))
    core.setOutput('action', 'apply')
    core.setOutput('projects', JSON.stringify(applyPayload))
    core.setOutput('pr-number', String(prNumber))
    core.setOutput('head-sha', headSha)
    core.setOutput('commenter', commenter)
  } catch (err) {
    core.setFailed(err.message)
  }
}

async function postComment(octokit, owner, repo, prNumber, body) {
  await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: prNumber,
    body,
  })
}

module.exports = run()
