const {
  stripQuotedAndForwardedNoise,
  extractEmailContent,
  htmlToText,
} = require('./email-parser');

describe('stripQuotedAndForwardedNoise', () => {
  test('keeps the forwarded payload and its header fields', () => {
    const input = [
      'Hi - can you add this to the calendar please?',
      '',
      '---------- Forwarded message ----------',
      'From: Springfield Primary <office@school.test>',
      'Sent: 14 May 2026',
      'Subject: Sports Day',
      '',
      'Sports Day is on Friday 19 June 2026 at 9:30am on the school field.',
    ].join('\n');
    const out = stripQuotedAndForwardedNoise(input);
    expect(out).toContain('Sports Day is on Friday 19 June 2026');
    expect(out).toContain('From: Springfield Primary');
    expect(out).toContain('Subject: Sports Day');
    // Decorative banner rule removed, content preserved.
    expect(out).not.toMatch(/-{3,}\s*forwarded message\s*-{3,}/i);
  });

  test('strips a standard signature block (-- delimiter)', () => {
    const input = [
      'Dentist appointment for Mia on 3 July 2026 at 4pm.',
      '',
      '-- ',
      'Jane Smith',
      'Mobile: 07700 900000',
      'Sent from my iPhone',
    ].join('\n');
    const out = stripQuotedAndForwardedNoise(input);
    expect(out).toContain('Dentist appointment for Mia on 3 July 2026 at 4pm.');
    expect(out).not.toContain('Jane Smith');
    expect(out).not.toContain('07700 900000');
  });

  test('strips a "Sent from my iPhone" tagline even without a sig delimiter', () => {
    const input = 'Parents evening 12 June, 6pm.\n\nSent from my iPhone';
    const out = stripQuotedAndForwardedNoise(input);
    expect(out).toBe('Parents evening 12 June, 6pm.');
  });

  test('strips a confidentiality disclaimer block', () => {
    const input = [
      'Your booking is confirmed for 20 August 2026, 7pm, Table for 4.',
      '',
      'This email and any attachments are confidential and intended solely for the addressee.',
      'If you have received this in error, please delete it.',
    ].join('\n');
    const out = stripQuotedAndForwardedNoise(input);
    expect(out).toContain('Your booking is confirmed for 20 August 2026');
    expect(out).not.toContain('confidential and intended solely');
  });

  test('strips a marketing / unsubscribe footer', () => {
    const input = [
      'Class photos will be taken on 5 October.',
      '',
      'You received this email because you subscribed to our newsletter.',
      'Unsubscribe | Manage preferences',
      '© 2026 SchoolComms Ltd. All rights reserved.',
    ].join('\n');
    const out = stripQuotedAndForwardedNoise(input);
    expect(out).toContain('Class photos will be taken on 5 October.');
    expect(out).not.toMatch(/unsubscribe/i);
    expect(out).not.toMatch(/all rights reserved/i);
  });

  test('removes inline-image placeholders', () => {
    const input = 'Swimming gala [image: logo.png] on 9 September at 2pm. [cid:banner@01D]';
    const out = stripQuotedAndForwardedNoise(input);
    expect(out).not.toMatch(/\[image:/i);
    expect(out).not.toMatch(/\[cid:/i);
    expect(out).toContain('Swimming gala');
    expect(out).toContain('9 September');
  });

  test('does not nuke a top-posted body when "--" appears with little above it', () => {
    // A "-- " near the very top (e.g. user typed a dashy separator) should
    // NOT cut the substantial content below it.
    const input = '--\nReal content: school trip on 1 July 2026, packed lunch needed.';
    const out = stripQuotedAndForwardedNoise(input);
    expect(out).toContain('school trip on 1 July 2026');
  });

  test('falls back to the original when cleaning would empty it', () => {
    const input = 'Unsubscribe from these emails';
    const out = stripQuotedAndForwardedNoise(input);
    // The whole thing looks like a footer, but it's all we have - keep it.
    expect(out.length).toBeGreaterThan(0);
  });

  test('handles empty / nullish input', () => {
    expect(stripQuotedAndForwardedNoise('')).toBe('');
    expect(stripQuotedAndForwardedNoise(null)).toBe('');
    expect(stripQuotedAndForwardedNoise(undefined)).toBe('');
  });
});

describe('extractEmailContent integration', () => {
  test('applies noise stripping to the extracted body', () => {
    const payload = {
      Subject: 'Sports Day',
      From: 'Jane <jane@example.test>',
      TextBody:
        'Sports Day is on 19 June 2026 at 9:30am.\n\n-- \nJane Smith\nSent from my iPhone',
    };
    const { text } = extractEmailContent(payload);
    expect(text).toContain('Sports Day is on 19 June 2026 at 9:30am.');
    expect(text).not.toContain('Jane Smith');
    expect(text).not.toMatch(/sent from my iphone/i);
  });
});

describe('htmlToText (unchanged behaviour sanity)', () => {
  test('preserves table cell structure', () => {
    const html = '<table><tr><td>Milk</td><td>£1.20</td></tr></table>';
    const out = htmlToText(html);
    expect(out).toContain('Milk');
    expect(out).toContain('£1.20');
  });
});
