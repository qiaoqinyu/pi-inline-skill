// Stand-in for @earendil-works/pi-tui.
// Only the shape matters for these tests: subsequence match, case-insensitive.
// pi-tui's real implementation also scores/orders matches; tests here never assert
// fuzzy ordering, so a simpler filter is enough.
export function fuzzyFilter(items, query, getText) {
	const needle = query.trim().toLowerCase();
	if (needle === "") return items;
	const tokens = needle.split(/[\s/]+/).filter(Boolean);
	const matches = (haystack, token) => {
		let index = 0;
		for (const char of haystack) {
			if (char === token[index]) index++;
			if (index === token.length) return true;
		}
		return index === token.length;
	};
	return items.filter((item) => {
		const text = getText(item).toLowerCase();
		return tokens.every((token) => matches(text, token));
	});
}
