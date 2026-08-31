# Phase 5.0 — Dodo Payments Migration Spec

> **Status:** DRAFT — awaiting section-by-section owner approval before implementation begins.  
> **Branch:** `phase-5-dodo-migration`  
> **Last updated:** 2026-08-30

---

## GOAL

Replace the Stripe payment integration wholesale with Dodo Payments. The external-facing
contract (bid flow, board behaviour, money invariants) is **unchanged**; only the payment
provider changes. The migration is complete when a real bid submitted via the live form
rounds-trips through Dodo Checkout → Dodo webhook → Postgres settlement → Redis projection
with every invariant satisfied, and no Stripe code remains in the codebase.

---

## CONTEXT — CURRENT STATE

Verified against `main` HEAD (2026-08-30):

| Layer | Current | Target |
|---|---|---|
| Client lib | `src/lib/stripe.ts` — lazy singleton `Stripe` | `src/lib/dodo.ts` — lazy singleton `DodoPayments` |
| SDK | `stripe` npm v22.5.0 | `dodopayments` npm (dodopayments-node) |
| Checkout logic | `src/features/bidding/checkout.ts` — `createCheckoutSession()` via `Stripe.checkout.sessions.create` | same file, `createCheckoutSession()` via Dodo checkout sessions |
| Webhook receiver | `src/app/api/webhooks/stripe/route.ts` | `src/app/api/webhooks/dodo/route.ts` |
| Webhook verification | `Stripe.webhooks.constructEvent(raw, sig, secret)` | `client.webhooks.unwrap(body, { headers })` — SDK wraps `standardwebhooks` |
| Env vars (active) | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | `DODO_API_KEY`, `DODO_WEBHOOK_SECRET` (already in local `.env`) |
| Dodo endpoint | — | `https://blowup.lol/api/webhooks/dodo` (already registered in Dodo dashboard) |

Money-path code that does **not** change: `src/features/bidding/settlement.ts`,
`src/features/bidding/pipeline.ts`, `src/db/schema.ts`, Redis projection logic.

---

## CRITICAL ARCHITECTURAL CONSTRAINT — DODO PRODUCT REQUIREMENT

Stripe supports fully dynamic line-item pricing (`price_data.unit_amount`). **Dodo does
not.** Every checkout session cart item requires a pre-existing `product_id`. For
Blowup's variable-amount bid flow, the approach is:

1. Create **one reusable "Blowup bid" product** in the Dodo dashboard (or via the API
   once) with `pay_what_you_want: true` and `price` (floor) set to 500 cents ($5, matching
   `CUSTOM_BID.MIN_CENTS`). Store its `product_id` in the env var `DODO_BID_PRODUCT_ID`.
2. At checkout time, pass that product in the cart with `amount: input.amountCents` on the
   `ProductItemReq`. Dodo honours this as the customer's chosen amount for a
   pay-what-you-want product.
3. At settlement, read `event.data.total_amount` (not a metadata field) as the
   authoritative paid amount — exactly as Stripe's `amount_total` was used.

This constraint means the migration involves **one manual setup step** (create the product in
the Dodo dashboard and record its ID) before integration tests can pass. That step is
documented in the Definition of Done.

---

## IN SCOPE

### Item 1 — Replace `src/lib/stripe.ts` with `src/lib/dodo.ts`

**What changes:**
- Install `dodopayments` npm package.
- Delete `src/lib/stripe.ts`.
- Create `src/lib/dodo.ts` with an identical lazy-singleton pattern:

