import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { __test } from "./knowledge-store";

const SCRIPT = resolve(import.meta.dir, "knowledge-store.ts");
const STORE = ".seeds/knowledge.jsonl";
const decoder = new TextDecoder();
const tempRoots: string[] = [];

interface RunResult {
	exitCode: number;
	stdout: string;
	stderr: string;
	envelope: {
		ok: boolean;
		command: string;
		data: unknown;
		error: null | {
			code: string;
			message: string;
			details?: unknown;
		};
	};
}

function tempRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "knowledge-store-test-"));
	tempRoots.push(root);
	return root;
}

function initSeeds(root: string): void {
	mkdirSync(join(root, ".seeds"));
}

function run(cwd: string, args: string[], stdin?: string): RunResult {
	const result = Bun.spawnSync({
		cmd: [process.execPath, SCRIPT, ...args],
		cwd,
		stdin,
	});
	const stdout = decoder.decode(result.stdout);
	const stderr = decoder.decode(result.stderr);
	const lines = stdout.split(/\r?\n/).filter((line) => line.length > 0);
	expect(lines).toHaveLength(1);
	return {
		exitCode: result.exitCode,
		stdout,
		stderr,
		envelope: JSON.parse(lines[0]),
	};
}

function expectError(result: RunResult, command: string, code: string): void {
	expect(result.exitCode).toBe(1);
	expect(result.stderr).toBe("");
	expect(Object.keys(result.envelope)).toEqual(["ok", "command", "data", "error"]);
	expect(result.envelope.ok).toBe(false);
	expect(result.envelope.command).toBe(command);
	expect(result.envelope.data).toBe(null);
	expect(result.envelope.error).not.toBeNull();
	expect(Object.keys(result.envelope.error as NonNullable<RunResult["envelope"]["error"]>)).toEqual(["code", "message"]);
	expect(result.envelope.error).toEqual({ code, message: expect.any(String) });
}

function recordFor(type: "convention" | "pattern" | "failure" | "decision" | "reference" | "guide", content: string) {
	const hash = createHash("sha256").update(`${type}:${content}`).digest("hex").slice(0, 6);
	return {
		id: `ex-${hash}`,
		type,
		content,
		recorded_at: "2026-01-01T00:00:00.000Z",
	};
}

afterEach(() => {
	for (const root of tempRoots.splice(0)) {
		rmSync(root, { recursive: true, force: true });
	}
});

test("record and count write success envelopes", () => {
	const root = tempRoot();
	initSeeds(root);
	const record = run(root, ["record", STORE, JSON.stringify({ type: "pattern", content: "Prefer focused tests." })]);
	expect(record.exitCode).toBe(0);
	expect(record.stderr).toBe("");
	expect(record.envelope).toMatchObject({
		ok: true,
		command: "record",
		error: null,
		data: {
			count: 1,
			record: {
				type: "pattern",
				content: "Prefer focused tests.",
			},
		},
	});
	expect((record.envelope.data as { record: { id: string } }).record.id).toMatch(/^ex-[0-9a-f]{6}$/);

	const count = run(root, ["count", STORE]);
	expect(count.exitCode).toBe(0);
	expect(count.stderr).toBe("");
	expect(count.envelope).toEqual({
		ok: true,
		command: "count",
		data: {
			count: 1,
			by_type: { pattern: 1 },
		},
		error: null,
	});
});

test("malformed JSON returns INVALID_JSON envelope and empty stderr", () => {
	const root = tempRoot();
	initSeeds(root);
	const result = run(root, ["record", STORE, "{not-json"]);
	expectError(result, "record", "INVALID_JSON");
	expect(result.stdout.trim()).toContain('"ok":false');
});

test("null record returns INVALID_RECORD", () => {
	const root = tempRoot();
	initSeeds(root);
	expectError(run(root, ["record", STORE, "null"]), "record", "INVALID_RECORD");
});

test("bad remove id returns INVALID_ARGUMENT", () => {
	const root = tempRoot();
	initSeeds(root);
	expectError(run(root, ["remove", STORE, "bad-id"]), "remove", "INVALID_ARGUMENT");
});

test("read and count tolerate missing .seeds without creating it", () => {
	const root = tempRoot();
	const read = run(root, ["read", STORE]);
	expect(read.exitCode).toBe(0);
	expect(read.envelope).toEqual({ ok: true, command: "read", data: [], error: null });

	const count = run(root, ["count", STORE]);
	expect(count.exitCode).toBe(0);
	expect(count.envelope).toEqual({ ok: true, command: "count", data: { count: 0, by_type: {} }, error: null });
	expect(existsSync(join(root, ".seeds"))).toBe(false);
});

test("mutating commands require existing .seeds directory", () => {
	const root = tempRoot();
	expectError(run(root, ["record", STORE, JSON.stringify({ type: "pattern", content: "No implicit init." })]), "record", "STORE_NOT_INITIALIZED");
	expectError(run(root, ["remove", STORE, "ex-123abc"]), "remove", "STORE_NOT_INITIALIZED");
	expectError(run(root, ["rewrite", STORE, JSON.stringify([])]), "rewrite", "STORE_NOT_INITIALIZED");
	expect(existsSync(join(root, ".seeds"))).toBe(false);
});

