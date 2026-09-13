import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Refund Policy — Blowup',
  description:
    'Blowup refund policy: bids are generally non-refundable once settled, except for specific auto-refund conditions defined in the codebase (season rolled over, no active season, amount out-of-bounds, unattributable payments).',
};

const SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'non-refundable', label: 'Generally non-refundable' },
  { id: 'auto-refund', label: 'Auto-refund conditions (Q4)' },
  { id: 'season-rolled', label: 'Season rolled over' },
  { id: 'no-active-season', label: 'No active season' },
  { id: 'amount-bounds', label: 'Amount out of bounds' },
  { id: 'unattributable', label: 'Unattributable payments' },
  { id: 'process', label: 'Refund process' },
  { id: 'contact', label: 'Contact' },
] as const;

const EFFECTIVE_DATE = 'September 6, 2026';

function SectionDivider() {
  return <hr className="border-t border-white/10" />;
}

function SectionHeading({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}) {
  return (
    <h2
      id={id}
      className="scroll-mt-10 font-serif text-xl font-normal leading-snug tracking-tight text-zinc-100"
    >
      {children}
    </h2>
  );
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mt-6 text-sm font-semibold uppercase tracking-widest text-zinc-400">
      {children}
    </h3>
  );
}

function Prose({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-3 space-y-3 text-sm leading-relaxed text-zinc-300 [&_a]:text-hot [&_a]:underline [&_a:hover]:text-hot/80 [&_strong]:font-semibold [&_strong]:text-zinc-100 [&_em]:italic">
      {children}
    </div>
  );
}

function Callout({ children, type = 'info' }: { children: React.ReactNode; type?: 'info' | 'warning' | 'success' }) {
  const colors = {
    info: 'border-hot bg-hot/8',
    warning: 'border-amber-500 bg-amber-500/10',
    success: 'border-emerald-500 bg-emerald-500/10',
  };
  const labels = {
    info: 'Policy detail',
    warning: 'Important',
    success: 'Auto-refund triggered',
  };
  return (
    <div className={`mt-4 rounded-r-lg border-l-2 ${colors[type]} px-4 py-3`}>
      <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-hot">
        {labels[type]}
      </p>
      <p className="text-sm leading-relaxed text-zinc-300">{children}</p>
    </div>
  );
}

function TableWrap({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-4 overflow-x-auto rounded-xl border border-white/10">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="border-b border-white/10 bg-white/[0.04] px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500 whitespace-nowrap">
      {children}
    </th>
  );
}

function Td({
  children,
  bold,
}: {
  children: React.ReactNode;
  bold?: boolean;
}) {
  return (
    <td
      className={`border-b border-white/8 px-4 py-3 align-top text-sm leading-relaxed text-zinc-300 last:border-b-0 ${
        bold ? 'whitespace-nowrap font-medium text-zinc-100' : ''
      }`}
    >
      {children}
    </td>
  );
}

function ContactBlock() {
  return (
    <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] px-5 py-4 text-sm text-zinc-300">
      <p className="font-semibold text-zinc-100">Blowup</p>
      <p>Individual operator, India</p>
      <p className="mt-1">
        Email:{' '}
        <a
          href="mailto:varshith@blowup.lol"
          className="text-hot underline hover:text-hot/80"
        >
          varshith@blowup.lol
        </a>
      </p>
      <p className="mt-3 text-xs text-zinc-500">
        We will respond to valid requests within 30 days. Requests that require
        significant effort may take up to 90 days with notice.
      </p>
    </div>
  );
}

