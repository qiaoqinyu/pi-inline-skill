// Invoke skills anywhere in a prompt with `/skill:name`, not only at the start.
// Mid-line, press Tab after `/`, `/as` or `/skill:as` to search skill names; keep typing to
// narrow the menu. `/as` matches word starts (`ask-matt`, `x-ask`) so paths like `/opt` keep
// path completion; `/skill:as` uses fuzzy matching. Tokens containing a second `/` stay paths.

import { readFileSync } from "node:fs";
import { type ExtensionAPI, stripFrontmatter } from "@earendil-works/pi-coding-agent";
import { type AutocompleteItem, fuzzyFilter } from "@earendil-works/pi-tui";

const SKILL_PREFIX = "/skill:";
// A token starts the text or follows punctuation, but never continues a Latin word, a digit, or a
// path (`foo/skill:x`, `/opt/skill:x`, `./skill:x`). CJK text and punctuation both count as a start,
// so `调用/skill:x` and `(/skill:x` are inline tokens.
const BOUNDARY = String.raw`(?<![\p{Script=Latin}\p{N}_./-])`;
const INLINE_SKILL = new RegExp(String.raw`${BOUNDARY}\/skill:([a-z0-9][a-z0-9-]*)`, "gu");
// `matchAll` clones this regex, so its `lastIndex` never advances; do not use `.test()`/`.exec()`.
const TOKEN_BEFORE_CURSOR = new RegExp(String.raw`${BOUNDARY}(\/[^\s]*)$`, "u");

type SkillInfo = { name: string; description: string; filePath: string; baseDir: string };

function listSkills(pi: ExtensionAPI): SkillInfo[] {
	return pi
		.getCommands()
		.filter((command) => command.source === "skill")
		.map((command) => ({
			name: command.name.slice("skill:".length),
			description: command.description ?? "",
			filePath: command.sourceInfo.path,
			baseDir: command.sourceInfo.baseDir ?? "",
		}));
}

// Same block format as pi's built-in leading `/skill:name` expansion.
function skillBlock(skill: SkillInfo): string {
	const body = stripFrontmatter(readFileSync(skill.filePath, "utf-8")).trim();
	return `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${skill.baseDir}.\n\n${body}\n</skill>`;
}

// Drop the tokens that expanded into a block, keeping unknown names and paths in the prompt.
// Only the gap where a token stood is rewritten, so pasted code and tables keep their spacing.
const REMOVED = "\u0000"; // sentinel: a typed or pasted prompt cannot contain it
function dropExpandedTokens(text: string, expanded: Set<string>): string {
	return text
		.replace(INLINE_SKILL, (token, name: string) => (expanded.has(name) ? REMOVED : token))
		.replace(/[ \t]*\u0000[ \t]*/g, (gap: string, offset: number, whole: string) => {
			const before = whole[offset - 1] ?? "";
			const after = whole[offset + gap.length] ?? "";
			// No space at the text's edge or before a line break, nor before punctuation that already
			// separates words: `read /skill:alpha, then` becomes `read, then`.
			const atEdge =
				before === "" || before === "\n" || before === "\r" || after === "" || after === "\n" || after === "\r";
			return atEdge || ",;:!?)]}".includes(after) ? "" : " ";
		});
}

// Names of the inline skill tokens in the prompt, in the order they appear.
function inlineSkillNames(text: string): Set<string> {
	const names = new Set<string>();
	for (const match of text.matchAll(INLINE_SKILL)) {
		const name = match[1];
		if (name) names.add(name);
	}
	return names;
}

