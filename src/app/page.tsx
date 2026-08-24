/**
 * Deliberately minimal: Phase 3 is API-only (checkout + webhooks). This page
 * exists so Stripe's success/cancel redirects land somewhere real instead of
 * a 404. The actual product UI is a later phase.
 */
export default function Home() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
      <h1>Blowup.io</h1>
      <p>Payments API online — the leaderboard UI ships in a later phase.</p>
    </main>
  );
}
