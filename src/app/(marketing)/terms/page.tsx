import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Terms of Service — Blowup',
  description:
    'Terms governing use of blowup.lol — pay-to-rank leaderboard marketplace for YouTube creators. Covers eligibility, bidding mechanics, deterministic ranking, liability, governing law (India), and contact.',
};

const SECTIONS = [
  { id: 'service', label: 'What Blowup is' },
  { id: 'eligibility', label: 'User eligibility' },
  { id: 'bidding', label: 'How bidding works' },
  { id: 'ranking', label: 'Deterministic ranking' },
  { id: 'usage', label: 'Account & usage rules' },
  { id: 'liability', label: 'Limitation of liability' },
  { id: 'governing', label: 'Governing law' },
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

function Callout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-4 rounded-r-lg border-l-2 border-hot bg-hot/8 px-4 py-3">
      <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-hot">
        Important
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

export default function TermsPage() {
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
            Terms of Service
          </p>
          <h1 className="mt-2 font-serif text-[clamp(2rem,5vw,2.75rem)] font-normal leading-tight tracking-tight text-zinc-100">
            Terms governing use of blowup.lol
          </h1>
          <p className="mt-2 pb-8 text-sm text-zinc-500">
            Effective date: {EFFECTIVE_DATE} · blowup.lol
          </p>
          <SectionDivider />

          {/* ── 1. What Blowup is ────────────────────────── */}
          <section className="mt-8 space-y-4" aria-labelledby="service">
            <SectionHeading id="service">
              1. What Blowup is
            </SectionHeading>
            <Prose>
              <p>
                Blowup (<em>blowup.lol</em>) is a <strong>pay-to-rank leaderboard
                marketplace for YouTube creators</strong>. Creators (or their
                representatives) bid for placement on weekly leaderboards in
                specific categories — currently Tech, Gaming, and Education.
                Higher bids yield higher scores, which determine rank. Ranks
                are public and visible to anyone visiting the site.
              </p>
              <p>
                The service is operated by an individual based in India — not a
                registered company or registered entity of any kind at this
                stage. &ldquo;We&rdquo;, &ldquo;us&rdquo;, and &ldquo;our&rdquo;
                throughout these terms refer to that individual operator.
              </p>
              <Callout>
                Blowup is <strong>not</strong> an investment platform, a
                fundraising tool, a revenue-share program, or a partnership
                marketplace. You are paying for <em>rank placement on a public
                leaderboard</em> for the duration of a weekly season — nothing
                more, nothing less.
              </Callout>
            </Prose>
          </section>

          <div className="mt-8">
            <SectionDivider />
          </div>

          {/* ── 2. User eligibility ──────────────────────── */}
          <section className="mt-8 space-y-4" aria-labelledby="eligibility">
            <SectionHeading id="eligibility">
              2. User eligibility
            </SectionHeading>
            <Prose>
              <p>
                You may place a bid only if:
              </p>
              <ul className="ml-4 list-disc space-y-1.5 text-zinc-300">
                <li>You are at least 18 years old.</li>
                <li>You have the legal authority to represent the YouTube
                    channel you are bidding for (you own the channel, manage it,
                    or have explicit permission from the owner).</li>
                <li>You are not located in a jurisdiction where participating in
                    pay-to-rank leaderboards is prohibited by law.</li>
                <li>You are not on any applicable sanctions list or otherwise
                    restricted from transacting with Dodo Payments (our payment
                    processor).</li>
              </ul>
              <p>
                By placing a bid, you represent and warrant that you meet all
                of the above. We reserve the right to reject or refund any bid
                if we determine eligibility requirements are not met.
              </p>
            </Prose>
          </section>

          <div className="mt-8">
            <SectionDivider />
          </div>

          {/* ── 3. How bidding works ─────────────────────── */}
          <section className="mt-8 space-y-4" aria-labelledby="bidding">
            <SectionHeading id="bidding">
              3. How bidding works
            </SectionHeading>
            <Prose>
              <p>
                Bidding is the only way to appear on a leaderboard. The flow is
                as follows:
              </p>
              <ol className="ml-4 list-decimal space-y-2 text-zinc-300">
                <li>
                  <strong>Pick a category.</strong> Each category (Tech, Gaming,
                  Education) runs its own independent weekly leaderboard.
                </li>
                <li>
                  <strong>Enter your YouTube handle or channel URL.</strong> We
                  resolve the channel via the YouTube Data API to verify it
                  exists and fetch public metadata (channel ID, name, avatar,
                  subscriber count).
                </li>
                <li>
                  <strong>Choose a bid amount.</strong> Preset tiers: <strong>$5
                  / $25 / $100 / $500</strong>. You may also enter a custom
                  amount between <strong>$5 minimum</strong> and
                  <strong>$10,000 maximum</strong> per bid.
                </li>
                <li>
                  <strong>Checkout via Dodo Payments.</strong> You are
                  redirected to a Dodo-hosted checkout page. Dodo Payments
                  collects your payment details and email address — we never
                  see or store your card number or raw payment credentials.
                </li>
                <li>
                  <strong>Settlement.</strong> Only after Dodo Payments confirms
                  the payment (via a cryptographically verified webhook) is the
                  bid recorded and your score updated. Pending or failed
                  payments never affect rank.
                </li>
              </ol>

              <SubHeading>Seasons</SubHeading>
              <Prose>
                <p>
                  Each category runs on a <strong>weekly season</strong>.
                  Seasons roll over every <strong>Monday at 00:05 UTC</strong>.
                  When a season ends, the leaderboard freezes as the final
                  result for that week, and a new empty season begins. Your bid
                  counts only toward the season that was active when the
                  checkout session was created.
                </p>
                <Callout>
                  If a season rolls over between when you start checkout and
                  when the webhook arrives (i.e., the season you targeted is no
                  longer active), the payment is <strong>automatically
                  refunded</strong> — your money is never applied to a week you
                  didn&rsquo;t intend to bid for. See the <a
                  href="/refund-policy">Refund Policy</a> for details.
                </Callout>
              </Prose>

              <SubHeading>Multiple bids</SubHeading>
              <Prose>
                <p>
                  You may bid multiple times in the same season. Each bid adds
                  to your <strong>cumulative bid total</strong> for that season,
                  which feeds directly into the scoring formula. There is no
                  limit on the number of bids per season, subject to the
                  $10,000 per-bid ceiling.
                </p>
              </Prose>
            </Prose>
          </section>

          <div className="mt-8">
            <SectionDivider />
          </div>

          {/* ── 4. Deterministic ranking (not gambling) ──── */}
          <section className="mt-8 space-y-4" aria-labelledby="ranking">
            <SectionHeading id="ranking">
              4. Deterministic ranking — not a game of chance
            </SectionHeading>
            <Prose>
              <p>
                <strong>Rank placement is entirely deterministic.</strong> There
                is no randomness, no lottery, no spin-the-wheel, and no element
                of chance in how scores or ranks are computed. The scoring
                formula is public and fixed:
              </p>
              <p className="font-mono text-sm bg-white/[0.04] rounded px-3 py-2 text-hot">
                Score = 0.85 × ln(1 + Bid Total in $) + 0.15 × ln(1 + Unique Clicks)
              </p>
              <p>
                Where:
              </p>
              <ul className="ml-4 list-disc space-y-1.5 text-zinc-300">
                <li>
                  <strong>Bid Total</strong> = sum of all settled bid amounts
                  for your campaign in the current season (in USD).
                </li>
                <li>
                  <strong>Unique Clicks</strong> = count of distinct viewer
                  sessions that clicked through to your YouTube channel from the
                  leaderboard, deduplicated per viewer per day via session
                  hashing (no raw IP stored).
                </li>
              </ul>
              <p>
                Ranks are ordered by <strong>Score descending</strong>. Ties
                are broken by <strong>earlier first succeeded bid wins</strong>
                (then by internal campaign ID as a final deterministic key).
                The tiebreak is implemented both in Postgres (source of truth)
                and in the Redis ZSET projection (folded into the score as a
                micro-adjustment ε·ordinal).
              </p>
              <Callout>
                Because the formula is public, deterministic, and verifiable
                against the open source code, Blowup is <strong>not a game of
                chance</strong> under any reasonable interpretation. You always
                know exactly how your bid amount and clicks translate into
                score and rank — there is no hidden randomness.
              </Callout>
            </Prose>
          </section>

          <div className="mt-8">
            <SectionDivider />
          </div>

          {/* ── 5. Account & usage rules ─────────────────── */}
          <section className="mt-8 space-y-4" aria-labelledby="usage">
            <SectionHeading id="usage">
              5. Account & usage rules
            </SectionHeading>
            <Prose>
              <p>
                There are no user accounts and no login. Your identity is your
                YouTube channel handle (normalized to <code
                className="font-mono text-xs text-zinc-400">@handle</code>
                format). By using Blowup, you agree:
              </p>
              <ul className="ml-4 list-disc space-y-1.5 text-zinc-300">
                <li>
                  <strong>One campaign per handle per season.</strong> You
                  cannot create duplicate campaigns for the same handle in the
                  same season. The database enforces this via a unique
                  constraint.
                </li>
                <li>
                  <strong>No bid manipulation.</strong> You may not use
                  automated scripts, bots, or coordinated groups to inflate
                  click counts. Click deduplication (session hashing) is
                  designed to prevent this; deliberate circumvention is a
                  violation of these terms.
                </li>
                <li>
                  <strong>No impersonation.</strong> You may not bid on behalf
                  of a channel you do not own or manage without authorization.
                </li>
                <li>
                  <strong>No illegal content.</strong> Channels promoting
                  illegal activities, hate speech, or content violating
                  YouTube&rsquo;s Terms of Service may be removed from the
                  leaderboard at our discretion.
                </li>
                <li>
                  <strong>No scraping abuse.</strong> Automated scraping that
                  degrades service for others is prohibited. The public
                  leaderboard is readable by anyone; we do not offer an API at
                  this time.
                </li>
              </ul>
              <p>
                We reserve the right to remove a campaign from the leaderboard,
                refuse a bid, or ban a handle from future participation if we
                determine these rules have been violated. No refund will be
                issued for bids already settled prior to removal (except as
                covered by the auto-refund conditions in the Refund Policy).
              </p>
            </Prose>
          </section>

          <div className="mt-8">
            <SectionDivider />
          </div>

          {/* ── 6. Limitation of liability ───────────────── */}
          <section className="mt-8 space-y-4" aria-labelledby="liability">
            <SectionHeading id="liability">
              6. Limitation of liability
            </SectionHeading>
            <Prose>
              <p>
                <strong>Blowup is provided &ldquo;as is&rdquo; and &ldquo;as
                available&rdquo; without warranties of any kind.</strong> To the
                maximum extent permitted by law:
              </p>
              <ul className="ml-4 list-disc space-y-1.5 text-zinc-300">
                <li>
                  We do not guarantee any specific rank, score, click count,
                  traffic, subscriber growth, or business outcome from
                  participating.
                </li>
                <li>
                  We are not liable for any indirect, incidental, special,
                  consequential, or punitive damages (including lost profits,
                  lost data, or reputational harm) arising from your use of or
                  inability to use the service.
                </li>
                <li>
                  Our total liability for any claim arising from these terms or
                  your use of Blowup shall not exceed the total amount you paid
                  in bids during the season giving rise to the claim.
                </li>
                <li>
                  We are not responsible for any actions by Dodo Payments, Vercel,
                  Neon, Upstash, Inngest, YouTube, or any other third-party
                  service provider.
                </li>
              </ul>
              <p>
                Some jurisdictions do not allow the exclusion of certain
                warranties or limitation of liability for certain damages, so
                the above may not apply to you in full.
              </p>
            </Prose>
          </section>

          <div className="mt-8">
            <SectionDivider />
          </div>

          {/* ── 7. Governing law ─────────────────────────── */}
          <section className="mt-8 space-y-4" aria-labelledby="governing">
            <SectionHeading id="governing">
              7. Governing law & dispute resolution
            </SectionHeading>
            <Prose>
              <p>
                These terms are governed by the laws of <strong>India</strong>,
                without regard to conflict-of-law principles. Any dispute
                arising from or relating to these terms or your use of Blowup
                shall be resolved exclusively in the competent courts located in
                <strong>India</strong>.
              </p>
              <p>
                If any provision of these terms is found unenforceable, the
                remaining provisions will continue in full force and effect.
              </p>
            </Prose>
          </section>

          <div className="mt-8">
            <SectionDivider />
          </div>

          {/* ── 8. Contact ───────────────────────────────── */}
          <section className="mt-8 space-y-4" aria-labelledby="contact">
            <SectionHeading id="contact">
              8. Contact
            </SectionHeading>
            <Prose>
              <p>
                Questions about these terms, your bids, or the service in
                general:
              </p>
            </Prose>

            <ContactBlock />

            <Prose>
              <p className="mt-4">
                <strong>Legal review disclaimer:</strong> This Terms of Service
                page was written to accurately reflect the actual architecture
                and codebase behavior as of the effective date above. It is
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