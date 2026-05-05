# Cross-PR Terraform Locking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Atlantis-style cross-PR locking so that when PR #1 plans a project, PR #2 gets a friendly lock comment instead of a raw Terraform state error.

**Architecture:** Lock files stored as JSON objects in the existing state S3 bucket under `locks/{project-name}.lock`. Lock acquired at plan time, verified and released at apply time, auto-released when the owning PR closes, and force-released by `/tf unlock`.

**Tech Stack:** AWS CLI (`aws s3api`), GitHub Actions YAML (`bash` + `actions/github-script@v7`), Node.js (command-parser, comment-renderer, main.js), `@vercel/ncc` for bundling.

---

## File Map

| File | Change |
|---|---|
| `src/command-parser.js` | Add `unlock` to valid commands |
| `src/__tests__/command-parser.test.js` | Add `unlock` test cases |
| `src/comment-renderer.js` | Add `renderLockBlocked`, `renderUnlockResult`, `renderLockMismatch` |
| `src/__tests__/comment-renderer.test.js` | Tests for three new render functions |
| `src/main.js` | Handle `unlock` dispatch (resolve all config projects, set action=unlock) |
| `src/__tests__/main.test.js` | Test unlock dispatch output |
| `dist/index.js` | Rebuilt bundle (`npm run build`) |
| `.github/workflows/tf-plan.yml` | Add `commenter` input + lock-acquire step (bash) + fail-if-blocked step (github-script) |
| `.github/workflows/tf-apply.yml` | Add lock-verify step (bash + github-script) + lock-release step after apply |
| `.github/workflows/tf-command.yml` | Add `unlock` job that calls `tf-unlock.yml`; add `pull_request: [closed]` event that calls `tf-cleanup.yml` |
| `.github/workflows/tf-unlock.yml` | **NEW** reusable workflow: delete all project locks, post comment |
| `.github/workflows/tf-cleanup.yml` | **NEW** workflow: on PR closed, auto-release locks owned by that PR |
| `template/.github/workflows/tf-plan.yml` | Mirror of tf-plan.yml changes |
| `template/.github/workflows/tf-apply.yml` | Mirror of tf-apply.yml changes |
| `template/.github/workflows/tf-command.yml` | Mirror of tf-command.yml changes |
| `template/.github/workflows/tf-unlock.yml` | **NEW** mirror |
| `template/.github/workflows/tf-cleanup.yml` | **NEW** mirror |
| Consumer repo `.github/workflows/*` | Mirror all workflow changes to the live test repo |

---

## Task 1: Add `unlock` to command-parser.js

**Files:**
- Modify: `src/command-parser.js`
- Test: `src/__tests__/command-parser.test.js`

- [ ] **Step 1: Write failing tests for `unlock`**

Add to the bottom of `src/__tests__/command-parser.test.js` (before the closing `})`):

```javascript
  test('parses /tf unlock with no project', () => {
    expect(parseCommand('/tf unlock')).toEqual({
      command: 'unlock',
      project: null,
      valid: true,
      error: null,
    })
  })

  test('parses /tf unlock with project name', () => {
    expect(parseCommand('/tf unlock s3-bucket')).toEqual({
      command: 'unlock',
      project: 's3-bucket',
      valid: true,
      error: null,
    })
  })

  test('rejects /tf unlock as part of existing error message check', () => {
    // The error message should now mention unlock
    const result = parseCommand('/tf destroy')
    expect(result.error).toMatch(/Unrecognized command/)
  })
```

- [ ] **Step 2: Run tests — expect failure**

```bash
cd /Users/nexpeque/Documents/ebsco/kale/workflows/terraform-deploy-action
npm test -- --testPathPattern=command-parser 2>&1 | tail -20
```

Expected: FAIL — `unlock` not recognized, returns `valid: false`.

- [ ] **Step 3: Update `src/command-parser.js` to recognize `unlock`**

Replace the entire file content:

