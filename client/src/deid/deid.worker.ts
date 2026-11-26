// Runs the de-identification model in the browser. Files come from this deployment only (R3).
import { AutoModelForTokenClassification, AutoTokenizer, Tensor, env } from '@huggingface/transformers';
import { detect } from './detect';

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = '/models/';
env.backends.onnx.wasm.wasmPaths = '/wasm/';

const MODEL = 'deid';
let ready: Promise<{ tokenizer: any; model: any }> | null = null;

function load() {
	if (!ready) {
		ready = (async () => ({
			tokenizer: await AutoTokenizer.from_pretrained(MODEL),
			model: await AutoModelForTokenClassification.from_pretrained(MODEL, { dtype: 'q8', device: 'wasm' })
		}))();
		ready.catch(() => (ready = null));
	}
	return ready;
}

self.onmessage = async (event) => {
	const { id, type, text } = event.data;
	try {
		const { tokenizer, model } = await load();
		self.postMessage({ id, ok: true, spans: type === 'detect' ? await detect(text, tokenizer, model, Tensor) : [] });
	} catch (error) {
		self.postMessage({ id, ok: false, error: error instanceof Error ? error.name : 'error' });
	}
};
