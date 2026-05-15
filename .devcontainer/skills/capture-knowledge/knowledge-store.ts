#!/usr/bin/env bun
/**
 * knowledge-store.ts - JSONL knowledge store with advisory file locking.
 *
 * Usage:
 *   bun /path/to/knowledge-store.ts record  <file> '{"type":"pattern","content":"..."}'
 *   bun /path/to/knowledge-store.ts read    <file>
 *   bun /path/to/knowledge-store.ts count   <file>
 *   bun /path/to/knowledge-store.ts remove  <file> <id>
 *   bun /path/to/knowledge-store.ts rewrite <file> '<json-array>'
 *
 * Accepts --stdin for record/rewrite to avoid shell-escaping issues:
 *   echo '{"type":"failure","content":"..."}' | bun /path/to/knowledge-store.ts record <file> --stdin
 */

import { randomBytes, createHash } from "node:crypto";
import {
	closeSync,
	existsSync,
	lstatSync,
	openSync,
	readFileSync,
	realpathSync,
	renameSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

// --- Types ---

const VALID_TYPES = ["convention", "pattern", "failure", "decision", "reference", "guide"] as const;
const WARN_THRESHOLD = 60;
const MAX_RECORDS = 80;
const STORE_PATH = ".seeds/knowledge.jsonl";

type RecordType = (typeof VALID_TYPES)[number];

interface KnowledgeRecord {
	id: string;
	type: RecordType;
	content: string;
	recorded_at: string;
}

type ErrorCode =
	| "INVALID_ARGUMENT"
	| "INVALID_JSON"
	| "INVALID_RECORD"
	| "STORE_NOT_INITIALIZED"
	| "STORE_LIMIT_EXCEEDED"
	| "DUPLICATE_RECORD_ID"
	| "LOCK_TIMEOUT"
	| "IO_ERROR";

class CliError extends Error {
	constructor(
		public readonly code: ErrorCode,
		message: string,
		public readonly details?: unknown,
	) {
		super(message);
	}
}

function isRecordObject(input: unknown): input is Record<string, unknown> {
	return typeof input === "object" && input !== null && !Array.isArray(input);
}

// --- Store path ---

function resolveStorePath(input: string, options: { requireStoreDir: boolean }): string {
	if (isAbsolute(input)) throw new CliError("INVALID_ARGUMENT", `Store path must be ${STORE_PATH}`);
	if (input !== STORE_PATH) throw new CliError("INVALID_ARGUMENT", `Store path must be ${STORE_PATH}`);

	const repoRoot = realpathSync(process.cwd());
	const storePath = resolve(repoRoot, STORE_PATH);
	const parent = dirname(storePath);
	if (!existsSync(parent)) {
		if (options.requireStoreDir) {
			throw new CliError("STORE_NOT_INITIALIZED", ".seeds directory is required before mutating knowledge store");
		}
		return storePath;
	}
	validateStoreParent(repoRoot, parent);
	return storePath;
}

function assertSafeStoreDir(filePath: string): void {
	const repoRoot = realpathSync(process.cwd());
	const parent = dirname(filePath);
	if (!existsSync(parent)) {
		throw new CliError("STORE_NOT_INITIALIZED", ".seeds directory is required before mutating knowledge store");
	}
	validateStoreParent(repoRoot, parent);
}

function validateStoreParent(repoRoot: string, parent: string): void {
	const stat = lstatSync(parent);
	if (stat.isSymbolicLink() || !stat.isDirectory()) {
		throw new CliError("INVALID_ARGUMENT", ".seeds must be a directory inside repository root");
	}
	const realParent = realpathSync(parent);
	const relativeParent = relative(repoRoot, realParent);
	if (relativeParent === ".." || relativeParent.startsWith("../") || isAbsolute(relativeParent)) {
		throw new CliError("INVALID_ARGUMENT", ".seeds must not resolve outside repository root");
	}
}

// --- Lock ---

const LOCK_RETRY_MS = 50;
const LOCK_STALE_MS = 30_000;
const LOCK_TIMEOUT_MS = 5_000;

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

interface LockOwner {
	path: string;
	token: string;
}

interface LockSnapshot {
	mtimeMs: number;
	token: string | null;
}

function lockPath(filePath: string): string {
	return `${filePath}.lock`;
}

function readLockSnapshot(lock: string): LockSnapshot | null {
	const st = statSync(lock);
	let token: string | null = null;
	try {
		const data = JSON.parse(readFileSync(lock, "utf8")) as Record<string, unknown>;
		if (typeof data.token === "string") token = data.token;
	} catch {
		// Legacy or corrupt stale locks can still be cleaned up after mtime recheck.
	}
	return { mtimeMs: st.mtimeMs, token };
}

function removeStaleLock(lock: string, first: LockSnapshot): boolean {
	const second = readLockSnapshot(lock);
	if (!second || second.token !== first.token || second.mtimeMs !== first.mtimeMs) return false;
	unlinkSync(lock);
	return true;
}

async function acquireLock(filePath: string): Promise<LockOwner> {
	const lock = lockPath(filePath);
	assertSafeStoreDir(filePath);
	const start = Date.now();
	while (true) {
		const token = randomBytes(16).toString("hex");
		try {
			const fd = openSync(lock, "wx");
			try {
				writeFileSync(fd, JSON.stringify({ pid: process.pid, token, createdAt: new Date().toISOString() }));
			} finally {
				closeSync(fd);
			}
			return { path: lock, token };
		} catch (err: unknown) {
			const code = (err as NodeJS.ErrnoException).code;
			if (code === "ENOENT") {
				throw new CliError("STORE_NOT_INITIALIZED", ".seeds directory is required before mutating knowledge store");
			}
			if (code !== "EEXIST") throw err;
			try {
				const snapshot = readLockSnapshot(lock);
				if (snapshot && Date.now() - snapshot.mtimeMs > LOCK_STALE_MS && removeStaleLock(lock, snapshot)) {
					continue;
				}
			} catch {
				continue;
			}
			if (Date.now() - start > LOCK_TIMEOUT_MS) {
				throw new CliError("LOCK_TIMEOUT", "Timeout acquiring knowledge store lock");
			}
			await sleep(LOCK_RETRY_MS + Math.floor(Math.random() * LOCK_RETRY_MS));
		}
	}
}

function releaseLock(owner: LockOwner): void {
	try {
		const snapshot = readLockSnapshot(owner.path);
		if (snapshot?.token === owner.token) unlinkSync(owner.path);
	} catch {
		// best-effort
	}
}

async function withLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
	const owner = await acquireLock(filePath);
	try {
		assertSafeStoreDir(filePath);
		return await fn();
	} finally {
		releaseLock(owner);
	}
}