```javascript
/**
 * Parses a /tf PR comment body into a structured command intent.
 * @param {string} body - The raw comment body text
 * @returns {{ command: string|null, project: string|null, valid: boolean, error: string|null }}
 */
function parseCommand(body) {
  const firstLine = (body || '').split('\n').map((l) => l.trim()).find((l) => l.length > 0) || ''
  const match = firstLine.match(/^\/tf\s+(plan|apply|unlock)(?:\s+(\S+))?$/i)

  if (!match) {
    return {
      command: null,
      project: null,
      valid: false,
      error: 'Unrecognized command. Supported: `/tf plan [project]`, `/tf apply [project]`, `/tf unlock [project]`',
    }
  }

  const command = match[1].toLowerCase()
  const project = match[2] || null

  return { command, project, valid: true, error: null }
}

module.exports = { parseCommand }
```

- [ ] **Step 4: Run tests — expect pass**

```bash
npm test -- --testPathPattern=command-parser 2>&1 | tail -10
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/command-parser.js src/__tests__/command-parser.test.js
git commit -m "feat: add unlock to command parser"
```

---

## Task 2: Add lock render functions to comment-renderer.js

**Files:**
- Modify: `src/comment-renderer.js`
- Test: `src/__tests__/comment-renderer.test.js`

- [ ] **Step 1: Write failing tests**

Add to `src/__tests__/comment-renderer.test.js`:

```javascript
const {
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
  renderLockBlocked,
  renderUnlockResult,
  renderLockMismatch,
} = require('../comment-renderer')

describe('renderLockBlocked', () => {
  test('includes project name, PR number, locker, and timestamp', () => {
    const result = renderLockBlocked('s3-bucket', 42, 'alice', '2026-05-04T18:00:00Z')
    expect(result).toContain('s3-bucket')
    expect(result).toContain('#42')
    expect(result).toContain('@alice')
    expect(result).toContain('2026-05-04T18:00:00Z')
    expect(result).toContain('/tf unlock')
  })
})

describe('renderUnlockResult', () => {
  test('lists released projects and commenter', () => {
    const result = renderUnlockResult(['s3-bucket', 'vpc'], 'bob')
    expect(result).toContain('s3-bucket')
    expect(result).toContain('vpc')
    expect(result).toContain('@bob')
  })

  test('handles empty list (nothing to unlock)', () => {
    const result = renderUnlockResult([], 'bob')
    expect(result).toContain('No active locks')
  })
})

describe('renderLockMismatch', () => {
  test('includes project name and run /tf plan instruction', () => {
    const result = renderLockMismatch('s3-bucket')
    expect(result).toContain('s3-bucket')
    expect(result).toContain('/tf plan')
  })
})
```

- [ ] **Step 2: Run tests — expect failure**

```bash
npm test -- --testPathPattern=comment-renderer 2>&1 | tail -20
```

Expected: FAIL — `renderLockBlocked` etc. not exported.

- [ ] **Step 3: Add three render functions to `src/comment-renderer.js`**

Add before the `module.exports` line:

```javascript
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
```

Update `module.exports`:

```javascript
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
  renderLockBlocked,
  renderUnlockResult,
  renderLockMismatch,
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
npm test -- --testPathPattern=comment-renderer 2>&1 | tail -10
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/comment-renderer.js src/__tests__/comment-renderer.test.js
git commit -m "feat: add lock render functions to comment-renderer"
```

---

## Task 3: Handle `unlock` dispatch in main.js

**Files:**
- Modify: `src/main.js`
- Test: `src/__tests__/main.test.js`

- [ ] **Step 1: Read the existing main.test.js to understand mock setup**

```bash
cat src/__tests__/main.test.js
```

Note how `@actions/core` and `@actions/github` are mocked — reuse that pattern.

- [ ] **Step 2: Write failing test for unlock dispatch**

Add a new `describe('unlock command', ...)` block to `src/__tests__/main.test.js`, matching the mock patterns already in that file. The test should verify:
- `core.setOutput` is called with `('action', 'unlock')`
- `core.setOutput` is called with `('projects', ...)` containing all config projects
- A comment is NOT posted for unlock (the workflow handles messaging)