test("path traversal and absolute store paths are rejected", () => {
	const root = tempRoot();
	expectError(run(root, ["count", "../.seeds/knowledge.jsonl"]), "count", "INVALID_ARGUMENT");
	expectError(run(root, ["count", join(root, STORE)]), "count", "INVALID_ARGUMENT");
});

test("symlinked .seeds parent is rejected before resolving", () => {
	const root = tempRoot();
	const outside = tempRoot();
	symlinkSync(outside, join(root, ".seeds"), "dir");

	expectError(run(root, ["count", STORE]), "count", "INVALID_ARGUMENT");
	expect(existsSync(join(outside, "knowledge.jsonl"))).toBe(false);
});

test("mutating commands reject symlinked .seeds parent without writing", () => {
	const root = tempRoot();
	const outside = tempRoot();
	symlinkSync(outside, join(root, ".seeds"), "dir");

	expectError(run(root, ["record", STORE, JSON.stringify({ type: "pattern", content: "Reject unsafe parent." })]), "record", "INVALID_ARGUMENT");
	expectError(run(root, ["remove", STORE, "ex-123abc"]), "remove", "INVALID_ARGUMENT");
	expectError(run(root, ["rewrite", STORE, JSON.stringify([])]), "rewrite", "INVALID_ARGUMENT");
	expect(existsSync(join(outside, "knowledge.jsonl"))).toBe(false);
	expect(existsSync(join(outside, "knowledge.jsonl.lock"))).toBe(false);
});

test("rewrite requires full records", () => {
	const root = tempRoot();
	initSeeds(root);
	const result = run(root, ["rewrite", STORE, JSON.stringify([{ type: "decision", content: "Missing id and timestamp." }])]);
	expectError(result, "rewrite", "INVALID_RECORD");
	expect(existsSync(join(root, STORE))).toBe(false);
});

test("rewrite accepts complete records produced by record", () => {
	const root = tempRoot();
	initSeeds(root);
	const record = run(root, ["record", STORE, JSON.stringify({ type: "reference", content: "Round-trip complete records." })]);
	expect(record.exitCode).toBe(0);
	const fullRecord = (record.envelope.data as { record: unknown }).record;

	rmSync(join(root, STORE), { force: true });
	const rewrite = run(root, ["rewrite", STORE, JSON.stringify([fullRecord])]);
	expect(rewrite.exitCode).toBe(0);
	expect(rewrite.stderr).toBe("");
	expect(rewrite.envelope).toEqual({
		ok: true,
		command: "rewrite",
		data: { count: 1 },
		error: null,
	});
	expect(readFileSync(join(root, STORE), "utf8").trim()).toBe(JSON.stringify(fullRecord));
});

test("rewrite rejects duplicate ids with stable error", () => {
	const root = tempRoot();
	initSeeds(root);
	const record = recordFor("guide", "Keep one id per knowledge item.");

	const result = run(root, ["rewrite", STORE, JSON.stringify([record, record])]);
	expectError(result, "rewrite", "DUPLICATE_RECORD_ID");
	expect(existsSync(join(root, STORE))).toBe(false);
});

test("rewrite cap returns stable domain error", () => {
	const root = tempRoot();
	initSeeds(root);
	const records = Array.from({ length: 81 }, (_, index) => recordFor("reference", `Cap record ${index}.`));

	const result = run(root, ["rewrite", STORE, JSON.stringify(records)]);
	expectError(result, "rewrite", "STORE_LIMIT_EXCEEDED");
	expect(existsSync(join(root, STORE))).toBe(false);
});

test("record cap returns stable domain error", () => {
	const root = tempRoot();
	initSeeds(root);
	const records = Array.from({ length: 80 }, (_, index) => recordFor("pattern", `Existing cap record ${index}.`));
	const rewrite = run(root, ["rewrite", STORE, JSON.stringify(records)]);
	expect(rewrite.exitCode).toBe(0);

	const result = run(root, ["record", STORE, JSON.stringify({ type: "pattern", content: "One too many." })]);
	expectError(result, "record", "STORE_LIMIT_EXCEEDED");
});

test("lock timeout returns one stable CLI envelope", () => {
	const root = tempRoot();
	initSeeds(root);
	const lockPath = join(root, `${STORE}.lock`);
	writeFileSync(lockPath, JSON.stringify({ pid: 123, token: "held", createdAt: new Date().toISOString() }));

	const result = run(root, ["remove", STORE, "ex-123abc"]);
	expectError(result, "remove", "LOCK_TIMEOUT");
	expect(existsSync(lockPath)).toBe(true);
}, 10_000);

test("lock release only removes matching token", () => {
	const root = tempRoot();
	const storePath = join(root, STORE);
	const lockPath = __test.lockPath(storePath);
	mkdirSync(join(root, ".seeds"));
	writeFileSync(lockPath, JSON.stringify({ pid: 123, token: "new-owner", createdAt: new Date().toISOString() }));

	__test.releaseLock({ path: lockPath, token: "old-owner" });
	expect(existsSync(lockPath)).toBe(true);

	__test.releaseLock({ path: lockPath, token: "new-owner" });
	expect(existsSync(lockPath)).toBe(false);
});