// --- JSONL ---

function parseJsonl(content: string): KnowledgeRecord[] {
	const results: KnowledgeRecord[] = [];
	for (const [index, line] of content.split("\n").entries()) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		let parsed: unknown;
		try {
			parsed = JSON.parse(trimmed) as unknown;
		} catch {
			throw new CliError("INVALID_JSON", `Invalid JSONL at line ${index + 1}`);
		}
		if (!isRecordObject(parsed)) throw new CliError("INVALID_RECORD", `Invalid JSONL record at line ${index + 1}: record must be an object`);
		const err = validateRecord(parsed);
		if (err) throw new CliError("INVALID_RECORD", `Invalid JSONL record at line ${index + 1}: ${err}`);
		results.push(parsed as KnowledgeRecord);
	}
	return results;
}

function dedup(records: KnowledgeRecord[]): KnowledgeRecord[] {
	const map = new Map<string, KnowledgeRecord>();
	for (const r of records) map.set(r.id, r);
	return Array.from(map.values());
}

// --- Operations ---

async function readRecords(filePath: string): Promise<KnowledgeRecord[]> {
	const file = Bun.file(filePath);
	if (!(await file.exists())) return [];
	return dedup(parseJsonl(await file.text()));
}

function generateId(record: Omit<KnowledgeRecord, "id" | "recorded_at">): string {
	const key = `${record.type}:${record.content}`;
	const hash = createHash("sha256").update(key).digest("hex").slice(0, 6);
	return `ex-${hash}`;
}

function unknownField(input: Record<string, unknown>, allowed: Set<string>): string | null {
	for (const key of Object.keys(input)) {
		if (!allowed.has(key)) return key;
	}
	return null;
}