```javascript
describe('unlock command', () => {
  beforeEach(() => {
    jest.resetModules()
    // Set up the same mocks as existing tests in this file
    // (copy the mock setup pattern from the existing beforeEach)
    jest.mock('@actions/core', () => ({
      getInput: jest.fn((name) => {
        const inputs = {
          'github-token': 'test-token',
          'config-path': '.terraform-deployment',
          'comment-body': '/tf unlock',
          'pr-number': '7',
          'head-sha': 'abc123',
          'changed-files': JSON.stringify(['infra/s3-bucket/main.tf']),
          'codeowners-content': '',
          'approved-reviewers': '[]',
          commenter: 'alice',
        }
        return inputs[name] ?? ''
      }),
      setOutput: jest.fn(),
      setFailed: jest.fn(),
      info: jest.fn(),
      warning: jest.fn(),
    }))
    jest.mock('@actions/github', () => ({
      getOctokit: jest.fn(() => ({
        rest: {
          issues: { createComment: jest.fn().mockResolvedValue({}) },
        },
      })),
      context: { repo: { owner: 'test-owner', repo: 'test-repo' } },
    }))
    // Use a minimal .terraform-deployment fixture that has at least one project
  })

  test('sets action=unlock and returns all config projects', async () => {
    const core = require('@actions/core')
    jest.mock('fs', () => ({
      readFileSync: jest.fn(() => `
version: 1
projects:
  - name: s3-bucket
    dir: infra/s3-bucket
    workspace: default
    when_modified: ["infra/s3-bucket/**"]
    backend:
      key: s3-bucket/terraform.tfstate
    deploy:
      role_arn: arn:aws:iam::123:role/test
      aws_region: us-east-1
`),
      existsSync: jest.fn(() => true),
    }))
    await require('../main')
    expect(core.setOutput).toHaveBeenCalledWith('action', 'unlock')
    const projectsCall = core.setOutput.mock.calls.find(([k]) => k === 'projects')
    expect(projectsCall).toBeDefined()
    const projects = JSON.parse(projectsCall[1])
    expect(projects.some((p) => p.name === 's3-bucket')).toBe(true)
  })
})
```

- [ ] **Step 3: Run test — expect failure**

```bash
npm test -- --testPathPattern=main 2>&1 | tail -20
```

Expected: FAIL — `unlock` falls through to the command error path.

- [ ] **Step 4: Add unlock dispatch to `src/main.js`**

Add the import at the top of the imports section:

```javascript
const { renderUnlockResult } = require('./comment-renderer')
```

Add after the `// 4. Dispatch: plan` block (around line 73), before the `// 5. Dispatch: apply` block:

```javascript
    // 4b. Dispatch: unlock — resolve ALL config projects regardless of changed files
    if (parsed.command === 'unlock') {
      const allProjects = (config.projects || []).map((p) => mergeWithDefaults(config.defaults || {}, p))
      if (parsed.project) {
        const raw = resolveExplicitProject(config, parsed.project)
        if (!raw) {
          await postComment(octokit, owner, repo, prNumber, renderUnknownProject(parsed.project))
          core.setOutput('action', 'none')
          return
        }
        const unlockPayload = [mergeWithDefaults(config.defaults || {}, raw)]
        core.setOutput('action', 'unlock')
        core.setOutput('projects', JSON.stringify(unlockPayload))
        core.setOutput('pr-number', String(prNumber))
        core.setOutput('commenter', commenter)
        return
      }
      core.setOutput('action', 'unlock')
      core.setOutput('projects', JSON.stringify(allProjects))
      core.setOutput('pr-number', String(prNumber))
      core.setOutput('commenter', commenter)
      return
    }
```

Also update the `renderCommandError` call site so the error message includes unlock (it auto-updates since command-parser now includes it in the error text).

- [ ] **Step 5: Run all tests — expect pass**

