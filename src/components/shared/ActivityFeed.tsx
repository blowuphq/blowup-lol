'use client';

import { useEffect, useState } from 'react';
import type { FeedEntry } from '../../features/activity/queries.js';

/**
 * Live activity feed ticker (Phase 6): subscribes to the 'activity' SSE event
 * on the same category stream and renders the most recent 5–7 entries as a
 * scrolling list. Each entry shows what happened — a bid landed, someone
 * overtook a rank, or a new creator joined the board.
 */
export function ActivityFeed({ slug }: { slug: string }) {
  const [entries, setEntries] = useState<FeedEntry[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const es = new EventSource(`/api/events?category=${encodeURIComponent(slug)}`);

    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);

    es.addEventListener('activity', (ev) => {
      const payload = JSON.parse((ev as MessageEvent).data) as { entries: FeedEntry[] };
      if (payload.entries?.length) {
        // Entries come newest-first from the server; keep the most recent 7
        setEntries(payload.entries.slice(0, 7));
      }
    });

    return () => es.close();
  }, [slug]);

  if (entries.length === 0) {
    return (
      <div
        className="rounded-xl border border-white/5 bg-white/[0.03] p-4 text-center text-sm text-zinc-500"
        aria-live="polite"
      >
        {connected ? 'No activity yet this round.' : 'Connecting to live feed…'}
      </div>
    );
  }

  function formatActivity(entry: FeedEntry): string {
    const time = new Date(entry.createdAt).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'UTC',
    });
    const amount = entry.amountCents
      ? `$${(entry.amountCents / 100).toLocaleString('en-US')}`
      : null;

    switch (entry.type) {
      case 'joined_board':
        return `${time} — ${entry.handle} joined the board${amount ? ` with ${amount}` : ''}`;
      case 'bid':
        return `${time} — ${entry.handle} bid${amount ? ` ${amount}` : ''}${
          entry.newRank ? ` (now #${entry.newRank})` : ''
        }`;
      case 'rank_change':
        return `${time} — ${entry.handle} moved from #${entry.previousRank} to #${entry.newRank}${amount ? ` (bid ${amount})` : ''}`;
    }
  }

  return (
    <div
      className="rounded-xl border border-white/5 bg-white/[0.03] p-4"
      aria-live="polite"
      aria-label="Live activity"
    >
      <div className="flex items-center gap-2 mb-3">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" aria-hidden />
        <span className="text-xs font-bold uppercase tracking-[0.2em] text-hot">
          Live activity
        </span>
      </div>
      <ul className="space-y-2 text-sm text-zinc-300" role="log">
        {entries.map((entry, i) => (
          <li
            key={entry.id}
            className={`flex items-start gap-2 animate-in fade-in slide-in-from-top-1 duration-200 ${
              i === 0 ? 'text-hot font-medium' : ''
            }`}
          >
            <span className="shrink-0 text-[10px] font-mono tabular-nums text-zinc-500">
              {new Date(entry.createdAt).toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: false,
                timeZone: 'UTC',
              })}
            </span>
            <span className="flex-1 min-w-0 truncate">
              {entry.type === 'joined_board' && (
                <>
                  <span className="font-bold">{entry.handle}</span>{' '}
                  joined the board
                  {entry.amountCents && (
                    <>
                      {' '}with{' '}
                      <span className="font-bold text-hot">
                        ${(entry.amountCents / 100).toLocaleString('en-US')}
                      </span>
                    </>
                  )}
                </>
              )}
              {entry.type === 'bid' && (
                <>
                  <span className="font-bold">{entry.handle}</span>{' '}
                  placed a bid
                  {entry.amountCents && (
                    <>
                      {' '}
                      <span className="font-bold text-hot">
                        ${(entry.amountCents / 100).toLocaleString('en-US')}
                      </span>
                    </>
                  )}
                  {entry.newRank && (
                    <>
                      {' '}
                      <span className="text-zinc-400">(</span>
                      now <span className="font-bold">#{entry.newRank}</span>
                      <span className="text-zinc-400">)</span>
                    </>
                  )}
                </>
              )}
              {entry.type === 'rank_change' && (
                <>
                  <span className="font-bold">{entry.handle}</span>{' '}
                  moved from
                  <span className="font-bold text-rose-400">
                    #{entry.previousRank}
                  </span>{' '}
                  to
                  <span className="font-bold text-emerald-400">
                    #{entry.newRank}
                  </span>
                  {entry.amountCents && (
                    <>
                      {' '}
                      <span className="text-zinc-400">(bid</span>{' '}
                      <span className="font-bold text-hot">
                        ${(entry.amountCents / 100).toLocaleString('en-US')}
                      </span>
                      <span className="text-zinc-400">)</span>
                    </>
                  )}
                </>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}