const { normalizeWhatsAppMarkdown, splitForWhatsApp } = require('./whatsapp');

describe('splitForWhatsApp', () => {
  it('returns a single chunk for short text', () => {
    expect(splitForWhatsApp('hello')).toEqual(['hello']);
  });

  it('never returns a chunk over the limit, and keeps the content', () => {
    const long = Array.from({ length: 50 }, (_, i) => `Paragraph ${i} with some words here.`).join('\n\n');
    const parts = splitForWhatsApp(long, 200);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(200);
    const joined = parts.join(' ');
    expect(joined).toContain('Paragraph 0');
    expect(joined).toContain('Paragraph 49');
  });

  it('hard-cuts a single unbroken string with no boundaries', () => {
    const blob = 'x'.repeat(450);
    const parts = splitForWhatsApp(blob, 100);
    expect(parts.every((p) => p.length <= 100)).toBe(true);
    expect(parts.join('').length).toBe(450);
  });

  it('handles empty / null input', () => {
    expect(splitForWhatsApp('')).toEqual(['']);
    expect(splitForWhatsApp(null)).toEqual(['']);
  });
});

describe('normalizeWhatsAppMarkdown', () => {
  describe('double-asterisk markdown bold', () => {
    it('converts **bold** to *bold*', () => {
      expect(normalizeWhatsAppMarkdown('**bold**')).toBe('*bold*');
    });

    it('unwraps a **span with a newline** to plain text (WhatsApp cannot bold across lines; real leak 2026-07-11)', () => {
      expect(normalizeWhatsAppMarkdown('under **Settings\nConnect Calendars**.'))
        .toBe('under Settings\nConnect Calendars.');
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

    it('does not BOLD across newlines - unwraps to plain text instead', () => {
      // A bold span can't span lines on WhatsApp. The old behaviour left
      // the asterisks untouched, which shipped literal ** to users (seen
      // live 2026-07-11: "**Settings\nConnect Calendars**"). Now the pair
      // is unwrapped: no bold, but no leaked punctuation either.
      expect(normalizeWhatsAppMarkdown('**line one\nline two**')).toBe('line one\nline two');
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

describe('sendTypingIndicator', () => {
  const { sendTypingIndicator } = require('./whatsapp');
  const ENV_KEYS = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'];
  const saved = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    process.env.TWILIO_ACCOUNT_SID = 'ACtest';
    process.env.TWILIO_AUTH_TOKEN = 'token';
    global.fetch = jest.fn();
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    delete global.fetch;
  });

  it('POSTs the inbound MessageSid to the v3 typing endpoint with basic auth', async () => {
    global.fetch.mockResolvedValue({ ok: true });
    const ok = await sendTypingIndicator('SMabc123');
    expect(ok).toBe(true);
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe('https://messaging.twilio.com/v3/Indicators/Typing.json');
    expect(opts.method).toBe('POST');
    expect(opts.headers.Authorization).toBe('Basic ' + Buffer.from('ACtest:token').toString('base64'));
    expect(JSON.parse(opts.body)).toEqual({ channel: 'WHATSAPP', messageId: 'SMabc123' });
  });

  it('no-ops without a MessageSid or without Twilio credentials', async () => {
    expect(await sendTypingIndicator('')).toBe(false);
    delete process.env.TWILIO_ACCOUNT_SID;
    expect(await sendTypingIndicator('SMabc123')).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('swallows HTTP failures and network errors (cosmetic - must never throw)', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 400, text: () => Promise.resolve('bad sid') });
    await expect(sendTypingIndicator('SMabc123')).resolves.toBe(false);
    global.fetch.mockRejectedValue(new Error('ECONNRESET'));
    await expect(sendTypingIndicator('SMabc123')).resolves.toBe(false);
  });
});

describe('sendWelcome', () => {
  // The welcome must arrive the instant pairing succeeds on BOTH paths. The
  // OTP path has no open 24-hour window (the user typed a code into the app
  // and has never messaged the bot), so only a template reaches them - a
  // freeform send there is rejected with 63016 and they're told nothing.
  const VALID_SID = `HX${'a'.repeat(32)}`;
  let whatsapp;

  beforeEach(() => {
    jest.resetModules();
    process.env.TWILIO_ACCOUNT_SID = 'ACtest';
    process.env.TWILIO_AUTH_TOKEN = 'token';
    process.env.TWILIO_MESSAGING_SERVICE_SID = 'MGtest';
    delete process.env.TWILIO_TEMPLATE_WELCOME;
    whatsapp = require('./whatsapp');
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, status: 201, json: () => Promise.resolve({ sid: 'SM1', status: 'queued' }),
    });
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => { jest.restoreAllMocks(); delete process.env.TWILIO_TEMPLATE_WELCOME; });

  const lastBody = () => new URLSearchParams(global.fetch.mock.calls.at(-1)[1].body);

  it('sends via the template when the SID is configured, passing the first name', async () => {
    process.env.TWILIO_TEMPLATE_WELCOME = VALID_SID;

    await whatsapp.sendWelcome('+447700900000', 'Grant Shapiro');

    const body = lastBody();
    expect(body.get('ContentSid')).toBe(VALID_SID);
    expect(JSON.parse(body.get('ContentVariables'))).toEqual({ 1: 'Grant' });
    expect(body.get('Body')).toBeNull();
  });

  it('falls back to freeform - with a warning - when no template is configured', async () => {
    await whatsapp.sendWelcome('+447700900000', 'Grant');

    expect(lastBody().get('Body')).toContain("You're linked");
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('TWILIO_TEMPLATE_WELCOME'));
  });

  it('never sends an empty greeting variable (Twilio rejects those with 21656)', async () => {
    process.env.TWILIO_TEMPLATE_WELCOME = VALID_SID;

    await whatsapp.sendWelcome('+447700900000', null);
    expect(JSON.parse(lastBody().get('ContentVariables'))).toEqual({ 1: 'there' });

    await whatsapp.sendWelcome('+447700900000', '   ');
    expect(JSON.parse(lastBody().get('ContentVariables'))).toEqual({ 1: 'there' });
  });

  it('keeps the freeform fallback byte-identical to the documented template body', () => {
    // If these drift, the two pairing paths say different things depending on
    // whether an env var happens to be set. Pin them together.
    const fs = require('fs');
    const doc = fs.readFileSync(`${__dirname}/../../docs/whatsapp-welcome-template.md`, 'utf8');
    const templateBody = doc.match(/### Body\n\n```\n([\s\S]*?)\n```/)[1];

    expect(whatsapp.buildWelcomeBody('Grant').body)
      .toBe(templateBody.replace('{{1}}', 'Grant'));
  });
});