```bash
npm test 2>&1 | tail -15
```

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/main.js src/__tests__/main.test.js
git commit -m "feat: handle unlock command dispatch in main.js"
```

---

## Task 4: Build the action bundle

**Files:**
- Modify: `dist/index.js` (rebuilt)

- [ ] **Step 1: Run the build**

```bash
cd /Users/nexpeque/Documents/ebsco/kale/workflows/terraform-deploy-action
npm run build 2>&1 | tail -10
```

Expected: `dist/index.js` updated, no errors.

- [ ] **Step 2: Commit the dist**

```bash
git add dist/
git commit -m "build: rebuild dist with unlock command support"
```

---

## Task 5: Add lock-acquire to tf-plan.yml

The lock-acquire runs after OIDC credentials are configured (needed for `aws s3api`) and before `terraform init`.

**Files:**
- Modify: `.github/workflows/tf-plan.yml`

- [ ] **Step 1: Add `commenter` input to tf-plan.yml**

In the `on.workflow_call.inputs:` block, add after `head-sha`:

```yaml
      commenter:
        description: 'GitHub username who triggered the plan (for lock attribution)'
        required: true
        type: string
```

- [ ] **Step 2: Add lock-acquire bash step after the `Configure AWS credentials` step**

Insert this new step between `Configure AWS credentials via OIDC` and `Terraform init`:

```yaml
      - name: Acquire project lock
        id: lock-acquire
        env:
          PROJECT_NAME: ${{ matrix.project.name }}
          PR_NUMBER: ${{ inputs.pr-number }}
          HEAD_SHA: ${{ inputs.head-sha }}
          COMMENTER: ${{ inputs.commenter }}
          BACKEND_BUCKET: ${{ matrix.project.backend_bucket }}
        run: |
          set -e
          LOCK_KEY="locks/${PROJECT_NAME}.lock"
          LOCK_FILE="/tmp/tf-lock.json"
          NEW_LOCK_FILE="/tmp/tf-new-lock.json"

          cat > "$NEW_LOCK_FILE" <<EOF
          {
            "pr_number": ${PR_NUMBER},
            "head_sha": "${HEAD_SHA}",
            "locked_by": "${COMMENTER}",
            "locked_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
            "repo": "${GITHUB_REPOSITORY}"
          }
          EOF

          if aws s3api get-object \
              --bucket "$BACKEND_BUCKET" \
              --key "$LOCK_KEY" \
              "$LOCK_FILE" 2>/dev/null; then
            EXISTING_PR=$(jq -r '.pr_number' "$LOCK_FILE")
            if [ "$EXISTING_PR" = "$PR_NUMBER" ]; then
              echo "Lock already owned by this PR. Re-plan allowed."
              exit 0
            fi
            # Blocked by another PR
            {
              echo "LOCK_BLOCKED=true"
              echo "LOCK_PR=$(jq -r '.pr_number' "$LOCK_FILE")"
              echo "LOCK_BY=$(jq -r '.locked_by' "$LOCK_FILE")"
              echo "LOCK_AT=$(jq -r '.locked_at' "$LOCK_FILE")"
            } >> "$GITHUB_ENV"
            exit 0
          fi

          # No existing lock — acquire with conditional write (avoids race condition)
          if ! aws s3api put-object \
              --bucket "$BACKEND_BUCKET" \
              --key "$LOCK_KEY" \
              --body "$NEW_LOCK_FILE" \
              --if-none-match "*" 2>/dev/null; then
            # Race condition: another plan acquired simultaneously — re-read and report blocked
            aws s3api get-object --bucket "$BACKEND_BUCKET" --key "$LOCK_KEY" "$LOCK_FILE" 2>/dev/null || true
            {
              echo "LOCK_BLOCKED=true"
              echo "LOCK_PR=$(jq -r '.pr_number' "$LOCK_FILE" 2>/dev/null || echo unknown)"
              echo "LOCK_BY=$(jq -r '.locked_by' "$LOCK_FILE" 2>/dev/null || echo unknown)"
              echo "LOCK_AT=$(jq -r '.locked_at' "$LOCK_FILE" 2>/dev/null || echo unknown)"
            } >> "$GITHUB_ENV"
            exit 0
          fi

          echo "Lock acquired for PR #${PR_NUMBER} on project ${PROJECT_NAME}."
