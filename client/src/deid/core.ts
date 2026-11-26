// De-identification logic with no browser or model dependency, so tests can run it directly.
// See docs/BROWSER_DEID_STANDARD.md.

export type Span = { start: number; end: number; type: string };
export type WordSpan = { start: number; end: number; text: string };

// Standard forms of clinical codes aren't identifiers (R9).
const PROTECTED = [
	/\[[A-Z]+_\d+\]/g, // our own placeholders, when a message is edited or re-sent
	/\b(?:SNOMED|LOINC|RXNORM|ICD10CM|ICD10PCS|ICD9CM|ICD9PROC|HP|MONDO|DOID|NCIT|CHEBI|GO|UBERON|CVX|HCPCS):[\w.\-]+/g,
	/\b[A-TV-Z]\d{2}(?:\.[0-9A-Z]{1,4})\b/g, // ICD-10-CM with a decimal, such as E11.9
	/\b\d{1,5}-\d\b/g // LOINC, such as 4548-4
];

const MONTHS =
	'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|' +
	'enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre|' +
	'gennaio|febbraio|aprile|maggio|giugno|luglio|settembre|ottobre|dicembre';

// Structured identifiers in English, Spanish and Italian formats. Order matters: earlier wins.
const PATTERNS: [string, RegExp][] = [
	['EMAIL', /[\w.+\-]+@[\w\-]+(?:\.[\w\-]+)+/g],
	['URL', /\bhttps?:\/\/[^\s<>"']+|\bwww\.[^\s<>"']+/gi],
	['IP', /\b(?:\d{1,3}\.){3}\d{1,3}\b/g],
	['ID', /\b\d{3}-\d{2}-\d{4}\b/g], // US Social Security number
	['ID', /\b[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]\b/g], // Italian codice fiscale
	['ID', /\b\d{8}[A-HJ-NP-TV-Z]\b/g], // Spanish DNI
	['ID', /\b[XYZ]\d{7}[A-HJ-NP-TV-Z]\b/g], // Spanish NIE
	[
		'ID',
		/\b(?:MRN|medical record(?: number| no\.?)?|patient id|chart(?: number| no\.?)?|n[úu]mero de historia|historia cl[íi]nica|cartella clinica|tessera sanitaria)\s*(?:#|:|no\.?|n[º°.]?)?\s*[A-Z0-9][A-Z0-9\-]{3,}/gi
	],
	['PHONE', /(?:\+\d{1,3}[\s.\-]?)?\(?\d{2,4}\)?[\s.\-]\d{2,4}[\s.\-]\d{2,4}(?:[\s.\-]\d{2,4})?\b/g],
	['DATE', /\b\d{1,4}[\/\-.]\d{1,2}[\/\-.]\d{1,4}\b/g],
	['DATE', new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th|º|°)?\\s+(?:de\\s+|di\\s+)?(?:${MONTHS})\\.?(?:\\s+(?:de\\s+|del\\s+)?\\d{2,4})?\\b`, 'gi')],
	['DATE', new RegExp(`\\b(?:${MONTHS})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{2,4})?\\b`, 'gi')]
];

function find(regex: RegExp, text: string): { start: number; end: number }[] {
	const out = [];
	regex.lastIndex = 0;
	let m: RegExpExecArray | null;
	while ((m = regex.exec(text))) {
		if (m[0].length === 0) {
			regex.lastIndex += 1;
			continue;
		}
		out.push({ start: m.index, end: m.index + m[0].length });
	}
	return out;
}

const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) => a.start < b.end && b.start < a.end;

export function protectedRanges(text: string) {
	return PROTECTED.flatMap((regex) => find(regex, text));
}

export function patternSpans(text: string): Span[] {
	const shielded = protectedRanges(text);
	const spans: Span[] = [];
	for (const [type, regex] of PATTERNS) {
		for (const hit of find(regex, text)) {
			if (shielded.some((p) => overlaps(p, hit)) || spans.some((s) => overlaps(s, hit))) continue;
			spans.push({ ...hit, type });
		}
	}
	return spans;
}

// Words and single punctuation marks, with their positions. Works for accented letters.
export function splitWords(text: string): WordSpan[] {
	const out: WordSpan[] = [];
	for (const m of text.matchAll(/[\p{L}\p{N}]+|[^\s\p{L}\p{N}]/gu)) {
		out.push({ start: m.index!, end: m.index! + m[0].length, text: m[0] });
	}
	return out;
}

// Model labels from obi/deid_roberta_i2b2, without their position prefix.
const MODEL_TYPES: Record<string, string> = {
	PATIENT: 'PATIENT',
	STAFF: 'CLINICIAN',
	HOSP: 'FACILITY',
	PATORG: 'ORG',
	LOC: 'LOCATION',
	DATE: 'DATE',
	AGE: 'AGE',
	PHONE: 'PHONE',
	EMAIL: 'EMAIL',
	ID: 'ID',
	OTHERPHI: 'OTHER'
};

export function modelType(label: string): string {
	return MODEL_TYPES[label.replace(/^[BILUES]-/, '')] ?? 'OTHER';
}

// Combine pattern and model findings. Patterns win. Neighbouring words of one type join up.
export function mergeSpans(text: string, spans: Span[]): Span[] {
	const shielded = protectedRanges(text);
	const sorted = spans
		.filter((s) => !shielded.some((p) => overlaps(p, s)))
		.sort((a, b) => a.start - b.start || b.end - a.end);
	const out: Span[] = [];
	for (const span of sorted) {
		const last = out[out.length - 1];
		if (last && span.start <= last.end) {
			last.end = Math.max(last.end, span.end);
		} else if (last && last.type === span.type && /^[\s,.'’\-]*$/.test(text.slice(last.end, span.start))) {
			last.end = span.end;
		} else {
			out.push({ ...span });
		}
	}
	return out;
}

// Same value, same placeholder, for one chat (R5). The map only ever lives in memory (R6).
export class PlaceholderMap {
	private byValue = new Map<string, string>();
	private counts = new Map<string, number>();

	// Never reuse a number already in the chat, such as after a reload.
	reserve(texts: string[]) {
		for (const text of texts) {
			for (const m of (text ?? '').matchAll(/\[([A-Z]+)_(\d+)\]/g)) {
				this.counts.set(m[1], Math.max(this.counts.get(m[1]) ?? 0, Number(m[2])));
			}
		}
	}

	placeholder(type: string, value: string): string {
		const key = `${type}\u0000${value.trim().toLowerCase()}`;
		let found = this.byValue.get(key);
		if (!found) {
			const n = (this.counts.get(type) ?? 0) + 1;
			this.counts.set(type, n);
			found = `[${type}_${n}]`;
			this.byValue.set(key, found);
		}
		return found;
	}
}

export function applySpans(text: string, spans: Span[], map: PlaceholderMap): string {
	let out = '';
	let cursor = 0;
	for (const s of spans) {
		out += text.slice(cursor, s.start) + map.placeholder(s.type, text.slice(s.start, s.end));
		cursor = s.end;
	}
	return out + text.slice(cursor);
}

// Titles and roles aren't identifiers, though the model sometimes flags them next to a name.
const ROLE_WORDS = new Set(
	'patient paciente paziente mr mrs ms miss dr doctor nurse sir señor señora señorita sr sra srta doctora enfermera enfermero signor signora signorina sig dottor dottore dottoressa infermiera infermiere'.split(' ')
);

// Lower is stricter about what counts as non-identifying: a word is flagged unless the model is
// at least this sure it's not an identifier. Set high because a miss costs more than an extra mask.
export const NOT_IDENTIFIER_CONFIDENCE = 0.9;
export const MAX_TOKENS = 512;
export const STRIDE_TOKENS = 128;

// Per-word decision from per-token probabilities. Pure, so it's testable without the model.
export function wordSpansFromTokens(
	words: WordSpan[],
	tokenWord: number[], // for each token, which word it belongs to
	notIdentifier: number[], // for each token, the lowest P(not an identifier) over all windows
	bestLabel: string[] // for each token, its most likely identifier label
): Span[] {
	const flagged = new Map<number, string>();
	tokenWord.forEach((word, token) => {
		if (notIdentifier[token] < NOT_IDENTIFIER_CONFIDENCE && !flagged.has(word)) {
			flagged.set(word, modelType(bestLabel[token]));
		}
	});
	return [...flagged.entries()]
		.filter(([word]) => /[\p{L}\p{N}]/u.test(words[word].text)) // a lone comma is never an identifier
		.filter(([word]) => !ROLE_WORDS.has(words[word].text.toLowerCase()))
		.map(([word, type]) => ({ start: words[word].start, end: words[word].end, type }));
}
