/**
 * Unit tests for the document upload validator.
 *
 * Regression anchors:
 *   - Extension allowlist (rejects executables, scripts, HTML/SVG)
 *   - Magic-byte sniffing (rejects extension/content mismatch)
 *   - Returns canonical MIME from server, not whatever the client claimed
 *   - Plain-text heuristic for .txt / .csv (rejects binaries with text ext)
 */

const { validateUpload, ACCEPT_ATTRIBUTE, ALLOWED } = require('./fileValidation');

// Helper: build a buffer that starts with the given magic bytes,
// padded with zeros to a reasonable length so the validator sees enough.
function bufferWithMagic(bytes, totalLength = 64) {
  const buf = Buffer.alloc(totalLength);
  for (let i = 0; i < bytes.length; i++) buf[i] = bytes[i];
  return buf;
}

describe('validateUpload()', () => {
  describe('extension allowlist', () => {
    test('accepts a .pdf with the right magic', () => {
      const pdf = bufferWithMagic([0x25, 0x50, 0x44, 0x46, 0x2D]);
      expect(validateUpload(pdf, 'passport.pdf')).toEqual({
        ext: 'pdf',
        mime: 'application/pdf',
      });
    });

    test('rejects an .exe', () => {
      const exe = bufferWithMagic([0x4D, 0x5A]);
      expect(() => validateUpload(exe, 'malware.exe')).toThrow(/not allowed/);
    });

    test('rejects an .html', () => {
      const html = Buffer.from('<html><script>alert(1)</script></html>');
      expect(() => validateUpload(html, 'evil.html')).toThrow(/not allowed/);
    });

    test('rejects an .svg (potential script vector)', () => {
      const svg = Buffer.from('<svg><script>alert(1)</script></svg>');
      expect(() => validateUpload(svg, 'evil.svg')).toThrow(/not allowed/);
    });

    test('rejects a file with no extension', () => {
      expect(() => validateUpload(Buffer.from('data'), 'noextension')).toThrow(/not allowed/);
    });

    test('rejects an Office macro file (.docm)', () => {
      const zip = bufferWithMagic([0x50, 0x4B, 0x03, 0x04]);
      expect(() => validateUpload(zip, 'macro.docm')).toThrow(/not allowed/);
    });

    test('is case-insensitive on extensions', () => {
      const pdf = bufferWithMagic([0x25, 0x50, 0x44, 0x46, 0x2D]);
      expect(validateUpload(pdf, 'Passport Scan.PDF')).toEqual({
        ext: 'pdf',
        mime: 'application/pdf',
      });
    });

    test('attaches statusCode 415 to thrown errors', () => {
      try {
        validateUpload(Buffer.from(''), 'evil.exe');
        fail('expected throw');
      } catch (err) {
        expect(err.statusCode).toBe(415);
      }
    });
  });

  describe('magic-byte sniffing', () => {
    test('rejects a .pdf whose bytes are not a real PDF', () => {
      const fakePdf = Buffer.from('not actually a pdf');
      expect(() => validateUpload(fakePdf, 'fake.pdf')).toThrow(/do not match a valid \.pdf/);
    });

    test('rejects an .exe renamed to .pdf', () => {
      const exe = bufferWithMagic([0x4D, 0x5A]); // MZ header
      expect(() => validateUpload(exe, 'evil-renamed.pdf')).toThrow(/do not match a valid \.pdf/);
    });

    test('accepts PNG with correct magic', () => {
      const png = bufferWithMagic([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
      expect(validateUpload(png, 'logo.png')).toEqual({
        ext: 'png',
        mime: 'image/png',
      });
    });

    test('accepts JPEG with correct magic', () => {
      const jpeg = bufferWithMagic([0xFF, 0xD8, 0xFF, 0xE0]);
      expect(validateUpload(jpeg, 'photo.jpg')).toEqual({
        ext: 'jpg',
        mime: 'image/jpeg',
      });
    });

    test('accepts GIF87a and GIF89a', () => {
      const gif87 = bufferWithMagic([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]);
      const gif89 = bufferWithMagic([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
      expect(validateUpload(gif87, 'old.gif').mime).toBe('image/gif');
      expect(validateUpload(gif89, 'new.gif').mime).toBe('image/gif');
    });

    test('accepts WebP with offset-aware pattern (RIFF…WEBP)', () => {
      const webp = Buffer.alloc(64);
      // RIFF at offset 0, WEBP at offset 8 (size bytes in 4..7)
      webp.set([0x52, 0x49, 0x46, 0x46], 0);
      webp.set([0x57, 0x45, 0x42, 0x50], 8);
      expect(validateUpload(webp, 'image.webp').mime).toBe('image/webp');
    });

    test('accepts DOCX (ZIP magic)', () => {
      const docx = bufferWithMagic([0x50, 0x4B, 0x03, 0x04]);
      expect(validateUpload(docx, 'report.docx').mime).toBe(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      );
    });

    test('canonicalises MIME — server-derived, not client-claimed', () => {
      // Even though we don't take a claimed-MIME parameter (by design),
      // confirm the function returns the canonical mime for the extension.
      const pdf = bufferWithMagic([0x25, 0x50, 0x44, 0x46, 0x2D]);
      const result = validateUpload(pdf, 'doc.pdf');
      expect(result.mime).toBe('application/pdf');
    });
  });

  describe('plain-text heuristic', () => {
    test('accepts a real .txt', () => {
      const txt = Buffer.from('Hello world\nLine 2\tTabbed\r\n');
      expect(validateUpload(txt, 'notes.txt').mime).toBe('text/plain');
    });

    test('rejects a binary file masquerading as .txt', () => {
      // Contains a NUL — characteristic of binaries
      const bin = Buffer.from([0x48, 0x69, 0x00, 0x21]);
      expect(() => validateUpload(bin, 'binary.txt')).toThrow(/plain text/);
    });

    test('rejects an .exe renamed to .csv', () => {
      const exe = bufferWithMagic([0x4D, 0x5A, 0x90, 0x00]);
      expect(() => validateUpload(exe, 'data.csv')).toThrow(/plain text/);
    });

    test('accepts .csv with multibyte UTF-8', () => {
      // £ is two bytes in UTF-8 (0xC2 0xA3), Café etc.
      const csv = Buffer.from('Name,Amount\nCafé,£2.50\n');
      expect(validateUpload(csv, 'spend.csv').mime).toBe('text/csv');
    });
  });

  describe('exports', () => {
    test('ACCEPT_ATTRIBUTE lists every allowed extension as a .ext', () => {
      const exts = ACCEPT_ATTRIBUTE.split(',');
      for (const key of Object.keys(ALLOWED)) {
        expect(exts).toContain(`.${key}`);
      }
    });
  });
});
