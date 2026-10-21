---
name: b200-run
description: Run a training/eval/profiling job on the `b200` host end to end — sync the repo, pause whatever GPU co-tenants are running (usually vLLM + an ARC-AGI benchmark, but the set changes), launch, poll in-turn, copy checkpoints back, eval, and always restore the paused services. Use when the user asks to train, eval, or profile "on b200", or to pause/restart b200 vllm or arc agi, or to hold/reserve N GB of VRAM on b200.
---

# B200 run

Host `b200` (ssh alias). Shared root `R=/NHNHOME/WORKSPACE/26motir001_F`. GPU lock `$R/.b200-gpu.lock` — every GPU job runs under `flock -n` on it.

Use the user's command, envs, and run dir. Use the existing launch/eval scripts; don't write a harness. Run each step as a plain ssh one-liner.

## 1. Sync

The remote checkout is `$R/<repo>-<short-sha>`. If it exists for the current HEAD, rsync only changed files into it. Otherwise create it:

```bash
rsync -aL --exclude=.venv --exclude=__pycache__ --exclude=.git --exclude='*.pyc' <paths> b200:$R/<repo>-<sha>/
```

## 2. Pause co-tenants

Co-tenants vary, so discover them; don't assume. List GPU and serving processes: `ssh b200 'pgrep -af "vllm serve|inference-taaf|make interactive|vram-hold"; tmux ls; nvidia-smi'`. Confirm the list with the user if it isn't vLLM + ARC.

For each co-tenant, save its argv, cwd, and `/proc/<pid>/environ` to `<run>/service-pause/` (mode 600), then stop it:
- vLLM: SIGTERM the process group, check port 8000 is closed, SIGKILL any leftovers.
- ARC: SIGTERM, then SIGCONT the group. ARC can't be resumed in memory; restarting it starts a fresh run.

Do this only when the user asked for the pause.

### VRAM hold (optional)

If the user asks to hold VRAM (default 120 GB per GPU), start a hold right after the pause, so nothing else grabs the freed memory before launch. The hold allocates memory with `cuMemAlloc` and runs no kernels. It does not take the lock:

```bash
ssh b200 'R=/NHNHOME/WORKSPACE/26motir001_F; CUDA_VISIBLE_DEVICES=<gpus> setsid nohup python3 -c "
import ctypes as C,os,sys,time; n=int(sys.argv[1]); open(sys.argv[2],\"w\").write(str(os.getpid()))
cu=C.CDLL(\"libcuda.so.1\"); cu.cuInit(0); k=C.c_int(); cu.cuDeviceGetCount(C.byref(k)); x=[]
for i in range(k.value):
  c=C.c_void_p(); p=C.c_uint64(); cu.cuCtxCreate_v2(C.byref(c),0,i); r=cu.cuMemAlloc_v2(C.byref(p),C.c_size_t(n<<30)); assert r==0,f\"gpu {i}: cuMemAlloc error {r}\"; x.append(p)
print(\"holding\",n,\"GB x\",len(x),flush=True); time.sleep(1e9)" <N> $R/.vram-hold.pid > $R/.vram-hold.log 2>&1 < /dev/null &'
```

This uses only plain `python3` and the driver's `libcuda.so.1`, so it needs no torch. Check that `nvidia-smi --query-gpu=index,memory.used --format=csv` rose by about N GB per GPU. `cuMemAlloc error 2` means out of memory, so report the free memory. To release the hold, run `kill $(cat $R/.vram-hold.pid)` and wait until `nvidia-smi` shows the memory as freed.

## 3. Launch

Release the VRAM hold first, if there is one.

```bash
ssh b200 'R=/NHNHOME/WORKSPACE/26motir001_F; cd $R/<repo>-<sha> && setsid nohup bash -c "flock -n $R/.b200-gpu.lock <cmd>; echo \$? > <run>/run.exit" > <run>/run.log 2>&1 < /dev/null & echo $!'
```

Always detached like this, never as a subagent's child — the job must outlive the turn and the agent. Report the PID, log path, and ETA once.

## 4. Watch

Check `ps -p`, `tail run.log`, and `run.exit`. Speak up only for: done, nonzero exit, NaN/inf or a traceback in the log, or no log progress across 2 checks. Don't send progress updates in between.

- Claude Code: use `Monitor` with a shell loop (every 3 min) that prints a line only on those events. Never `ScheduleWakeup` — it fires late.
- Codex/others: poll in-turn every 10–15 min.

## 5. Copy back and eval

`rsync -a b200:<run>/checkpoints/ <local run>/checkpoints/` — no `--delete`. Check that the `.pt` counts match. If training failed, still copy the partial checkpoints. Eval every checkpoint with the repo's eval command, on b200 under the lock.

## 6. Restore — always

Run this even when training or eval failed, unless the user said to leave services down. Release any VRAM hold that is still running. Order:
1. vLLM: relaunch from the saved argv/cwd/env (or `$R/llm-serve/serve.sh` in tmux session `vllm`). Wait for `curl -s 127.0.0.1:8000/health` to return 200.
2. ARC and other co-tenants: relaunch from the saved record (ARC is usually `$R/arc3/launch-60pass.sh`). Check that the process is alive.

## 7. Report

≤6 lines: exit code, checkpoints copied, eval results, service health, log paths.