export default function RefundPolicyPage() {
  return (
    <div className="min-h-dvh bg-zinc-950 text-zinc-100">
      {/* header */}
      <header className="flex items-center justify-between border-b border-white/10 px-6 py-5 sm:px-10">
        <Link href="/" className="inline-flex h-6 items-center gap-1 text-lg font-bold tracking-tight">
          <Image
            src="/favicon-512x512-transparent.png"
            alt=""
            width={32}
            height={32}
            className="-mr-1 h-6 w-6 object-contain"
            aria-hidden
          />
          <span className="inline-flex h-6 items-center leading-none">
            BLOWUP<span className="relative top-px ml-0.5 inline-block text-hot">.</span>
          </span>
        </Link>
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
          Legal
        </span>
      </header>

      {/* two-column layout on wide screens */}
      <div className="mx-auto grid max-w-5xl grid-cols-1 gap-0 px-5 sm:px-8 lg:grid-cols-[220px_1fr] lg:gap-x-16">

        {/* ── TOC sidebar ─────────────────────────────── */}
        <nav
          aria-label="On this page"
          className="hidden py-10 lg:block"
        >
          <div className="sticky top-10">
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-600">
              On this page
            </p>
            <ol className="space-y-0.5">
              {SECTIONS.map((s, i) => (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    className="flex items-start gap-2 rounded px-2 py-1.5 text-[13px] leading-tight text-zinc-500 transition-colors hover:bg-white/[0.04] hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-hot"
                  >
                    <span className="mt-px font-mono text-[10px] text-zinc-600">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    {s.label}
                  </a>
                </li>
              ))}
            </ol>
          </div>
        </nav>

        {/* ── Main document ────────────────────────────── */}
        <main className="py-10 pb-24">
          {/* title block */}
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-hot">
            Refund Policy
          </p>
          <h1 className="mt-2 font-serif text-[clamp(2rem,5vw,2.75rem)] font-normal leading-tight tracking-tight text-zinc-100">
            When bids are (and aren&rsquo;t) refunded
          </h1>
          <p className="mt-2 pb-8 text-sm text-zinc-500">
            Effective date: {EFFECTIVE_DATE} · blowup.lol
          </p>
          <SectionDivider />

          {/* ── 1. Overview ─────────────────────────────── */}
          <section className="mt-8 space-y-4" aria-labelledby="overview">
            <SectionHeading id="overview">
              1. Overview
            </SectionHeading>
            <Prose>
              <p>
                This policy explains exactly when payments for bids on
                <em>blowup.lol</em> are refunded. The rules are implemented
                directly in the settlement code (see <code
                className="font-mono text-xs text-zinc-400">src/features/bidding/settlement.ts</code>
                and architecture decision <strong>Q4</strong> in <code
                className="font-mono text-xs text-zinc-400">docs/architecture.md</code>).
                This is not a generic template — it reflects what the code
                actually does.
              </p>
              <Callout type="warning">
                <strong>Default position: bids are non-refundable once settled.</strong>
                If your payment succeeds and the bid is recorded against an
                active season, you will not receive a refund — regardless of
                rank outcome, click count, or whether you &ldquo;changed your
                mind.&rdquo;
              </Callout>
            </Prose>
          </section>

          <div className="mt-8">
            <SectionDivider />
          </div>

          {/* ── 2. Generally non-refundable ─────────────── */}
          <section className="mt-8 space-y-4" aria-labelledby="non-refundable">
            <SectionHeading id="non-refundable">
              2. Generally non-refundable
            </SectionHeading>
            <Prose>
              <p>
                Once a payment is verified by Dodo Payments and the bid is
                settled against an <strong>active season</strong> (the season
                that was current when the checkout session was created), the bid
                is final. The following are <strong>not</strong> grounds for a
                refund:
              </p>
              <ul className="ml-4 list-disc space-y-1.5 text-zinc-300">
                <li>Your rank dropped because another creator bid more.</li>
                <li>You received fewer clicks than expected.</li>
                <li>You did not gain subscribers or traffic.</li>
                <li>You bid on the wrong category by mistake.</li>
                <li>You no longer wish to participate.</li>
                <li>The season ended and a new one began (normal rollover).</li>
              </ul>
              <p>
                Settled bids remain on the leaderboard for the duration of the
                season and are part of the permanent season archive afterward.
              </p>
            </Prose>
          </section>

          <div className="mt-8">
            <SectionDivider />
          </div>

          {/* ── 3. Auto-refund conditions (Q4) ──────────── */}
          <section className="mt-8 space-y-4" aria-labelledby="auto-refund">
            <SectionHeading id="auto-refund">
              3. Auto-refund conditions (architecture Q4)
            </SectionHeading>
            <Prose>
              <p>
                There are <strong>exactly four conditions</strong> under which
                the settlement code <strong>automatically initiates a full
                refund</strong> via the Dodo Payments API. These are hardcoded
                in <code className="font-mono text-xs text-zinc-400">settlement.ts</code>
                and are not discretionary:
              </p>

              <TableWrap>
                <thead>
                  <tr>
                    <Th>Code reason</Th>
                    <Th>Trigger</Th>
                    <Th>Source</Th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <Td bold><code className="font-mono text-xs text-zinc-400">season_rolled_over</code></Td>
                    <Td>The season targeted at checkout is no longer active when the webhook arrives (a new season has started).</Td>
                    <Td><code className="font-mono text-xs text-zinc-400">settlement.ts:250</code></Td>
                  </tr>
                  <tr>
                    <Td bold><code className="font-mono text-xs text-zinc-400">no_active_season</code></Td>
                    <Td>No active season exists for the category at webhook time (e.g., category disabled, gap between seasons).</Td>
                    <Td><code className="font-mono text-xs text-zinc-400">settlement.ts:244</code></Td>
                  </tr>
                  <tr>
                    <Td bold><code className="font-mono text-xs text-zinc-400">amount_out_of_bounds</code></Td>
                    <Td>The paid amount is outside the allowed range ($5–$10,000).</Td>
                    <Td><code className="font-mono text-xs text-zinc-400">settlement.ts:215</code></Td>
                  </tr>
                  <tr>
                    <Td bold><code className="font-mono text-xs text-zinc-400">missing_metadata_or_fields</code></Td>
                    <Td>Required metadata (categorySlug, handle, seasonId) or payment fields (payment_id, checkout_session_id, total_amount) are missing from the webhook payload.</Td>
                    <Td><code className="font-mono text-xs text-zinc-400">settlement.ts:218-224</code></Td>
                  </tr>
                </tbody>
              </TableWrap>

              <Callout>
                These four conditions are <strong>exhaustive</strong>. No other
                auto-refund paths exist in the code. If your payment does not
                match one of these, it will not be auto-refunded.
              </Callout>
            </Prose>
          </section>

          <div className="mt-8">
            <SectionDivider />
          </div>

          {/* ── 4. Season rolled over ────────────────────── */}
          <section className="mt-8 space-y-4" aria-labelledby="season-rolled">
            <SectionHeading id="season-rolled">
              4. Season rolled over (<code className="font-mono text-xs text-zinc-400">season_rolled_over</code>)
            </SectionHeading>
            <Prose>
              <p>
                Seasons roll over every <strong>Monday at 00:05 UTC</strong> via
                an Inngest cron job. When you start checkout, the
                <code className="font-mono text-xs text-zinc-400">seasonId</code>
                of the currently active season is embedded in the Dodo checkout
                session metadata.
              </p>
              <p>
                If the webhook arrives <strong>after</strong> that season has
                ended (i.e., a new season is now active for that category), the
                code detects the mismatch:
              </p>
              <pre className="font-mono text-xs bg-white/[0.04] rounded p-3 text-zinc-300 overflow-x-auto">
{`// settlement.ts lines 247-252
if (active.seasonId !== intendedSeasonId) {
  throw new Q4Refund('season_rolled_over');
}`}
              </pre>
              <p>
                The payment is fully refunded. The bidder&rsquo;s money is
                never applied to a week they didn&rsquo;t intend to bid for.
              </p>
              <Callout type="success">
                This protects bidders from checkout-to-webhook latency crossing
                a season boundary. The refund is automatic — no action needed
                by the bidder.
              </Callout>
            </Prose>
          </section>

          <div className="mt-8">
            <SectionDivider />
          </div>

          {/* ── 5. No active season ──────────────────────── */}
          <section className="mt-8 space-y-4" aria-labelledby="no-active-season">
            <SectionHeading id="no-active-season">
              5. No active season (<code className="font-mono text-xs text-zinc-400">no_active_season</code>)
            </SectionHeading>
            <Prose>
              <p>
                If a category has no active season at the moment the webhook is
                processed (for example, the category was disabled, or there is a
                gap between the end of one season and the start of the next),
                the settlement code cannot attribute the bid to any season.
              </p>
              <pre className="font-mono text-xs bg-white/[0.04] rounded p-3 text-zinc-300 overflow-x-auto">
{`// settlement.ts lines 243-246
const [active] = await tx.select({...}).from(seasons)
  .innerJoin(categories, ...)
  .where(and(eq(categories.slug, slug), eq(seasons.status, 'active')));

if (!active) {
  throw new Q4Refund('no_active_season');
}`}
              </pre>
              <p>
                The payment is fully refunded. This ensures money is never held
                in limbo without a valid season to credit it to.
              </p>
            </Prose>
          </section>

          <div className="mt-8">
            <SectionDivider />
          </div>

          {/* ── 6. Amount out of bounds ──────────────────── */}
          <section className="mt-8 space-y-4" aria-labelledby="amount-bounds">
            <SectionHeading id="amount-bounds">
              6. Amount out of bounds (<code className="font-mono text-xs text-zinc-400">amount_out_of_bounds</code>)
            </SectionHeading>
            <Prose>
              <p>
                The allowed bid range is <strong>$5 minimum</strong> to
                <strong>$10,000 maximum</strong> per bid, enforced by
                <code className="font-mono text-xs text-zinc-400">assertBidAmount</code>
                in <code className="font-mono text-xs text-zinc-400">src/features/bidding/pipeline.ts</code>:
              </p>
              <pre className="font-mono text-xs bg-white/[0.04] rounded p-3 text-zinc-300 overflow-x-auto">
{`// pipeline.ts lines 58-65
export function assertBidAmount(amountCents: number): void {
  if (!Number.isInteger(amountCents)) throw new Error('amountCents must be an integer');
  if (amountCents < CUSTOM_BID.MIN_CENTS || amountCents > CUSTOM_BID.MAX_CENTS) {
    throw new Error(
      'bid must be between 500 and 1_000_000 cents ($5–$10,000)',
    );
  }
}`}
              </pre>
              <p>
                <code className="font-mono text-xs text-zinc-400">CUSTOM_BID.MIN_CENTS = 500</code>
                ($5) and <code className="font-mono text-xs text-zinc-400">CUSTOM_BID.MAX_CENTS = 1_000_000</code>
                ($10,000) are defined in <code
                className="font-mono text-xs text-zinc-400">src/config/site.ts</code>.
              </p>
              <p>
                If a webhook arrives with a <code
                className="font-mono text-xs text-zinc-400">total_amount</code>
                outside this range, the settlement code treats it as
                structurally invalid and auto-refunds:
              </p>
              <pre className="font-mono text-xs bg-white/[0.04] rounded p-3 text-zinc-300 overflow-x-auto">
{`// settlement.ts lines 211-216
if (!structurallyInvalid) {
  try {
    assertBidAmount(amountCents as number);
  } catch {
    return refundUnattributable(paymentId, refunds, paymentId, 'amount_out_of_bounds');
  }
}`}
              </pre>
              <Callout type="warning">
                The checkout session creation also validates the amount
                <strong>before</strong> redirecting to Dodo, so this condition
                should only occur if someone manually crafts a webhook payload
                or if Dodo&rsquo;s amount differs from what was requested
                (which should not happen with the current integration).
              </Callout>
            </Prose>
          </section>

          <div className="mt-8">
            <SectionDivider />
          </div>

          {/* ── 7. Unattributable payments ───────────────── */}
          <section className="mt-8 space-y-4" aria-labelledby="unattributable">
            <SectionHeading id="unattributable">
              7. Unattributable payments (<code className="font-mono text-xs text-zinc-400">missing_metadata_or_fields</code>)
            </SectionHeading>
            <Prose>
              <p>
                The settlement code requires the following fields to be present
                in the verified webhook payload to attribute a payment to a bid:
              </p>
              <ul className="ml-4 list-disc space-y-1.5 text-zinc-300">
                <li><code className="font-mono text-xs text-zinc-400">payment_id</code> (Dodo&rsquo;s payment ID — the idempotency key)</li>
                <li><code className="font-mono text-xs text-zinc-400">checkout_session_id</code></li>
                <li><code className="font-mono text-xs text-zinc-400">total_amount</code> (numeric)</li>
                <li><code className="font-mono text-xs text-zinc-400">metadata.categorySlug</code></li>
                <li><code className="font-mono text-xs text-zinc-400">metadata.handle</code></li>
                <li><code className="font-mono text-xs text-zinc-400">metadata.seasonId</code></li>
              </ul>
              <p>
                If any of these are missing or malformed, the payment is
                considered <strong>unattributable</strong> — we cannot
                determine which campaign, season, or creator it belongs to.
                Rather than silently keeping the money, the code auto-refunds:
              </p>
              <pre className="font-mono text-xs bg-white/[0.04] rounded p-3 text-zinc-300 overflow-x-auto">
{`// settlement.ts lines 204-225
const structurallyInvalid =
  !paymentId ||
  !checkoutSessionId ||
  typeof amountCents !== 'number' ||
  !slug ||
  !handle ||
  !intendedSeasonId;

if (structurallyInvalid) {
  return refundUnattributable(
    paymentId,
    refunds,
    paymentId,
    'missing_metadata_or_fields',
  );
}`}
              </pre>
              <p>
                If <code className="font-mono text-xs text-zinc-400">payment_id</code>
                is also missing, the event is logged and dropped without a
                refund (there is no payment ID to refund).
              </p>
            </Prose>
          </section>

          <div className="mt-8">
            <SectionDivider />
          </div>

          {/* ── 8. Refund process ────────────────────────── */}
          <section className="mt-8 space-y-4" aria-labelledby="process">
            <SectionHeading id="process">
              8. Refund process
            </SectionHeading>
            <Prose>
              <p>
                When an auto-refund condition is met:
              </p>
              <ol className="ml-4 list-decimal space-y-2 text-zinc-300">
                <li>
                  The settlement code calls <code
                  className="font-mono text-xs text-zinc-400">refundOrTolerate</code>
                  which invokes Dodo Payments&rsquo; refunds API:
                  <code className="font-mono text-xs text-zinc-400">{"refunds.create({ payment_id })"}</code>.
                </li>
                <li>
                  The refund is <strong>idempotent</strong>: if the webhook is
                  redelivered (Dodo&rsquo;s at-least-once delivery) and the
                  refund was already issued, the code tolerates the
                  <code className="font-mono text-xs text-zinc-400">charge_already_refunded</code>
                  error and does not throw.
                </li>
                <li>
                  The webhook event is marked <code
                  className="font-mono text-xs text-zinc-400">processed_at</code>
                  in the <code className="font-mono text-xs text-zinc-400">webhook_events</code>
                  table so it is never retried.
                </li>
                <li>
                  The settlement outcome is recorded as
                  <code className="font-mono text-xs text-zinc-400">{"{ kind: 'refunded', reason: '...' }"}</code>.
                </li>
              </ol>
              <p>
                Refund timing is determined by Dodo Payments and the card
                network — typically 5–10 business days to appear on the
                original payment method. Blowup does not control this timeline.
              </p>
              <Callout type="info">
                The <code className="font-mono text-xs text-zinc-400">refundUnattributable</code>
                function logs every auto-refund with its reason to the server
                console for audit purposes. No bid row is created for refunded
                payments.
              </Callout>
            </Prose>
          </section>

          <div className="mt-8">
            <SectionDivider />
          </div>

          {/* ── 9. Contact ───────────────────────────────── */}
          <section className="mt-8 space-y-4" aria-labelledby="contact">
            <SectionHeading id="contact">
              9. Contact
            </SectionHeading>
            <Prose>
              <p>
                Questions about a specific refund, or if you believe a refund
                was missed:
              </p>
            </Prose>

            <ContactBlock />

            <Prose>
              <p className="mt-4">
                <strong>Legal review disclaimer:</strong> This Refund Policy
                page was written to accurately reflect the actual auto-refund
                logic in the codebase as of the effective date above. It is
                <strong>not a substitute for professional legal review</strong>
                before handling significant real revenue. The operator
                acknowledges this and plans to engage qualified counsel before
                any production scale-up.
              </p>
            </Prose>
          </section>

        </main>
      </div>

      {/* footer */}
      <footer className="border-t border-white/10 py-8 text-center text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-600">
        blowup.lol · <a href="/privacy" className="underline hover:text-zinc-400">Privacy Policy</a> · <a href="/terms" className="underline hover:text-zinc-400">Terms of Service</a> · <a href="/refund-policy" className="underline hover:text-zinc-400">Refund Policy</a> · Effective {EFFECTIVE_DATE}
      </footer>
    </div>
  );
}