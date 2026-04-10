/**
 * Documents routes — family file storage with folders and Cloudflare R2 backend.
 */

const { Router } = require('express');
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const db = require('../db/queries');
const r2 = require('../services/r2');
const { requireAuth, requireHousehold } = require('../middleware/auth');

const router = Router();

// 25 MB file size limit — any file type accepted
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

// Storage limits
const MAX_STORAGE_BYTES = 10 * 1024 * 1024 * 1024; // 10 GB per household
const MAX_FILES = 500;

// ─── Folders ──────────────────────────────────────────────────────────────────

/**
 * GET /api/documents/folders?parent_id=<uuid>
 * List folders at a given level (root if no parent_id).
 */
router.get('/folders', requireAuth, requireHousehold, async (req, res) => {
  try {
    const folders = await db.getDocumentFolders(req.householdId, req.user.id, req.query.parent_id || null);
    return res.json(folders);
  } catch (err) {
    console.error('GET /api/documents/folders error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/documents/folders
 * Create a new folder.
 */
router.post('/folders', requireAuth, requireHousehold, async (req, res) => {
  try {
    const { name, visibility, color, icon, parent_folder_id } = req.body;
    if (!name?.trim()) {
      return res.status(400).json({ error: 'Folder name is required' });
    }

    // If creating inside a private folder, inherit private visibility
    if (parent_folder_id) {
      const parentFolder = await db.getDocumentFolderById(parent_folder_id, req.householdId);
      if (!parentFolder) return res.status(404).json({ error: 'Parent folder not found' });
      if (parentFolder.visibility === 'private' && parentFolder.created_by !== req.user.id) {
        return res.status(403).json({ error: 'Cannot create folder inside another user\'s private folder' });
      }
    }

    const folder = await db.createDocumentFolder(req.householdId, {
      name: name.trim(),
      visibility: visibility || 'shared',
      created_by: req.user.id,
      parent_folder_id: parent_folder_id || null,
      color: color || '#6B3FA0',
      icon: icon || 'folder',
    });
    return res.status(201).json(folder);
  } catch (err) {
    console.error('POST /api/documents/folders error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PATCH /api/documents/folders/:id
 * Update a folder (name, visibility, color, icon, parent).
 */
router.patch('/folders/:id', requireAuth, requireHousehold, async (req, res) => {
  try {
    const folder = await db.getDocumentFolderById(req.params.id, req.householdId);
    if (!folder) return res.status(404).json({ error: 'Folder not found' });

    // Only the creator or an admin can update private folders
    if (folder.visibility === 'private' && folder.created_by !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'You can only edit your own private folders' });
    }

    const updated = await db.updateDocumentFolder(req.params.id, req.householdId, req.body);
    return res.json(updated);
  } catch (err) {
    console.error('PATCH /api/documents/folders/:id error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/documents/folders/:id
 * Delete a folder, its sub-folders, and all associated R2 files.
 */
router.delete('/folders/:id', requireAuth, requireHousehold, async (req, res) => {
  try {
    const folder = await db.getDocumentFolderById(req.params.id, req.householdId);
    if (!folder) return res.status(404).json({ error: 'Folder not found' });

    if (folder.visibility === 'private' && folder.created_by !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'You can only delete your own private folders' });
    }

    // Get all descendant folder IDs (including this one)
    const allFolderIds = await db.getDescendantFolderIds(req.params.id);

    // Get all documents in those folders to clean up R2 storage
    const docs = await db.getDocumentsByFolderIds(allFolderIds);
    if (docs.length > 0) {
      const keys = docs.map(d => d.file_path);
      try {
        await r2.deleteFiles(keys);
      } catch (r2Err) {
        console.error('R2 batch delete error (continuing with DB delete):', r2Err.message);
      }
    }

    // CASCADE on parent_folder_id handles sub-folder deletion;
    // ON DELETE SET NULL on documents.folder_id orphans docs (but we already cleaned them up)
    // Delete documents first, then the folder tree
    for (const doc of docs) {
      await db.deleteDocument(doc.id, req.householdId);
    }
    await db.deleteDocumentFolder(req.params.id, req.householdId);

    return res.json({ deleted: true, filesRemoved: docs.length });
  } catch (err) {
    console.error('DELETE /api/documents/folders/:id error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Documents ────────────────────────────────────────────────────────────────

/**
 * GET /api/documents/usage
 * Get storage usage for the household.
 */
router.get('/usage', requireAuth, requireHousehold, async (req, res) => {
  try {
    const usage = await db.getHouseholdStorageUsage(req.householdId);
    return res.json({
      ...usage,
      limitBytes: MAX_STORAGE_BYTES,
      limitFiles: MAX_FILES,
    });
  } catch (err) {
    console.error('GET /api/documents/usage error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/documents?folder_id=<uuid>
 * List documents in a folder (root if no folder_id).
 */
router.get('/', requireAuth, requireHousehold, async (req, res) => {
  try {
    const docs = await db.getDocuments(req.householdId, req.user.id, req.query.folder_id || null);

    // Attach a signed preview URL for image documents so the frontend can
    // render thumbnails. Signing is cheap (HMAC only — no network), and the
    // browser lazy-loads the actual image bytes only when the card scrolls
    // into view. URLs are valid for 1 hour which is plenty for a session.
    const withPreviews = await Promise.all(docs.map(async (doc) => {
      if (doc.mime_type?.startsWith('image/')) {
        try {
          const preview_url = await r2.getSignedDownloadUrl(doc.file_path, 3600);
          return { ...doc, preview_url };
        } catch {
          return doc;
        }
      }
      return doc;
    }));

    return res.json(withPreviews);
  } catch (err) {
    console.error('GET /api/documents error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/documents/upload
 * Upload a file to R2 and record in the database.
 */
router.post('/upload', requireAuth, requireHousehold, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded. Use field name "file".' });
  }

  try {
    // Check storage quota
    const usage = await db.getHouseholdStorageUsage(req.householdId);
    if (usage.totalBytes + req.file.size > MAX_STORAGE_BYTES) {
      return res.status(413).json({
        error: 'Storage limit reached (10 GB per household)',
        usage: { ...usage, limitBytes: MAX_STORAGE_BYTES },
      });
    }
    if (usage.fileCount >= MAX_FILES) {
      return res.status(413).json({
        error: `File limit reached (${MAX_FILES} files per household)`,
        usage: { ...usage, limitFiles: MAX_FILES },
      });
    }

    // If uploading to a folder, verify access
    const folderId = req.body.folder_id || null;
    if (folderId) {
      const folder = await db.getDocumentFolderById(folderId, req.householdId);
      if (!folder) return res.status(404).json({ error: 'Folder not found' });
      if (folder.visibility === 'private' && folder.created_by !== req.user.id) {
        return res.status(403).json({ error: 'Cannot upload to another user\'s private folder' });
      }
    }

    // Build storage key
    const ext = path.extname(req.file.originalname || '').toLowerCase();
    const safeFilename = req.file.originalname
      ? req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')
      : `file${ext}`;
    const storageKey = `${req.householdId}/${folderId || 'root'}/${crypto.randomUUID()}-${safeFilename}`;

    // Upload to R2
    await r2.uploadFile(storageKey, req.file.buffer, req.file.mimetype);

    // Record in database
    const doc = await db.createDocument(req.householdId, {
      name: req.file.originalname || safeFilename,
      file_path: storageKey,
      file_size: req.file.size,
      mime_type: req.file.mimetype,
      uploaded_by: req.user.id,
      folder_id: folderId,
    });

    return res.status(201).json(doc);
  } catch (err) {
    console.error('POST /api/documents/upload error:', err.message);
    console.error('  stack:', err.stack);
    console.error('  name:', err.name);
    if (err.$metadata) console.error('  S3 metadata:', JSON.stringify(err.$metadata));
    if (err.Code) console.error('  S3 code:', err.Code);
    // Surface the real error message in non-production for debugging
    return res.status(500).json({
      error: 'Upload failed',
      detail: err.message || 'Unknown error',
    });
  }
});

/**
 * GET /api/documents/:id/url
 * Get a signed download URL (valid for 1 hour).
 */
router.get('/:id/url', requireAuth, requireHousehold, async (req, res) => {
  try {
    const doc = await db.getDocumentById(req.params.id, req.householdId);
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    // Check visibility
    if (doc.folder?.visibility === 'private' && doc.folder.created_by !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const url = await r2.getSignedDownloadUrl(doc.file_path, 3600);
    return res.json({ url, expiresIn: 3600 });
  } catch (err) {
    console.error('GET /api/documents/:id/url error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PATCH /api/documents/:id
 * Move or rename a document.
 */
router.patch('/:id', requireAuth, requireHousehold, async (req, res) => {
  try {
    const doc = await db.getDocumentById(req.params.id, req.householdId);
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    // If moving to a private folder, check access
    if (req.body.folder_id) {
      const targetFolder = await db.getDocumentFolderById(req.body.folder_id, req.householdId);
      if (!targetFolder) return res.status(404).json({ error: 'Target folder not found' });
      if (targetFolder.visibility === 'private' && targetFolder.created_by !== req.user.id) {
        return res.status(403).json({ error: 'Cannot move to another user\'s private folder' });
      }
    }

    const updated = await db.updateDocument(req.params.id, req.householdId, req.body);
    return res.json(updated);
  } catch (err) {
    console.error('PATCH /api/documents/:id error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/documents/:id
 * Delete a document from R2 and the database.
 */
router.delete('/:id', requireAuth, requireHousehold, async (req, res) => {
  try {
    const doc = await db.getDocumentById(req.params.id, req.householdId);
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    // Check visibility
    if (doc.folder?.visibility === 'private' && doc.folder.created_by !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Delete from R2
    try {
      await r2.deleteFile(doc.file_path);
    } catch (r2Err) {
      console.error('R2 delete error (continuing with DB delete):', r2Err.message);
    }

    // Delete from database
    await db.deleteDocument(req.params.id, req.householdId);
    return res.json({ deleted: true });
  } catch (err) {
    console.error('DELETE /api/documents/:id error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
