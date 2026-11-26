// Kept apart from the model code, so API modules can import it without loading the worker.
export class DeidBlockedError extends Error {}

// For inputs this version can't de-identify (R4).
export function refuseUncleanable(what: string): never {
	throw new DeidBlockedError(`${what} is turned off: it can't be de-identified before leaving your browser.`);
}
