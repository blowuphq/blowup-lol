const { Webhook } = require('standardwebhooks');

const secret = process.env.DODO_WEBHOOK_SECRET || 'whsec_8oribrjB2mLJcMnAMjQ0fuM99C6nQMSm';
const wh = new Webhook(secret);

const msgId = 'msg_cb4ba3da-951e-4600-935c-a8f2b105eaa0';
const timestamp = new Date(1788105117 * 1000); // 1788105117
const payload = '{"type":"payment.succeeded","business_id":"biz_test","timestamp":"2026-08-30T15:51:57.242Z","data":{"payment_id":"pay_test_a6b2a172-5d5b-44af-b893-5df6af162018","checkout_session_id":"cs_test_9e04e1eb-c362-4c46-ab3a-c39ef07e845a","total_amount":5000,"currency":"USD","status":"succeeded","metadata":{"categorySlug":"w40969b7898","handle":"@ada","name":"Ada","seasonId":"e7433418-5cea-4ded-9bc7-060edb9040a6"}}}';

console.log("My generated sig:", wh.sign(msgId, timestamp, payload));

try {
  wh.verify(payload, {
    'webhook-id': msgId,
    'webhook-timestamp': '1788105117',
    'webhook-signature': 'v1,3Bk1bRg+8WNJs+VbpJ4VhIfyV/CG6hN+zQMsXsVAVRc='
  });
  console.log('Verified v1,3Bk1bRg+8WNJs+VbpJ4VhIfyV/CG6hN+zQMsXsVAVRc=');
} catch (e) {
  console.log('Verify failed!', e.message);
}