function validateFields(input: Record<string, unknown>): string | null {
	if (!input.type || !VALID_TYPES.includes(input.type as RecordType)) {
		return `Invalid type "${input.type}". Must be one of: ${VALID_TYPES.join(", ")}`;
	}
	if (!input.content || typeof input.content !== "string" || input.content.trim() === "") {
		return "content is required and must be a non-empty string";
	}
	return null;
}

function validateInput(input: Record<string, unknown>): string | null {
	if ("evidence" in input) return "evidence is not supported; content must be self-contained";
	const unknown = unknownField(input, new Set(["type", "content"]));
	if (unknown) return `Unknown field "${unknown}"`;
	return validateFields(input);
}

function validateRecord(input: Record<string, unknown>): string | null {
	if ("evidence" in input) return "evidence is not supported; content must be self-contained";
	const unknown = unknownField(input, new Set(["id", "type", "content", "recorded_at"]));
	if (unknown) return `Unknown field "${unknown}"`;
	if (!input.id || typeof input.id !== "string") return "id is required and must be a string";
	if (!input.recorded_at || typeof input.recorded_at !== "string") {
		return "recorded_at is required and must be a string";
	}
	const parsed = new Date(input.recorded_at);
	if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== input.recorded_at) {
		return "recorded_at must be an ISO timestamp from Date.toISOString()";
	}
	const err = validateFields(input);
	if (err) return err;
	const expectedId = generateId({
		type: input.type as RecordType,
		content: input.content as string,
	});
	if (input.id !== expectedId) return `id must be ${expectedId} for type:content`;
	return null;
}

interface AppendResult {
	record: KnowledgeRecord;
	count: number;
	warning?: string;
}

async function appendRecord(
	filePath: string,
	input: Omit<KnowledgeRecord, "id" | "recorded_at">,
): Promise<AppendResult> {
	const record: KnowledgeRecord = {
		...input,
		id: generateId(input),
		recorded_at: new Date().toISOString(),
	};

	return withLock(filePath, async () => {
		const existing = await readRecords(filePath);

		if (existing.length >= MAX_RECORDS) {
			const idx = existing.findIndex((r) => r.id === record.id);
			if (idx === -1) {
				throw new CliError(
					"STORE_LIMIT_EXCEEDED",
					`Store has ${existing.length} records (max ${MAX_RECORDS}). ` +
					`Curate with 'remove' or 'rewrite' before adding new records.`,
				);
			}
		}

		const idx = existing.findIndex((r) => r.id === record.id);
		if (idx !== -1) {
			existing[idx] = record;
		} else {
			existing.push(record);
		}
		await atomicWrite(filePath, existing);

		const result: AppendResult = { record, count: existing.length };
		if (existing.length >= WARN_THRESHOLD) {
			result.warning = `Store has ${existing.length} records. Consider curating (target: under ${WARN_THRESHOLD}).`;
		}
		return result;
	});
}

async function removeRecord(filePath: string, id: string): Promise<boolean> {
	return withLock(filePath, async () => {
		const existing = await readRecords(filePath);
		const filtered = existing.filter((r) => r.id !== id);
		if (filtered.length === existing.length) return false;
		await atomicWrite(filePath, filtered);
		return true;
	});
}

async function rewriteRecords(
	filePath: string,
	records: KnowledgeRecord[],
): Promise<void> {
	return withLock(filePath, async () => {
		await atomicWrite(filePath, records);
	});
}

async function atomicWrite(filePath: string, records: KnowledgeRecord[]): Promise<void> {
	assertSafeStoreDir(filePath);
	const tmp = `${filePath}.tmp.${randomBytes(4).toString("hex")}`;
	const content = records.map((r) => JSON.stringify(r)).join("\n") + "\n";
	try {
		await Bun.write(tmp, content);
		renameSync(tmp, filePath);
	} catch (err: unknown) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") {
			throw new CliError("STORE_NOT_INITIALIZED", ".seeds directory is required before mutating knowledge store");
		}
		throw err;
	}
}

// --- CLI ---

async function readInput(rest: string[]): Promise<unknown> {
	let text: string;
	if (rest.includes("--stdin")) {
		text = (await Bun.stdin.text()).trim();
	} else {
		const arg = rest.find((r) => r !== "--stdin");
		if (!arg) throw new CliError("INVALID_ARGUMENT", "No JSON argument provided. Pass JSON as argument or use --stdin.");
		text = arg;
	}
	try {
		return JSON.parse(text);
	} catch {
		throw new CliError("INVALID_JSON", "Invalid JSON input");
	}
}

