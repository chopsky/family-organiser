import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../lib/api';
import { useAuth } from '../context/AuthContext';
import {
  IconFolder, IconFileText, IconPlus, IconUpload, IconDownload,
  IconTrash, IconLock, IconEye, IconGrid, IconList, IconX,
  IconChevronRight, IconArrowLeft,
} from '../components/Icons';

/* ─── Constants ─── */

const FOLDER_COLORS = [
  '#6B3FA0', '#E8724A', '#7DAE82', '#E0A458', '#4A9FCC',
  '#9050B5', '#3AADA0', '#C74E95', '#3A9E6E', '#7A8694',
];

const FILE_ICONS = {
  pdf: { emoji: '', color: '#E25555', label: 'PDF' },
  image: { emoji: '', color: '#4A9FCC', label: 'Image' },
  document: { emoji: '', color: '#6B3FA0', label: 'Doc' },
  spreadsheet: { emoji: '', color: '#3A9E6E', label: 'Sheet' },
  default: { emoji: '', color: '#7A8694', label: 'File' },
};

function getFileCategory(mimeType) {
  if (!mimeType) return 'default';
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.includes('word') || mimeType.includes('document')) return 'document';
  if (mimeType.includes('sheet') || mimeType.includes('excel') || mimeType.includes('csv')) return 'spreadsheet';
  return 'default';
}

