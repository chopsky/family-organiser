/**
 * Cloudflare R2 storage service (S3-compatible).
 *
 * Handles file upload, deletion, and signed URL generation
 * for the family documents feature.
 */

const { S3Client, PutObjectCommand, DeleteObjectCommand, DeleteObjectsCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { GetObjectCommand } = require('@aws-sdk/client-s3');

// Trim credentials to defend against stray whitespace/newlines when pasting
// into Railway / .env — the AWS SDK rejects the Authorization header if the
// secret contains a \n, producing "Invalid character in header content".
const ACCOUNT_ID = process.env.R2_ACCOUNT_ID?.trim();
const ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID?.trim();
const SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY?.trim();
const BUCKET = (process.env.R2_BUCKET_NAME || 'housemait-documents').trim();

const client = ACCOUNT_ID
  ? new S3Client({
      region: 'auto',
      endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: ACCESS_KEY_ID,
        secretAccessKey: SECRET_ACCESS_KEY,
      },
      // R2 doesn't support the newer default "when_supported" checksum
      // behavior added in @aws-sdk/client-s3 ≥3.729. Forcing both to
      // "when_required" avoids R2 returning 501 Not Implemented.
      requestChecksumCalculation: 'when_required',
      responseChecksumValidation: 'when_required',
    })
  : null;

function ensureClient() {
  if (!client) {
    throw new Error('R2 is not configured — set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY');
  }
}

/**
 * Upload a file to R2.
 * @param {string} key - Storage path (e.g. "{householdId}/{folderId}/{uuid}-filename.pdf")
 * @param {Buffer} buffer - File contents
 * @param {string} contentType - MIME type
 */
async function uploadFile(key, buffer, contentType) {
  ensureClient();
  await client.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  }));
}

/**
 * Delete a single file from R2.
 * @param {string} key - Storage path
 */
async function deleteFile(key) {
  ensureClient();
  await client.send(new DeleteObjectCommand({
    Bucket: BUCKET,
    Key: key,
  }));
}

/**
 * Delete multiple files from R2 in a single request.
 * @param {string[]} keys - Array of storage paths
 */
async function deleteFiles(keys) {
  if (!keys.length) return;
  ensureClient();
  // R2 supports up to 1000 objects per DeleteObjects call
  const batches = [];
  for (let i = 0; i < keys.length; i += 1000) {
    batches.push(keys.slice(i, i + 1000));
  }
  for (const batch of batches) {
    await client.send(new DeleteObjectsCommand({
      Bucket: BUCKET,
      Delete: {
        Objects: batch.map(Key => ({ Key })),
        Quiet: true,
      },
    }));
  }
}

/**
 * Generate a signed URL for downloading a file.
 * @param {string} key - Storage path
 * @param {number} expiresIn - Seconds until URL expires (default 3600 = 1 hour)
 * @returns {Promise<string>} Signed URL
 */
async function getSignedDownloadUrl(key, expiresIn = 3600) {
  ensureClient();
  return getSignedUrl(client, new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
  }), { expiresIn });
}

module.exports = { uploadFile, deleteFile, deleteFiles, getSignedDownloadUrl };
