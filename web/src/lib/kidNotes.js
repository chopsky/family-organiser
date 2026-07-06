// Shared helpers for the kids'-notes surfaces (the KidNoteAlert banner/popup
// and the Notes archive page).

// Must match REACTION_EMOJI in src/routes/kids.js - the backend rejects
// anything outside this set.
export const REACTIONS = ['❤️', '😍', '🌟', '😂', '🥰', '👏'];

const escapeHtml = (s) => String(s || '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

// Print a note on its own page so a parent can pop a keepsake on the
// fridge. Builds a minimal document (the drawing + message + who/when) as
// a Blob and opens it in a new window; the inline script waits for the
// image to paint, then fires the browser print dialog.
export function printNote(note) {
  const who = escapeHtml(note.child_name || 'the kids');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>A note from ${who}</title>
    <style>
      /* Predictable page box so the whole note fits on ONE sheet. */
      @page { margin: 12mm; }
      * { box-sizing: border-box; }
      html, body { margin: 0; }
      body { font-family: -apple-system, system-ui, sans-serif; color: #1A1620; padding: 24px; }
      /* Keep heading + drawing + message together - never split across
         pages. The image is capped in height so there's always room for
         the heading above and the message below on the same page. */
      .sheet { text-align: center; break-inside: avoid; page-break-inside: avoid; }
      h1 { font-size: 22px; margin: 0 0 4px; }
      .date { color: #8A8493; font-size: 13px; margin: 0 0 14px; }
      /* Cap the drawing's height so the heading above and the message below
         always share the page. The printable HEIGHT is much smaller on a
         landscape sheet (~186mm on A4) than portrait (~273mm), so the cap
         drops accordingly - otherwise the message spills to a second page. */
      img { display: block; margin: 0 auto; max-width: 100%; max-height: 170mm; border: 1px solid #ddd; border-radius: 12px; }
      @media print and (orientation: landscape) { img { max-height: 120mm; } }
      .msg { font-size: 18px; font-style: italic; margin-top: 14px; }
      @media print { body { padding: 0; } }
    </style></head><body>
    <div class="sheet">
      <h1>A note from ${who} &#128156;</h1>
      <div class="date">${escapeHtml(note.note_date || '')}</div>
      ${note.image_url ? `<img alt="Drawing" src="${escapeHtml(note.image_url)}">` : ''}
      ${note.text_note ? `<div class="msg">&ldquo;${escapeHtml(note.text_note)}&rdquo;</div>` : ''}
    </div>
    <script>
      window.addEventListener('load', function () {
        var img = document.querySelector('img');
        if (img && !img.complete) {
          img.addEventListener('load', function () { window.print(); });
          img.addEventListener('error', function () { window.print(); });
        } else { window.print(); }
      });
    </script>
    </body></html>`;
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  const w = window.open(url, '_blank');
  if (!w) { URL.revokeObjectURL(url); return; }
  setTimeout(() => URL.revokeObjectURL(url), 60000); // after the window has loaded it
}
