import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { createHarness, fixtureSkill } from "./harness.ts";

const fixtures = resolve(import.meta.dirname, "fixtures");

const skillBlock = (name: string) => {
	const title = name[0]?.toUpperCase() + name.slice(1);
	return new RegExp(
		`^<skill name="${name}" location="[^"]*/${name}/SKILL\\.md">\\nReferences are relative to [^\\n]*/${name}\\.\\n\\n# ${title}\\n\\n${title} body\\.\\n</skill>`,
	);
};

// ---------------------------------------------------------------------------
// Sending a prompt with an inline skill token
// ---------------------------------------------------------------------------

test("inline skill expands to a skill block and drops the token", async () => {
	const harness = createHarness();
	const result = await harness.input("please /skill:alpha review this");

	assert.equal(result.action, "transform");
	assert.match(result.text ?? "", skillBlock("alpha"));
	assert.match(result.text ?? "", /<\/skill>\n\nplease review this$/);
	assert.doesNotMatch(result.text ?? "", /\/skill:alpha/);
});

test("two inline skills produce two blocks in the order they appear", async () => {
	const harness = createHarness();
	const result = await harness.input("use /skill:beta then /skill:alpha");

	const names = [...(result.text ?? "").matchAll(/<skill name="([^"]+)"/g)].map((match) => match[1]);
	assert.deepEqual(names, ["beta", "alpha"]);
	assert.match(result.text ?? "", /<\/skill>\n\nuse then$/);
});

test("repeating the same skill expands it once", async () => {
	const harness = createHarness();
	const result = await harness.input("x /skill:alpha y /skill:alpha");

	assert.equal((result.text ?? "").match(/<skill name="alpha"/g)?.length, 1);
	assert.match(result.text ?? "", /<\/skill>\n\nx y$/);
});

test("an unknown skill token stays in the prompt and expands nothing", async () => {
	const harness = createHarness();
	const result = await harness.input("use /skill:ghost here");

	assert.equal(result.action, "continue");
	assert.equal(result.text, undefined);
});

test("a known skill expands while an unknown token beside it is preserved", async () => {
	const harness = createHarness();
	const result = await harness.input("use /skill:ghost and /skill:alpha");

	assert.match(result.text ?? "", skillBlock("alpha"));
	assert.match(result.text ?? "", /<\/skill>\n\nuse \/skill:ghost and$/);
});

test("a token next to CJK text is expanded and removed", async () => {
	const harness = createHarness();
	const result = await harness.input("调用/skill:alpha 写代码");

	assert.match(result.text ?? "", skillBlock("alpha"));
	assert.match(result.text ?? "", /<\/skill>\n\n调用 写代码$/);
});

test("a prompt that is only a skill token leaves no empty user text", async () => {
	const harness = createHarness();
	const result = await harness.input("   /skill:alpha");

	assert.match(result.text ?? "", /<\/skill>$/);
	assert.doesNotMatch(result.text ?? "", /\n\n$/);
});

test("leading skill token past the start of the prompt is expanded here, not by pi", async () => {
	const harness = createHarness();
	const result = await harness.input("  /skill:alpha why");

	assert.match(result.text ?? "", skillBlock("alpha"));
	assert.match(result.text ?? "", /<\/skill>\n\nwhy$/);
});

test("a leading skill token at position zero is left to pi's built-in expansion", async () => {
	const harness = createHarness();
	const result = await harness.input("/skill:alpha why");

	assert.equal(result.action, "continue");
});

test("paths that merely contain a skill token are left alone", async () => {
	const harness = createHarness();
	for (const text of ["see foo/skill:alpha", "open /opt/skill:alpha now"]) {
		const result = await harness.input(text);
		assert.equal(result.action, "continue", text);
	}
});

test("messages sent by an extension are not rewritten", async () => {
	const harness = createHarness();
	const result = await harness.input("use /skill:alpha", "extension");

	assert.equal(result.action, "continue");
});

test("an unreadable skill file notifies and leaves its token in place", async () => {
	const harness = createHarness({
		skills: [
			fixtureSkill("alpha"),
			fixtureSkill("broken", { filePath: resolve(fixtures, "skills", "missing", "SKILL.md") }),
		],
	});
	const result = await harness.input("use /skill:alpha and /skill:broken");

	assert.match(result.text ?? "", skillBlock("alpha"));
	assert.match(result.text ?? "", /\/skill:broken$/);
	assert.equal(harness.notifications.length, 1);
	assert.equal(harness.notifications[0]?.type, "error");
	assert.match(harness.notifications[0]?.message ?? "", /inline-skill: cannot read .*missing\/SKILL\.md/);
});

