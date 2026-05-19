const { normaliseWhatsAppPhone } = require('./phone-normalise');

describe('normaliseWhatsAppPhone', () => {
  it('returns empty string for empty input', () => {
    expect(normaliseWhatsAppPhone('', 'ZA')).toBe('');
    expect(normaliseWhatsAppPhone(null, 'ZA')).toBe('');
  });

  it('keeps a clean E.164 number as-is', () => {
    expect(normaliseWhatsAppPhone('+27833586883', 'ZA')).toBe('+27833586883');
  });

  it('strips formatting from an E.164 number', () => {
    expect(normaliseWhatsAppPhone('+27 83 358 6883', 'ZA')).toBe('+27833586883');
    expect(normaliseWhatsAppPhone('+44 7700 900000', 'GB')).toBe('+447700900000');
  });

  it('expands a SA national-format number to E.164', () => {
    // The exact bug from the logs: user typed "0833586883" and Twilio
    // refused "+0833586883".
    expect(normaliseWhatsAppPhone('0833586883', 'ZA')).toBe('+27833586883');
    expect(normaliseWhatsAppPhone('083 358 6883', 'ZA')).toBe('+27833586883');
  });

  it('expands a UK national-format number to E.164', () => {
    expect(normaliseWhatsAppPhone('07700900000', 'GB')).toBe('+447700900000');
    expect(normaliseWhatsAppPhone('07700 900000', 'GB')).toBe('+447700900000');
  });

  it('converts 00 international prefix to +', () => {
    expect(normaliseWhatsAppPhone('0027833586883', 'ZA')).toBe('+27833586883');
    expect(normaliseWhatsAppPhone('0044 7700 900000', 'GB')).toBe('+447700900000');
  });

  it('prepends + to a number that already has the country code but no +', () => {
    expect(normaliseWhatsAppPhone('27833586883', 'ZA')).toBe('+27833586883');
    expect(normaliseWhatsAppPhone('447700900000', 'GB')).toBe('+447700900000');
  });

  it('falls back to dial code for a pure local number with no trunk prefix', () => {
    // US users often type just "5551234567" without any prefix.
    expect(normaliseWhatsAppPhone('5551234567', 'US')).toBe('+15551234567');
  });

  it('defaults to GB dial code when country is unknown', () => {
    expect(normaliseWhatsAppPhone('07700900000', undefined)).toBe('+447700900000');
    expect(normaliseWhatsAppPhone('07700900000', 'XX')).toBe('+447700900000');
  });

  it('handles various punctuation', () => {
    expect(normaliseWhatsAppPhone('(083) 358-6883', 'ZA')).toBe('+27833586883');
    expect(normaliseWhatsAppPhone('083.358.6883', 'ZA')).toBe('+27833586883');
  });
});
