// Stand-in for @earendil-works/pi-coding-agent so the tests run without a pi install.
// Mirrors pi's stripFrontmatter: normalise newlines, then return the body after the
// closing `---`, trimmed. The extension never reads frontmatter values, so the YAML
// parse is skipped here.
export function stripFrontmatter(content) {
	const normalized = content.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
	if (!normalized.startsWith("---")) return normalized;
	const endIndex = normalized.indexOf("\n---", 3);
	if (endIndex === -1) return normalized;
	return normalized.slice(endIndex + 4).trim();
}