test("a prompt with no skill token passes through untouched", async () => {
	const harness = createHarness();
	const result = await harness.input("plain words");

	assert.equal(result.action, "continue");
});

// ---------------------------------------------------------------------------
// Autocomplete: which token the menu completes
// ---------------------------------------------------------------------------

const commandMenu = [
	{ value: "/model", label: "model", description: "builtin" },
	{ value: "/ml", label: "ml", description: "builtin" },
];

const values = (suggestions: { items: { value: string }[] } | null) =>
	(suggestions?.items ?? []).map((item) => item.value);

test("a slash token at the very start of the prompt keeps the built-in command menu", async () => {
	const harness = createHarness({ baseSuggestions: commandMenu });
	await harness.startSession();

	const suggestions = await harness.suggest(["/m"], 0, 2);

	assert.equal(harness.baseRequests.length, 1, "the built-in provider should be asked");
	assert.deepEqual(values(suggestions), ["/model", "/ml"]);
});

test("leading whitespace on the first line still keeps the built-in command menu", async () => {
	const harness = createHarness({ baseSuggestions: commandMenu });
	await harness.startSession();

	const suggestions = await harness.suggest(["  /m"], 0, 4);

	assert.equal(harness.baseRequests.length, 1);
	assert.deepEqual(values(suggestions), ["/model", "/ml"]);
});

test("empty lines before the token still keep the built-in command menu", async () => {
	const harness = createHarness({ baseSuggestions: commandMenu });
	await harness.startSession();

	await harness.suggest(["", "  /m"], 1, 4);

	assert.equal(harness.baseRequests.length, 1);
});

test("a slash token on a later line searches skills instead of the command menu", async () => {
	const harness = createHarness({ baseSuggestions: commandMenu });
	await harness.startSession();

	const suggestions = await harness.suggest(["first line", "/al"], 1, 3);

	assert.deepEqual(values(suggestions), ["/skill:alpha"]);
});

test("a slash token mid-line searches skills", async () => {
	const harness = createHarness({ baseSuggestions: commandMenu });
	await harness.startSession();

	const suggestions = await harness.suggest(["why /al"], 0, 7);

	assert.deepEqual(values(suggestions), ["/skill:alpha"]);
});

// ---------------------------------------------------------------------------
// Autocomplete: which punctuation may sit before the token
// ---------------------------------------------------------------------------

test("an inline token after ASCII punctuation is expanded", async () => {
	const harness = createHarness();
	for (const text of ["(/skill:alpha)", '"/skill:alpha"', "[/skill:alpha]", "—/skill:alpha"]) {
		const result = await harness.input(text);
		assert.equal(result.action, "transform", text);
		assert.equal((result.text ?? "").match(/<skill name="alpha"/g)?.length, 1, text);
	}
});

test("a token that continues a word or a path is not expanded", async () => {
	const harness = createHarness();
	for (const text of ["foo/skill:alpha", "/opt/skill:alpha", "v2/skill:alpha", "./skill:alpha"]) {
		const result = await harness.input(text);
		assert.equal(result.action, "continue", text);
	}
});

test("a token after punctuation is completed", async () => {
	const harness = createHarness({ baseSuggestions: commandMenu });
	await harness.startSession();

	const suggestions = await harness.suggest(["see (/al"], 0, 8);

	assert.deepEqual(values(suggestions), ["/skill:alpha"]);
});

test("a token after CJK text is completed", async () => {
	const harness = createHarness({ baseSuggestions: commandMenu });
	await harness.startSession();

	const suggestions = await harness.suggest(["调用/al"], 0, 5);

	assert.deepEqual(values(suggestions), ["/skill:alpha"]);
});

// ---------------------------------------------------------------------------
// Skill list lifecycle
// ---------------------------------------------------------------------------

test("the skill list is read once per session, not per keystroke or prompt", async () => {
	const harness = createHarness({ baseSuggestions: commandMenu });
	await harness.startSession();
	await harness.input("use /skill:alpha");
	await harness.input("use /skill:alpha again");
	await harness.suggest(["why /al"], 0, 7);
	await harness.suggest(["why /skill:b"], 0, 13);

	assert.equal(harness.getCommandsCalls, 1);
});

test("a new session re-reads the skill list", async () => {
	const harness = createHarness();
	await harness.startSession("startup");
	await harness.startSession("reload");

	assert.equal(harness.getCommandsCalls, 2);
});

test("completion keeps working after the session behind pi was replaced", async () => {
	const harness = createHarness({ baseSuggestions: commandMenu });
	await harness.startSession();
	harness.invalidatePi();

	const suggestions = await harness.suggest(["why /al"], 0, 7);

	assert.deepEqual(values(suggestions), ["/skill:alpha"]);
});

