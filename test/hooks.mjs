// Maps pi's host packages to local stand-ins so the extension can be imported
// by `node --test` without a pi installation.
import { registerHooks } from "node:module";

const stubs = {
	"@earendil-works/pi-coding-agent": new URL("./stubs/pi-coding-agent.mjs", import.meta.url).href,
	"@earendil-works/pi-tui": new URL("./stubs/pi-tui.mjs", import.meta.url).href,
};

registerHooks({
	resolve(specifier, context, nextResolve) {
		const stub = stubs[specifier];
		if (stub) return { url: stub, shortCircuit: true };
		return nextResolve(specifier, context);
	},
});