```

- [ ] **Step 3: Add fail-if-blocked step immediately after the acquire step**

Insert between `Acquire project lock` and `Terraform init`:

```yaml
      - name: Fail if project is locked by another PR
        if: env.LOCK_BLOCKED == 'true'
        env:
          PROJECT_NAME: ${{ matrix.project.name }}
          PR_NUMBER: ${{ inputs.pr-number }}
        uses: actions/github-script@v7
        with:
          script: |
            const name = process.env.PROJECT_NAME
            const lockPr = process.env.LOCK_PR
            const lockBy = process.env.LOCK_BY
            const lockAt = process.env.LOCK_AT
            const prNumber = parseInt(process.env.PR_NUMBER, 10)

            await github.rest.issues.createComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: prNumber,
              body:
                `🔒 **Project \`${name}\` is locked by PR #${lockPr}** (@${lockBy}, since ${lockAt}).\n\n` +
                `Run \`/tf unlock\` in this PR to steal the lock if that PR is abandoned.`,
            })
            core.setFailed(`Project "${name}" is locked by PR #${lockPr}`)
```

- [ ] **Step 4: Pass `commenter` when calling tf-plan.yml from tf-command.yml**

In `.github/workflows/tf-command.yml`, update the `plan:` job's `with:` block:

```yaml
  plan:
    needs: dispatch
    if: needs.dispatch.outputs.action == 'plan'
    uses: ./.github/workflows/tf-plan.yml
    with:
      projects: ${{ needs.dispatch.outputs.projects }}
      pr-number: ${{ needs.dispatch.outputs.pr-number }}
      head-sha: ${{ needs.dispatch.outputs.head-sha }}
      commenter: ${{ needs.dispatch.outputs.commenter }}
    secrets: inherit
```

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/tf-plan.yml .github/workflows/tf-command.yml
git commit -m "feat: add lock-acquire step to tf-plan workflow"
```

---

## Task 6: Add lock-verify and lock-release to tf-apply.yml

**Files:**
- Modify: `.github/workflows/tf-apply.yml`

- [ ] **Step 1: Add lock-verify bash step after `Configure AWS credentials` and before `Download plan artifact`**

```yaml
      - name: Verify lock ownership
        env:
          PROJECT_NAME: ${{ matrix.project.name }}
          PR_NUMBER: ${{ inputs.pr-number }}
          BACKEND_BUCKET: ${{ matrix.project.backend_bucket }}
        run: |
          set -e
          LOCK_KEY="locks/${PROJECT_NAME}.lock"
          LOCK_FILE="/tmp/tf-lock.json"

          if ! aws s3api get-object \
              --bucket "$BACKEND_BUCKET" \
              --key "$LOCK_KEY" \
              "$LOCK_FILE" 2>/dev/null; then
            echo "LOCK_MISMATCH=true" >> "$GITHUB_ENV"
            exit 0
          fi

          EXISTING_PR=$(jq -r '.pr_number' "$LOCK_FILE")
          if [ "$EXISTING_PR" != "$PR_NUMBER" ]; then
            echo "LOCK_MISMATCH=true" >> "$GITHUB_ENV"
            echo "LOCK_PR=${EXISTING_PR}" >> "$GITHUB_ENV"
            echo "LOCK_BY=$(jq -r '.locked_by' "$LOCK_FILE")" >> "$GITHUB_ENV"
          fi
```

- [ ] **Step 2: Add fail-if-lock-mismatch step immediately after verify**

```yaml
      - name: Fail if lock not owned by this PR
        if: env.LOCK_MISMATCH == 'true'
        env:
          PROJECT_NAME: ${{ matrix.project.name }}
          PR_NUMBER: ${{ inputs.pr-number }}
        uses: actions/github-script@v7
        with:
          script: |
            const name = process.env.PROJECT_NAME
            const prNumber = parseInt(process.env.PR_NUMBER, 10)
            const lockPr = process.env.LOCK_PR || 'unknown'
            const lockBy = process.env.LOCK_BY || 'unknown'

            const reason = lockPr === 'unknown'
              ? `No lock found for \`${name}\`. Run \`/tf plan\` on this PR before applying.`
              : `Lock is held by PR #${lockPr} (@${lockBy}). Run \`/tf plan\` on this PR to acquire the lock.`

            await github.rest.issues.createComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: prNumber,
              body: `⚠️ **Apply blocked for \`${name}\`**: ${reason}`,
            })
            core.setFailed(`Lock mismatch for project "${name}"`)
