/**
 * Vision fallback for scanned documents: an image-only PDF (no text
 * layer) must be transcribed with the vision model instead of bouncing
 * the user to "send a screenshot instead" (real complaint, 2026-08-14),
 * and photos of letters transcribe directly for the School term-dates
 * upload (whose picker promised JPEG/PNG that the server then rejected).
 */
jest.mock('pdf-parse', () => jest.fn());
jest.mock('./ai-client', () => ({ callClaude: jest.fn() }));

const pdfParse = require('pdf-parse');
const { callClaude } = require('./ai-client');
const { extractTextFromDocument, transcribeScannedDocument } = require('./document-extract');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('scanned-PDF vision fallback', () => {
  test('empty text layer falls back to vision transcription', async () => {
    pdfParse.mockResolvedValue({ text: '   \n  ' });
    callClaude.mockResolvedValue({ text: 'Dear Parents, Sports Day is on 12 July at 2pm.' });

    const { text, kind } = await extractTextFromDocument(Buffer.from('%PDF-fake'), 'application/pdf');
    expect(kind).toBe('pdf');
    expect(text).toContain('Sports Day');
    // The vision call carried the PDF as a native document block.
    const content = callClaude.mock.calls[0][0].messages[0].content;
    expect(content[0].type).toBe('document');
    expect(content[0].source.media_type).toBe('application/pdf');
  });

  test('text-layer PDFs never invoke vision', async () => {
    pdfParse.mockResolvedValue({ text: 'Term starts 3 September' });
    const { text } = await extractTextFromDocument(Buffer.from('%PDF-fake'), 'application/pdf');
    expect(text).toContain('Term starts');
    expect(callClaude).not.toHaveBeenCalled();
  });

  test('vision failure still yields the friendly error', async () => {
    pdfParse.mockResolvedValue({ text: '' });
    callClaude.mockRejectedValue(new Error('provider down'));
    await expect(extractTextFromDocument(Buffer.from('%PDF-fake'), 'application/pdf'))
      .rejects.toThrow(/couldn't find any readable text/);
  });
});

describe('transcribeScannedDocument with images', () => {
  test('images are sent as image blocks', async () => {
    callClaude.mockResolvedValue({ text: 'Autumn term: 3 Sep - 19 Dec' });
    const text = await transcribeScannedDocument(Buffer.from('jpegbytes'), 'image/jpeg');
    expect(text).toContain('Autumn term');
    const content = callClaude.mock.calls[0][0].messages[0].content;
    expect(content[0].type).toBe('image');
    expect(content[0].source.media_type).toBe('image/jpeg');
  });
});
