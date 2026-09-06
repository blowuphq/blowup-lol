import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Privacy Policy — Blowup',
  description:
    'How blowup.lol handles your data — verified against the actual codebase. No cookies, no analytics SDKs, session hashing with no raw IP storage.',
};

/** Section anchor IDs — co-located so the TOC and headings stay in sync. */
const SECTIONS = [
  { id: 'responsible', label: "Who's responsible" },
  { id: 'collect', label: 'What we collect' },
  { id: 'cookies', label: 'Cookies' },
  { id: 'why', label: 'Why we use it' },
  { id: 'public', label: 'Public listing data' },
  { id: 'sharing', label: 'Who we share with' },
  { id: 'retention', label: 'Data retention' },
  { id: 'rights', label: 'Your rights' },
  { id: 'children', label: "Children's privacy" },
  { id: 'changes', label: 'Changes' },
] as const;

const EFFECTIVE_DATE = 'August 31, 2026';

// ─── Sub-components ───────────────────────────────────────────────────────────

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

function PrivacyCallout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-4 rounded-r-lg border-l-2 border-hot bg-hot/8 px-4 py-3">
      <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-hot">
        Privacy-by-design detail
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
          href="mailto:privacy@blowup.lol"
          className="text-hot underline hover:text-hot/80"
        >
          privacy@blowup.lol
        </a>
      </p>
      <p className="mt-3 text-xs text-zinc-500">
        We will respond to valid requests within 30 days. Requests that require
        significant effort may take up to 90 days with notice.
      </p>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function PrivacyPage() {
  return (
    <div className="min-h-dvh bg-zinc-950 text-zinc-100">
      {/* header */}
      <header className="flex items-center justify-between border-b border-white/10 px-6 py-5 sm:px-10">
        <Link href="/" className="text-lg font-bold tracking-tight">
          BLOWUP<span className="text-hot">.</span>
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
            Privacy Policy
          </p>
          <h1 className="mt-2 font-serif text-[clamp(2rem,5vw,2.75rem)] font-normal leading-tight tracking-tight text-zinc-100">
            How Blowup handles your data
          </h1>
          <p className="mt-2 pb-8 text-sm text-zinc-500">
            Effective date: {EFFECTIVE_DATE} · blowup.lol
          </p>
          <SectionDivider />

          {/* ── 1. Who's responsible ───────────────────── */}
          <section className="mt-8 space-y-4" aria-labelledby="responsible">
            <SectionHeading id="responsible">
              1. Who&rsquo;s responsible
            </SectionHeading>
            <Prose>
              <p>
                Blowup (<em>blowup.lol</em>) is operated by an individual
                based in India — not a registered company or registered entity
                of any kind at this stage. &ldquo;We&rdquo;,
                &ldquo;us&rdquo;, and &ldquo;our&rdquo; throughout this policy
                refer to that individual operator.
              </p>
              <p>
                If you have any questions about this policy or about how your
                data is handled, you can reach us at the contact details in{' '}
                <a href="#rights">Section 8</a>.
              </p>
            </Prose>
          </section>

          <div className="mt-8">
            <SectionDivider />
          </div>

          {/* ── 2. What we collect ─────────────────────── */}
          <section className="mt-8 space-y-4" aria-labelledby="collect">
            <SectionHeading id="collect">2. What we collect</SectionHeading>
            <Prose>
              <p>
                Everything below reflects our actual architecture. We describe
                each piece of data, where it goes, and — crucially — what we
                deliberately choose <em>not</em> to store.
              </p>
            </Prose>

            <SubHeading>Click deduplication (session hashing)</SubHeading>
            <Prose>
              <p>
                When someone clicks through to a YouTube creator via Blowup,
                we count that click uniquely — one counted click per viewer
                per creator campaign, per day. To do this without identifying
                individuals, we compute a{' '}
                <strong>session hash</strong>: a one-way HMAC of your IP
                address, your browser&rsquo;s user-agent string, and a daily
                salt that rotates every 24 hours.
              </p>
            </Prose>

            <PrivacyCallout>
              We store only the resulting hash — a pseudonymous fingerprint —
              never the raw IP address itself. The daily salt means hashes
              computed yesterday cannot be linked to hashes computed today.
              Once the salt rotates, the original inputs are unrecoverable
              from what we stored.
            </PrivacyCallout>

            <Prose>
              <p>
                The session hash is stored in our database alongside the
                click record. It is used solely to prevent duplicate click
                counting; it is never used for advertising, cross-site
                tracking, or profiling.
              </p>
            </Prose>

            <SubHeading>Checkout and bid data</SubHeading>
            <Prose>
              <p>
                When you submit a bid through the claim form or the board, we
                collect and store:
              </p>
              <ul className="ml-4 list-disc space-y-1.5 text-zinc-300">
                <li>Your YouTube channel handle or channel URL</li>
                <li>
                  The category you are bidding in (Tech, Gaming, or Education)
                </li>
                <li>Your bid amount</li>
                <li>
                  YouTube channel metadata resolved via the YouTube Data API:
                  channel ID (<code className="font-mono text-xs text-zinc-400">UC&hellip;</code>),
                  display handle, channel name, avatar URL, and subscriber
                  count. This is fetched from YouTube&rsquo;s public API and
                  cached for 24 hours.
                </li>
                <li>
                  Internal identifiers linking your bid to the current
                  week&rsquo;s season and your campaign record
                </li>
                <li>
                  Payment confirmation identifiers provided by Dodo Payments after a
                  successful payment
                </li>
              </ul>
            </Prose>

            <SubHeading>Payment data</SubHeading>
            <Prose>
              <p>
                Payments are processed directly by <strong>Dodo Payments</strong>. We
                do not collect, see, or store your card number, bank details,
                or any raw payment credentials. Dodo Payments handles the checkout
                page, payment processing, and PCI compliance on our behalf.
              </p>
              <p>
                What we receive from Dodo Payments after a successful payment: a
                checkout session ID and a payment ID, used only for
                idempotency (ensuring the same payment cannot credit a bid
                twice) and for audit records. Dodo Payments separately collects the
                email address you provide at checkout — that email goes to
                Dodo Payments, not to us, and is subject to{' '}
                <a
                  href="https://dodopayments.com/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Dodo Payments&rsquo; own privacy policy
                </a>
                .
              </p>
            </Prose>

            <SubHeading>Analytics and error tracking</SubHeading>
            <Prose>
              <p>
                At the time of writing, Blowup does not use any third-party
                analytics service (no PostHog, no Google Analytics, no
                Plausible, or equivalent). We do not currently use a
                third-party error tracking service (no Sentry or equivalent).
                If this changes, this policy will be updated before any such
                service is deployed.
              </p>
              <p>
                Vercel, our hosting provider, may log standard request
                metadata (including IP addresses and user-agent strings) for
                operational purposes at the infrastructure level. This is
                governed by{' '}
                <a
                  href="https://vercel.com/legal/privacy-policy"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Vercel&rsquo;s privacy policy
                </a>
                .
              </p>
            </Prose>
          </section>

          <div className="mt-8">
            <SectionDivider />
          </div>

          {/* ── 3. Cookies ─────────────────────────────── */}
          <section className="mt-8 space-y-4" aria-labelledby="cookies">
            <SectionHeading id="cookies">3. Cookies</SectionHeading>
            <Prose>
              <p>
                Blowup does not set any first-party cookies. The site is
                fully anonymous — there is no login, no user account, and no
                session token stored in your browser.
              </p>
              <p>
                Dodo Payments sets cookies during the Dodo-hosted checkout flow
                (on Dodo&rsquo;s own domain, not on blowup.lol). These are
                Dodo&rsquo;s cookies, governed by Dodo&rsquo;s privacy
                policy. Once you return to blowup.lol after checkout, no
                payment provider cookies persist on our domain.
              </p>
              <p>
                Your browser may cache standard HTTP assets (fonts, page
                resources) per normal web behaviour, but this is not tracking.
              </p>
            </Prose>
          </section>

          <div className="mt-8">
            <SectionDivider />
          </div>

          {/* ── 4. Why we use it ───────────────────────── */}
          <section className="mt-8 space-y-4" aria-labelledby="why">
            <SectionHeading id="why">4. Why we use this data</SectionHeading>

            <TableWrap>
              <thead>
                <tr>
                  <Th>Data</Th>
                  <Th>Purpose</Th>
                  <Th>Legal basis (GDPR)</Th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <Td bold>Handle, channel metadata, bid amount, category</Td>
                  <Td>
                    Running the bid, computing your score and rank, displaying
                    your listing on the public leaderboard
                  </Td>
                  <Td>
                    Contract performance — you submit this data specifically
                    to participate
                  </Td>
                </tr>
                <tr>
                  <Td bold>Dodo payment identifiers</Td>
                  <Td>
                    Confirming payment, preventing duplicate credits,
                    maintaining financial audit records
                  </Td>
                  <Td>
                    Contract performance; legal obligation (financial
                    record-keeping)
                  </Td>
                </tr>
                <tr>
                  <Td bold>Session hash</Td>
                  <Td>
                    Counting unique clicks on creator listings fairly and
                    preventing click inflation
                  </Td>
                  <Td>
                    Legitimate interest — fair operation of the ranking
                    system, which all participants rely on
                  </Td>
                </tr>
                <tr>
                  <Td bold>YouTube channel metadata</Td>
                  <Td>
                    Verifying the channel exists, resolving the public handle
                    and avatar used on the leaderboard
                  </Td>
                  <Td>Contract performance</Td>
                </tr>
                <tr>
                  <Td bold>Referrer URL</Td>
                  <Td>
                    Understanding traffic origin (stored as a nullable field,
                    not required)
                  </Td>
                  <Td>
                    Legitimate interest — traffic source visibility for
                    the operator
                  </Td>
                </tr>
              </tbody>
            </TableWrap>
          </section>

          <div className="mt-8">
            <SectionDivider />
          </div>

          {/* ── 5. Public listing data ─────────────────── */}
          <section className="mt-8 space-y-4" aria-labelledby="public">
            <SectionHeading id="public">5. Public listing data</SectionHeading>
            <Prose>
              <p>
                Participation in Blowup is an act of public competition. By
                placing a bid, you agree that the following data about your
                listing will be displayed publicly on the leaderboard — to
                anyone who visits the site, without any login requirement:
              </p>
              <ul className="ml-4 list-disc space-y-1.5 text-zinc-300">
                <li>Your YouTube handle and channel name</li>
                <li>
                  Your avatar (as resolved from the YouTube Data API)
                </li>
                <li>Your current rank and score in the category</li>
                <li>
                  Your cumulative bid total for the current season (in
                  dollars)
                </li>
                <li>Your unique click count for the current season</li>
                <li>
                  Your rank history and season results, which are retained
                  permanently as part of the public leaderboard archive
                </li>
              </ul>
              <p>
                <strong>
                  If you do not want this information to be public, do not
                  place a bid.
                </strong>{' '}
                There is no private participation mode.
              </p>
            </Prose>
          </section>

          <div className="mt-8">
            <SectionDivider />
          </div>

          {/* ── 6. Who we share data with ──────────────── */}
          <section className="mt-8 space-y-4" aria-labelledby="sharing">
            <SectionHeading id="sharing">
              6. Who we share data with
            </SectionHeading>
            <Prose>
              <p>
                We use a small number of third-party services to operate
                Blowup. These are the only vendors who receive any of your data:
              </p>
            </Prose>

            <TableWrap>
              <thead>
                <tr>
                  <Th>Vendor</Th>
                  <Th>Role</Th>
                  <Th>Data they receive</Th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <Td bold>Dodo Payments</Td>
                  <Td>Payment processing</Td>
                  <Td>
                    All data you enter on the Dodo-hosted checkout page
                    (card details, email). We do not see this data; Dodo
                    processes it directly and returns payment confirmation to us.
                  </Td>
                </tr>
                <tr>
                  <Td bold>Neon</Td>
                  <Td>Postgres database hosting</Td>
                  <Td>
                    All structured data we store: creator records, bids,
                    campaigns, click hashes, season data. Neon hosts our
                    database; they do not access or use this data
                    independently of providing the database service.
                  </Td>
                </tr>
                <tr>
                  <Td bold>Upstash</Td>
                  <Td>Redis (leaderboard cache &amp; rate limiting)</Td>
                  <Td>
                    Leaderboard scores, season pointers, click deduplication
                    keys (session hash + campaign ID), rate-limit buckets,
                    visitor counters. These are operational projections of
                    the main database, not personal data in isolation.
                    Upstash does not access or use this data independently.
                  </Td>
                </tr>
                <tr>
                  <Td bold>Vercel</Td>
                  <Td>Application hosting &amp; CDN</Td>
                  <Td>
                    All HTTP requests to blowup.lol pass through
                    Vercel&rsquo;s infrastructure. Vercel logs standard
                    request data (IP address, headers, timestamps) at the
                    infrastructure level per their own data processing terms.
                  </Td>
                </tr>
                <tr>
                  <Td bold>Google (YouTube Data API)</Td>
                  <Td>Creator metadata resolution</Td>
                  <Td>
                    When you submit a channel handle, we query
                    YouTube&rsquo;s public Data API with that handle to
                    resolve channel metadata. The handle is sent to
                    Google&rsquo;s API. This is public YouTube data; we do
                    not send any personal information beyond the handle you
                    provided.
                  </Td>
                </tr>
                <tr>
                  <Td bold>Inngest</Td>
                  <Td>Background job scheduling</Td>
                  <Td>
                    Inngest orchestrates our background jobs (weekly season
                    rollover, leaderboard reconciliation, creator enrichment).
                    These jobs read and write our own database; Inngest
                    receives job event payloads containing internal
                    identifiers (season IDs, creator IDs) but not personal data.
                  </Td>
                </tr>
              </tbody>
            </TableWrap>

            <Prose>
              <p>
                We do not sell your data. We do not share your data with
                advertisers, data brokers, or any party not listed above.
              </p>
            </Prose>
          </section>

          <div className="mt-8">
            <SectionDivider />
          </div>

          {/* ── 7. Retention ───────────────────────────── */}
          <section className="mt-8 space-y-4" aria-labelledby="retention">
            <SectionHeading id="retention">7. Data retention</SectionHeading>

            <TableWrap>
              <thead>
                <tr>
                  <Th>Data type</Th>
                  <Th>Retention</Th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <Td bold>Creator profiles</Td>
                  <Td>
                    Retained indefinitely — they form the public leaderboard
                    archive. YouTube metadata is refreshed from the YouTube
                    API periodically; the stored record may lag the live
                    channel by up to 24 hours.
                  </Td>
                </tr>
                <tr>
                  <Td bold>Season results and bid history</Td>
                  <Td>
                    Retained permanently. Season results are the historical
                    record of competition outcomes and are immutable by design.
                  </Td>
                </tr>
                <tr>
                  <Td bold>Bid records (incl. Dodo session/payment IDs)</Td>
                  <Td>
                    Retained indefinitely for financial audit purposes.
                  </Td>
                </tr>
                <tr>
                  <Td bold>Click records</Td>
                  <Td>
                    Stored in the database. The click deduplication key in
                    Redis (session hash + campaign ID) expires automatically
                    after 24 hours. The underlying click row in Postgres is
                    retained.
                  </Td>
                </tr>
                <tr>
                  <Td bold>Leaderboard Redis cache</Td>
                  <Td>
                    Active leaderboard keys expire 35 days after the season
                    ends. This is a cache — the source of truth is Postgres
                    and is unaffected by cache expiry.
                  </Td>
                </tr>
                <tr>
                  <Td bold>Dodo-side payment data</Td>
                  <Td>
                    Governed by Dodo&rsquo;s data retention policy, not
                    ours.
                  </Td>
                </tr>
              </tbody>
            </TableWrap>

            <Prose>
              <p>
                If you want us to delete data associated with your YouTube
                handle, see <a href="#rights">Section 8</a>. Note that
                publicly visible season results may be retained even after
                deletion of other records, as they constitute a historical
                record of the competition.
              </p>
            </Prose>
          </section>

          <div className="mt-8">
            <SectionDivider />
          </div>

          {/* ── 8. Rights ──────────────────────────────── */}
          <section className="mt-8 space-y-4" aria-labelledby="rights">
            <SectionHeading id="rights">8. Your rights</SectionHeading>
            <Prose>
              <p>
                If you are located in the European Economic Area, the United
                Kingdom, or another jurisdiction with data protection rights,
                you have the following rights regarding your personal data:
              </p>
              <ul className="ml-4 list-disc space-y-2 text-zinc-300">
                <li>
                  <strong>Access</strong> — you can ask us what data we hold
                  about your YouTube handle.
                </li>
                <li>
                  <strong>Rectification</strong> — you can ask us to correct
                  inaccurate information.
                </li>
                <li>
                  <strong>Erasure</strong> — you can ask us to delete your
                  data, subject to our legal obligations (we may need to
                  retain financial records).
                </li>
                <li>
                  <strong>Restriction</strong> — you can ask us to restrict
                  processing of your data while a dispute is resolved.
                </li>
                <li>
                  <strong>Portability</strong> — you can ask us to provide
                  your data in a structured, machine-readable format.
                </li>
                <li>
                  <strong>Objection</strong> — you can object to processing
                  based on legitimate interest. In practice this effectively
                  means requesting removal from the service.
                </li>
                <li>
                  <strong>Withdraw consent</strong> — where processing relies
                  on consent, you can withdraw it. Note that most of our
                  processing is based on contract or legitimate interest, not
                  consent.
                </li>
              </ul>
              <p>
                Because there is no account or login, we identify data
                associated with you by your YouTube channel handle or channel
                ID. Please include these in any request so we can locate your
                records accurately.
              </p>
            </Prose>

            <Prose>
              <p>To exercise any of these rights, contact us:</p>
            </Prose>

            <ContactBlock />

            <Prose>
              <p className="mt-4">
                You also have the right to lodge a complaint with your local
                data protection authority if you believe we have not handled
                your data in accordance with applicable law.
              </p>
            </Prose>
          </section>

          <div className="mt-8">
            <SectionDivider />
          </div>

          {/* ── 9. Children ────────────────────────────── */}
          <section className="mt-8 space-y-4" aria-labelledby="children">
            <SectionHeading id="children">
              9. Children&rsquo;s privacy
            </SectionHeading>
            <Prose>
              <p>
                Blowup is intended for adults and for YouTube creators who are
                at least 18 years old. We do not knowingly collect personal
                information from anyone under 18. If you believe a person
                under 18 has submitted data through Blowup, please contact us
                at{' '}
                <a href="mailto:privacy@blowup.lol">privacy@blowup.lol</a>{' '}
                and we will delete those records.
              </p>
            </Prose>
          </section>

          <div className="mt-8">
            <SectionDivider />
          </div>

          {/* ── 10. Changes ────────────────────────────── */}
          <section className="mt-8 space-y-4" aria-labelledby="changes">
            <SectionHeading id="changes">
              10. Changes to this policy
            </SectionHeading>
            <Prose>
              <p>
                We will update this policy if our data practices change —
                particularly before introducing any new analytics or error
                tracking service, or any new vendor. The effective date at
                the top of this page will reflect the date of the most
                recent update.
              </p>
              <p>
                For material changes that affect data already collected, we
                will make a reasonable effort to notify affected users where
                we have a means to do so (for example, via an announcement
                at the top of the site).
              </p>
            </Prose>
          </section>

        </main>
      </div>

      {/* footer */}
      <footer className="border-t border-white/10 py-8 text-center text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-600">
        blowup.lol · Privacy Policy · Effective {EFFECTIVE_DATE}
      </footer>
    </div>
  );
}
