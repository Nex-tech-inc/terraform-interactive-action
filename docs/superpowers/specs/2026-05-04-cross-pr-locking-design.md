# Cross-PR Terraform Locking

**Date:** 2026-05-04  
**Status:** Approved

## Problem

The action currently prevents concurrent runs *within* the same PR via GitHub Actions `concurrency` groups. It provides no protection across PRs: if PR #1 and PR #2 both target the same Terraform project, they can plan freely and the second `apply` crashes with a raw Terraform state lock error. This is confusing to users and leaves state potentially inconsistent.

## Goal

Replicate Atlantis-style cross-PR locking: when a project is already planned by one PR, a second PR attempting to plan the same project gets a friendly comment explaining who holds the lock and how to release it.

## Lock Storage

Locks are stored as JSON objects in the existing Terraform state S3 bucket under a `locks/` prefix:

```
s3://{backend_bucket}/locks/{project-name}.lock
```

### Lock Object Schema

```json
{
  "pr_number": 42,
  "head_sha": "abc123...",
  "locked_by": "nexpeque",
  "locked_at": "2026-05-04T18:32:00Z",
  "repo": "Nex-tech-inc/terraform-interactive-action-user"
}
```

- Lock key is `project.name` from `.terraform-deployment` (not workspace or state key).
- Two projects sharing a workspace have independent locks.
- Lock files are small (~200 bytes) and incur negligible S3 cost.

## Lock Lifecycle

### Acquire (during `/tf plan`)

Run before `terraform init`, once per matrix project:

1. Attempt `aws s3api get-object --bucket {bucket} --key locks/{project}.lock /tmp/lock.json`
2. **Exit code non-zero (object not found):** Acquire the lock using a conditional write:
   ```
   aws s3api put-object --bucket {bucket} --key locks/{project}.lock \
     --body /tmp/new-lock.json --if-none-match "*"
   ```
   - If the conditional write succeeds (HTTP 200): proceed with plan.
   - If the conditional write returns 412 (race condition — another plan acquired simultaneously): re-read the lock and treat as "locked by another PR" below.
3. **Exit code zero, `pr_number == current PR`:** Lock already owned — proceed (re-plan is allowed).
4. **Exit code zero, `pr_number != current PR`:** Post comment and fail:
   > 🔒 **Project `{name}` is locked by PR #{n}** (@{locked_by}, since {locked_at}).
   > 
   > Run `/tf unlock` in this PR to steal the lock if that PR is abandoned.

### Verify + Release (during `/tf apply`)

Before running `terraform apply`:

1. Read the lock file; if missing or `pr_number` doesn't match current PR, post comment and abort:
   > ⚠️ Lock mismatch for `{name}`. Run `/tf plan` on this PR before applying.

After **successful** apply:

- Delete the lock: `aws s3api delete-object --bucket {bucket} --key locks/{project}.lock`

After **failed** apply:

- Keep the lock. Prevents another PR from applying against a potentially dirty state.

### Auto-Release (PR closed or merged)

A new workflow `tf-cleanup.yml` listens on `pull_request: [closed]`:

1. Checks out the default branch to read `.terraform-deployment`.
2. For each project, reads its lock file from S3.
3. If `pr_number` matches the closed PR number, deletes the lock.
4. Posts a comment on the closed PR listing which locks were released (if any).

### Force Release (`/tf unlock`)

Any collaborator with write access can run `/tf unlock` on any PR:

1. `tf-command.yml` dispatcher recognises `/tf unlock` and calls new reusable workflow `tf-unlock.yml`.
2. `tf-unlock.yml` reads all projects from `.terraform-deployment`, deletes their lock files unconditionally, and posts a summary comment:
   > 🔓 Lock released for `{name}` by @{commenter}.

`/tf unlock` releases locks for *all* projects in the repo config (same scope as `/tf plan` and `/tf apply`). Future: project-scoped `/tf unlock {project}` can be added if needed.

## IAM Requirements

The OIDC role needs the following on `arn:aws:s3:::{bucket}/locks/*`:

- `s3:GetObject`
- `s3:PutObject`
- `s3:DeleteObject`

If the role currently has `s3:*` on the full bucket, no IAM changes are needed.

## Files Changed

| File | Change |
|---|---|
| `.github/workflows/tf-plan.yml` | Add lock-acquire step (before `terraform init`) per matrix project |
| `.github/workflows/tf-apply.yml` | Add lock-verify step (before apply); add lock-release step (after successful apply) |
| `.github/workflows/tf-command.yml` | Add `/tf unlock` branch in dispatcher; add new `tf-cleanup.yml` trigger on PR close |
| `.github/workflows/tf-unlock.yml` | New reusable workflow: delete all project locks, post comment |
| `.github/workflows/tf-cleanup.yml` | New workflow: `pull_request: [closed]` → auto-release locks owned by the closed PR |
| `template/` | Mirror all changes above into the template directory |

## Concurrency Interaction

The existing `concurrency: group: tf-${{ github.event.issue.number }}` in `tf-command.yml` remains unchanged. It prevents concurrent runs *within* the same PR. The S3 lock layer adds cross-PR protection on top of it.

## Error Scenarios

| Scenario | Behaviour |
|---|---|
| PR #1 plans, PR #1 plans again | Lock re-used (same PR), proceed |
| PR #1 plans, PR #2 plans same project | PR #2 gets friendly lock comment, job fails |
| PR #1 applies, PR #2 was already blocked | After apply lock is released, PR #2 can now plan |
| PR #1 apply fails | Lock retained; PR #1 must re-plan and re-apply |
| PR #1 closed without applying | `tf-cleanup.yml` deletes lock automatically |
| Two plans fire simultaneously (race) | `--if-none-match "*"` ensures only one acquires; other gets 412 and posts lock comment |
| `/tf unlock` run | Lock deleted for all projects; any PR can now plan |