```

- [ ] **Step 3: Add lock-release step after the `Terraform apply` step**

Add this after the `Terraform apply` step (it only runs on success, so the lock is kept on failure):

```yaml
      - name: Release project lock
        if: steps.apply.outputs.exit-code == '0'
        env:
          PROJECT_NAME: ${{ matrix.project.name }}
          BACKEND_BUCKET: ${{ matrix.project.backend_bucket }}
        run: |
          aws s3api delete-object \
            --bucket "$BACKEND_BUCKET" \
            --key "locks/${PROJECT_NAME}.lock"
          echo "Lock released for project ${PROJECT_NAME}."
```

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/tf-apply.yml
git commit -m "feat: add lock-verify and lock-release to tf-apply workflow"
```

---

## Task 7: Create tf-unlock.yml reusable workflow

**Files:**
- Create: `.github/workflows/tf-unlock.yml`

- [ ] **Step 1: Create the file**

```yaml
name: Terraform Unlock

on:
  workflow_call:
    inputs:
      projects:
        description: 'JSON array of project execution payloads'
        required: true
        type: string
      pr-number:
        description: 'Pull request number'
        required: true
        type: string
      commenter:
        description: 'GitHub username who triggered the unlock'
        required: true
        type: string

permissions:
  issues: write
  id-token: write

jobs:
  unlock:
    runs-on: ubuntu-latest
    steps:
      - name: Configure AWS credentials via OIDC
        uses: aws-actions/configure-aws-credentials@v4
        with:
          # Use the first project's role — all projects share one role in the common case
          role-to-assume: ${{ fromJson(inputs.projects)[0].role_arn }}
          aws-region: ${{ fromJson(inputs.projects)[0].aws_region }}

      - name: Release project locks
        id: release
        env:
          PROJECTS_JSON: ${{ inputs.projects }}
        run: |
          RELEASED=""
          while IFS=$'\t' read -r name bucket; do
            LOCK_KEY="locks/${name}.lock"
            aws s3api delete-object --bucket "$bucket" --key "$LOCK_KEY" 2>/dev/null
            RELEASED="${RELEASED}${RELEASED:+, }\`${name}\`"
          done < <(echo "$PROJECTS_JSON" | jq -r '.[] | [.name, .backend_bucket] | @tsv')

          echo "RELEASED_PROJECTS=${RELEASED:-none}" >> "$GITHUB_ENV"

      - name: Post unlock comment
        env:
          PR_NUMBER: ${{ inputs.pr-number }}
          COMMENTER: ${{ inputs.commenter }}
        uses: actions/github-script@v7
        with:
          script: |
            const prNumber = parseInt(process.env.PR_NUMBER, 10)
            const commenter = process.env.COMMENTER
            const released = process.env.RELEASED_PROJECTS

            const body = released === 'none'
              ? `🔓 **Terraform Unlock** by @${commenter}: No active locks found — nothing to release.`
              : `🔓 **Terraform Unlock** by @${commenter}: Released locks for ${released}.`

            await github.rest.issues.createComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: prNumber,
              body,
            })
```

- [ ] **Step 2: Add the `unlock` job to tf-command.yml**

In `.github/workflows/tf-command.yml`, add after the `apply:` job:

```yaml
  unlock:
    needs: dispatch
    if: needs.dispatch.outputs.action == 'unlock'
    uses: ./.github/workflows/tf-unlock.yml
    with:
      projects: ${{ needs.dispatch.outputs.projects }}
      pr-number: ${{ needs.dispatch.outputs.pr-number }}
      commenter: ${{ needs.dispatch.outputs.commenter }}
    secrets: inherit
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/tf-unlock.yml .github/workflows/tf-command.yml
git commit -m "feat: add tf-unlock reusable workflow and unlock dispatch"
```

---

## Task 8: Create tf-cleanup.yml (PR close auto-release)

**Files:**
- Create: `.github/workflows/tf-cleanup.yml`

- [ ] **Step 1: Create the file**