test("prompts keep expanding after the session behind pi was replaced", async () => {
	const harness = createHarness();
	await harness.startSession();
	harness.invalidatePi();

	const result = await harness.input("why /skill:alpha");

	assert.match(result.text ?? "", skillBlock("alpha"));
});

// ---------------------------------------------------------------------------
// Autocomplete: which items are offered, and what applying one does
// ---------------------------------------------------------------------------

test("explicit /skill: search matches by subsequence", async () => {
	const harness = createHarness({ baseSuggestions: commandMenu });
	await harness.startSession();

	const suggestions = await harness.suggest(["why /skill:bt"], 0, 13);

	assert.deepEqual(values(suggestions), ["/skill:beta"]);
});

test("explicit /skill: search with no match falls back to the built-in menu", async () => {
	const harness = createHarness({ baseSuggestions: commandMenu });
	await harness.startSession();

	await harness.suggest(["why /skill:zzz"], 0, 15);

	assert.equal(harness.baseRequests.length, 1);
});

test("bare slash completion offers skills first, then paths", async () => {
	const harness = createHarness({ baseSuggestions: [{ value: "/opt", label: "/opt" }] });
	await harness.startSession();

	const suggestions = await harness.suggest(["见 /"], 0, 3);

	assert.deepEqual(values(suggestions), ["/skill:alpha", "/skill:beta", "/opt"]);
});

test("a token with a second slash stays a path", async () => {
	const harness = createHarness({ baseSuggestions: [{ value: "/etc/hosts", label: "/etc/hosts" }] });
	await harness.startSession();

	const suggestions = await harness.suggest(["cat /etc/ho"], 0, 11);

	assert.deepEqual(values(suggestions), ["/etc/hosts"]);
	assert.equal(harness.baseRequests.length, 1);
});

test("@-file completion is left to the built-in provider", async () => {
	const harness = createHarness({ baseSuggestions: [{ value: "@src/foo.ts", label: "@src/foo.ts" }] });
	await harness.startSession();

	const tokens = ["see @src/fo", "see @src/"];

	const seen = await Promise.all(tokens.map((line) => harness.suggest([line], 0, line.length)));

	assert.equal(harness.baseRequests.length, 2);
	assert.deepEqual(seen.map(values), [["@src/foo.ts"], ["@src/foo.ts"]]);
});

test("applying a skill completion replaces the token and leaves one trailing space", async () => {
	const harness = createHarness();
	await harness.startSession();

	const applied = harness.apply(["see /al more"], 0, 7, { value: "/skill:alpha", label: "alpha" }, "/al");

	assert.deepEqual(applied, { lines: ["see /skill:alpha more"], cursorLine: 0, cursorCol: 17 });
});

test("applying a skill completion at the end of a line appends nothing extra", async () => {
	const harness = createHarness();
	await harness.startSession();

	const applied = harness.apply(["first", "why /al"], 1, 7, { value: "/skill:alpha", label: "alpha" }, "/al");

	assert.deepEqual(applied, { lines: ["first", "why /skill:alpha "], cursorLine: 1, cursorCol: 17 });
});

test("applying a path completion is left to the built-in provider", async () => {
	const harness = createHarness();
	await harness.startSession();

	const applied = harness.apply(["see /op more"], 0, 7, { value: "/opt", label: "/opt" }, "/op");

	assert.deepEqual(applied, { lines: ["see /opt more"], cursorLine: 0, cursorCol: 8 });
});

// ---------------------------------------------------------------------------
// Prompt text is otherwise left alone
// ---------------------------------------------------------------------------

test("removing a token leaves exactly one space between its neighbours", async () => {
	const harness = createHarness();
	const result = await harness.input("please   /skill:alpha   review");

	assert.match(result.text ?? "", /<\/skill>\n\nplease review$/);
});

test("whitespace elsewhere in the prompt is preserved", async () => {
	const harness = createHarness();
	const result = await harness.input("col1    col2\nkey     /skill:alpha");

	assert.match(result.text ?? "", /<\/skill>\n\ncol1    col2\nkey$/);
});

test("indentation on a continuation line is preserved", async () => {
	const harness = createHarness();
	const result = await harness.input("rules:\n    - /skill:alpha\n    - keep indent");

	assert.match(result.text ?? "", /<\/skill>\n\nrules:\n    -\n    - keep indent$/);
});

test("indentation on the first line is preserved", async () => {
	const harness = createHarness();
	const result = await harness.input("    indented /skill:alpha");

	assert.match(result.text ?? "", /<\/skill>\n\n    indented$/);
});