export default function (pi: ExtensionAPI): void {
	// Read once per session: the list is fixed until pi reloads skills, and calling into pi on every
	// keystroke and prompt is wasted work that also fails once the session behind pi is replaced.
	let skillCache: SkillInfo[] | undefined;
	const skills = () => (skillCache ??= listSkills(pi));

	pi.on("input", (event, ctx) => {
		if (event.source === "extension") return { action: "continue" };
		const names = inlineSkillNames(event.text);
		// A single leading token is pi's own `/skill:name args` form; leave it to the built-in.
		if (names.size === 0 || (names.size === 1 && event.text.startsWith(SKILL_PREFIX))) {
			return { action: "continue" };
		}

		// The transformed text starts with `<skill`, so pi's built-in expansion skips it.
		const byName = new Map(skills().map((skill) => [skill.name, skill]));
		const blocks: string[] = [];
		const expanded = new Set<string>();
		for (const name of names) {
			const skill = byName.get(name);
			if (!skill) continue;
			try {
				blocks.push(skillBlock(skill));
				expanded.add(name);
			} catch (err) {
				ctx.ui.notify(`inline-skill: cannot read ${skill.filePath}: ${err instanceof Error ? err.message : String(err)}`, "error");
			}
		}
		if (blocks.length === 0) return { action: "continue" };
		const prompt = dropExpandedTokens(event.text, expanded);
		// Two or more skills reach the model as stacked blocks, but pi's transcript renderer draws only
		// the first as a skill card; the rest show as plain user text. Model input is unaffected.
		return { action: "transform", text: prompt ? `${blocks.join("\n\n")}\n\n${prompt}` : blocks.join("\n\n") };
	});

	pi.on("session_start", (_event, ctx) => {
		skillCache = listSkills(pi);
		ctx.ui.addAutocompleteProvider((current) => ({
			async getSuggestions(lines, cursorLine, cursorCol, options) {
				const beforeCursor = (lines[cursorLine] ?? "").slice(0, cursorCol);
				const token = beforeCursor.match(TOKEN_BEFORE_CURSOR)?.[1];
				// Only a token at the very start of the prompt belongs to the built-in command menu.
				// A slash token on a later line is inline text, so it searches skills.
				const startsPrompt =
					beforeCursor.trim() === token && lines.slice(0, cursorLine).every((line) => line.trim() === "");
				// Leading slash commands use the built-in menu.
				if (token === undefined || startsPrompt) {
					return current.getSuggestions(lines, cursorLine, cursorCol, options);
				}
				const explicit = token.startsWith(SKILL_PREFIX);
				const query = (explicit ? token.slice(SKILL_PREFIX.length) : token.slice(1)).toLowerCase();
				if (query.includes("/")) return current.getSuggestions(lines, cursorLine, cursorCol, options);

				const all = skills();
				const matches = explicit
					? fuzzyFilter(all, query, (skill) => skill.name)
					: [
							...all.filter((skill) => skill.name.startsWith(query)),
							...all.filter((skill) => !skill.name.startsWith(query) && skill.name.includes(`-${query}`)),
						];
				const items: AutocompleteItem[] = matches.map((skill) => ({
					value: `${SKILL_PREFIX}${skill.name}`,
					label: skill.name,
					description: skill.description,
				}));
				if (explicit) return items.length > 0 ? { prefix: token, items } : current.getSuggestions(lines, cursorLine, cursorCol, options);

				// A bare `/op` may also be a path such as /opt: show both, so a lone skill match is never
				// auto-inserted over a path the user meant. applyCompletion dispatches by item value.
				const base = await current.getSuggestions(lines, cursorLine, cursorCol, options);
				if (items.length === 0) return base;
				const paths = base?.prefix === token ? base.items : [];
				return { prefix: token, items: [...items, ...paths] };
			},
			applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
				if (!item.value.startsWith(SKILL_PREFIX)) return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
				const line = lines[cursorLine] ?? "";
				const start = cursorCol - prefix.length;
				const inserted = `${item.value} `;
				const next = [...lines];
				next[cursorLine] = line.slice(0, start) + inserted + line.slice(cursorCol).replace(/^ /, "");
				return { lines: next, cursorLine, cursorCol: start + inserted.length };
			},
			shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
				return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
			},
		}));
	});
}