```yaml
name: Terraform Lock Cleanup

on:
  pull_request:
    types: [closed]

permissions:
  issues: write
  contents: read
  id-token: write

jobs:
  cleanup:
    runs-on: ubuntu-latest
    steps:
      - name: Check out default branch
        uses: actions/checkout@v4
        # Checks out the default branch (where .terraform-deployment lives)

      - name: Parse config for projects
        id: parse-config
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs')
            const yaml = require('js-yaml')

            const configPath = '.terraform-deployment'
            if (!fs.existsSync(configPath)) {
              core.info('No .terraform-deployment found — nothing to clean up.')
              core.setOutput('projects', '[]')
              return
            }

            const config = yaml.load(fs.readFileSync(configPath, 'utf8'))
            const defaults = config.defaults || {}
            const projects = (config.projects || []).map((p) => ({
              name: p.name,
              backend_bucket: p.backend?.bucket || defaults.backend?.bucket || '',
              role_arn: p.deploy?.role_arn || defaults.deploy?.role_arn || '',
              aws_region: p.deploy?.aws_region || defaults.aws_region || 'us-east-1',
            }))
            core.setOutput('projects', JSON.stringify(projects))

      - name: Configure AWS credentials via OIDC
        if: steps.parse-config.outputs.projects != '[]'
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ fromJson(steps.parse-config.outputs.projects)[0].role_arn }}
          aws-region: ${{ fromJson(steps.parse-config.outputs.projects)[0].aws_region }}

      - name: Release locks owned by this PR
        if: steps.parse-config.outputs.projects != '[]'
        id: release
        env:
          PROJECTS_JSON: ${{ steps.parse-config.outputs.projects }}
          PR_NUMBER: ${{ github.event.pull_request.number }}
        run: |
          RELEASED=""
          while IFS=$'\t' read -r name bucket; do
            LOCK_KEY="locks/${name}.lock"
            LOCK_FILE="/tmp/cleanup-lock-${name}.json"

            if ! aws s3api get-object \
                --bucket "$bucket" \
                --key "$LOCK_KEY" \
                "$LOCK_FILE" 2>/dev/null; then
              continue
            fi

            LOCK_PR=$(jq -r '.pr_number' "$LOCK_FILE")
            if [ "$LOCK_PR" = "$PR_NUMBER" ]; then
              aws s3api delete-object --bucket "$bucket" --key "$LOCK_KEY"
              RELEASED="${RELEASED}${RELEASED:+, }\`${name}\`"
              echo "Released lock for ${name} (was held by PR #${PR_NUMBER})"
            fi
          done < <(echo "$PROJECTS_JSON" | jq -r '.[] | [.name, .backend_bucket] | @tsv')

          echo "RELEASED_PROJECTS=${RELEASED}" >> "$GITHUB_ENV"

      - name: Post cleanup comment (if locks were released)
        if: env.RELEASED_PROJECTS != ''
        uses: actions/github-script@v7
        with:
          script: |
            const released = process.env.RELEASED_PROJECTS
            await github.rest.issues.createComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.payload.pull_request.number,
              body: `🔓 **Terraform locks auto-released** on PR close: ${released}.`,
            })
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/tf-cleanup.yml
git commit -m "feat: add tf-cleanup workflow for PR close lock auto-release"
```

---

## Task 9: Mirror all changes to template/ directory

**Files:**
- Modify/Create: `template/.github/workflows/tf-plan.yml`, `tf-apply.yml`, `tf-command.yml`
- Create: `template/.github/workflows/tf-unlock.yml`, `tf-cleanup.yml`

