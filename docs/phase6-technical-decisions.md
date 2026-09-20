# Phase 6 – Technical Design Decisions

## 1. PNG generation for the shareable rank card

The project uses **Next.js 16’s built‑in Open Graph image rendering** via the `ImageResponse` API (exported from `next/og`).  This is the canonical, documented way to generate server‑side PNGs in Next App Router:

```ts
import { ImageResponse } from "next/og";
```

*Why this is the chosen path*:

*  It is part of the official Next 16 docs (see the *Image generation* section) and works in both the default Node runtime and Vercel’s Fluid‑Compute edge environment.
*  It has no Webpack or Turbopack dependency – the route lives in `app/api/.../route.ts` and is executed as a pure server‑side function.
*  It lets us reuse the same JSX that renders the in‑app rank‑card component, ensuring visuals match exactly.
*  The returned response must include the `Content-Type: image/png` header automatically – no extra plumbing.

**Implementation sketch** (pseudo‑code):

```ts
// src/app/api/share/[creator]/image.tsx
import { ImageResponse } from "next/og";
import { getCreatorProfile } from "../../lib/db"; // helper to pull avatar, score, rank, etc.
import RankCard from "../../components/shared/RankCard"; // same component used in the UI

export async function GET({ params, searchParams }) {
  const { creator } = params;
  // Look up the creator’s public data (handle, avatar, rank, score, category)
  const profile = await getCreatorProfile(creator);
  if (!profile) return new Response("Not found", { status: 404 });

  return new ImageResponse(
    <RankCard profile={profile} />, // React component rendered as SVG
    { width: 1200, height: 630, type: "image/png" }
  );
}
```

The `RankCard` component outputs a single‑staged SVG that the `ImageResponse` library turns into a PNG.  Because Next 16’s `ImageResponse` already supports VS‑Code previewing and caching, the image will also be served as an Open Graph image for social share previews.

---

## 2. Identifying a creator for the “blown‑out” banner

**Critical constraint:** V1 is intentionally anonymous — no email infrastructure exists, no email is collected or sent by the app. The “blown‑out” link must be delivered with **zero new infrastructure and zero new PII collection**.

We identify a creator via a **deterministic HMAC token** derived from their handle + the current season ID. The token is shown/copyable directly on the **claim‑form success page** immediately after a creator submits their bid — self‑serve, no email required.

### How the token is created

```ts
import crypto from “crypto”;

export function createNotifyToken(handle: string, seasonId: string) {
  const hmac = crypto.createHmac(“sha256”, process.env.IDENTITY_SECRET!);
  hmac.update(`${handle}:${seasonId}`);
  const digest = hmac.digest(“hex”);
  // First 16 hex chars — URL-friendly, sufficient entropy for this purpose
  return digest.slice(0, 16);
}
```

*  `IDENTITY_SECRET` is a per‑deployment constant set via the Vercel env store, **never** exposed client‑side.
*  The token is deterministic: same handle + same season always produces the same token. It proves the link-holder knew the handle at the time the season was active — not a cryptographic secret, just anti-guess protection.

### How a creator receives their link

**The only delivery mechanism is the claim‑form success page.**

After a creator submits a bid via the claim form and payment is initiated (or confirmed), the success page renders their personal “blown‑out” tracking URL clearly, with a copy‑to‑clipboard button and an instruction to bookmark it:

```text
https://blowup.lol/profile/${handle}?token=${token}
```

The URL is shown once on that page. If they bookmark or copy it, they have it. **No email is sent or collected for this purpose.** This matches the architecture’s Q1 decision (anonymous V1) and avoids any new PII or contact-point infrastructure.

### What the link does when visited

* Route: `src/app/(board)/[category]/creator/[handle]/page.tsx` (or a dedicated blown‑out sub‑route if the profile page grows large). The server receives `handle` from the path and `token` from `searchParams`.
* It recomputes the expected token using the same algorithm and checks that the 16‑character hash matches. Mismatch → page renders without the private banner (no error page, just the public profile view).
* On match: the server pulls the most recent `activities` rows for that creator from the DB. If the last `rank_change` event moved them out of the top‑3, the page renders a `<BlownOutBanner />` — e.g. *”You’ve been knocked out of the spotlight. You’re $X away from reclaiming #3.”*

### Token recovery

Because the token is deterministic, the creator can **always recompute** a valid link for the current season by visiting the claim form again and completing a new bid — the success page will show the same URL (same handle, same active season → same token). No backend state needs to change.

---

## Summary

1. **PNG generation** – use the officially supported `ImageResponse` API (`next/og`) in a dedicated App‑Router API route.
2. **Blown‑out banner** – identify creators by a short, deterministic HMAC token derived from `handle + currentSeason`. The link is shown/copyable on the **claim‑form success page only** — no email, no new infrastructure, no PII. Validated server‑side before showing the private banner; the public profile view is unaffected on mismatch.

These decisions keep the implementation lightweight, fully respect the “no login, no email” V1 requirement (architecture.md Q1), and rely solely on the existing `activities` and `clicks` tables without schema changes.
