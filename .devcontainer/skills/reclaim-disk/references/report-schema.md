# Report schema

Scanner emits canonical JSON with these top-level fields:

- `schema_version`, `scanner_version`
- `generated_at`, `expires_at`
- `report_sha256`: SHA-256 over canonical JSON after removing this field
- `host`: boot ID when readable
- `workspace`: requested path, realpath, device, inode, filesystem totals
- `docker`: availability, context, daemon ID, global disk summary
- `limits`: age, timeout, output, and item bounds
- `errors`: bounded structured failures
- `complete`: whether all requested sections completed
- `summary`: counts and estimated bytes by class and kind
- `resources`: fixed deletion candidates and protected/review findings

Each resource contains:

- `id`, `kind`, `class`, `reason_keys`
- `locator` and immutable `fingerprint`
- `estimated_bytes`, `created_at` or `commit_time`
- ownership, activity, reference, and preservation evidence
- exact `proposed_argv` only for eligible secondary worktrees, Docker images, or anonymous local Docker volumes

Only `git_worktree`, `docker_image`, and `docker_volume` resources may be `eligible`. Worktree evidence includes exact path/device/inode, common Git directory, HEAD, branch, status hashes, process visibility/activity, age, plus dirty/detached/preservation warnings. Image evidence includes exact immutable ID, complete tag list, RootFS, creation time, reference state, and daemon ID. Volume evidence includes `anonymous`, `local`, reference state, exact name, Docker anonymous-label presence, creation time, driver, mountpoint, and daemon ID. Containers, named volumes, and build cache are always `protected` and omit `proposed_argv`.

Estimates use allocated worktree bytes when available and Docker-reported bytes otherwise. Eligible image estimates use Docker's per-image unique-size figure as a conservative lower bound. Shared layers reclaimable only after several images are removed can make actual recovery larger; image, build-cache, and cross-category totals remain non-additive.

Result JSON contains report/approval identity, start/end timestamps, before/after filesystem stats, measured free-space delta, and per-target `removed`, `skipped`, `failed`, or `unknown` outcomes.