- [ ] **Step 1: Copy all updated workflows to template/**

```bash
cp .github/workflows/tf-plan.yml template/.github/workflows/tf-plan.yml
cp .github/workflows/tf-apply.yml template/.github/workflows/tf-apply.yml
cp .github/workflows/tf-command.yml template/.github/workflows/tf-command.yml
cp .github/workflows/tf-unlock.yml template/.github/workflows/tf-unlock.yml
cp .github/workflows/tf-cleanup.yml template/.github/workflows/tf-cleanup.yml
```

- [ ] **Step 2: Verify the template directory has all 5 files**

```bash
ls template/.github/workflows/
```

Expected: `tf-apply.yml  tf-command.yml  tf-cleanup.yml  tf-plan.yml  tf-status.yml  tf-unlock.yml`

- [ ] **Step 3: Commit**

```bash
git add template/
git commit -m "chore: mirror lock workflow changes to template/"
git push origin main
```

---

## Task 10: Mirror all changes to the consumer test repo

**Files (in `/Users/nexpeque/Documents/ebsco/kale/workflows/terraform-interactive-action-user/.github/workflows/`):**
- Modify: `tf-plan.yml`, `tf-apply.yml`, `tf-command.yml`
- Create: `tf-unlock.yml`, `tf-cleanup.yml`

- [ ] **Step 1: Copy workflows from action repo to consumer repo**

```bash
ACTION=../terraform-deploy-action
CONSUMER=/Users/nexpeque/Documents/ebsco/kale/workflows/terraform-interactive-action-user

cp $ACTION/.github/workflows/tf-plan.yml     $CONSUMER/.github/workflows/tf-plan.yml
cp $ACTION/.github/workflows/tf-apply.yml    $CONSUMER/.github/workflows/tf-apply.yml
cp $ACTION/.github/workflows/tf-command.yml  $CONSUMER/.github/workflows/tf-command.yml
cp $ACTION/.github/workflows/tf-unlock.yml   $CONSUMER/.github/workflows/tf-unlock.yml
cp $ACTION/.github/workflows/tf-cleanup.yml  $CONSUMER/.github/workflows/tf-cleanup.yml
```

- [ ] **Step 2: Commit and push the consumer repo**

```bash
cd $CONSUMER
git add .github/workflows/
git commit -m "feat: add cross-PR locking (S3 lock files, /tf unlock, PR close cleanup)"
git push origin main
```

---

## Task 11: Verify IAM permissions

- [ ] **Step 1: Check the OIDC role policy in AWS**

Verify the role `arn:aws:iam::436054236749:role/terraform-github-oidc-role` has `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` on `arn:aws:s3:::terraform-tfstates-436054236749-us-east-1-an/locks/*`.

If the role has `s3:*` on the full bucket (likely, since it manages state), no change is needed.

To check (requires AWS CLI with appropriate credentials):

```bash
aws iam list-role-policies \
  --role-name terraform-github-oidc-role \
  --output text
```

If `s3:*` is already granted on the bucket, mark this done. If not, the specific actions `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` on `arn:aws:s3:::terraform-tfstates-436054236749-us-east-1-an/locks/*` must be added to the role policy.

---

## Task 12: End-to-end smoke test

- [ ] **Step 1: Create a second test branch and PR**

```bash
cd /Users/nexpeque/Documents/ebsco/kale/workflows/terraform-interactive-action-user
git checkout -b test/lock-e2e
echo "# Lock test" >> infra/s3-bucket/README.md
git add infra/s3-bucket/README.md
git commit -m "test: trigger lock scenario"
git push origin test/lock-e2e
gh pr create --title "Lock E2E Test" --body "Testing cross-PR lock behavior" --base main
```

- [ ] **Step 2: Post `/tf plan` on the new PR**

```bash
gh pr comment <new-pr-number> --body "/tf plan"
```

Expected: Plan succeeds, lock acquired (`locks/s3-bucket.lock` exists in S3), plan comment appears.

- [ ] **Step 3: Post `/tf plan` on PR #1 (same project)**

```bash
gh pr comment 1 --body "/tf plan"
```

Expected: Comment on PR #1 says "🔒 Project `s3-bucket` is locked by PR #<new>" and job fails cleanly.

- [ ] **Step 4: Post `/tf unlock` on PR #1**

```bash
gh pr comment 1 --body "/tf unlock"
```

Expected: Comment "🔓 Terraform Unlock by @nexpeque: Released locks for `s3-bucket`."

- [ ] **Step 5: Post `/tf plan` on PR #1 again**

```bash
gh pr comment 1 --body "/tf plan"
```

Expected: Plan succeeds — lock re-acquired by PR #1.

- [ ] **Step 6: Close the new test PR without applying**

```bash
gh pr close <new-pr-number>
```

Expected: No lock cleanup comment (the lock is now owned by PR #1, not the closed PR).

- [ ] **Step 7: Delete the test branch**

```bash
git push origin --delete test/lock-e2e
```
