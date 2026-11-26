// De-identify text in the browser before it enters chat state. See docs/BROWSER_DEID_STANDARD.md.
import { PlaceholderMap, applySpans, mergeSpans, patternSpans } from './core';
import { DeidBlockedError } from './guard';
import DeidWorker from './deid.worker?worker';

export { DeidBlockedError, refuseUncleanable } from './guard';

export const DRAFT = 'new';
const TIMEOUT_MS = 180_000;
let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, { resolve: Function; reject: Function; timer: any }>();

// In memory only, one per chat, and lost on reload (R6).
const maps = new Map<string, PlaceholderMap>();

function getWorker() {
	if (!worker) {
		worker = new DeidWorker();
		worker.onmessage = ({ data }) => {
			const job = pending.get(data.id);
			if (!job) return;
			pending.delete(data.id);
			clearTimeout(job.timer);
			data.ok ? job.resolve(data) : job.reject(new Error(data.error));
		};
		worker.onerror = (event) => {
			for (const job of pending.values()) {
				clearTimeout(job.timer);
				job.reject(new Error(event.message || 'worker failed'));
			}
			pending.clear();
			worker?.terminate();
			worker = null;
		};
	}
	return worker;
}

function ask(message: object): Promise<any> {
	return new Promise((resolve, reject) => {
		const id = nextId++;
		const timer = setTimeout(() => {
			pending.delete(id);
			reject(new Error('timed out'));
		}, TIMEOUT_MS);
		pending.set(id, { resolve, reject, timer });
		getWorker().postMessage({ id, ...message });
	});
}

// Load early, so the first message doesn't wait for it.
export const preloadDeid = () => ask({ type: 'load' }).catch(() => undefined);

// Returns de-identified text. Throws DeidBlockedError if it can't run: the caller must not send (R2).
// `existing` is the chat's current text, so a reloaded chat's placeholders are never reused for someone new.
export async function deidentify(
	text: string,
	chatKey: string,
	existing: string[] = []
): Promise<{ text: string; replaced: number }> {
	if (!text.trim()) return { text, replaced: 0 };
	try {
		const { spans: modelSpans } = await ask({ type: 'detect', text });
		const spans = mergeSpans(text, [...patternSpans(text), ...modelSpans]);
		// A new chat gets its ID after the first message: keep the same numbering when it does.
		if (chatKey !== DRAFT && !maps.has(chatKey) && maps.has(DRAFT)) {
			maps.set(chatKey, maps.get(DRAFT)!);
			maps.delete(DRAFT);
		}
		let map = maps.get(chatKey);
		if (!map) {
			map = new PlaceholderMap();
			maps.set(chatKey, map);
		}
		map.reserve(existing);
		return { text: applySpans(text, spans, map), replaced: spans.length };
	} catch (error) {
		console.error('De-identification failed', error instanceof Error ? error.name : 'unknown');
		throw new DeidBlockedError('De-identification is unavailable, so this message was not sent.');
	}
}
