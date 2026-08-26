/**
 * Deterministic avatar gradient — no YouTube API dependency for V1 boards.
 * Extracted from LeaderboardRow (Phase 4.6) so server components (root
 * landing #1 previews) can render an avatar WITHOUT pulling the board row's
 * framer-motion client boundary onto pages that never animate.
 */

const GRADIENTS = [
  'from-[#ff4017] to-[#ffb03a]',
  'from-[#8b5cf6] to-[#ec4899]',
  'from-[#06b6d4] to-[#3b82f6]',
  'from-[#10b981] to-[#84cc16]',
  'from-[#f43f5e] to-[#f97316]',
];

function gradientFor(handle: string): string {
  let h = 0;
  for (let i = 0; i < handle.length; i++) h = (h * 31 + handle.charCodeAt(i)) >>> 0;
  return GRADIENTS[h % GRADIENTS.length];
}

export function Avatar({ handle, size = 'md' }: { handle: string; size?: 'md' | 'lg' }) {
  const dim = size === 'lg' ? 'h-14 w-14 text-xl' : 'h-11 w-11 text-base';
  return (
    <div
      aria-hidden
      className={`${dim} flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${gradientFor(handle)} font-bold text-white shadow-lg shadow-black/40`}
    >
      {(handle.replace(/^@/, '') || '?')[0].toUpperCase()}
    </div>
  );
}