```ts
import DodoPayments from 'dodopayments';

let cached: DodoPayments | null = null;

export function tryGetDodo(): DodoPayments | null {
  const key = process.env.DODO_API_KEY;
  if (!key) return null;

  // The SDK expects DODO_PAYMENTS_API_KEY by default, so we explicitly map our DODO_API_KEY
  // to bearerToken. We also rely on process.env.NODE_ENV or an explicit env var to control 
  // the environment ('test_mode' vs 'live_mode'), as sandbox keys require 'test_mode'.
  const isProd = process.env.NODE_ENV === 'production';
  const environment = isProd ? 'live_mode' : 'test_mode';

  if (!cached) cached = new DodoPayments({ 
    bearerToken: key,
    environment
  });
  
  return cached;
}

export function getDodo(): DodoPayments {
  const client = tryGetDodo();
  if (!client) throw new Error('DODO_API_KEY is not set — cannot call the Dodo API');
  return client;
}
```

The `bearerToken` constructor param is used explicitly because the Node SDK defaults to looking for `DODO_PAYMENTS_API_KEY`, but our environment uses `DODO_API_KEY`. We also explicitly pass `environment` because sandbox keys will throw a 401 Unauthorized if the client defaults to `live_mode`.

**What does NOT change:** The lazy singleton pattern, the `try/get` naming pair, the
error message convention.

---

### Item 2 — Replace checkout session creation in `src/features/bidding/checkout.ts`

**What changes:**

The `CheckoutSessionsApi` interface is replaced with a Dodo-shaped one (or removed entirely
in favour of calling the SDK directly — see below). The `createCheckoutSession` function
body changes; its **exported signature is unchanged**:

```ts
export async function createCheckoutSession(input: CheckoutRequest): Promise<CreatedCheckout>
```

`CheckoutRequest` and `CreatedCheckout` remain identical — the route and the ClaimForm
never see the internal Dodo types.

**Dodo call shape:**

