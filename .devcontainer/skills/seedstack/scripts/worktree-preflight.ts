import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

export type WorktreePolicy = "linked-ok" | "allow-same-branch";

export type RepoPreflightOptions = {
  repoInput: string;
  cwd: string;
  policy: WorktreePolicy;
  requireWorktree: boolean;
};

export type WorktreeMetadata = {
  original_repo_input: string;
  original_repo_path: string;
  repo: string;
  git_common_dir: string | null;
  git_dir: string | null;
  worktree_root: string | null;
  branch: string | null;
  head: string | null;
  linked: boolean;
  policy: WorktreePolicy;
  require_worktree: boolean;
};

export type RepoPreflight = {
  repo: string;
  metadata: WorktreeMetadata;
};

// Records git common dir/git dir separately so linked worktrees are diagnosable.
type WorktreeEntry = {
  path: string;
  branch: string | null;
};

function git(repo: string, args: string[]): string {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    maxBuffer: 5 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function gitOrNull(repo: string, args: string[]): string | null {
  try {
    const out = git(repo, args);
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

function parseWorktreeList(raw: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = [];
  let current: WorktreeEntry | null = null;
  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith("worktree ")) {
      if (current) entries.push(current);
      current = { path: resolve(line.slice("worktree ".length)), branch: null };
    } else if (current && line.startsWith("branch ")) {
      current.branch = line.slice("branch ".length);
    }
  }
  if (current) entries.push(current);
  return entries;
}

function normalizeBranch(branch: string | null): string | null {
  if (!branch) return null;
  return branch.startsWith("refs/heads/") ? branch : `refs/heads/${branch}`;
}

function sameBranchDuplicates(repo: string, worktreeRoot: string, branch: string | null): string[] {
  const normalized = normalizeBranch(branch);
  if (!normalized) return [];
  const raw = gitOrNull(repo, ["worktree", "list", "--porcelain"]);
  if (!raw) return [];
  return parseWorktreeList(raw)
    .filter((entry) => entry.path !== worktreeRoot && entry.branch === normalized)
    .map((entry) => entry.path)
    .sort();
}

export function preflightRepo(options: RepoPreflightOptions): RepoPreflight {
  const originalRepoPath = resolve(options.cwd, options.repoInput);
  const worktreeRoot = gitOrNull(originalRepoPath, ["rev-parse", "--show-toplevel"]);
  const repo = worktreeRoot ? resolve(worktreeRoot) : originalRepoPath;
  const gitCommonDir = gitOrNull(repo, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  const gitDir = gitOrNull(repo, ["rev-parse", "--path-format=absolute", "--git-dir"]);
  const branchName = gitOrNull(repo, ["branch", "--show-current"]);
  const head = gitOrNull(repo, ["rev-parse", "HEAD"]);
  const linked = !!(worktreeRoot && gitDir && gitCommonDir && resolve(gitDir) !== resolve(repo, ".git"));

  const metadata: WorktreeMetadata = {
    original_repo_input: options.repoInput,
    original_repo_path: originalRepoPath,
    repo,
    git_common_dir: gitCommonDir ? resolve(gitCommonDir) : null,
    git_dir: gitDir ? resolve(gitDir) : null,
    worktree_root: worktreeRoot ? repo : null,
    branch: branchName || null,
    head,
    linked,
    policy: options.policy,
    require_worktree: options.requireWorktree,
  };

  if (worktreeRoot && options.requireWorktree && !linked) {
    throw new Error("require-worktree failed: repo is main worktree, not linked worktree");
  }

  if (worktreeRoot && linked && options.policy === "linked-ok") {
    const duplicates = sameBranchDuplicates(repo, repo, branchName);
    if (duplicates.length > 0) {
      throw new Error(`same-branch linked worktree blocked by linked-ok policy: ${duplicates.join(", ")}`);
    }
  }

  return { repo, metadata };
}