function formatFileSize(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
  return `${size.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/* ─── Main Component ─── */

export default function Documents() {
  const { user } = useAuth();
  const [folders, setFolders] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [breadcrumbs, setBreadcrumbs] = useState([]); // [{id, name}, ...]
  const [currentFolder, setCurrentFolder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [viewMode, setViewMode] = useState('grid');
  const [usage, setUsage] = useState(null);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [editingFolder, setEditingFolder] = useState(null);
  const [previewDoc, setPreviewDoc] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const fileInputRef = useRef(null);

  // ─── Data Fetching ──────────────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const folderId = currentFolder?.id || null;
      const params = folderId ? { folder_id: folderId } : {};
      const folderParams = folderId ? { parent_id: folderId } : {};

      // Use allSettled so a single failing endpoint (e.g. during deploy)
      // doesn't break the whole page
      const [foldersRes, docsRes, usageRes] = await Promise.allSettled([
        api.get('/documents/folders', { params: folderParams }),
        api.get('/documents', { params }),
        api.get('/documents/usage'),
      ]);

      const rawFolders = foldersRes.status === 'fulfilled' ? foldersRes.value.data : [];
      const rawDocs = docsRes.status === 'fulfilled' ? docsRes.value.data : [];
      setFolders(Array.isArray(rawFolders) ? rawFolders : []);
      setDocuments(Array.isArray(rawDocs) ? rawDocs : []);
      setUsage(usageRes.status === 'fulfilled' ? usageRes.value.data : null);

      // Only show an error if ALL three calls failed with a real error
      // (not 404 — 404 usually means the backend hasn't finished deploying)
      const failures = [foldersRes, docsRes, usageRes].filter(r => r.status === 'rejected');
      const allFailed = failures.length === 3;
      const nonNotFoundFailure = failures.find(f => f.reason?.response?.status !== 404);

      if (allFailed && nonNotFoundFailure) {
        setError(nonNotFoundFailure.reason?.response?.data?.error || 'Failed to load documents');
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load documents');
    } finally {
      setLoading(false);
    }
  }, [currentFolder]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ─── Navigation ─────────────────────────────────────────────────────────

  function navigateToFolder(folder) {
    setBreadcrumbs(prev => [...prev, { id: folder.id, name: folder.name }]);
    setCurrentFolder(folder);
  }

  function navigateUp(index) {
    if (index < 0) {
      // Go to root
      setBreadcrumbs([]);
      setCurrentFolder(null);
    } else {
      const target = breadcrumbs[index];
      setBreadcrumbs(prev => prev.slice(0, index + 1));
      setCurrentFolder(target);
    }
  }

  // ─── Folder Actions ─────────────────────────────────────────────────────

  async function handleCreateFolder(data) {
    try {
      await api.post('/documents/folders', {
        ...data,
        parent_folder_id: currentFolder?.id || null,
      });
      setShowNewFolder(false);
      fetchData();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create folder');
    }
  }

  async function handleUpdateFolder(folderId, data) {
    try {
      await api.patch(`/documents/folders/${folderId}`, data);
      setEditingFolder(null);
      fetchData();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update folder');
    }
  }

  async function handleDeleteFolder(folderId) {
    if (!confirm('Delete this folder and all its contents? This cannot be undone.')) return;
    try {
      await api.delete(`/documents/folders/${folderId}`);
      fetchData();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to delete folder');
    }
  }

  // ─── File Actions ───────────────────────────────────────────────────────

  async function handleUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      if (currentFolder?.id) formData.append('folder_id', currentFolder.id);

      await api.post('/documents/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      fetchData();
    } catch (err) {
      const data = err.response?.data;
      const msg = data?.detail
        ? `${data.error || 'Upload failed'}: ${data.detail}`
        : (data?.error || 'Failed to upload file');
      setError(msg);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleDownload(doc) {
    try {
      const { data } = await api.get(`/documents/${doc.id}/url`);
      window.open(data.url, '_blank');
    } catch (err) {
      setError('Failed to get download link');
    }
  }

  async function handlePreview(doc) {
    try {
      const { data } = await api.get(`/documents/${doc.id}/url`);
      setPreviewDoc(doc);
      setPreviewUrl(data.url);
    } catch (err) {
      setError('Failed to load preview');
    }
  }

  async function handleDeleteDocument(docId) {
    if (!confirm('Delete this document? This cannot be undone.')) return;
    try {
      await api.delete(`/documents/${docId}`);
      fetchData();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to delete document');
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h1
          className="hidden md:flex text-[38px] font-normal leading-none text-bark items-center gap-2"
          style={{ fontFamily: '"Instrument Serif", Georgia, "Times New Roman", serif' }}
        >
          <IconFileText className="h-6 w-6 text-plum" /> Documents
        </h1>
        <div className="flex-1 md:hidden" />
        <button
          onClick={() => setViewMode(v => v === 'grid' ? 'list' : 'grid')}
          className="p-2 rounded-lg text-warm-grey hover:text-plum hover:bg-plum-light transition-colors"
          title={viewMode === 'grid' ? 'List view' : 'Grid view'}
        >
          {viewMode === 'grid' ? <IconList className="h-5 w-5" /> : <IconGrid className="h-5 w-5" />}
        </button>
      </div>

      {/* Storage bar */}
      {usage && <div className="mb-5"><StorageBar usage={usage} /></div>}

      {/* Breadcrumbs */}
      <Breadcrumbs breadcrumbs={breadcrumbs} onNavigate={navigateUp} />

      {/* Action buttons */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setShowNewFolder(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-white border-[1.5px] border-plum text-plum rounded-xl text-sm font-semibold hover:bg-plum-light transition-colors"
        >
          <IconPlus className="h-4 w-4" />
          New Folder
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-2 px-4 py-2.5 bg-plum text-white rounded-xl text-sm font-semibold hover:bg-plum/90 transition-colors disabled:opacity-50"
        >
          <IconUpload className="h-4 w-4" />
          {uploading ? 'Uploading...' : 'Upload File'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={handleUpload}
        />
      </div>

      {/* Error banner */}
      {error && (
        <div className="mb-4 p-3 bg-coral-light text-coral rounded-xl text-sm font-medium flex items-center justify-between">
          {error}
          <button onClick={() => setError('')} className="ml-2 text-coral hover:text-coral/80">
            <IconX className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Loading */}
      {loading ? (
        <div className="space-y-4">
          {[1,2,3].map(i => (
            <div key={i} className="h-20 bg-light-grey/40 rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : folders.length === 0 && documents.length === 0 ? (
        /* Empty state */
        <div className="text-center py-16">
          <IconFolder className="h-16 w-16 mx-auto text-light-grey mb-4" />
          <p className="text-warm-grey text-lg font-medium">No documents yet</p>
          <p className="text-warm-grey/70 text-sm mt-1">
            Create a folder or upload a file to get started
          </p>
        </div>
      ) : (
        <>
          {/* Folders */}
          {folders.length > 0 && (
            <div className="mb-6">
              <h2 className="text-xs font-semibold text-warm-grey uppercase tracking-wider mb-3">Folders</h2>
              <div className={viewMode === 'grid'
                ? 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3'
                : 'flex flex-col gap-2'
              }>
                {folders.map(folder => (
                  <FolderCard
                    key={folder.id}
                    folder={folder}
                    viewMode={viewMode}
                    userId={user?.id}
                    onOpen={() => navigateToFolder(folder)}
                    onEdit={() => setEditingFolder(folder)}
                    onDelete={() => handleDeleteFolder(folder.id)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Documents */}
          {documents.length > 0 && (
            <div>
              <h2 className="text-xs font-semibold text-warm-grey uppercase tracking-wider mb-3">Files</h2>
              <div className={viewMode === 'grid'
                ? 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3'
                : 'flex flex-col gap-2'
              }>
                {documents.map(doc => (
                  <DocumentCard
                    key={doc.id}
                    doc={doc}
                    viewMode={viewMode}
                    onPreview={() => handlePreview(doc)}
                    onDownload={() => handleDownload(doc)}
                    onDelete={() => handleDeleteDocument(doc.id)}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* New Folder Modal */}
      {showNewFolder && (
        <NewFolderModal
          onSave={handleCreateFolder}
          onClose={() => setShowNewFolder(false)}
        />
      )}

      {/* Edit Folder Modal */}
      {editingFolder && (
        <NewFolderModal
          folder={editingFolder}
          onSave={(data) => handleUpdateFolder(editingFolder.id, data)}
          onClose={() => setEditingFolder(null)}
        />
      )}

      {/* File Preview Modal */}
      {previewDoc && (
        <FilePreviewModal
          doc={previewDoc}
          url={previewUrl}
          onClose={() => { setPreviewDoc(null); setPreviewUrl(''); }}
          onDownload={() => window.open(previewUrl, '_blank')}
        />
      )}
    </div>
  );
}

/* ─── Storage Bar ──────────────────────────────────────────────────────────── */

function StorageBar({ usage }) {
  const pct = Math.min((usage.totalBytes / usage.limitBytes) * 100, 100);
  const usedLabel = formatFileSize(usage.totalBytes);
  const limitLabel = formatFileSize(usage.limitBytes);

  return (
    <div className="mt-2">
      <div className="flex items-center justify-between text-[11px] text-warm-grey mb-1">
        <span>{usedLabel} / {limitLabel} used</span>
        <span>{usage.fileCount} / {usage.limitFiles} files</span>
      </div>
      <div className="h-1.5 bg-light-grey rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{
            width: `${pct}%`,
            backgroundColor: pct > 90 ? '#E8724A' : pct > 70 ? '#E0A458' : '#6B3FA0',
          }}
        />
      </div>
    </div>
  );
}

/* ─── Breadcrumbs ──────────────────────────────────────────────────────────── */

function Breadcrumbs({ breadcrumbs, onNavigate }) {
  if (breadcrumbs.length === 0) return null;

  return (
    <div className="flex items-center gap-1 mb-4 overflow-x-auto pb-1">
      <button
        onClick={() => onNavigate(-1)}
        className="flex items-center gap-1 text-sm text-plum hover:text-plum/80 font-medium shrink-0"
      >
        <IconArrowLeft className="h-4 w-4" />
        All Documents
      </button>
      {breadcrumbs.map((crumb, i) => (
        <span key={crumb.id} className="flex items-center gap-1 shrink-0">
          <IconChevronRight className="h-3 w-3 text-warm-grey" />
          {i === breadcrumbs.length - 1 ? (
            <span className="text-sm font-medium text-charcoal">{crumb.name}</span>
          ) : (
            <button
              onClick={() => onNavigate(i)}
              className="text-sm text-plum hover:text-plum/80 font-medium"
            >
              {crumb.name}
            </button>
          )}
        </span>
      ))}
    </div>
  );
}

/* ─── Folder Card ──────────────────────────────────────────────────────────── */

function FolderCard({ folder, viewMode, userId, onOpen, onEdit, onDelete }) {
  const isPrivate = folder.visibility === 'private';

  if (viewMode === 'list') {
    return (
      <div className="flex items-center gap-3 bg-white rounded-2xl shadow-sm hover:shadow-md transition-shadow px-4 py-3 cursor-pointer group" onClick={onOpen}>
        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: folder.color + '20' }}>
          <IconFolder className="h-5 w-5" style={{ color: folder.color }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-charcoal truncate">{folder.name}</span>
            {isPrivate && <IconLock className="h-3.5 w-3.5 text-plum shrink-0" />}
          </div>
          <span className="text-[11px] text-warm-grey">{folder.file_count || 0} files</span>
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
          <button onClick={onEdit} className="p-1.5 rounded-lg text-warm-grey hover:text-plum hover:bg-plum-light transition-colors" title="Edit">
            <IconFileText className="h-4 w-4" />
          </button>
          <button onClick={onDelete} className="p-1.5 rounded-lg text-warm-grey hover:text-coral hover:bg-coral-light transition-colors" title="Delete">
            <IconTrash className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm hover:shadow-md transition-shadow p-4 cursor-pointer group relative" onClick={onOpen}>
      <div className="flex items-start justify-between mb-3">
        <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ backgroundColor: folder.color + '20' }}>
          <IconFolder className="h-6 w-6" style={{ color: folder.color }} />
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
          <button onClick={onEdit} className="p-1 rounded-lg text-warm-grey hover:text-plum hover:bg-plum-light transition-colors">
            <IconFileText className="h-3.5 w-3.5" />
          </button>
          <button onClick={onDelete} className="p-1 rounded-lg text-warm-grey hover:text-coral hover:bg-coral-light transition-colors">
            <IconTrash className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-sm font-semibold text-charcoal truncate">{folder.name}</span>
        {isPrivate && <IconLock className="h-3 w-3 text-plum shrink-0" />}
      </div>
      <span className="text-[11px] text-warm-grey">{folder.file_count || 0} files</span>
    </div>
  );
}

/* ─── Document Card ────────────────────────────────────────────────────────── */

function DocumentCard({ doc, viewMode, onPreview, onDownload, onDelete }) {
  const cat = getFileCategory(doc.mime_type);
  const fileInfo = FILE_ICONS[cat];
  const isImage = cat === 'image' && doc.preview_url;

  if (viewMode === 'list') {
    return (
      <div className="flex items-center gap-3 bg-white rounded-2xl shadow-sm hover:shadow-md transition-shadow px-4 py-3 group">
        <div
          className="w-10 h-10 rounded-xl overflow-hidden flex items-center justify-center shrink-0 cursor-pointer"
          style={isImage ? undefined : { backgroundColor: fileInfo.color + '15' }}
          onClick={onPreview}
        >
          {isImage ? (
            <img
              src={doc.preview_url}
              alt={doc.name}
              loading="lazy"
              decoding="async"
              className="w-full h-full object-cover"
            />
          ) : (
            <FileTypeIcon mimeType={doc.mime_type} color={fileInfo.color} />
          )}
        </div>
        <div className="flex-1 min-w-0 cursor-pointer" onClick={onPreview}>
          <span className="text-sm font-semibold text-charcoal truncate block">{doc.name}</span>
          <span className="text-[11px] text-warm-grey">
            {formatFileSize(doc.file_size)} &middot; {formatDate(doc.created_at)}
          </span>
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={onDownload} className="p-1.5 rounded-lg text-warm-grey hover:text-plum hover:bg-plum-light transition-colors" title="Download">
            <IconDownload className="h-4 w-4" />
          </button>
          <button onClick={onDelete} className="p-1.5 rounded-lg text-warm-grey hover:text-coral hover:bg-coral-light transition-colors" title="Delete">
            <IconTrash className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  // Grid view
  return (
    <div className="bg-white rounded-2xl shadow-sm hover:shadow-md transition-shadow overflow-hidden group relative flex flex-col">
      {isImage ? (
        <div
          className="aspect-[4/3] bg-cream cursor-pointer overflow-hidden relative"
          onClick={onPreview}
        >
          <img
            src={doc.preview_url}
            alt={doc.name}
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover"
          />
          <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
            <button onClick={onDownload} className="p-1.5 rounded-lg bg-white/90 text-warm-grey hover:text-plum shadow-sm">
              <IconDownload className="h-3.5 w-3.5" />
            </button>
            <button onClick={onDelete} className="p-1.5 rounded-lg bg-white/90 text-warm-grey hover:text-coral shadow-sm">
              <IconTrash className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ) : (
        <div className="p-4">
          <div className="flex items-start justify-between mb-3">
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center cursor-pointer"
              style={{ backgroundColor: fileInfo.color + '15' }}
              onClick={onPreview}
            >
              <FileTypeIcon mimeType={doc.mime_type} color={fileInfo.color} />
            </div>
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button onClick={onDownload} className="p-1 rounded-lg text-warm-grey hover:text-plum hover:bg-plum-light transition-colors">
                <IconDownload className="h-3.5 w-3.5" />
              </button>
              <button onClick={onDelete} className="p-1 rounded-lg text-warm-grey hover:text-coral hover:bg-coral-light transition-colors">
                <IconTrash className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}
      <div className={`${isImage ? 'px-4 py-3' : 'px-4 pb-4'}`}>
        <span className="text-sm font-semibold text-charcoal truncate block cursor-pointer" onClick={onPreview}>{doc.name}</span>
        <span className="text-[11px] text-warm-grey">
          {formatFileSize(doc.file_size)} &middot; {formatDate(doc.created_at)}
        </span>
      </div>
    </div>
  );
}

/* ─── File Type Icon ───────────────────────────────────────────────────────── */

function FileTypeIcon({ mimeType, color }) {
  const cat = getFileCategory(mimeType);
  const label = FILE_ICONS[cat].label;

  return (
    <div className="flex flex-col items-center justify-center">
      <IconFileText className="h-5 w-5" style={{ color }} />
      <span className="text-[8px] font-bold mt-0.5" style={{ color }}>{label}</span>
    </div>
  );
}

/* ─── New Folder Modal ─────────────────────────────────────────────────────── */

function NewFolderModal({ folder, onSave, onClose }) {
  const [name, setName] = useState(folder?.name || '');
  const [visibility, setVisibility] = useState(folder?.visibility || 'shared');
  const [color, setColor] = useState(folder?.color || '#6B3FA0');

  function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    onSave({ name: name.trim(), visibility, color });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-charcoal/40 px-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-lg w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-display text-lg font-semibold text-charcoal">
            {folder ? 'Edit Folder' : 'New Folder'}
          </h2>
          <button onClick={onClose} className="text-warm-grey hover:text-charcoal transition-colors">
            <IconX className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name */}
          <div>
            <label className="block text-[13px] font-medium text-charcoal mb-1.5">Folder name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. School Letters"
              className="w-full px-3 py-2.5 border-[1.5px] border-light-grey bg-cream rounded-[10px] text-sm text-charcoal focus:border-plum focus:ring-1 focus:ring-plum/20 outline-none transition-colors"
              autoFocus
            />
          </div>

          {/* Visibility */}
          <div>
            <label className="block text-[13px] font-medium text-charcoal mb-1.5">Visibility</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setVisibility('shared')}
                className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors border-[1.5px] ${
                  visibility === 'shared'
                    ? 'border-plum bg-plum-light text-plum'
                    : 'border-light-grey text-warm-grey hover:border-plum/30'
                }`}
              >
                <IconEye className="h-4 w-4" />
                Shared
              </button>
              <button
                type="button"
                onClick={() => setVisibility('private')}
                className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors border-[1.5px] ${
                  visibility === 'private'
                    ? 'border-plum bg-plum-light text-plum'
                    : 'border-light-grey text-warm-grey hover:border-plum/30'
                }`}
              >
                <IconLock className="h-4 w-4" />
                Private
              </button>
            </div>
          </div>

          {/* Color */}
          <div>
            <label className="block text-[13px] font-medium text-charcoal mb-1.5">Color</label>
            <div className="flex gap-2 flex-wrap">
              {FOLDER_COLORS.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`w-8 h-8 rounded-full transition-all ${
                    color === c ? 'ring-2 ring-offset-2 ring-plum scale-110' : 'hover:scale-105'
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          {/* Submit */}
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 bg-white border-[1.5px] border-light-grey text-warm-grey rounded-xl text-sm font-semibold hover:bg-cream transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2.5 bg-plum text-white rounded-xl text-sm font-semibold hover:bg-plum/90 transition-colors"
            >
              {folder ? 'Save Changes' : 'Create Folder'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ─── File Preview Modal ───────────────────────────────────────────────────── */

function FilePreviewModal({ doc, url, onClose, onDownload }) {
  const cat = getFileCategory(doc.mime_type);
  const isImage = cat === 'image';
  const isPdf = cat === 'pdf';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-charcoal/60 px-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-lg w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-light-grey">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-charcoal truncate">{doc.name}</h3>
            <p className="text-[11px] text-warm-grey">{formatFileSize(doc.file_size)}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={onDownload}
              className="flex items-center gap-1.5 px-3 py-2 bg-plum text-white rounded-xl text-xs font-semibold hover:bg-plum/90 transition-colors"
            >
              <IconDownload className="h-3.5 w-3.5" />
              Download
            </button>
            <button onClick={onClose} className="p-2 text-warm-grey hover:text-charcoal transition-colors">
              <IconX className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-cream/50">
          {isImage ? (
            <img src={url} alt={doc.name} className="max-w-full max-h-[70vh] rounded-lg object-contain" />
          ) : isPdf ? (
            <iframe src={url} className="w-full h-[70vh] rounded-lg border border-light-grey" title={doc.name} />
          ) : (
            <div className="text-center py-12">
              <IconFileText className="h-16 w-16 mx-auto text-light-grey mb-4" />
              <p className="text-warm-grey text-sm mb-4">Preview not available for this file type</p>
              <button
                onClick={onDownload}
                className="flex items-center gap-2 mx-auto px-5 py-2.5 bg-plum text-white rounded-xl text-sm font-semibold hover:bg-plum/90 transition-colors"
              >
                <IconDownload className="h-4 w-4" />
                Download File
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
