---
name: deploy-dag
description: Check rlwrld-mwaa deployment readiness before merge, then monitor S3 deployment and authorized DAG runs. Use for MWAA merge readiness, "merged, monitor and trigger", "deploy and trigger", or "watch the deploy".
---

# Deploy DAG

Repo `rlwrld-mwaa`. `P="--name rlwrld-mwaa --region us-east-1 --profile rlwrld-sso"`.

## Before merge or manual deployment

Matching pushes to `main` auto-deploy. Worker image releases (`:latest` for Batch stages) are separate: follow exp-bundle-pipeline `skills/release-worker`. For changes to DAGs, shared runtime code or scanner fingerprints, complete this check before declaring the PR ready to merge:

- Identify affected DAGs, including consumers of shared modules. Record original pause states. Inspect queued/running DagRuns and unfinished tasks, including scheduled, queued, deferred, up_for_retry and up_for_reschedule.
- Verify corresponding native Slurm and Batch jobs are terminal. A terminal Airflow run does not prove external work stopped; paused DAGs can retain unfinished runs and blocked retries.
- For bundle captures, also inspect the current capture's frozen intent and pending handoff against matching READY and source ACK/cursor proofs. A post-scan idle timeout can end the native job while delivery remains unfinished. Do not call that drained: complete the handoff or record a compatible, explicitly authorized recovery plan before changing its release. Preserve pending state and frozen artifacts.
- Report exact blockers. Drain existing work using the unchanged release, then recheck immediately before merge/deploy. Drained means: no queued, running or up_for_retry runs; no live Slurm or Batch jobs; `current.json` intent is the one you expect; and, for bundle captures, a READY baseline is reachable along the intent `previous` chain. A paused DAG alone is not drained. Preserve original pause states.
- If pausing blocks drain, obtain explicit authorization for a bounded unpause/re-pause. Before any unpause, read the DAG's `next_dagrun_run_after`. If it is in the past, the scheduler starts a catch-up scheduled run at once; with `max_active_runs=1` it blocks a manual run, and failing it (task, then run) is a separate authorized write. Any re-pause monitor must take the real run id and a guard time computed after the unpause, in the future; confirm both before relying on it.
- Keep affected schedules paused through deployment when authorized, or verify a quiet window covering deployment. Recheck active work immediately before merge/dispatch.

### Kakao and other Slurm v2 capture DAGs (`capture_*_slurm_v2`): hard gate

Recovering a broken Kakao run costs hours (full re-verification, OOM retries, pause guards). Treat any deploy that could touch these DAGs as high risk.

- **Frozen capture fingerprints.** Files in `ops.ZIP_FILES` (`common/exp_track/capture_bundle/{__init__,records,selection,storage,capture,exclusions,detached,ckid_runner,checkpoints,daily,canary,io}.py`, `ckid.py`, the `common/` and `common/exp_track/` `__init__.py`) change `code_sha256`. Kakao also packages `presigned_delivery.py` separately: editing it changes `script_sha256` even though it is outside `ops.ZIP_FILES`. Either can block frozen retries. For these changes, no affected v2 Slurm DAG may have an unfinished intent, run, retry or `recover_from` pending. Controller-only changes such as `bundle_slurm_capture.py` avoid those native fingerprints, but still require the drain check.
- **Never deploy while Kakao is mid-run, mid-delivery or mid-recovery**, including `up_for_retry`. A Slurm TIMEOUT or terminal state is not completion; READY and delivery must be verified.
- **Do not change Kakao pause state** or unpause it, trigger, cancel, resubmit or clear tasks without explicit authorization for that exact action. A paused DAG lets an already-running try finish but blocks a waiting retry (`up_for_retry`) and does not start queued runs, so a paused DAG with a retry pending is not drained; bounded unpause/re-pause needs explicit authorization and the unpause precheck above.
- **Prefer a quiet window.** Check `reports/v2/capture/<source>/current.json` and the active intent first. Merge right after Kakao delivers READY, not while a capture is in flight.
- **Recovery cost.** A missing or unusable READY baseline forces hours of full verification and retries. Since #403 (`a45b153`) the baseline is found by walking the intent `previous` chain (`BASELINE_HOPS`). Verify the baseline line (`V2 prior READY baseline=... raw_proofs=N`, N nonzero) on the first recovery attempt; `baseline=None` means full verification. A present but invalid older baseline is not guarded and can fail delivery (verify). Only exact proven raw objects reuse coverage; metadata and closure still require verification. Avoid creating recovery obligations through deployment.

After a deploy, treat the first Kakao recovery as a test: a retained frozen intent may fail the frozen-code check. Watch it and report; do not retry or reset state.

If deployment already crossed active work, inspect recovery before dispatching another deployment or triggering a new run. Do not cancel jobs, clear tasks, mark runs terminal or change pause states without authorization for that action.

## After merge

1. **Deploy.** `gh run list -w deploy-mwaa-s3.yml -b main -L 3` — find the run for the merge commit. If none within 5 min, recheck the drain gate and dispatch only when deployment is authorized: `gh workflow run deploy-mwaa-s3.yml --ref main`. Watch-only requests authorize monitoring. `gh run watch <id> --exit-status`. On failure, report the failing step and stop.
2. **Parsed.** Poll `aws mwaa invoke-rest-api $P --method GET --path /dags/<dag>` until `last_parsed_time` is after the deploy finished and `is_paused` is what the user expects. Every affected DAG, not just the one to trigger, needs a parse time newer than the deploy, and `/importErrors` must show no new errors. Don't unpause unless asked; if asked, do the unpause precheck under Before merge first.
3. **Trigger, when authorized.** A watch-only request or existing pause instruction does not authorize a new run. `aws mwaa invoke-rest-api $P --method POST --path /dags/<dag>/dagRuns --body '{"dag_run_id":"manual__<pr|slug>_<UTC yyyymmddThhmmssZ>","logical_date":null,"conf":{...}}'` — conf only if the user gave one. Airflow 3 requires `logical_date` (null is fine); omitting it returns 422.
4. **Watch.** GET `/dags/<dag>/dagRuns/<run_id>` until `success` or `failed` (in Claude Code use `Monitor`; elsewhere poll in-turn every 2–3 min, silent between checks). On failure, GET `.../taskInstances`, then the failed task's `/logs/<try_number>` and pull the first error line.
5. **Report** ≤4 lines: deploy run id, DAG run id, state, duration; on failure the task, try, and error line.
