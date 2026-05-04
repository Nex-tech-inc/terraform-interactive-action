# Terraform Deploy Action Design

## Problem

Design a JavaScript-based GitHub Actions solution that mimics Atlantis-style Terraform workflows inside private GitHub organization repositories. Users should be able to issue PR comment commands to plan and apply Terraform changes, with behavior controlled by a repository config file named `.terraform-deployment`.

The system must:

- Support multiple Terraform projects in one repository
- Use a YAML config file similar in spirit to `atlantis.yaml`
- Be AWS-specific in the first version
- Support Atlantis-inspired PR commands using `/tf ...`
- Default `/tf plan` to planning only projects affected by the PR
- Require successful CODEOWNERS approval before apply
- Allow any authorized org/repo user to trigger commands
- Block merge until Terraform apply succeeds
- Auto-comment, merge, and delete the branch after a successful apply

## Goals

1. Deliver Atlantis-like PR-driven Terraform operations without a long-running service
2. Keep all execution and auditability inside native GitHub Actions
3. Provide a repo-level config model for projects, state storage, deployment roles, and policy
4. Make apply the required gate before merging infrastructure PRs

## Non-Goals

- Multi-cloud support in the first version
- A GitHub App or external control plane
- Full Atlantis command compatibility
- Direct manual merge after approval but before apply

## Recommended Architecture

The design uses a thin JavaScript action plus reusable workflows.

### Layer 1: PR Comment Entry Workflow

A repository workflow listens to `issue_comment` events on pull requests. It performs lightweight eligibility checks, then invokes the JavaScript action.

Responsibilities:

- Verify the comment belongs to a pull request
- Ignore unsupported comments
- Fetch PR metadata needed for command resolution
- Call the JavaScript action with event context

### Layer 2: JavaScript Control Action

The JavaScript action is the control plane. It does not run Terraform directly. It interprets commands, loads configuration, resolves affected projects, evaluates approval state, and emits structured outputs for downstream workflows.

Responsibilities:

- Parse `/tf` commands
- Load and validate `.terraform-deployment`
- Resolve changed projects from PR files
- Resolve explicit project names from config
- Evaluate CODEOWNERS-based apply eligibility
- Produce an execution payload for downstream workflows
- Generate structured status and comment content

### Layer 3: Reusable Terraform Workflows

Reusable GitHub workflows perform the actual `terraform init`, `plan`, and `apply` operations. These workflows consume the execution payload produced by the JavaScript action.

Responsibilities:

- Assume AWS roles with GitHub OIDC
- Configure the Terraform backend from project config
- Run plan/apply per targeted project
- Upload and consume plan artifacts
- Post result summaries back to the PR
- Manage apply-gated merge flow

## Command Model

Commands are custom, concise, and Atlantis-inspired:

- `/tf plan`
- `/tf plan <project>`
- `/tf apply`
- `/tf apply <project>`
- `/tf show <project>`

### Command Semantics

#### `/tf plan`

With no explicit project, the action determines which configured projects are affected by the PR. It does this by comparing changed files against each project's `dir` and optional `when_modified` patterns.

If matching projects are found, plan runs for that set only.

If no projects match, the action comments with a deterministic error.

#### `/tf plan <project>`

Plans exactly one configured project by name.

#### `/tf apply`

Targets the PR's changed project set. It is all-or-nothing: if any targeted project lacks the required approval state, the entire command is blocked.

#### `/tf apply <project>`

Applies only the named project, but still requires valid approval state and a previously generated plan artifact for that project.

#### `/tf show <project>`

Displays details from the most recent saved plan artifact for that project on the current PR context.

## Configuration Model

The repository contains a YAML file named `.terraform-deployment`.

### Shape

```yaml
version: 1
defaults:
  terraform_version: 1.9.0
  aws_region: us-east-1
  backend:
    bucket: org-terraform-state
    dynamodb_table: terraform-locks
  policies:
    require_apply_before_merge: true
projects:
  - name: network-prod
    dir: infra/network/prod
    when_modified:
      - infra/network/**
      - modules/vpc/**
    workspace: default
    backend:
      key: network/prod.tfstate
    deploy:
      role_arn: arn:aws:iam::111111111111:role/github-terraform-prod
      account_id: "111111111111"
      aws_region: us-east-1
```

### Config Responsibilities

The config defines:

- Global defaults shared across projects
- Project names and working directories
- Changed-file matching rules
- Terraform workspace selection
- S3 backend details and lock-table settings
- Deployment AWS accounts and role assumptions
- Policy flags such as apply-before-merge

### Resolution Rules

- Top-level defaults apply to all projects unless overridden
- Projects are referenced by `name` in PR commands
- Backend configuration is assembled from defaults plus project overrides
- Deployment role settings are resolved per project

