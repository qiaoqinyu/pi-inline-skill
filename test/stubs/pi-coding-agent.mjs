// Stand-in for @earendil-works/pi-coding-agent so tests run without a pi install.
// stripFrontmatter must match pi's implementation: drop a leading `---` block.
export function stripFrontmatter(content) {
	const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
	return match ? content.slice(match[0].length) : content;
}
