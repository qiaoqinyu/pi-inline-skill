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