## Changed Project Resolution

Changed-project detection is central to the Atlantis-like experience.

Algorithm:

1. Fetch PR changed files
2. Load configured projects
3. For each project, compare PR files against the project's `dir` and `when_modified` patterns
4. Collect all matching projects
5. Sort and de-duplicate the result for deterministic execution and comments

This powers the default behavior for `/tf plan` and `/tf apply`.

## Approval and Authorization Model

This product is intended for private repositories inside a GitHub organization.

### Who Can Issue Commands

Any allowed organization member or repository user with access can issue `/tf` commands.

This rule controls who may request execution, not whether apply is permitted to proceed.

### Who Can Unlock Apply

Apply is unlocked only by approval state, not by the identity of the commenter. The commenter does not need to be a code owner.

The action checks whether each targeted project has the required CODEOWNERS approval coverage for its changed files. If a targeted project is not sufficiently approved, apply does not run.

### Multi-Project Apply

For `/tf apply` across multiple projects, the rule is all-or-nothing. If any targeted project is missing the required approval state, the entire apply command is blocked.

The PR comment should name every blocked project so the operator knows exactly what is missing.

## Terraform Execution Model

### Plan

For each targeted project:

1. Assume the configured AWS role using OIDC
2. Run `terraform init` with the resolved backend settings
3. Run `terraform plan`
4. Upload the plan artifact
5. Post a PR summary comment and/or update a check run

Plan artifacts are keyed to:

- Pull request number
- Project name
- Commit SHA

This prevents apply from consuming a stale plan.

### Apply

Apply only runs if:

- The target set is fully approved
- A valid plan artifact exists for each target
- The artifact matches the current PR commit scope required by policy

For each targeted project:

1. Retrieve the saved plan artifact
2. Re-assume the configured AWS role
3. Run `terraform apply` using the saved plan artifact
4. Record the requesting user in output and logs

If any project fails apply, the PR is not merged and the apply-gate status remains unmet.

## Merge Control Model

Successful infrastructure apply is the required merge gate.

### Branch Protection

The repository uses branch protection so that a dedicated status check, for example `terraform/apply-required`, must pass before merge is allowed.

That status remains failing or pending until a successful apply completes.

This means CODEOWNERS approval is necessary but not sufficient for merge.

### Post-Apply Automation

After a fully successful apply:

1. Comment that infrastructure changes were successfully applied
2. Comment that the PR will now be auto-closed by merge
3. Merge the PR
4. Delete the source branch

If merge or branch deletion fails, the workflow reports that explicitly.

## Failure Handling

Every command yields a deterministic, user-visible outcome.

Expected failure cases include:

- Unsupported or malformed command
- Unknown project name
- No changed projects found
- Missing or invalid `.terraform-deployment`
- Missing backend or role configuration
- Missing required CODEOWNERS approval
- Missing, stale, or incompatible plan artifact
- Terraform plan failure
- Terraform apply failure
- Merge failure
- Branch deletion failure

The action should comment with precise, project-aware error messages rather than generic failures.

## JavaScript Module Boundaries

To keep the implementation testable, the JavaScript code should be split into focused modules:

- `command-parser`: parse `/tf` command syntax into an execution intent
- `config-loader`: read and validate `.terraform-deployment`
- `project-resolver`: map PR changes and explicit names to project sets
- `codeowners-evaluator`: determine whether targeted projects satisfy approval requirements
- `execution-payload`: produce normalized outputs for workflows
- `comment-renderer`: render deterministic PR comments and summaries

These modules should be independent enough to unit test in isolation.

## Testing Strategy

The design calls for both unit and integration coverage.

### Unit Tests

- Command parsing
- Config validation
- Changed-project resolution
- Approval evaluation
- Merge-gate decision logic
- Output rendering

### Integration Tests

- `/tf plan` against changed projects
- `/tf plan <project>`
- blocked `/tf apply` when approvals are missing
- successful `/tf apply` after approval
- stale-plan rejection
- post-apply merge and branch deletion flow

## Open Decisions Deferred to Planning

These are implementation details, not design blockers:

- Whether plan/apply fan out through a matrix job or one workflow per project
- Exact artifact naming conventions
- Exact PR comment formatting
- Exact branch protection check name
- Whether CODEOWNERS evaluation is implemented directly or via a GitHub API helper library

## Recommendation Summary

Build a JavaScript control action that interprets `/tf` PR commands and a set of reusable GitHub workflows that execute Terraform operations on AWS. Use `.terraform-deployment` as the single source of truth for projects, state, and roles. Make `/tf plan` default to changed projects, make `/tf apply` depend on prior plan artifacts and CODEOWNERS approval, and make successful apply the only path to merge.
