# terraform-deploy-action

Atlantis-inspired GitHub Actions Terraform automation for AWS-backed infrastructure in private organization repositories.

## Features

- PR comment commands (`/tf plan`, `/tf apply`, `/tf show`) to drive Terraform operations
- Automatically detects which projects are affected by PR changes
- CODEOWNERS-gated apply: all targeted projects must have required owner approval before apply runs
- Apply-before-merge enforcement via `terraform/apply-required` branch protection status check
- Auto-merges the PR and deletes the branch after a successful apply
- Multi-project support in a single repository

## Setup

### 1. Copy the example config

```bash
cp .terraform-deployment.example.yaml .terraform-deployment
```

Edit `.terraform-deployment` to define your projects, S3 backend, and AWS roles.

### 2. Add workflows to your infrastructure repository

Copy `.github/workflows/tf-command.yml`, `tf-plan.yml`, `tf-apply.yml`, and `tf-status.yml` into your repository's `.github/workflows/` directory.

### 3. Configure AWS OIDC

Each project's `deploy.role_arn` must reference an IAM role that trusts GitHub Actions via OIDC:

```json
{
  "Effect": "Allow",
  "Principal": { "Federated": "arn:aws:iam::ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com" },
  "Action": "sts:AssumeRoleWithWebIdentity",
  "Condition": {
    "StringEquals": { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
    "StringLike": { "token.actions.githubusercontent.com:sub": "repo:YOUR_ORG/YOUR_REPO:*" }
  }
}
```

### 4. Configure branch protection

In your repository settings, add a branch protection rule for your default branch that requires the `terraform/apply-required` status check to pass before merging. This prevents merging before apply.

> **Note:** The `terraform/apply-required` status check is set to `pending` when `/tf plan` succeeds and resolved to `success` after `/tf apply` succeeds. This action is designed for **Terraform-only infrastructure repositories** where every PR is expected to contain Terraform changes. If your repository has PRs that do not touch Terraform (e.g. documentation), those PRs will have a permanently `pending` `terraform/apply-required` status. In that case, either exclude those PRs using per-file status check rules or configure `require_apply_before_merge: false` in your `.terraform-deployment` config.

### 5. Add CODEOWNERS

Define a `CODEOWNERS` file at the repository root, `.github/CODEOWNERS`, or `docs/CODEOWNERS`. Owners assigned to a project's directory must approve the PR before `/tf apply` is allowed.

## Commands

| Command | Behavior |
|---|---|
| `/tf plan` | Plans all projects affected by this PR's changed files |
| `/tf plan <project>` | Plans a specific project by name |
| `/tf apply` | Applies all changed projects — blocked if any lacks CODEOWNERS approval |
| `/tf apply <project>` | Applies a specific project — requires CODEOWNERS approval |
| `/tf show <project>` | Shows the latest saved plan for a project |

## Configuration Reference

| Field | Required | Description |
|---|---|---|
| `version` | yes | Must be `1` |
| `defaults.terraform_version` | no | Default Terraform CLI version |
| `defaults.aws_region` | no | Default AWS region |
| `defaults.backend.bucket` | no | Default S3 state bucket |
| `defaults.backend.dynamodb_table` | no | Default DynamoDB lock table |
| `defaults.policies.require_apply_before_merge` | no | Block merge until apply succeeds (default: `true`) |
| `projects[].name` | yes | Unique project identifier used in commands |
| `projects[].dir` | yes | Terraform root module directory |
| `projects[].when_modified` | no | Glob patterns that trigger this project; defaults to `<dir>/**` |
| `projects[].workspace` | no | Terraform workspace name (default: `default`) |
| `projects[].backend.key` | yes* | S3 object key for the state file |
| `projects[].deploy.role_arn` | yes | IAM role ARN to assume for this project |
| `projects[].deploy.aws_region` | no | Per-project AWS region override |
