const fs = require('fs');
const file = fs.readFileSync('tests/webhook.test.ts', 'utf-8');

const newCode = `let lastMsgId = '';
let lastTimestamp = 0;

/** Sign like standardwebhooks does: msgId, timestamp, payload -> signature header. */
async function sign(raw: string, timestamp?: Date): Promise<string> {
  const { Webhook } = await import('standardwebhooks');
  const wh = new Webhook(SECRET());
  lastMsgId = \`msg_\${randomUUID()}\`;
  const ts = timestamp ?? new Date();
  lastTimestamp = Math.floor(ts.getTime() / 1000);
  return wh.sign(lastMsgId, ts, raw);
}

function makeRequest(raw: string, signature: string): Request {
  return new Request('http://localhost/api/webhooks/dodo', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'webhook-id': lastMsgId,
      'webhook-timestamp': lastTimestamp.toString(),
      'webhook-signature': signature,
    },
    body: raw,
  });
}`;

const patched = file.replace(
  /\/\*\* Sign like standardwebhooks does[\s\S]*?body: raw,\n  \}\);\n\}/,
  newCode
);
fs.writeFileSync('tests/webhook.test.ts', patched);
