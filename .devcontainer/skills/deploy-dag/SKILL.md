---
name: deploy-dag
description: After a rlwrld-mwaa PR is merged — wait for the S3 deploy workflow (dispatch it if it didn't start), trigger the DAG on MWAA, watch the run to a terminal state, and report. Use when the user says "merged, monitor and trigger", "deploy and trigger", or "watch the deploy".
---

# Deploy DAG

Runs only after the user says the PR is merged. Repo `rlwrld-mwaa`. `P="--name rlwrld-mwaa --region us-east-1 --profile rlwrld-sso"`.

1. **Deploy.** `gh run list -w deploy-mwaa-s3.yml -b main -L 3` — find the run for the merge commit. If none within 5 min, `gh workflow run deploy-mwaa-s3.yml --ref main`. `gh run watch <id> --exit-status`. On failure, report the failing step and stop.
2. **Parsed.** Poll `aws mwaa invoke-rest-api $P --method GET --path /dags/<dag>` until `last_parsed_time` is after the deploy finished and `is_paused` is what the user expects. Don't unpause unless asked.
3. **Trigger.** `aws mwaa invoke-rest-api $P --method POST --path /dags/<dag>/dagRuns --body '{"dag_run_id":"manual__<pr|slug>_<UTC yyyymmddThhmmssZ>","conf":{...}}'` — conf only if the user gave one.
4. **Watch.** GET `/dags/<dag>/dagRuns/<run_id>` until `success` or `failed` (in Claude Code use `Monitor`; elsewhere poll in-turn every 2–3 min, silent between checks). On failure, GET `.../taskInstances`, then the failed task's `/logs/<try_number>` and pull the first error line.
5. **Report** ≤4 lines: deploy run id, DAG run id, state, duration; on failure the task, try, and error line.
