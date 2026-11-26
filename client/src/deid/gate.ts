// The last check before anything leaves the browser. See docs/BROWSER_DEID_STANDARD.md.
//
// The composer cleans text before it enters chat state. This catches every other way text can get out
// (edits, queued and steered messages, retries), at the network layer so a new feature can't bypass it.
// fetch and XMLHttpRequest are the only two ways out: axios and sse.js both use XMLHttpRequest.
import { DeidBlockedError, deidentify } from './index';

const REFUSED: [RegExp, string][] = [
  [/\/api\/files(\/|$)/, 'File upload'],
  [/\/api\/speech\/stt/, 'Voice input'],
];
const TEXT_ROUTES = /\/api\/(agents\/chat|messages)(\/|$)/;
const WRITES = new Set(['POST', 'PUT', 'PATCH']);
export const BLOCKED_EVENT = 'deid-blocked';

function refusal(method: string, url: string): string | null {
  if (!WRITES.has(method.toUpperCase())) {
    return null;
  }
  const match = REFUSED.find(([route]) => route.test(url));
  return match ? `${match[1]} is turned off: it can't be de-identified before leaving your browser.` : null;
}

function announce(message: string) {
  window.dispatchEvent(new CustomEvent(BLOCKED_EVENT, { detail: message }));
}

async function cleanBody(method: string, url: string, body: unknown): Promise<unknown> {
  if (!WRITES.has(method.toUpperCase()) || !TEXT_ROUTES.test(url) || typeof body !== 'string') {
    return body;
  }
  let parsed: any;
  try {
    parsed = JSON.parse(body);
  } catch {
    return body;
  }
  if (typeof parsed?.text !== 'string') {
    return body;
  }
  const { text } = await deidentify(parsed.text, parsed.conversationId ?? 'new');
  return JSON.stringify({ ...parsed, text });
}

let installed = false;

export function installDeidGate() {
  if (installed || typeof window === 'undefined') {
    return;
  }
  installed = true;

  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    const refused = refusal(method, url);
    if (refused) {
      announce(refused);
      throw new DeidBlockedError(refused);
    }
    if (input instanceof Request && init?.body === undefined && TEXT_ROUTES.test(url) && WRITES.has(method.toUpperCase())) {
      const body = await cleanBodyOrBlock(method, url, await input.clone().text());
      return realFetch(new Request(input, { body: body as BodyInit }));
    }
    if (init?.body !== undefined) {
      const body = await cleanBodyOrBlock(method, url, init.body);
      return realFetch(input, { ...init, body: body as BodyInit });
    }
    return realFetch(input, init);
  };

  const open = XMLHttpRequest.prototype.open;
  const send = XMLHttpRequest.prototype.send;
  const targets = new WeakMap<XMLHttpRequest, { method: string; url: string }>();

  XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: any[]) {
    targets.set(this, { method, url: String(url) });
    return (open as any).call(this, method, url, ...rest);
  } as typeof XMLHttpRequest.prototype.open;

  XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
    const { method, url } = targets.get(this) ?? { method: 'GET', url: '' };
    const fail = (message: string) => {
      announce(message);
      // Nothing was sent: report it the way a failed request reports itself.
      this.abort();
      this.dispatchEvent(new ProgressEvent('error'));
    };
    const refused = refusal(method, url);
    if (refused) {
      return fail(refused);
    }
    if (!WRITES.has(method.toUpperCase()) || !TEXT_ROUTES.test(url)) {
      return send.call(this, body);
    }
    cleanBodyOrBlock(method, url, body).then(
      (cleaned) => send.call(this, cleaned as XMLHttpRequestBodyInit),
      (error) => fail(error.message),
    );
  };

  async function cleanBodyOrBlock(method: string, url: string, body: unknown) {
    try {
      return await cleanBody(method, url, body);
    } catch (error) {
      announce((error as Error).message);
      throw error;
    }
  }
}
