# Safety policy

## Classes

- `eligible`: every automated deletion invariant proven during scan. Still requires explicit report-bound approval and live revalidation.
- `review`: looks reclaimable but ownership, preservation, provenance, or content safety is incomplete. Applier rejects it.
- `protected`: active, primary, referenced, sensitive, outside scope, too recent, or affected by blocking scan uncertainty. Applier rejects it. Dirty worktrees instead carry an explicit warning.

## Git worktrees

Secondary worktree eligibility requires:

- Registered secondary worktree with canonical path strictly below configured workspace.
- Worktree directory device and inode recorded.
- Not locked, prunable, or active through any visible process CWD, root, or open fd.
- HEAD commit meets configured worktree minimum age: 14 days by default.
- Git inspection completed without timeout or truncation.

Dirty status, detached HEAD, failure to reach a local default/upstream ref, and incomplete process visibility are deletion warnings, not blockers. List these warnings for every candidate before requesting explicit approval. Approval deliberately permits loss of uncommitted files and commits without preserving refs. Incomplete process visibility means hidden processes may still use a candidate. A stale local remote-tracking ref does not prove a remote PR is closed; state these limitations.

At apply time, require unchanged path, device, inode, common Git directory, HEAD, branch/detached state, tracked/untracked status hash, ignored status hash, registration, and age. Recheck process activity. Use only exact `git -C <primary> worktree remove --force <path>` recorded in report. Never delete primary worktree or use recursive filesystem removal.

## Docker

Image eligibility requires every condition:

- Exact immutable `sha256:` image ID is report-bound.
- Every container was enumerated successfully and none references image ID.
- Image meets configured image minimum age: 14 days by default.
- Exact ID, creation time, RootFS, complete tag list, daemon ID, and context are unchanged at apply time.

Tagged and dangling images use same rule. Removing tagged images loses local snapshots and may require later pulls or rebuilds. Containers, named volumes, and build cache remain scan/report-only and never eligible.

Anonymous-volume eligibility requires every condition:

- Exact name matches 64 lowercase hexadecimal characters.
- Label key `com.docker.volume.anonymous` exists; its value is not interpreted.
- Driver is `local`.
- Every container was enumerated successfully and none references the volume.
- Volume meets configured volume minimum age: 30 days by default.
- Exact name, creation time, driver, mountpoint, daemon ID, and context are report-bound and unchanged at apply time.

BenchFlow ownership labels are irrelevant for anonymous-volume eligibility. Protect every referenced volume and every named volume, including agent-home/config/history volumes.

Never invoke `docker system prune`, `docker image prune`, `docker volume prune`, `docker container prune`, `docker builder prune`, or BuildKit prune. Never select deletion targets by glob, prefix, repository, tag, or display name. For an image carrying multiple tags, its report-bound command may name the complete exact tag list so Docker can remove every repository reference without `--force`.

## Approval and application

Approval binds to unexpired report SHA-256 plus exact target IDs. Recompute report hash before use. Match workspace realpath/device/inode and Docker context/daemon ID. Revalidate each target immediately before its exact command. Never replace missing targets with newly discovered resources.

Run sequentially using only report-recorded exact Git or Docker commands. Target-specific validation failure skips that target. Workspace identity change, Docker identity change, malformed report, timeout after mutation may have started, or other systemic uncertainty stops remaining work. Never retry ambiguous mutation.

## Bounds

Keep filesystem traversal on one device, do not follow symlinks, bound command time and captured bytes, and cap discovered resources. Record incomplete sections and errors. Any incomplete section makes affected resources ineligible.
