import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../lib/api';
import { confirmDestructive } from '../lib/action-sheet';
import PageHeader from '../components/ui/PageHeader';
import PillBtn from '../components/ui/PillBtn';
import {
  IconFolder, IconFileText, IconPlus, IconUpload, IconDownload,
  IconTrash, IconLock, IconEye, IconX, IconMore, IconEdit,
  IconChevronRight, IconArrowLeft,
} from '../components/Icons';

/* ─── Constants ─── */

// Soft warm sand for inset surfaces / row hover / progress track. We have no
// exact theme token for this neutral, so it's shared as a literal across the
// redesigned pages (matches AfterSchoolCard's SOFT).
const SOFT = '#F3EEE5';
const CARD_SHADOW = '0 1px 0 rgba(26,22,32,0.02), 0 4px 14px rgba(26,22,32,0.03)';

const FOLDER_COLORS = [
  '#6B3FA0', '#E8724A', '#7DAE82', '#E0A458', '#4A9FCC',
  '#9050B5', '#3AADA0', '#C74E95', '#3A9E6E', '#7A8694',
];

const FILE_ICONS = {
  pdf: { color: '#E25555', label: 'PDF' },
  image: { color: '#4A9FCC', label: 'Image' },
  document: { color: '#6B3FA0', label: 'Doc' },
  spreadsheet: { color: '#3A9E6E', label: 'Sheet' },
  default: { color: '#7A8694', label: 'File' },
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

// "Today" / "Yesterday" / "3 days ago" / "12 Apr" - the design's flavour.
function whenLabel(iso) {
  if (!iso) return '';
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '';
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(new Date()) - startOfDay(then)) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return then.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/* ─── Main Component ─── */

export default function Documents() {
  const [folders, setFolders] = useState([]);
  const [files, setFiles] = useState([]); // current folder's files, or recent-across-household at root
  const [breadcrumbs, setBreadcrumbs] = useState([]); // [{id, name}, ...]
  const [currentFolder, setCurrentFolder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [usage, setUsage] = useState(null);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [editingFolder, setEditingFolder] = useState(null);
  const [renamingDoc, setRenamingDoc] = useState(null);
  const [previewDoc, setPreviewDoc] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const fileInputRef = useRef(null);

  const atRoot = !currentFolder;

  // ─── Data Fetching ──────────────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const folderId = currentFolder?.id || null;
      const folderParams = folderId ? { parent_id: folderId } : {};

      // At root, the file list is "Recently added" across every folder; inside
      // a folder it's that folder's files. allSettled so one failing endpoint
      // (e.g. mid-deploy) doesn't blank the whole page.
      const [foldersRes, filesRes, usageRes] = await Promise.allSettled([
        api.get('/documents/folders', { params: folderParams }),
        folderId
          ? api.get('/documents', { params: { folder_id: folderId } })
          : api.get('/documents/recent', { params: { limit: 8 } }),
        api.get('/documents/usage'),
      ]);

      const rawFolders = foldersRes.status === 'fulfilled' ? foldersRes.value.data : [];
      const rawFiles = filesRes.status === 'fulfilled' ? filesRes.value.data : [];
      setFolders(Array.isArray(rawFolders) ? rawFolders : []);
      setFiles(Array.isArray(rawFiles) ? rawFiles : []);
      setUsage(usageRes.status === 'fulfilled' ? usageRes.value.data : null);

      const failures = [foldersRes, filesRes, usageRes].filter(r => r.status === 'rejected');
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
      await api.post('/documents/folders', { ...data, parent_folder_id: currentFolder?.id || null });
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
    const ok = await confirmDestructive({
      title: 'Delete this folder?',
      message: 'Every document inside will also be deleted. This cannot be undone.',
      confirmLabel: 'Delete folder',
    });
    if (!ok) return;
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
    } catch {
      setError('Failed to get download link');
    }
  }

  async function handlePreview(doc) {
    try {
      const { data } = await api.get(`/documents/${doc.id}/url`);
      setPreviewDoc(doc);
      setPreviewUrl(data.url);
    } catch {
      setError('Failed to load preview');
    }
  }

  async function handleRenameDocument(docId, name) {
    try {
      await api.patch(`/documents/${docId}`, { name });
      setRenamingDoc(null);
      fetchData();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to rename document');
    }
  }

  async function handleDeleteDocument(docId) {
    const ok = await confirmDestructive({
      title: 'Delete this document?',
      message: 'This cannot be undone.',
    });
    if (!ok) return;
    try {
      await api.delete(`/documents/${docId}`);
      fetchData();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to delete document');
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────────

  const totalFiles = usage?.fileCount ?? 0;
  const kicker = `${totalFiles} ${totalFiles === 1 ? 'file' : 'files'} · ${folders.length} ${folders.length === 1 ? 'folder' : 'folders'}`;
  const empty = !loading && folders.length === 0 && files.length === 0;

  return (
    <div className="max-w-[1160px] mx-auto pb-24">
      <PageHeader
        kicker={kicker}
        title="Documents"
        subtitle="Everything the household needs, in one safe place."
        actions={<>
          <PillBtn icon={<IconPlus className="h-3.5 w-3.5" />} onClick={() => setShowNewFolder(true)}>
            New folder
          </PillBtn>
          <PillBtn
            primary
            icon={<IconUpload className="h-3.5 w-3.5" />}
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? 'Uploading…' : 'Upload'}
          </PillBtn>
        </>}
      />

      {/* Hidden file input. The `accept` list MUST stay in sync with the
          server allowlist in src/utils/fileValidation.js (UX only - the
          server rejects anything off-list regardless). */}
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept=".pdf,.txt,.csv,.png,.jpg,.jpeg,.gif,.webp,.heic,.docx,.xlsx,.pptx,.doc,.xls,.ppt"
        onChange={handleUpload}
      />

      {usage && <div className="mb-5"><StorageBar usage={usage} /></div>}

      <Breadcrumbs breadcrumbs={breadcrumbs} onNavigate={navigateUp} />

      {error && (
        <div className="mb-4 p-3 bg-coral-light text-coral rounded-xl text-sm font-medium flex items-center justify-between">
          {error}
          <button onClick={() => setError('')} aria-label="Dismiss error" className="ml-2 text-coral hover:text-coral/80">
            <IconX className="h-4 w-4" />
          </button>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-[104px] rounded-2xl animate-pulse" style={{ background: SOFT }} />
          ))}
        </div>
      ) : empty ? (
        <div className="text-center py-16">
          <IconFolder className="h-16 w-16 mx-auto text-light-grey mb-4" />
          <p className="text-warm-grey text-lg font-medium">No documents yet</p>
          <p className="text-warm-grey/70 text-sm mt-1">Create a folder or upload a file to get started</p>
        </div>
      ) : (
        <>
          {/* Folder grid */}
          {folders.length > 0 && (
            <div className="grid gap-4 mb-9" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
              {folders.map(folder => (
                <FolderCard
                  key={folder.id}
                  folder={folder}
                  onOpen={() => navigateToFolder(folder)}
                  onEdit={() => setEditingFolder(folder)}
                  onDelete={() => handleDeleteFolder(folder.id)}
                />
              ))}
            </div>
          )}

          {/* Files list */}
          {files.length > 0 && (
            <>
              <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-warm-grey mb-3.5">
                {atRoot ? 'Recently added' : 'Files'}
              </div>
              {/* No overflow-hidden here - it would clip a row's ⋯ menu when
                  it drops below a short card. First/last rows round their own
                  corners instead so the hover tint still matches the card. */}
              <div
                className="bg-white rounded-[18px] border border-light-grey"
                style={{ boxShadow: CARD_SHADOW }}
              >
                {files.map((doc, i) => (
                  <DocumentRow
                    key={doc.id}
                    doc={doc}
                    showFolder={atRoot}
                    isFirst={i === 0}
                    isLast={i === files.length - 1}
                    onPreview={() => handlePreview(doc)}
                    onDownload={() => handleDownload(doc)}
                    onRename={() => setRenamingDoc(doc)}
                    onDelete={() => handleDeleteDocument(doc.id)}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}

      {showNewFolder && (
        <NewFolderModal onSave={handleCreateFolder} onClose={() => setShowNewFolder(false)} />
      )}
      {editingFolder && (
        <NewFolderModal
          folder={editingFolder}
          onSave={(data) => handleUpdateFolder(editingFolder.id, data)}
          onClose={() => setEditingFolder(null)}
        />
      )}
      {renamingDoc && (
        <RenameModal
          doc={renamingDoc}
          onSave={(name) => handleRenameDocument(renamingDoc.id, name)}
          onClose={() => setRenamingDoc(null)}
        />
      )}
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
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] text-warm-grey mb-1">
        <span>{formatFileSize(usage.totalBytes)} / {formatFileSize(usage.limitBytes)} used</span>
        <span>{usage.fileCount} / {usage.limitFiles} files</span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: SOFT }}>
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${pct}%`, backgroundColor: pct > 90 ? '#E8724A' : pct > 70 ? '#E0A458' : '#6B3FA0' }}
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
        All documents
      </button>
      {breadcrumbs.map((crumb, i) => (
        <span key={crumb.id} className="flex items-center gap-1 shrink-0">
          <IconChevronRight className="h-3 w-3 text-warm-grey" />
          {i === breadcrumbs.length - 1 ? (
            <span className="text-sm font-medium text-charcoal">{crumb.name}</span>
          ) : (
            <button onClick={() => onNavigate(i)} className="text-sm text-plum hover:text-plum/80 font-medium">
              {crumb.name}
            </button>
          )}
        </span>
      ))}
    </div>
  );
}

/* ─── Folder Card ──────────────────────────────────────────────────────────── */

function FolderCard({ folder, onOpen, onEdit, onDelete }) {
  const isPrivate = folder.visibility === 'private';
  const color = folder.color || '#6B3FA0';

  return (
    <div
      className="group relative bg-white rounded-2xl border border-light-grey p-[18px] cursor-pointer transition-all hover:-translate-y-0.5"
      style={{ boxShadow: 'none' }}
      onMouseOver={(e) => { e.currentTarget.style.boxShadow = '0 8px 22px rgba(26,22,32,0.08)'; }}
      onMouseOut={(e) => { e.currentTarget.style.boxShadow = 'none'; }}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
    >
      <div className="flex items-start justify-between mb-4">
        <div
          className="w-12 h-12 rounded-[13px] flex items-center justify-center"
          style={{ backgroundColor: color + '1F' }}
        >
          <IconFolder className="h-6 w-6" style={{ color }} />
        </div>
        <div
          className="flex items-center gap-0.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={onEdit}
            aria-label={`Edit ${folder.name}`}
            className="p-1.5 rounded-lg text-warm-grey hover:text-plum hover:bg-plum-light transition-colors"
          >
            <IconEdit className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onDelete}
            aria-label={`Delete ${folder.name}`}
            className="p-1.5 rounded-lg text-warm-grey hover:text-coral hover:bg-coral-light transition-colors"
          >
            <IconTrash className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-[15px] font-bold text-charcoal truncate">{folder.name}</span>
        {isPrivate && <IconLock className="h-3 w-3 text-plum shrink-0" />}
      </div>
      <div className="text-xs text-warm-grey mt-0.5">{folder.file_count || 0} files</div>
    </div>
  );
}

/* ─── File Glyph ───────────────────────────────────────────────────────────── */

function FileGlyph({ doc }) {
  const cat = getFileCategory(doc.mime_type);
  const color = FILE_ICONS[cat].color;
  const isImage = cat === 'image' && doc.preview_url;

  return (
    <div
      className="w-10 h-10 rounded-[10px] shrink-0 overflow-hidden flex items-center justify-center"
      style={{ background: isImage ? undefined : color + '1F', color }}
    >
      {isImage ? (
        <img src={doc.preview_url} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
      ) : cat === 'image' ? (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="9.5" r="1.5" /><path d="M21 16l-5-5-9 9" />
        </svg>
      ) : (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" />
        </svg>
      )}
    </div>
  );
}

/* ─── Document Row ─────────────────────────────────────────────────────────── */

function DocumentRow({ doc, showFolder, isFirst, isLast, onPreview, onDownload, onRename, onDelete }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const folderName = doc.folder?.name;
  const sub = showFolder && folderName
    ? `${folderName} · ${formatFileSize(doc.file_size)}`
    : formatFileSize(doc.file_size);

  return (
    <div
      className={`flex items-center gap-3.5 px-5 py-3.5 transition-colors ${isFirst ? 'rounded-t-[18px]' : ''} ${isLast ? 'rounded-b-[18px]' : ''}`}
      style={{ borderBottom: isLast ? 'none' : '1px solid var(--color-light-grey)' }}
      onMouseOver={(e) => { e.currentTarget.style.background = SOFT; }}
      onMouseOut={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      <button onClick={onPreview} aria-label={`Preview ${doc.name}`} className="shrink-0">
        <FileGlyph doc={doc} />
      </button>
      <button onClick={onPreview} className="flex-1 min-w-0 text-left">
        <div className="text-sm font-semibold text-charcoal truncate">{doc.name}</div>
        <div className="text-xs text-warm-grey mt-0.5 truncate">{sub}</div>
      </button>
      <div className="text-xs text-warm-grey shrink-0">{whenLabel(doc.created_at)}</div>

      {/* Overflow menu */}
      <div className="relative shrink-0">
        <button
          onClick={() => setMenuOpen(o => !o)}
          aria-label={`Actions for ${doc.name}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-warm-grey hover:text-charcoal hover:bg-light-grey/60 transition-colors"
        >
          <IconMore className="h-4 w-4" />
        </button>
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} aria-hidden="true" />
            <div
              role="menu"
              className="absolute right-0 z-50 mt-1 min-w-[150px] bg-white rounded-xl border border-light-grey p-1.5"
              style={{ top: '100%', boxShadow: '0 8px 24px rgba(26,22,32,0.12)' }}
            >
              <MenuItem icon={<IconDownload className="h-3.5 w-3.5" />} onClick={() => { setMenuOpen(false); onDownload(); }}>
                Download
              </MenuItem>
              <MenuItem icon={<IconEdit className="h-3.5 w-3.5" />} onClick={() => { setMenuOpen(false); onRename(); }}>
                Rename
              </MenuItem>
              <MenuItem icon={<IconTrash className="h-3.5 w-3.5" />} danger onClick={() => { setMenuOpen(false); onDelete(); }}>
                Delete
              </MenuItem>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function MenuItem({ icon, children, onClick, danger }) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-3 py-2 text-left rounded-lg text-[13px] transition-colors ${
        danger ? 'text-coral hover:bg-coral-light' : 'text-charcoal hover:bg-cream'
      }`}
    >
      {icon}{children}
    </button>
  );
}

/* ─── Rename Modal ─────────────────────────────────────────────────────────── */

function RenameModal({ doc, onSave, onClose }) {
  const [name, setName] = useState(doc.name || '');

  function handleSubmit(e) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    onSave(trimmed);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-charcoal/40 px-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-lg w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-display text-lg font-medium text-charcoal">Rename file</h2>
          <button onClick={onClose} aria-label="Close" className="text-warm-grey hover:text-charcoal transition-colors">
            <IconX className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            className="w-full px-3 py-2.5 border-[1.5px] border-light-grey bg-cream rounded-[10px] text-sm text-charcoal focus:border-plum focus:ring-1 focus:ring-plum/20 outline-none transition-colors"
            autoFocus
          />
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2.5 bg-white border-[1.5px] border-light-grey text-warm-grey rounded-xl text-sm font-semibold hover:bg-cream transition-colors">
              Cancel
            </button>
            <button type="submit" className="flex-1 px-4 py-2.5 bg-plum text-white rounded-xl text-sm font-semibold hover:bg-plum/90 transition-colors">
              Save
            </button>
          </div>
        </form>
      </div>
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
          <h2 className="font-display text-lg font-medium text-charcoal">{folder ? 'Edit folder' : 'New folder'}</h2>
          <button onClick={onClose} aria-label="Close" className="text-warm-grey hover:text-charcoal transition-colors">
            <IconX className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[13px] font-medium text-charcoal mb-1.5">Folder name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. School letters"
              className="w-full px-3 py-2.5 border-[1.5px] border-light-grey bg-cream rounded-[10px] text-sm text-charcoal focus:border-plum focus:ring-1 focus:ring-plum/20 outline-none transition-colors"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-[13px] font-medium text-charcoal mb-1.5">Visibility</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setVisibility('shared')}
                className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors border-[1.5px] ${
                  visibility === 'shared' ? 'border-plum bg-plum-light text-plum' : 'border-light-grey text-warm-grey hover:border-plum/30'
                }`}
              >
                <IconEye className="h-4 w-4" /> Shared
              </button>
              <button
                type="button"
                onClick={() => setVisibility('private')}
                className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors border-[1.5px] ${
                  visibility === 'private' ? 'border-plum bg-plum-light text-plum' : 'border-light-grey text-warm-grey hover:border-plum/30'
                }`}
              >
                <IconLock className="h-4 w-4" /> Private
              </button>
            </div>
          </div>

          <div>
            <label className="block text-[13px] font-medium text-charcoal mb-1.5">Colour</label>
            <div className="flex gap-2 flex-wrap">
              {FOLDER_COLORS.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  aria-label={`Colour ${c}`}
                  className={`w-8 h-8 rounded-full transition-all ${color === c ? 'ring-2 ring-offset-2 ring-plum scale-110' : 'hover:scale-105'}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2.5 bg-white border-[1.5px] border-light-grey text-warm-grey rounded-xl text-sm font-semibold hover:bg-cream transition-colors">
              Cancel
            </button>
            <button type="submit" className="flex-1 px-4 py-2.5 bg-plum text-white rounded-xl text-sm font-semibold hover:bg-plum/90 transition-colors">
              {folder ? 'Save changes' : 'Create folder'}
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
        <div className="flex items-center justify-between px-5 py-4 border-b border-light-grey">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-charcoal truncate">{doc.name}</h3>
            <p className="text-[11px] text-warm-grey">{formatFileSize(doc.file_size)}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={onDownload} className="flex items-center gap-1.5 px-3 py-2 bg-plum text-white rounded-xl text-xs font-semibold hover:bg-plum/90 transition-colors">
              <IconDownload className="h-3.5 w-3.5" /> Download
            </button>
            <button onClick={onClose} aria-label="Close" className="p-2 text-warm-grey hover:text-charcoal transition-colors">
              <IconX className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-cream/50">
          {isImage ? (
            <img src={url} alt={doc.name} className="max-w-full max-h-[70vh] rounded-lg object-contain" />
          ) : isPdf ? (
            <iframe src={url} sandbox="allow-popups" className="w-full h-[70vh] rounded-lg border border-light-grey" title={doc.name} />
          ) : (
            <div className="text-center py-12">
              <IconFileText className="h-16 w-16 mx-auto text-light-grey mb-4" />
              <p className="text-warm-grey text-sm mb-4">Preview not available for this file type</p>
              <button onClick={onDownload} className="flex items-center gap-2 mx-auto px-5 py-2.5 bg-plum text-white rounded-xl text-sm font-semibold hover:bg-plum/90 transition-colors">
                <IconDownload className="h-4 w-4" /> Download file
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
