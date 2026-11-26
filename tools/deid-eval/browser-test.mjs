// Real-browser check of the standard against LibreChat, run on the server:
//   node browser-test.mjs <base url> <file with email then password>
// Uses a made-up patient. Records every request the page makes and fails if an identifier appears.
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const [base, loginFile] = process.argv.slice(2);
const [email, password] = readFileSync(loginFile, 'utf8').trim().split('\n');
const IDENTIFIERS = ['Zebulon', 'Quackenbush', '04/12/1958', 'zq@example.com', '415-555-0182'];
const MESSAGE = 'Patient Zebulon Quackenbush, DOB 04/12/1958, email zq@example.com, phone 415-555-0182, had a seizure. What is a seizure?';
const CHAT = /\/api\/agents\/chat/;
const baseHost = new URL(base).host;
let failed = 0;
const check = (name, ok, detail = '') => {
	console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' - ' + detail : ''}`);
	if (!ok) failed += 1;
};
const posted = (requests) => requests.filter((r) => r.body);
const leaks = (requests) => posted(requests).filter((r) => IDENTIFIERS.some((id) => r.body.includes(id)));

async function open(browser, { blockModel = false } = {}) {
	const context = await browser.newContext({ locale: 'en-US', timezoneId: 'America/New_York' });
	const page = await context.newPage();
	const requests = [];
	page.on('request', (r) => requests.push({ url: r.url(), method: r.method(), body: r.postData() ?? '' }));
	page.on('websocket', (ws) => ws.on('framesent', (f) => requests.push({ url: ws.url(), method: 'WS', body: String(f.payload) })));
	if (blockModel) await page.route('**/models/deid/**', (route) => route.abort());
	await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded' });
	await page.fill('input[name="email"]', email);
	await page.fill('input[name="password"]', password);
	await page.keyboard.press('Enter');
	await page.waitForSelector('#prompt-textarea', { timeout: 120000 });
	await page.waitForTimeout(3000);
	return { context, page, requests };
}

async function send(page, text) {
	await page.locator('#prompt-textarea').click();
	await page.keyboard.insertText(text);
	await page.waitForTimeout(500);
	await page.keyboard.press('Enter');
}

const browser = await chromium.launch();

// 1. Normal send: the text is cleaned before anything leaves.
{
	const { context, page, requests } = await open(browser);
	await send(page, MESSAGE);
	const started = Date.now();
	let sent = null;
	while (Date.now() - started < 300000 && !sent) {
		sent = requests.find((r) => r.method === 'POST' && CHAT.test(r.url));
		await page.waitForTimeout(500);
	}
	check('message reached the chat endpoint', Boolean(sent), `after ${Math.round((Date.now() - started) / 1000)}s`);
	await page.waitForTimeout(30000);
	check('no identifier in any request', leaks(requests).length === 0, `${posted(requests).length} requests with bodies checked${leaks(requests).length ? '; leaked to ' + leaks(requests).map((r) => r.url).join(', ') : ''}`);
	check('request carries placeholders', Boolean(sent && /\[PATIENT_1\]/.test(sent.body)));
	check('the seizure question survives', Boolean(sent && sent.body.includes('seizure')));
	const shown = await page.locator('body').innerText();
	await page.screenshot({ path: '/out/send.png' });
	console.log('page:', JSON.stringify(shown).slice(0, 900));
	check('chat shows the de-identified text', /PATIENT_1/.test(shown));
	check('original name is not on screen', !shown.includes('Quackenbush'));
	check('the answer comes from the ontology', /HP:0001250/.test(shown));
	check('the answer lists its sources', /Sources/.test(shown));

	// Second channels, from the same page: requests made as the app would make them.
	const before = requests.length;
	const results = await page.evaluate(async (raw) => {
		const out = {};
		const form = new FormData();
		form.append('file', new Blob([raw]), 'note.txt');
		out.fetchUpload = await fetch('/api/files', { method: 'POST', body: form }).then((r) => r.status, () => 'refused');
		out.fetchVoice = await fetch('/api/speech/stt', { method: 'POST', body: form }).then((r) => r.status, () => 'refused');
		out.xhrUpload = await new Promise((resolve) => {
			const xhr = new XMLHttpRequest();
			xhr.open('POST', '/api/files');
			xhr.onload = () => resolve(xhr.status);
			xhr.onerror = () => resolve('refused');
			xhr.send(form);
		});
		return out;
	}, MESSAGE);
	check('file upload is refused (fetch)', results.fetchUpload === 'refused', String(results.fetchUpload));
	check('voice is refused (fetch)', results.fetchVoice === 'refused', String(results.fetchVoice));
	check('file upload is refused (XHR)', results.xhrUpload === 'refused', String(results.xhrUpload));
	check('refused requests never left the browser', !requests.slice(before).some((r) => /\/api\/(files|speech)/.test(r.url) && r.method === 'POST'));

	const gated = await page.evaluate(async (raw) => {
		const body = JSON.stringify({ text: raw, conversationId: 'new' });
		const status = await fetch('/api/messages/gate-test/gate-test', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body }).then((r) => r.status, () => 'blocked');
		return status;
	}, MESSAGE);
	await page.waitForTimeout(1000);
	check('text sent another way is cleaned at the network layer', leaks(requests).length === 0, `status ${gated}`);

	const outside = [...new Set(requests.map((r) => new URL(r.url).host))].filter((h) => h !== baseHost);
	check('no requests to other hosts', outside.length === 0, outside.join(', '));
	await context.close();
}

// 2. A message typed while an answer is still being written goes through queueing or steering.
{
	const { context, page, requests } = await open(browser);
	await send(page, 'What is a seizure?');
	await page.waitForTimeout(700);
	await send(page, MESSAGE);
	await page.waitForTimeout(25000);
	const shown = await page.locator('body').innerText();
	check('during a reply: no identifier in any request', leaks(requests).length === 0, leaks(requests).map((r) => r.url).join(', '));
	check('during a reply: original name is not on screen', !shown.includes('Quackenbush'));
	await context.close();
}

// 3. Fail closed: with the model unavailable, nothing goes out.
{
	const { context, page, requests } = await open(browser, { blockModel: true });
	await send(page, MESSAGE);
	let told = false;
	for (let i = 0; i < 40 && !told; i += 1) {
		told = /not sent|De-identification/i.test(await page.locator('body').innerText());
		await page.waitForTimeout(500);
	}
	await page.screenshot({ path: '/out/blocked.png' });
	await page.waitForTimeout(3000);
	check('fail closed: typed text is kept in the box', (await page.locator('#prompt-textarea').inputValue()).includes('Quackenbush'));
	await page.waitForTimeout(7000);
	check('fail closed: no identifier sent', leaks(requests).length === 0, leaks(requests).map((r) => r.url).join(', '));
	check('fail closed: nothing sent to the model', !requests.some((r) => r.method === 'POST' && CHAT.test(r.url)));
	check('fail closed: user is told', told);
	await context.close();
}

await browser.close();
console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
process.exit(failed ? 1 : 0);
