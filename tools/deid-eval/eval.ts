// Measures the de-identifier on made-up notes. Usage: tsx eval.ts <model parent folder> <notes.json>
// A found identifier means none of its words remain in the output.
import { readFileSync } from 'node:fs';
import { AutoModelForTokenClassification, AutoTokenizer, Tensor, env } from '@huggingface/transformers';
import { PlaceholderMap, applySpans, mergeSpans, patternSpans } from '../../client/src/deid/core';
import { detect } from '../../client/src/deid/detect';

env.allowRemoteModels = false;
env.localModelPath = process.argv[2];
const tokenizer = await AutoTokenizer.from_pretrained('deid');
const model = await AutoModelForTokenClassification.from_pretrained('deid', { dtype: 'q8' });
const notes = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const tally: Record<string, { ids: number; found: number; keep: number; kept: number }> = {};
const words = (s: string) => s.match(/[\p{L}\p{N}]+/gu) ?? [];
let totalMs = 0;
for (const note of notes) {
	const started = Date.now();
	const out = applySpans(note.text, mergeSpans(note.text, [...patternSpans(note.text), ...(await detect(note.text, tokenizer, model, Tensor))]), new PlaceholderMap());
	totalMs += Date.now() - started;
	const t = (tally[note.lang] ??= { ids: 0, found: 0, keep: 0, kept: 0 });
	for (const id of note.ids) {
		t.ids += 1;
		const leaked = words(id).filter((w) => new RegExp(`(^|[^\\p{L}\\p{N}])${w}($|[^\\p{L}\\p{N}])`, 'u').test(out));
		if (leaked.length === 0) t.found += 1;
		else console.log(`MISSED [${note.lang}] ${id} (left: ${leaked.join(' ')})`);
	}
	for (const term of note.keep) {
		t.keep += 1;
		if (out.includes(term)) t.kept += 1;
		else console.log(`OVERMASKED [${note.lang}] ${term}`);
	}
	console.log(`${note.lang}: ${out}`);
}
console.log(JSON.stringify(tally));
console.log(`average ${Math.round(totalMs / notes.length)} ms per note`);
