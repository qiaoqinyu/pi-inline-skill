# pi-inline-skill

Invoke a [pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) skill **anywhere** in a prompt with `/skill:name`, not only as the first word. Mid-line, on a later line, after punctuation, or glued to Chinese text, with Tab completion for skill names.

```
why does /skill:ste100-explain keep the imperative mood here
调用/skill:arxiv-daily 看看今天的新论文
```

pi itself only expands `/skill:name` when it opens the message. This extension finds the tokens anywhere and expands each one into the same `<skill>` block pi would have produced.

## Install

Copy or link the file into pi's global extensions directory:

```bash
ln -s "$PWD/inline-skill.ts" ~/.pi/agent/extensions/inline-skill.ts
```

Or install the repository as a pi package so pi keeps it up to date:

```bash
pi install git:github.com/qiaoqinyu/pi-inline-skill
```

Reload pi with `/reload` afterwards.

## Use it

| You type | What happens |
|---|---|
| `/skill:name why` at the start | Left to pi's built-in expansion |
| `why /skill:name` mid-line | Skill block prepended, token removed |
| `/skill:a and /skill:b` | Two blocks, one per skill, in the order written |
| `调用/skill:name` | Expanded: CJK text counts as a word boundary |
| `(/skill:name)` `"/skill:name"` | Expanded: punctuation counts as a boundary |
| `foo/skill:name`, `/opt/skill:name` | Not expanded: the token continues a path |
| `/skill:typo` | Not expanded, left in the prompt as typed |

Completion, after pressing <kbd>Tab</kbd> following `/`, `/ab`, or `/skill:ab`:

- `/ab` matches skill-name word starts (`arxiv-daily`, `x-ask`) and keeps the path menu, so a bare `/opt` still completes as a directory.
- `/skill:ab` fuzzy-matches every skill name.
- A token with a second slash stays a path (`/etc/ho`).

## Behaviour worth knowing

- **The token is removed.** After a skill expands, its `/skill:name` token is dropped from the prompt and the leftover spaces are collapsed. A name that matches no skill stays as text, so the model still sees it.
- **Two or more skills render plainly.** The model receives every block, but pi's transcript draws only the first as a skill card; the rest appear as literal `<skill>` text in the user message. Single skills render normally.
- **pi's own form still wins.** A prompt that starts with `/skill:name` is untouched, so pi's built-in expansion handles the arguments exactly as before.
- **Messages from other extensions are skipped** (pi's `input` event `source === "extension"`), so injected text never expands twice.
- **The skill list is read once per session** and refreshed on `/reload`, not on every keystroke.

## Development

```bash
npm install       # types only: the two @earendil-works packages are peers
npm test          # covers both public seams
npm run typecheck
```

Tests import the extension through `test/hooks.mjs`, which maps `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` to local stand-ins in `test/stubs/`. That keeps the suite runnable without a pi install. The stubs mirror the parts the extension uses (`stripFrontmatter`, `fuzzyFilter`); the test suite never asserts fuzzy ordering, so pi-tui's real scoring can differ without breaking anything.

Layout:

```
inline-skill.ts        the extension (single file, no runtime dependencies)
test/harness.ts        fake pi: drives the input event and the autocomplete provider
test/inline-skill.test.ts
test/fixtures/skills/  two skills with frontmatter
```

Requires Node 22.15+ for `module.registerHooks`, and pi 1.6.x.
