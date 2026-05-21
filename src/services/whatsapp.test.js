const { normalizeWhatsAppMarkdown } = require('./whatsapp');

describe('normalizeWhatsAppMarkdown', () => {
  describe('double-asterisk markdown bold', () => {
    it('converts **bold** to *bold*', () => {
      expect(normalizeWhatsAppMarkdown('**bold**')).toBe('*bold*');
    });

    it('converts multi-word **place names** to *place names*', () => {
      expect(normalizeWhatsAppMarkdown('**Alexandra Palace Park**')).toBe('*Alexandra Palace Park*');
    });

    it('converts inline **bold** in a longer sentence', () => {
      expect(normalizeWhatsAppMarkdown('Try **Highgate Wood** for a walk.'))
        .toBe('Try *Highgate Wood* for a walk.');
    });

    it('converts multiple **bold** spans in one message', () => {
      // Real production case: LLM emits a 3-paragraph recommendation
      // with **Place A**, **Place B**, **Place C** sprinkled through.
      const input = '**Alexandra Palace Park** is great. Also try **Hobbledown Heath** or **Highgate Wood**.';
      const expected = '*Alexandra Palace Park* is great. Also try *Hobbledown Heath* or *Highgate Wood*.';
      expect(normalizeWhatsAppMarkdown(input)).toBe(expected);
    });

    it('converts **bold with colon:** correctly', () => {
      expect(normalizeWhatsAppMarkdown('**Right now:** 21°C')).toBe('*Right now:* 21°C');
    });

    it('does not match across newlines', () => {
      // A bold span shouldn't span two paragraphs - if the model writes
      // ** at the start of one line and ** at the end of a later line
      // we leave it alone (probably a quoting accident or an actual
      // unbalanced asterisk).
      const input = '**line one\nline two**';
      expect(normalizeWhatsAppMarkdown(input)).toBe(input);
    });
  });

  describe('double-underscore markdown bold', () => {
    it('converts __bold__ to *bold*', () => {
      expect(normalizeWhatsAppMarkdown('__bold__')).toBe('*bold*');
    });

    it('converts __multi word__ to *multi word*', () => {
      expect(normalizeWhatsAppMarkdown('see __Highgate Wood__ map')).toBe('see *Highgate Wood* map');
    });
  });

  describe('leaves correct WhatsApp formatting alone', () => {
    it('preserves single-asterisk *bold*', () => {
      expect(normalizeWhatsAppMarkdown('*already bold*')).toBe('*already bold*');
    });

    it('preserves single-underscore _italic_', () => {
      expect(normalizeWhatsAppMarkdown('_already italic_')).toBe('_already italic_');
    });

    it('preserves bullet-list asterisks at line starts', () => {
      // A regex that matched too eagerly would turn "* item" lines into
      // partial conversions. Lazy match prevents this.
      const input = '* item one\n* item two\n* item three';
      expect(normalizeWhatsAppMarkdown(input)).toBe(input);
    });

    it('leaves stray single asterisks alone', () => {
      expect(normalizeWhatsAppMarkdown('a * b * c')).toBe('a * b * c');
    });
  });

  describe('input validation', () => {
    it('returns non-string input unchanged', () => {
      expect(normalizeWhatsAppMarkdown(null)).toBe(null);
      expect(normalizeWhatsAppMarkdown(undefined)).toBe(undefined);
      expect(normalizeWhatsAppMarkdown(42)).toBe(42);
    });

    it('returns empty string unchanged', () => {
      expect(normalizeWhatsAppMarkdown('')).toBe('');
    });
  });
});
