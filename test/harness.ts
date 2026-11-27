// Harness: drives the extension through its two public seams with a fake pi.
//
// Seam 1 — the `input` event: give text, observe `{ action, text }`.
// Seam 2 — the autocomplete provider: give editor lines plus a cursor, observe suggestions;
//          run `applyCompletion` and observe the resulting lines.
import { resolve } from "node:path";
import inlineSkill from "../inline-skill.ts";

const fixtures = resolve(import.meta.dirname, "fixtures");

export type SkillFixture = {
	/** Name as pi reports it, without the `skill:` prefix. */
	name: string;
	description?: string;
	filePath: string;
	baseDir: string;
};

export function fixtureSkill(name: string, overrides: Partial<SkillFixture> = {}): SkillFixture {
	const dir = resolve(fixtures, "skills", name);
	return { name, description: `${name} fixture`, filePath: resolve(dir, "SKILL.md"), baseDir: dir, ...overrides };
}

export type BaseSuggestion = { value: string; label: string; description?: string };

export type Harness = {
	/** Send a prompt through the `input` seam. */
	input(text: string, source?: "interactive" | "rpc" | "extension"): Promise<{ action: string; text?: string }>;
	/** Start a session, which is when the extension registers its autocomplete provider. */
	startSession(reason?: string): Promise<void>;
	/** Call the registered autocomplete provider. */
	suggest(
		lines: string[],
		cursorLine: number,
		cursorCol: number,
	): Promise<{ prefix: string; items: BaseSuggestion[] } | null>;
	/** Run `applyCompletion` through the registered provider. */
	apply(
		lines: string[],
		cursorLine: number,
		cursorCol: number,
		item: BaseSuggestion,
		prefix: string,
	): { lines: string[]; cursorLine: number; cursorCol: number };
	notifications: { message: string; type?: string }[];
	/** How many times the extension asked pi for its command list. */
	getCommandsCalls: number;
	/** Suggestions the fake built-in provider would return. */
	baseSuggestions: BaseSuggestion[];
	/** Tokens the fake built-in provider was asked to complete. */
	baseRequests: { lines: string[]; cursorLine: number; cursorCol: number }[];
	/** Simulate a session swap, after which the extension's captured `pi` throws. */
	invalidatePi(): void;
};

export type HarnessOptions = {
	skills?: SkillFixture[];
	/** Commands pi exposes, in addition to one `skill:<name>` command per skill. */
	commands?: { name: string; description?: string; source?: "extension" | "prompt" }[];
	baseSuggestions?: BaseSuggestion[];
	/** Make `pi.getCommands()` throw, as it does after a session swap. */
	getCommandsThrows?: boolean;
};

export function createHarness(options: HarnessOptions = {}): Harness {
	const skills = options.skills ?? [fixtureSkill("alpha"), fixtureSkill("beta")];
	let getCommandsThrows = options.getCommandsThrows ?? false;

	const harness: Harness = {
		input: async () => ({ action: "continue" }),
		startSession: async () => {},
		suggest: async () => null,
		apply: () => ({ lines: [], cursorLine: 0, cursorCol: 0 }),
		notifications: [],
		getCommandsCalls: 0,
		baseSuggestions: options.baseSuggestions ?? [],
		baseRequests: [],
		invalidatePi: () => {
			getCommandsThrows = true;
		},
	};

	const commands = [
		...skills.map((skill) => ({
			name: `skill:${skill.name}`,
			description: skill.description,
			source: "skill",
			sourceInfo: { path: skill.filePath, baseDir: skill.baseDir, source: "test", scope: "user", origin: "local" },
		})),
		...(options.commands ?? []).map((command) => ({
			name: command.name,
			description: command.description,
			source: command.source ?? "extension",
			sourceInfo: { path: "/builtin", source: "test", scope: "user", origin: "built-in" },
		})),
	];

	const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
	const pi = {
		on: (name: string, handler: (event: unknown, ctx: unknown) => unknown) => {
			handlers.set(name, handler);
		},
		getCommands: () => {
			harness.getCommandsCalls++;
			if (getCommandsThrows) throw new Error("This extension ctx is stale after session replacement or reload.");
			return commands;
		},
	};

	let provider:
		| {
				getSuggestions: (
					lines: string[],
					cursorLine: number,
					cursorCol: number,
					options: { signal: AbortSignal },
				) => Promise<{ prefix: string; items: BaseSuggestion[] } | null>;
				applyCompletion: (
					lines: string[],
					cursorLine: number,
					cursorCol: number,
					item: BaseSuggestion,
					prefix: string,
				) => { lines: string[]; cursorLine: number; cursorCol: number };
		  }
		| undefined;

	// The built-in provider: a plain prefix match over the configured items, like pi's
	// command/path menu that the extension wraps.
	const current = {
		getSuggestions: async (lines: string[], cursorLine: number, cursorCol: number) => {
			harness.baseRequests.push({ lines, cursorLine, cursorCol });
			const before = (lines[cursorLine] ?? "").slice(0, cursorCol);
			const token = before.match(/(\S*)$/)?.[1] ?? "";
			const items = harness.baseSuggestions.filter((item) => item.value.startsWith(token));
			return items.length > 0 ? { prefix: token, items } : null;
		},
		applyCompletion: (lines: string[], cursorLine: number, cursorCol: number, item: BaseSuggestion, prefix: string) => {
			const line = lines[cursorLine] ?? "";
			const start = cursorCol - prefix.length;
			const next = [...lines];
			next[cursorLine] = line.slice(0, start) + item.value + line.slice(cursorCol);
			return { lines: next, cursorLine, cursorCol: start + item.value.length };
		},
		shouldTriggerFileCompletion: () => true,
	};

	const ctx = {
		ui: {
			notify: (message: string, type?: string) => {
				harness.notifications.push({ message, type });
			},
			addAutocompleteProvider: (factory: (current: typeof current) => NonNullable<typeof provider>) => {
				provider = factory(current);
			},
		},
	};

	inlineSkill(pi as never);

	harness.input = async (text, source = "interactive") => {
		const handler = handlers.get("input");
		if (!handler) throw new Error("extension registered no input handler");
		return (await handler({ type: "input", text, source, images: [] }, ctx)) as { action: string; text?: string };
	};

	harness.startSession = async (reason = "startup") => {
		const handler = handlers.get("session_start");
		if (!handler) throw new Error("extension registered no session_start handler");
		await handler({ type: "session_start", reason }, ctx);
	};

	harness.suggest = async (lines, cursorLine, cursorCol) => {
		if (!provider) throw new Error("autocomplete provider not registered; call startSession() first");
		return provider.getSuggestions(lines, cursorLine, cursorCol, { signal: new AbortController().signal });
	};

	harness.apply = (lines, cursorLine, cursorCol, item, prefix) => {
		if (!provider) throw new Error("autocomplete provider not registered; call startSession() first");
		return provider.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
	};

	return harness;
}
