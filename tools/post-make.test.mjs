// A stand-in Make webhook and image host. Make answers "Accepted" to a webhook unless the scenario ends with a
// "Webhook response" module, which can send back the new Pin's id. No network is used.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { pinDate, pinFileName, sendToMake, waitForImage } from './post-make.mjs';

const received = [];
let imageHits = 0;
const server = http.createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  if (req.url.startsWith('/img/')) {
    imageHits++;
    if (req.url === '/img/late.png' && imageHits < 3) { res.writeHead(404); return res.end(); }
    if (req.url === '/img/html.png') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'image/png' });
    return res.end();
  }
  received.push({ url: req.url, type: req.headers['content-type'], body: raw });
  if (req.url === '/hook/accepted') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('Accepted'); }
  if (req.url === '/hook/with-response') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"id":"1122334455667788"}'); }
  if (req.url === '/hook/gone') { res.writeHead(410, { 'Content-Type': 'text/plain' }); return res.end('There is no scenario listening for this webhook.'); }
  res.writeHead(500, { 'Content-Type': 'text/plain' });
  res.end('Scenario failed');
});

let base;
before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const pin = { id: 'muslim-245', date: '2026-10-30', name: 'pin-2026-10-30-muslim-245.png', title: 'مَنْ تَوَضَّأَ', description: 'قال رسول الله ﷺ', alt_text: 'بطاقة حديث نبوي' };
// sendToMake only accepts https addresses; the stub is http, so route the request through a fetch that rewrites it.
const viaStub = (fetchImpl = fetch) => (url, init) => fetchImpl(url.replace('https://hook.example', base), init);

test('sends the Pin text and image address to the webhook', async () => {
  const result = await sendToMake({ webhookUrl: 'https://hook.example/hook/accepted', pin, imageUrl: 'https://raw.example/pin.png', fetchImpl: viaStub() });
  assert.deepEqual(result, { accepted: true, pinId: null, answer: 'Accepted' });
  const sent = received.at(-1);
  assert.equal(sent.type, 'application/json');
  assert.deepEqual(JSON.parse(sent.body), {
    id: 'muslim-245', date: '2026-10-30', title: 'مَنْ تَوَضَّأَ', description: 'قال رسول الله ﷺ', alt_text: 'بطاقة حديث نبوي', link: '', image_url: 'https://raw.example/pin.png',
  });
});

test("reads the Pin id when the scenario answers with one", async () => {
  const result = await sendToMake({ webhookUrl: 'https://hook.example/hook/with-response', pin, imageUrl: 'https://raw.example/pin.png', fetchImpl: viaStub() });
  assert.equal(result.pinId, '1122334455667788');
});

test('explains webhook failures', async () => {
  const send = (hook) => sendToMake({ webhookUrl: `https://hook.example/hook/${hook}`, pin, imageUrl: 'https://raw.example/pin.png', fetchImpl: viaStub() });
  await assert.rejects(send('gone'), /no scenario listening.*\(HTTP 410\)\. The webhook no longer exists/);
  await assert.rejects(send('broken'), /Make refused the Pin: Scenario failed \(HTTP 500\)/);
  await assert.rejects(sendToMake({ webhookUrl: '', pin, imageUrl: 'x' }), /Set MAKE_WEBHOOK_URL/);
  await assert.rejects(sendToMake({ webhookUrl: 'http://hook.example/x', pin, imageUrl: 'x' }), /starts with https/);
});

test('waits until the image can be downloaded as an image', async () => {
  imageHits = 0;
  await waitForImage(`${base}/img/late.png`, { intervalMs: 10, timeoutMs: 2000 });
  assert.equal(imageHits, 3, 'polled until the third answer was an image');
  await assert.rejects(waitForImage(`${base}/img/html.png`, { intervalMs: 10, timeoutMs: 100 }), /still isn't available \(content type text\/html\)/);
  await assert.rejects(waitForImage('http://127.0.0.1:1/img/x.png', { intervalMs: 10, timeoutMs: 50 }), /still isn't available/);
});

test("names the day's image after the date in the card's time zone", () => {
  const lateEvening = new Date('2026-10-30T23:30:00Z');
  assert.equal(pinDate('Europe/Paris', lateEvening), '2026-10-31', 'already the next day in Paris');
  assert.equal(pinDate('UTC', lateEvening), '2026-10-30');
  assert.equal(pinFileName('2026-10-31', 'muslim-245'), 'pin-2026-10-31-muslim-245.png');
  assert.equal(pinFileName('2026-10-31', 'dorar-a/b c'), 'pin-2026-10-31-dorar-a_b_c.png');
});
