// Model inference shared by the browser worker and the evaluation script.
import { MAX_TOKENS, STRIDE_TOKENS, splitWords, wordSpansFromTokens, type Span } from './core';

function softmax(row: number[]) {
	const peak = Math.max(...row);
	const exp = row.map((x) => Math.exp(x - peak));
	const sum = exp.reduce((a, b) => a + b, 0);
	return exp.map((x) => x / sum);
}

export async function detect(text: string, tokenizer: any, model: any, Tensor: any): Promise<Span[]> {
	const labels: Record<string, string> = model.config.id2label;
	const words = splitWords(text);
	if (!words.length) return [];

	const ids: number[] = [];
	const tokenWord: number[] = [];
	words.forEach((word, w) => {
		// A leading space gives each word the form it has mid-sentence in this tokenizer.
		for (const id of tokenizer.encode(` ${word.text}`, { add_special_tokens: false })) {
			ids.push(Number(id));
			tokenWord.push(w);
		}
	});

	const cls = tokenizer.cls_token_id ?? 0;
	const sep = tokenizer.sep_token_id ?? 2;
	const notIdentifier = new Array(ids.length).fill(1);
	const bestLabel = new Array(ids.length).fill('O');
	const outside = Number(Object.entries(labels).find(([, name]) => name === 'O')![0]);
	const room = MAX_TOKENS - 2;

	for (let begin = 0; begin < ids.length; begin += room - STRIDE_TOKENS) {
		const input = [cls, ...ids.slice(begin, begin + room), sep].map((x) => BigInt(x));
		const shape = [1, input.length];
		const { logits } = await model({
			input_ids: new Tensor('int64', BigInt64Array.from(input), shape),
			attention_mask: new Tensor('int64', BigInt64Array.from(input.map(() => 1n)), shape)
		});
		const [, length, classes] = logits.dims;
		for (let t = 1; t < length - 1; t += 1) {
			const probs = softmax(Array.from(logits.data.slice(t * classes, (t + 1) * classes)) as number[]);
			const index = begin + t - 1;
			if (probs[outside] < notIdentifier[index]) {
				notIdentifier[index] = probs[outside];
				let top = -1;
				let topProb = -1;
				probs.forEach((p, c) => {
					if (c !== outside && p > topProb) {
						topProb = p;
						top = c;
					}
				});
				bestLabel[index] = labels[top];
			}
		}
		if (begin + room >= ids.length) break;
	}
	return wordSpansFromTokens(words, tokenWord, notIdentifier, bestLabel);
}