```ts
const session = await getDodo().checkoutSessions.create({
  product_cart: [{
    product_id: process.env.DODO_BID_PRODUCT_ID!,
    quantity: 1,
    amount: input.amountCents,    // pay-what-you-want amount in cents
  }],
  metadata: {
    categorySlug: input.categorySlug,
    handle,
    name:        input.name?.slice(0, 80) ?? '',
    seasonId:    season.id,
  },
  return_url:  `${appUrl}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
  cancel_url:  `${appUrl}/?checkout=cancelled`,
  billing_currency: 'USD',
});
```

Return mapping:

```ts
if (!session.checkout_url) throw new Error('Dodo returned no checkout URL');
return { sessionId: session.session_id, url: session.checkout_url };
```

**Notes:**
- The `CheckoutSessionsApi` injectable interface (used by unit tests in the Stripe version)
  is removed; tests will mock at the `getDodo()` level instead.
- `integration_identifier` (Stripe-specific tag) is dropped — no equivalent in Dodo.
- `DODO_BID_PRODUCT_ID` must be in the env; the function throws (→ 500) if absent.
- Error classification in the route stays the same: config problems → 500, validation → 400.
  The route's catch block pattern (`/STRIPE_SECRET_KEY/`) is updated to match Dodo errors.

---

### Item 3 — Replace webhook receiver

**Old file deleted:** `src/app/api/webhooks/stripe/route.ts`

**New file created:** `src/app/api/webhooks/dodo/route.ts`

**Preserved money-path invariants (verbatim from architecture §4):**

| Invariant | How preserved |
|---|---|
| Raw body read before any parsing | `const raw = await req.text()` — identical |
| Signature verified before any handler | `getDodo().webhooks.unwrap(raw, { headers })` — throws on bad sig |
| Bad signature → 400 | catch the unwrap error, return 400 |
| Infrastructure errors → 500 | let thrown infrastructure errors propagate to the 500 branch |
| Idempotency key | `event.data.payment_id` (replaces Stripe `event.id`) — see Item 5 |
| Settlement only via verified webhook | unchanged — `processVerifiedEvent` is called only on the verified event object |

**New route structure:**

```ts
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  const secret = process.env.DODO_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[dodo-webhook] DODO_WEBHOOK_SECRET not set');
    return Response.json({ error: 'webhook not configured' }, { status: 500 });
  }

  const raw = await req.text();
  const headers = {
    'webhook-id':        req.headers.get('webhook-id') ?? '',
    'webhook-signature': req.headers.get('webhook-signature') ?? '',
    'webhook-timestamp': req.headers.get('webhook-timestamp') ?? '',
  };

  let event: UnwrapWebhookEvent;
  try {
    event = getDodo().webhooks.unwrap(raw, { headers, key: secret });
  } catch {
    return Response.json({ error: 'invalid signature' }, { status: 400 });
  }

  try {
    await processVerifiedDodoEvent(event);
    return Response.json({ ok: true });
  } catch (err) {
    console.error('[dodo-webhook] processing error:', err);
    return Response.json({ error: 'internal error' }, { status: 500 });
  }
}
```

`processVerifiedDodoEvent` is a thin adapter in the same file that converts the Dodo
event shape to the `VerifiedEventLike` interface that `processVerifiedEvent` already
accepts — see Item 5.

---

### Item 4 — Event mapping

The Dodo SDK's `UnwrapWebhookEvent.type` discriminator values map to the
settlement outcomes in `settlement.ts` as follows:

| Dodo event type | Stripe equivalent | Settlement outcome |
|---|---|---|
| `payment.succeeded` | `checkout.session.completed` (paid) | `settleSession` → `{ kind: 'settled' }` |
| `payment.failed` | `checkout.session.async_payment_failed` | `{ kind: 'async_payment_failed' }` |
| `payment.cancelled` | checkout cancelled/expired (no webhook in Stripe) | `{ kind: 'ignored' }` (no money moved; no refund needed) |
| `payment.processing` | `checkout.session.completed` (unpaid / delayed method) | `{ kind: 'awaiting_payment' }` |
| anything else | `default:` | `{ kind: 'ignored' }` |

**Notes on `payment.processing`:**
Dodo sends this for async payment methods (e.g. bank transfer) before confirmation.
A later `payment.succeeded` or `payment.failed` follows. The `awaiting_payment` outcome
already exists in `settlement.ts` — no new outcome kind is needed.

**No async_payment_succeeded Dodo event:** In Stripe, `checkout.session.async_payment_succeeded`
was an explicit event type. In Dodo, the terminal confirmation is simply `payment.succeeded`.
So `payment.succeeded` must handle both the synchronous completion case AND the deferred
confirmation case — `settleSession` is called unconditionally on `payment.succeeded`.

---

### Item 5 — Adapter: Dodo event → `VerifiedEventLike`

`processVerifiedEvent` in `settlement.ts` accepts `VerifiedEventLike`:

```ts
export interface VerifiedEventLike {
  id: string;                      // idempotency key
  type: string;                    // event discriminator
  data: { object: unknown };       // the payload object
}
```

The Dodo event shape is:

```ts
{
  type: 'payment.succeeded',
  timestamp: string,
  business_id: string,
  data: Payment,   // NOT wrapped in { object: ... }
}
```

The adapter is a pure mapping function — no logic, no side effects:

```ts
function toDodoVerifiedEvent(raw: UnwrapWebhookEvent): VerifiedEventLike {
  const payment = raw.data as PaymentsAPI.Payment;
  return {
    id:   payment.payment_id,           // idempotency key
    type: raw.type,
    data: { object: payment },          // wraps to match VerifiedEventLike
  };
}
```

**Settlement field mapping inside `settleSession` (settlement.ts):**

`settleSession` casts `event.data.object` as `SessionLike`:

```ts
interface SessionLike {
  id: string;                         // ← session.id
  payment_intent?: string | null;     // ← used as paymentIntentId for refunds
  amount_total?: number | null;       // ← authoritative paid amount
  currency?: string | null;
  payment_status?: string | null;     // ← 'paid' check for awaiting_payment guard
  metadata?: Record<string, string> | null;
}
```

The Dodo `Payment` object maps to `SessionLike` fields as follows:

| `SessionLike` field | Dodo `Payment` field | Notes |
|---|---|---|
| `id` | `payment.checkout_session_id` | The checkout session id |
| `payment_intent` | `payment.payment_id` | Used as the refund target (Dodo refunds by payment_id) |
| `amount_total` | `payment.total_amount` | Authoritative amount in cents |
| `currency` | `payment.currency` | |
| `payment_status` | `'paid'` (hardcoded for `payment.succeeded`) | `payment.processing` → `'unpaid'` triggers awaiting_payment guard |
| `metadata` | `payment.metadata` | Identity fields written at checkout creation |

**This mapping is done in the adapter, not in `settlement.ts`.** The adapter constructs
a synthetic `SessionLike`-shaped object so `settlement.ts` is not touched:

```ts
function toDodoSessionLike(payment: PaymentsAPI.Payment, eventType: string): SessionLike {
  return {
    id:             payment.checkout_session_id ?? payment.payment_id,
    payment_intent: payment.payment_id,
    amount_total:   payment.total_amount,
    currency:       payment.currency?.toLowerCase() ?? null,
    payment_status: eventType === 'payment.succeeded' ? 'paid' : 'unpaid',
    metadata:       (payment.metadata as Record<string, string> | null) ?? null,
  };
}
```

**Refund adapter:** `settlement.ts` calls `refunds.create({ payment_intent: id })`.
No `RefundApi` shim is needed — instead, the Dodo refund call is:

```ts
await getDodo().refunds.create({ payment_id: paymentId });
```

The `refunds` parameter in `processVerifiedEvent` is typed as `RefundApi | undefined`.
For the Dodo route, we pass a thin adapter:

```ts
const refundAdapter: RefundApi = {
  create: ({ payment_intent }) =>
    getDodo().refunds.create({ payment_id: payment_intent }),
};
```

`RefundApi.create` returns `Promise<unknown>` — the Dodo `refunds.create` return type
satisfies this.

---

### Item 6 — Delete old Stripe code

The following files are **deleted entirely** after the Dodo versions are verified:

| File | Reason |
|---|---|
| `src/lib/stripe.ts` | Replaced by `src/lib/dodo.ts` |
| `src/app/api/webhooks/stripe/route.ts` | Replaced by `src/app/api/webhooks/dodo/route.ts` |

The following file is **updated** (not deleted):

| File | Change |
|---|---|
| `src/features/bidding/checkout.ts` | `createCheckoutSession` body replaced; `CheckoutSessionsApi` interface removed |
| `src/app/api/checkout/route.ts` | Error message pattern updated (`STRIPE_SECRET_KEY` → `DODO_API_KEY`); no structural change |
| `package.json` | `stripe` package removed; `dodopayments` added |

The `stripe` npm package is **removed** (`npm uninstall stripe`) only after all Stripe
imports are gone and `tsc --noEmit` passes clean.

---

### Item 7 — Update `docs/architecture.md`

Two categories of corrections:

**Payment provider (throughout):**
- Replace all Stripe references with Dodo Payments.
- Update §4 (money path) to name Dodo's checkout session API and webhook verification.
- Update env var names: `STRIPE_SECRET_KEY` → `DODO_API_KEY`, `STRIPE_WEBHOOK_SECRET` →
  `DODO_WEBHOOK_SECRET`, add `DODO_BID_PRODUCT_ID`.
- Update the webhook endpoint path: `/api/webhooks/stripe` → `/api/webhooks/dodo`.

**Observability drift corrections (§8):**
- PostHog: mark as **not yet installed** (currently described aspirationally; no npm
  package, no instrumentation code exists).
- Sentry: mark as **not yet installed** (same situation).

These corrections are made in a single commit on this branch after the implementation is
verified.

---

### Item 8 — Update privacy policy (DEFERRED — last step)

`src/app/(marketing)/privacy/page.tsx` currently names Stripe as the payment processor.
**This file is not touched until the migration is deployed and verified live in production.**
Only then does the page update to name Dodo Payments.

This is the last step. Do not do it before production verification.

---

## OUT OF SCOPE

- **Subscriptions.** Blowup V1 is one-time bids only. Dodo's subscription API is not used.
- **Dodo's embedded checkout / Dropin.** We use Dodo-hosted checkout (redirect flow) for
  simplicity and PCI scope avoidance — identical to the Stripe-hosted checkout approach.
- **Multi-currency.** V1 is USD-only. `billing_currency: 'USD'` is hardcoded.
- **Tax configuration.** Dodo handles tax at the product level; the `digital_products`
  tax category on the bid product is set in the dashboard, not in code.
- **Dodo's pay-as-you-go product API.** The "Blowup bid" product is created once in the
  Dodo dashboard (manual setup step). No product-management code is added.
- **Dodo's customer API.** Blowup is fully anonymous V1; no customer records are created
  or fetched.
- **Changing the bid amount validation range.** `CUSTOM_BID.MIN_CENTS` and
  `CUSTOM_BID.MAX_CENTS` are unchanged ($5–$10,000).
- **Replay of any existing Stripe webhooks.** Events already in `webhook_events` table
  with Stripe `evt_*` IDs remain as historical records. No backfill.
- **Changing the Phase 4.3 ClaimForm.** The form calls `POST /api/checkout` with
  `{ categorySlug, handle, amountCents?, name? }` and receives `{ sessionId, url }`.
  This contract is unchanged. The form's error handling already matches these 400/500
  semantics. No change to `ClaimForm.tsx`, `CheckoutStatusBanner.tsx`, or the route itself
  (other than the error-message regex).
- **Removing the `bids.stripeCheckoutSessionId` / `bids.stripePaymentIntentId` DB columns.**
  Renaming these columns is a schema migration risk with no functional benefit at this
  phase. They continue to store Dodo IDs under the existing column names. A future schema
  cleanup phase can rename them.

---

## SEQUENCE OF WORK

The following order eliminates broken-import windows (no step leaves the codebase in a
state where TypeScript sees missing imports):

1. **Install SDK** — `npm install dodopayments`
2. **Create `src/lib/dodo.ts`** — new file; nothing imports it yet
3. **Update `src/features/bidding/checkout.ts`** — swap Stripe session creation for Dodo;
   update import from `stripe.ts` to `dodo.ts`
4. **Update `src/app/api/checkout/route.ts`** — error-message regex only
5. **Create `src/app/api/webhooks/dodo/route.ts`** — new file with adapter
6. **Delete `src/app/api/webhooks/stripe/route.ts`** — old file gone
7. **Delete `src/lib/stripe.ts`** — old file gone; no imports remain
8. **`npm uninstall stripe`**
9. **`npx tsc --noEmit`** — must pass clean
10. **Update `docs/architecture.md`** (§4 + §8 corrections)
11. **Deploy and verify** — smoke test via real Dodo sandbox checkout
12. **Update privacy policy** — last step, after production verification

---

## DEFINITION OF DONE

### Pre-implementation (manual setup — owner action required)

- [ ] Dodo sandbox "Blowup bid" product created with `pay_what_you_want: true`,
      `price: 500` (USD), `tax_category: 'digital_products'`, name `"Blowup rank bid"`.
- [ ] Product's `product_id` (e.g. `pdt_xxxxxxx`) recorded in local `.env` as
      `DODO_BID_PRODUCT_ID=pdt_xxxxxxx`.
- [ ] `DODO_BID_PRODUCT_ID` added to Vercel env vars (same procedure as other secrets —
      Vercel dashboard or CLI, **not** `vercel env pull`).

### Code (verified by CI / local checks)

- [ ] `npx tsc --noEmit` exits 0 with no Stripe references in the type-checked surface.
- [ ] No file in `src/` imports from `stripe` or `src/lib/stripe`.
- [ ] `src/app/api/webhooks/stripe/route.ts` does not exist.
- [ ] `src/lib/stripe.ts` does not exist.
- [ ] `package.json` contains `dodopayments` and does not contain `stripe`.

### Money-path invariants (unchanged)

- [ ] Idempotency: two deliveries of the same `payment.succeeded` event (same
      `payment.payment_id`) produce exactly one settled bid row.
- [ ] Structural validation: a `payment.succeeded` event missing `categorySlug` or
      `handle` in metadata triggers the `refundUnattributable` path.
- [ ] Settlement is never triggered from the checkout route — only from a verified webhook.
- [ ] Postgres commits before Redis ZADD (ordering invariant §3).
- [ ] Advisory lock on `seasonId` serialises concurrent settlements within a season.

### End-to-end (sandbox smoke test — owner action required)

- [ ] Submit a real bid through the ClaimForm on the local or deployed app with Dodo
      sandbox credentials.
- [ ] Dodo-hosted checkout opens and a test payment completes.
- [ ] `payment.succeeded` webhook arrives at `/api/webhooks/dodo`, passes signature
      verification, and settles the bid (observe in Vercel function logs or local dev logs).
- [ ] The leaderboard row for the test handle appears on the board within 2 seconds.
- [ ] Submitting the same `payment_id` a second time (replay) produces `duplicate_event`
      outcome and no second bid row.
- [ ] `docs/architecture.md` Stripe references replaced; PostHog/Sentry marked
      not-yet-installed.

### Final step (post-production verification)

- [ ] `src/app/(marketing)/privacy/page.tsx` updated to name Dodo Payments instead of
      Stripe, with accurate description of what metadata Dodo receives.

---

## OPEN QUESTIONS / RISKS

| # | Risk | Mitigation |
|---|---|---|
| R1 | Dodo sandbox `payment_id` uniqueness guarantee | Treat it as unique per the SDK contract; idempotency index backstops any collision |
| R2 | `checkout_session_id` may be null on `Payment` if payment was not created via a checkout session | The adapter falls back to `payment.payment_id` for the `SessionLike.id` field; `settlement.ts` uses this as the checkout-session-id analog for the unique bids index |
| R3 | `pay_what_you_want` + `amount` on `ProductItemReq` — Dodo may ignore `amount` if the product has a fixed price | **Must be verified** in sandbox before implementation: submit a checkout with a non-floor amount and confirm `total_amount` in the settled webhook matches the submitted amount |
| R4 | `DODO_WEBHOOK_SECRET` format — the SDK passes this to `standardwebhooks`; the secret in the Dodo dashboard may need `whsec_` prefix stripping or base64 encoding | Check the Dodo dashboard's "signing secret" format against what `standardwebhooks` expects; the SDK's `unwrap()` handles this internally but the secret literal must match |
| R5 | Refund API shape — `getDodo().refunds.create({ payment_id })` is inferred from SDK types but not smoke-tested | Trigger a Q4 auto-refund scenario in sandbox (e.g., complete a checkout after rolling the season) to verify the refund path |

---

## FILES TOUCHED SUMMARY

| File | Action |
|---|---|
| `src/lib/stripe.ts` | **DELETE** |
| `src/lib/dodo.ts` | **CREATE** |
| `src/features/bidding/checkout.ts` | **MODIFY** — swap session creation logic |
| `src/app/api/checkout/route.ts` | **MODIFY** — error regex only |
| `src/app/api/webhooks/stripe/route.ts` | **DELETE** |
| `src/app/api/webhooks/dodo/route.ts` | **CREATE** |
| `src/app/(marketing)/privacy/page.tsx` | **MODIFY** — last step, post-verification |
| `docs/architecture.md` | **MODIFY** — §4 + §8 corrections |
| `package.json` / `package-lock.json` | **MODIFY** — swap npm packages |
| `docs/phase-5.0-dodo-migration-spec.md` | **CREATE** — this file |