interface ErrorEnvelope {
	code: ErrorCode;
	message: string;
	details?: unknown;
}

function writeEnvelope(command: string, ok: boolean, data: unknown, error: ErrorEnvelope | null): void {
	console.log(JSON.stringify({ ok, command, data, error }));
}

function toCliError(e: unknown): CliError {
	if (e instanceof CliError) return e;
	return new CliError("IO_ERROR", "I/O operation failed");
}

const REMOVE_ID_RE = /^ex-[0-9a-f]{6}$/;
async function main(cmd: string | undefined, filePath: string | undefined, rest: string[]): Promise<unknown> {
	if (!cmd || !filePath) {
		throw new CliError(
			"INVALID_ARGUMENT",
				"Usage: bun /path/to/knowledge-store.ts <record|read|count|remove|rewrite> <file> [args]",
		);
	} else if (cmd === "record") {
		const storePath = resolveStorePath(filePath, { requireStoreDir: true });
		const input = await readInput(rest);
		if (!isRecordObject(input)) throw new CliError("INVALID_RECORD", "record must be an object");
		const err = validateInput(input);
		if (err) throw new CliError("INVALID_RECORD", err);
		return appendRecord(storePath, input as Omit<KnowledgeRecord, "id" | "recorded_at">);
	} else if (cmd === "read") {
		const storePath = resolveStorePath(filePath, { requireStoreDir: false });
		return readRecords(storePath);
	} else if (cmd === "count") {
		const storePath = resolveStorePath(filePath, { requireStoreDir: false });
		const records = await readRecords(storePath);
		const byType: Record<string, number> = {};
		for (const r of records) byType[r.type] = (byType[r.type] ?? 0) + 1;
		return { count: records.length, by_type: byType };
	} else if (cmd === "remove") {
		const storePath = resolveStorePath(filePath, { requireStoreDir: true });
		const id = rest[0];
		if (!id) {
			throw new CliError("INVALID_ARGUMENT", "Usage: bun /path/to/knowledge-store.ts remove <file> <id>");
		}
		if (!REMOVE_ID_RE.test(id)) throw new CliError("INVALID_ARGUMENT", "remove id must match /^ex-[0-9a-f]{6}$/");
		const removed = await removeRecord(storePath, id);
		return { removed };
	} else if (cmd === "rewrite") {
		const storePath = resolveStorePath(filePath, { requireStoreDir: true });
		const records = await readInput(rest);
		if (!Array.isArray(records)) {
			throw new CliError("INVALID_RECORD", "rewrite expects a JSON array of records");
		} else if (records.length > MAX_RECORDS) {
			throw new CliError("STORE_LIMIT_EXCEEDED", `rewrite has ${records.length} records (max ${MAX_RECORDS})`);
		} else {
			const err = records
				.map((r, index) => ({ r, index }))
				.find(({ r }) => !isRecordObject(r) || validateRecord(r));
			if (err) {
				const reason = isRecordObject(err.r) ? validateRecord(err.r) : "record must be an object";
				throw new CliError("INVALID_RECORD", `rewrite record ${err.index}: ${reason}`);
			}
			const seen = new Set<string>();
			for (const [index, record] of (records as KnowledgeRecord[]).entries()) {
				if (seen.has(record.id)) {
					throw new CliError("DUPLICATE_RECORD_ID", `rewrite record ${index}: duplicate id ${record.id}`);
				}
				seen.add(record.id);
			}
			await rewriteRecords(storePath, records as KnowledgeRecord[]);
			return { count: records.length };
		}
	} else {
		throw new CliError("INVALID_ARGUMENT", `Unknown command: ${cmd}`);
	}
}

async function runCli(argv: string[]): Promise<void> {
	const [cmd, filePath, ...rest] = argv;
	const command = cmd ?? "";
	try {
		const data = await main(cmd, filePath, rest);
		writeEnvelope(command, true, data, null);
	} catch (e: unknown) {
		const err = toCliError(e);
		writeEnvelope(command, false, null, { code: err.code, message: err.message, details: err.details });
		process.exitCode = 1;
	}
}

export const __test = {
	lockPath,
	releaseLock,
};

if (import.meta.main) {
	await runCli(process.argv.slice(2));
}
