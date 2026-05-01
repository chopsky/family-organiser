/**
 * FaqAccordion — a stateless wrapper around native <details>/<summary>.
 *
 * Why native <details>:
 *   • Browsers automatically open a <details> whose id matches the URL
 *     hash on load — so /help#bot-not-replying both scrolls to and
 *     expands that question, no JS required.
 *   • <summary> is a button by default — keyboard, focus ring, and
 *     screen-reader expanded/collapsed state all work out of the box.
 *   • Zero state to manage in React, zero library to add.
 *
 * Styling note: the default disclosure triangle is suppressed via a
 * global rule in index.css (`summary::-webkit-details-marker { display:
 * none }` + `summary { list-style: none }`), so the only visible
 * affordance is our own chevron — which rotates on `[open]` via the
 * `group-open:` Tailwind variant.
 */

import { IconChevronRight } from './Icons';

export default function FaqAccordion({ id, question, children }) {
  return (
    <details
      id={id}
      className="group border-b border-light-grey last:border-b-0 py-4"
    >
      <summary className="cursor-pointer flex items-center justify-between gap-3 text-charcoal font-medium list-none select-none">
        <span className="flex-1">{question}</span>
        <IconChevronRight className="h-4 w-4 shrink-0 text-warm-grey transition-transform group-open:rotate-90" />
      </summary>
      <div className="mt-3 text-warm-grey leading-relaxed text-[15px] space-y-2.5">
        {children}
      </div>
    </details>
  );
}
