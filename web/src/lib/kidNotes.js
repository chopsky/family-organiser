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
      body { font-family: -apple-system, system-ui, sans-serif; color: #1A1620; text-align: center; padding: 32px; }
      h1 { font-size: 24px; margin: 0 0 4px; }
      .date { color: #8A8493; font-size: 13px; margin-bottom: 20px; }
      img { max-width: 100%; border: 1px solid #ddd; border-radius: 12px; }
      .msg { font-size: 20px; font-style: italic; margin-top: 20px; }
      @media print { body { padding: 0; } }
    </style></head><body>
    <h1>A note from ${who} &#128156;</h1>
    <div class="date">${escapeHtml(note.note_date || '')}</div>
    ${note.image_url ? `<img alt="Drawing" src="${escapeHtml(note.image_url)}">` : ''}
    ${note.text_note ? `<div class="msg">&ldquo;${escapeHtml(note.text_note)}&rdquo;</div>` : ''}
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
