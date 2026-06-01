const { extractTextFromDocument, isSupportedDocument } = require('./document-extract');

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

describe('document-extract', () => {
  describe('isSupportedDocument', () => {
    test('accepts pdf / docx / doc / text', () => {
      expect(isSupportedDocument('application/pdf')).toBe(true);
      expect(isSupportedDocument(DOCX)).toBe(true);
      expect(isSupportedDocument('application/msword')).toBe(true);
      expect(isSupportedDocument('text/plain')).toBe(true);
    });
    test('rejects images / audio / unknown', () => {
      expect(isSupportedDocument('image/jpeg')).toBe(false);
      expect(isSupportedDocument('audio/ogg')).toBe(false);
      expect(isSupportedDocument('')).toBe(false);
    });
  });

  describe('extractTextFromDocument', () => {
    test('decodes plain text', async () => {
      const buf = Buffer.from('Sports day on 12/07 at 2pm', 'utf8');
      const { text, kind } = await extractTextFromDocument(buf, 'text/plain');
      expect(kind).toBe('text');
      expect(text).toContain('Sports day');
    });

    test('throws user-safe message for legacy .doc', async () => {
      const buf = Buffer.from('whatever', 'utf8');
      await expect(extractTextFromDocument(buf, 'application/msword'))
        .rejects.toThrow(/older \.doc format/);
    });

    test('throws user-safe message for unsupported type', async () => {
      const buf = Buffer.from('x', 'utf8');
      await expect(extractTextFromDocument(buf, 'application/zip'))
        .rejects.toThrow(/file type isn't supported/);
    });

    test('throws for empty buffer', async () => {
      await expect(extractTextFromDocument(Buffer.alloc(0), 'text/plain'))
        .rejects.toThrow(/empty/);
    });

    test('throws for whitespace-only text (scanned-image case)', async () => {
      const buf = Buffer.from('   \n\n  \t ', 'utf8');
      await expect(extractTextFromDocument(buf, 'text/plain'))
        .rejects.toThrow(/couldn't find any readable text/);
    });
  });
});
