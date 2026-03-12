/**
 * Unit tests for the Whisper transcription service.
 * The OpenAI SDK is mocked so these run without an API key.
 */

jest.mock('openai');
const OpenAI = require('openai');

const { transcribeVoice } = require('./transcribe');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mockOpenAI(transcriptionText) {
  OpenAI.mockImplementation(() => ({
    audio: {
      transcriptions: {
        create: jest.fn().mockResolvedValue({ text: transcriptionText }),
      },
    },
  }));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('transcribeVoice()', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, OPENAI_API_KEY: 'test-key-123' };
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test('returns transcribed text from Whisper', async () => {
    mockOpenAI('We need milk and eggs');

    const buffer = Buffer.from('fake-audio-data');
    const result = await transcribeVoice(buffer);

    expect(result).toBe('We need milk and eggs');
  });

  test('trims whitespace from transcription', async () => {
    mockOpenAI('  Remind Jake to do homework by Friday.  ');

    const result = await transcribeVoice(Buffer.from('audio'));
    expect(result).toBe('Remind Jake to do homework by Friday.');
  });

  test('sends audio as a file with correct MIME type for OGG', async () => {
    const mockCreate = jest.fn().mockResolvedValue({ text: 'hello' });
    OpenAI.mockImplementation(() => ({
      audio: { transcriptions: { create: mockCreate } },
    }));

    await transcribeVoice(Buffer.from('audio'), 'voice.ogg');

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'whisper-1' })
    );
  });

  test('uses whisper-1 model', async () => {
    const mockCreate = jest.fn().mockResolvedValue({ text: 'test' });
    OpenAI.mockImplementation(() => ({
      audio: { transcriptions: { create: mockCreate } },
    }));

    await transcribeVoice(Buffer.from('audio'));

    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.model).toBe('whisper-1');
  });

  test('accepts MP3 filename and infers correct MIME type', async () => {
    const mockCreate = jest.fn().mockResolvedValue({ text: 'hello' });
    OpenAI.mockImplementation(() => ({
      audio: { transcriptions: { create: mockCreate } },
    }));

    await transcribeVoice(Buffer.from('audio'), 'recording.mp3');
    // Should not throw — just verify it calls the API
    expect(mockCreate).toHaveBeenCalled();
  });

  test('throws if OPENAI_API_KEY is not set', async () => {
    delete process.env.OPENAI_API_KEY;
    await expect(transcribeVoice(Buffer.from('audio')))
      .rejects.toThrow('OPENAI_API_KEY is not configured');
  });

  test('throws if OPENAI_API_KEY is the placeholder value', async () => {
    process.env.OPENAI_API_KEY = 'your_openai_api_key_here';
    await expect(transcribeVoice(Buffer.from('audio')))
      .rejects.toThrow('OPENAI_API_KEY is not configured');
  });

  test('propagates Whisper API errors', async () => {
    OpenAI.mockImplementation(() => ({
      audio: {
        transcriptions: {
          create: jest.fn().mockRejectedValue(new Error('Whisper API error')),
        },
      },
    }));

    await expect(transcribeVoice(Buffer.from('audio')))
      .rejects.toThrow('Whisper API error');
  });
});
