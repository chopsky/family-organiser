const OpenAI = require('openai');
const { toFile } = require('openai');

/**
 * Transcribe an audio buffer using OpenAI Whisper.
 *
 * @param {Buffer} audioBuffer - Raw audio data (OGG Opus from Telegram voice notes)
 * @param {string} [filename='voice.ogg'] - Filename hint for the MIME type detection
 * @returns {Promise<string>} Transcribed text
 */
async function transcribeVoice(audioBuffer, filename = 'voice.ogg') {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey === 'your_openai_api_key_here') {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  const client = new OpenAI({ apiKey });

  // Determine MIME type from filename
  const mimeType = filename.endsWith('.mp3') ? 'audio/mpeg'
    : filename.endsWith('.mp4') ? 'audio/mp4'
    : filename.endsWith('.m4a') ? 'audio/mp4'
    : filename.endsWith('.wav') ? 'audio/wav'
    : filename.endsWith('.webm') ? 'audio/webm'
    : 'audio/ogg'; // default: Telegram voice notes are OGG Opus

  const file = await toFile(audioBuffer, filename, { type: mimeType });

  const transcription = await client.audio.transcriptions.create({
    file,
    model: 'whisper-1',
  });

  return transcription.text.trim();
}

module.exports = { transcribeVoice };
