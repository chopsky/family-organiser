/**
 * Skeleton primitives + per-page skeleton compositions.
 *
 * Used in place of <Spinner /> on first-load. Mimics the rough shape
 * of the eventual page so the transition to real content feels like
 * "details filling in" rather than "spinner replaced by data" -
 * which is the single biggest perceived-native upgrade for a
 * content-heavy app like this one.
 *
 * Design guide reference: CLAUDE.md "Motion" section explicitly says
 * "Loading: skeleton screens, never spinners". This module makes
 * that real.
 */

import React from 'react';

/**
 * Base shimmer block. Use as the building block for any page-
 * specific skeleton. Always renders a soft pulsing grey rectangle
 * at the given dimensions.
 *
 * Tailwind doesn't ship a great built-in shimmer, so we use the
 * native `animate-pulse` which is good enough and respects
 * prefers-reduced-motion (CSS @media handles that for us).
 */
export function Skeleton({ className = '', style = {}, rounded = 'rounded-lg' }) {
  return (
    <div
      className={`bg-light-grey/60 animate-pulse ${rounded} ${className}`}
      style={style}
      aria-hidden="true"
    />
  );
}

export function SkeletonText({ width = '80%', className = '' }) {
  return <Skeleton className={`h-3 ${className}`} style={{ width }} rounded="rounded-md" />;
}

export function SkeletonAvatar({ size = 32 }) {
  return <Skeleton style={{ width: size, height: size }} rounded="rounded-full" />;
}

/** Generic card with title + a few text lines, sized like dashboard cards. */
export function SkeletonCard({ rows = 3, className = '' }) {
  return (
    <div
      className={`bg-linen rounded-2xl p-5 space-y-3 ${className}`}
      style={{ boxShadow: 'rgba(26, 22, 32, 0.04) 0px 1px 0px, rgba(26, 22, 32, 0.04) 0px 4px 14px' }}
    >
      <div className="flex items-center justify-between">
        <SkeletonText width="40%" className="h-4" />
        <SkeletonText width="20%" />
      </div>
      <div className="space-y-2.5">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-3 py-2.5 bg-cream rounded-xl">
            <Skeleton className="w-[3px] h-7" rounded="rounded-full" />
            <SkeletonText width="3rem" />
            <SkeletonText width={`${50 + (i * 8) % 30}%`} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Dashboard skeleton - greeting kicker + serif headline + 4 cards. */
export function DashboardSkeleton() {
  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="space-y-3">
        <SkeletonText width="50%" />
        <Skeleton className="h-12 md:h-14 w-3/4" rounded="rounded-md" />
      </div>
      <Skeleton className="h-12" rounded="rounded-2xl" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SkeletonCard rows={3} />
        <SkeletonCard rows={4} />
        <SkeletonCard rows={3} />
        <SkeletonCard rows={4} />
      </div>
    </div>
  );
}

/** Simple page skeleton - h1 + 5 row stubs. Reusable on Tasks /
 *  Shopping / Documents / etc. */
export function PageListSkeleton({ rows = 6, headerWidth = '40%' }) {
  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <Skeleton className="h-10" style={{ width: headerWidth }} rounded="rounded-md" />
      <div className="bg-linen rounded-2xl p-5 space-y-3" style={{ boxShadow: 'rgba(26, 22, 32, 0.04) 0px 1px 0px, rgba(26, 22, 32, 0.04) 0px 4px 14px' }}>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 py-2.5">
            <SkeletonAvatar size={24} />
            <div className="flex-1 space-y-2">
              <SkeletonText width={`${70 - (i * 8) % 35}%`} />
              <SkeletonText width="35%" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
