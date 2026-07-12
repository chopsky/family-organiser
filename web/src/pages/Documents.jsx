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
  const [usage, setUsage] = useState(null); // file/folder counts for the header kicker
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [uploadProgress, setUploadProgress] = useState(null); // {done, total} while uploading
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [editingFolder, setEditingFolder] = useState(null);
  const [renamingDoc, setRenamingDoc] = useState(null);
  const [movingDocs, setMovingDocs] = useState(null); // array of docs (1 = row menu, N = bulk)
  // Multi-select: checkboxes on rows + a floating Move/Delete bar.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [previewDoc, setPreviewDoc] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [showNewNote, setShowNewNote] = useState(false);
  const [editingNote, setEditingNote] = useState(null); // note row being edited
  // Search spans the WHOLE household (file names + note bodies) regardless of
  // the folder being viewed. null = not searching; [] = no results.
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [searchTotal, setSearchTotal] = useState(0);
  // Root file list: "Recent" (default) or the paginated "All files" browser.
  const [rootTab, setRootTab] = useState('recent');
  const [sort, setSort] = useState('newest');
  const [allFiles, setAllFiles] = useState([]);
  const [allHasMore, setAllHasMore] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  const atRoot = !currentFolder;
  const uploading = uploadProgress !== null;
  const searching = searchResults !== null;

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

  // Debounced global search - file names AND note bodies, every folder.
  useEffect(() => {
    const q = search.trim();
    if (!q) { setSearchResults(null); return undefined; }
    const t = setTimeout(async () => {
      try {
        const { data } = await api.get('/documents/search', { params: { q, limit: 50 } });
        setSearchResults(Array.isArray(data.items) ? data.items : []);
        setSearchTotal(data.total || 0);
      } catch {
        setSearchResults([]);
        setSearchTotal(0);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  // "All files" browser at root: paginated, sortable, spans every folder.
  const fetchAllFiles = useCallback(async (offset) => {
    try {
      const { data } = await api.get('/documents/search', { params: { sort, offset, limit: 30 } });
      const items = Array.isArray(data.items) ? data.items : [];
      setAllFiles(prev => (offset === 0 ? items : [...prev, ...items]));
      setAllHasMore(!!data.hasMore);
    } catch {
      if (offset === 0) setAllFiles([]);
      setAllHasMore(false);
    }
  }, [sort]);

  useEffect(() => {
    if (atRoot && rootTab === 'all') fetchAllFiles(0);
  }, [atRoot, rootTab, fetchAllFiles]);

  // One refresh for every mutation: the folder view always, plus whichever
  // global views (search / All files) are currently showing.
  const refresh = useCallback(() => {
    fetchData();
    if (atRoot && rootTab === 'all') fetchAllFiles(0);
    if (search.trim()) {
      api.get('/documents/search', { params: { q: search.trim(), limit: 50 } })
        .then(({ data }) => {
          setSearchResults(Array.isArray(data.items) ? data.items : []);
          setSearchTotal(data.total || 0);
        })
        .catch(() => {});
    }
  }, [fetchData, atRoot, rootTab, fetchAllFiles, search]);

  // Leaving the current list (folder change, tab flip, search on/off) drops
  // the selection - stale ids from an invisible list must never be acted on.
  useEffect(() => {
    setSelectMode(false);
    setSelectedIds(new Set());
  }, [currentFolder, rootTab, searching]);

  function toggleSelected(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelectedIds(new Set());
  }

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
      refresh();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create folder');
    }
  }

  async function handleUpdateFolder(folderId, data) {
    try {
      await api.patch(`/documents/folders/${folderId}`, data);
      setEditingFolder(null);
      refresh();
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
      refresh();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to delete folder');
    }
  }

  // ─── File Actions ───────────────────────────────────────────────────────

  // One uploader for the picker AND drag-drop; takes a FileList, uploads
  // sequentially (the server validates one file per request) and reports
  // per-file failures without abandoning the rest of the batch.
  async function uploadFiles(fileList) {
    const filesArr = Array.from(fileList || []);
    if (!filesArr.length) return;
    setUploadProgress({ done: 0, total: filesArr.length });
    setError('');
    const failed = [];
    for (let i = 0; i < filesArr.length; i++) {
      const file = filesArr[i];
      try {
        const formData = new FormData();
        formData.append('file', file);
        if (currentFolder?.id) formData.append('folder_id', currentFolder.id);
        await api.post('/documents/upload', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      } catch (err) {
        const data = err.response?.data;
        failed.push(`${file.name} (${data?.detail || data?.error || 'failed'})`);
      }
      setUploadProgress({ done: i + 1, total: filesArr.length });
    }
    if (failed.length) {
      setError(`Couldn't upload ${failed.length === 1 ? '' : `${failed.length} files, e.g. `}${failed[0]}`);
    }
    setUploadProgress(null);
    refresh();
  }

  function handleUpload(e) {
    uploadFiles(e.target.files);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function handleMoveDocuments(docIds, folderId) {
    const results = await Promise.allSettled(
      docIds.map((id) => api.patch(`/documents/${id}`, { folder_id: folderId })),
    );
    const failed = results.filter((r) => r.status === 'rejected');
    setMovingDocs(null);
    exitSelectMode();
    if (failed.length) {
      setError(failed.length === docIds.length
        ? (failed[0].reason?.response?.data?.error || 'Failed to move')
        : `Moved ${docIds.length - failed.length}, but ${failed.length} failed`);
    }
    refresh();
  }

  async function handleDeleteDocuments(docIds) {
    const ok = await confirmDestructive({
      title: `Delete ${docIds.length} item${docIds.length === 1 ? '' : 's'}?`,
      message: 'This cannot be undone.',
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    const results = await Promise.allSettled(
      docIds.map((id) => api.delete(`/documents/${id}`)),
    );
    const failed = results.filter((r) => r.status === 'rejected').length;
    exitSelectMode();
    if (failed) setError(`Deleted ${docIds.length - failed}, but ${failed} failed`);
    refresh();
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
      refresh();
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
      refresh();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to delete document');
    }
  }

  // ─── Note Actions ───────────────────────────────────────────────────────

  async function handleCreateNote({ title, body, folder_id }) {
    try {
      await api.post('/documents/notes', { title, body, folder_id: folder_id || null });
      setShowNewNote(false);
      refresh();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save note');
    }
  }

  async function handleUpdateNote(noteId, { title, body, folder_id }) {
    try {
      await api.patch(`/documents/${noteId}`, { name: title, body, folder_id: folder_id || null });
      setEditingNote(null);
      refresh();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save note');
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────────

  const totalFiles = usage?.fileCount ?? 0;
  const kicker = `${totalFiles} ${totalFiles === 1 ? 'file' : 'files'} · ${folders.length} ${folders.length === 1 ? 'folder' : 'folders'}`;
  const empty = !loading && folders.length === 0 && files.length === 0;

  return (
    <div
      className="max-w-[1160px] mx-auto pb-24 relative"
      onDragOver={(e) => {
        if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); setDragOver(true); }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget)) return;
        setDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer?.files?.length) uploadFiles(e.dataTransfer.files);
      }}
    >
      {dragOver && (
        <div className="absolute inset-0 z-40 rounded-2xl border-2 border-dashed border-plum bg-plum-light/70 flex items-center justify-center pointer-events-none">
          <div className="text-plum font-semibold text-sm flex items-center gap-2">
            <IconUpload className="h-5 w-5" />
            Drop files to upload{currentFolder ? ` to ${currentFolder.name}` : ''}
          </div>
        </div>
      )}
      <PageHeader
        kicker={kicker}
        title="Documents"
        actions={<>
          <PillBtn icon={<IconPlus className="h-3.5 w-3.5" />} onClick={() => setShowNewFolder(true)}>
            New folder
          </PillBtn>
          <PillBtn icon={<IconFileText className="h-3.5 w-3.5" />} onClick={() => setShowNewNote(true)}>
            New note
          </PillBtn>
          <PillBtn
            primary
            icon={<IconUpload className="h-3.5 w-3.5" />}
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? `Uploading ${uploadProgress.done}/${uploadProgress.total}…` : 'Upload'}
          </PillBtn>
        </>}
      />

      {/* Hidden file input. The `accept` list MUST stay in sync with the
          server allowlist in src/utils/fileValidation.js (UX only - the
          server rejects anything off-list regardless). */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        accept=".pdf,.txt,.csv,.png,.jpg,.jpeg,.gif,.webp,.heic,.docx,.xlsx,.pptx,.doc,.xls,.ppt"
        onChange={handleUpload}
      />

      <Breadcrumbs breadcrumbs={breadcrumbs} onNavigate={navigateUp} />

      {/* Global search - spans every folder, matches file names + note bodies */}
      <div className="relative mb-5">
        <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-warm-grey pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
        </svg>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search all files and notes…"
          aria-label="Search documents"
          className="w-full pl-10 pr-9 py-2.5 border-[1.5px] border-light-grey bg-white rounded-xl text-sm text-charcoal placeholder:text-warm-grey focus:border-plum focus:ring-1 focus:ring-plum/20 outline-none transition-colors"
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            aria-label="Clear search"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-warm-grey hover:text-charcoal transition-colors"
          >
            <IconX className="h-4 w-4" />
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 p-3 bg-coral-light text-coral rounded-xl text-sm font-medium flex items-center justify-between">
          {error}
          <button onClick={() => setError('')} aria-label="Dismiss error" className="ml-2 text-coral hover:text-coral/80">
            <IconX className="h-4 w-4" />
          </button>
        </div>
      )}

      {searching ? (
        <>
          <div className="flex items-center justify-between mb-3.5">
            <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-warm-grey">
              {searchResults.length === 0
                ? 'No matches'
                : `${searchTotal} match${searchTotal === 1 ? '' : 'es'}${searchTotal > searchResults.length ? ` · showing ${searchResults.length}` : ''}`}
            </div>
            {searchResults.length > 0 && (
              <SelectToggle active={selectMode} onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))} />
            )}
          </div>
          {searchResults.length === 0 ? (
            <div className="text-center py-14">
              <p className="text-bark font-medium">Nothing matches &ldquo;{search.trim()}&rdquo;</p>
              <p className="text-warm-grey text-sm mt-1">Search covers every folder, file name and note.</p>
            </div>
          ) : (
            <div className="bg-white rounded-[18px] border border-light-grey" style={{ boxShadow: CARD_SHADOW }}>
              {searchResults.map((doc, i) => (
                <DocumentRow
                  key={doc.id}
                  doc={doc}
                  showFolder
                  isFirst={i === 0}
                  isLast={i === searchResults.length - 1}
                  selectMode={selectMode}
                  selected={selectedIds.has(doc.id)}
                  onToggleSelect={() => toggleSelected(doc.id)}
                  onPreview={() => handlePreview(doc)}
                  onDownload={() => handleDownload(doc)}
                  onRename={() => setRenamingDoc(doc)}
                  onMove={() => setMovingDocs([doc])}
                  onDelete={() => handleDeleteDocument(doc.id)}
                  onOpenNote={() => setEditingNote(doc)}
                />
              ))}
            </div>
          )}
        </>
      ) : loading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-[104px] rounded-2xl animate-pulse" style={{ background: SOFT }} />
          ))}
        </div>
      ) : empty ? (
        <div className="text-center py-16">
          <IconFolder className="h-16 w-16 mx-auto text-light-grey mb-4" />
          <p className="text-bark text-lg font-medium">Keep the documents that matter in one safe place</p>
          <p className="text-warm-grey text-sm mt-1.5">Upload a file or create a folder to get started.</p>
          <div className="flex flex-wrap justify-center gap-2 mt-5 max-w-md mx-auto">
            {['Medical records', 'Insurance policies', 'Passports', 'Warranties', 'School forms'].map((ex) => (
              <span key={ex} className="inline-flex items-center px-3 py-1.5 rounded-full bg-plum-light text-plum text-xs font-semibold">
                {ex}
              </span>
            ))}
          </div>
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

          {/* Files list. At root: Recent (quick glance) or All files (the
              full browser - paginated + sortable). Inside a folder: its files. */}
          {(() => {
            const showAll = atRoot && rootTab === 'all';
            const list = showAll ? allFiles : files;
            return (atRoot || list.length > 0) && (
            <>
              <div className="flex items-center justify-between mb-3.5">
                {atRoot ? (
                  <div className="flex items-center gap-1.5" role="tablist" aria-label="File list mode">
                    {[['recent', 'Recently added'], ['all', 'All files']].map(([key, label]) => (
                      <button
                        key={key}
                        role="tab"
                        aria-selected={rootTab === key}
                        onClick={() => setRootTab(key)}
                        className={`px-3 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-[0.1em] transition-colors ${
                          rootTab === key ? 'bg-plum-light text-plum' : 'text-warm-grey hover:text-charcoal'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-warm-grey">Files</div>
                )}
                <div className="flex items-center gap-2">
                {list.length > 0 && (
                  <SelectToggle active={selectMode} onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))} />
                )}
                {showAll && (
                  <select
                    value={sort}
                    onChange={(e) => setSort(e.target.value)}
                    aria-label="Sort files"
                    className="px-2.5 py-1.5 border-[1.5px] border-light-grey bg-white rounded-[10px] text-xs font-semibold text-charcoal outline-none focus:border-plum"
                  >
                    <option value="newest">Newest first</option>
                    <option value="name">Name A–Z</option>
                    <option value="largest">Largest first</option>
                  </select>
                )}
                </div>
              </div>
              {list.length === 0 ? (
                <p className="text-sm text-warm-grey py-4">
                  {showAll ? 'No files anywhere yet.' : 'Nothing here yet.'}
                </p>
              ) : (
              <div
                className="bg-white rounded-[18px] border border-light-grey"
                style={{ boxShadow: CARD_SHADOW }}
              >
                {list.map((doc, i) => (
                  <DocumentRow
                    key={doc.id}
                    doc={doc}
                    showFolder={atRoot}
                    isFirst={i === 0}
                    isLast={i === list.length - 1}
                    selectMode={selectMode}
                    selected={selectedIds.has(doc.id)}
                    onToggleSelect={() => toggleSelected(doc.id)}
                    onPreview={() => handlePreview(doc)}
                    onDownload={() => handleDownload(doc)}
                    onRename={() => setRenamingDoc(doc)}
                    onMove={() => setMovingDocs([doc])}
                    onDelete={() => handleDeleteDocument(doc.id)}
                    onOpenNote={() => setEditingNote(doc)}
                  />
                ))}
              </div>
              )}
              {showAll && allHasMore && (
                <button
                  onClick={() => fetchAllFiles(allFiles.length)}
                  className="mt-4 mx-auto block px-5 py-2.5 bg-white border-[1.5px] border-light-grey text-plum rounded-xl text-sm font-semibold hover:border-plum transition-colors"
                >
                  Load more
                </button>
              )}
            </>
            );
          })()}
        </>
      )}

      {selectMode && (() => {
        const visibleDocs = searching ? searchResults : (atRoot && rootTab === 'all' ? allFiles : files);
        const selectedDocs = (visibleDocs || []).filter((d) => selectedIds.has(d.id));
        return (
          <div className="fixed bottom-24 md:bottom-8 left-1/2 -translate-x-1/2 z-40 bg-charcoal text-white rounded-2xl px-4 py-2.5 flex items-center gap-1.5" style={{ boxShadow: '0 8px 24px rgba(26,22,32,0.25)' }}>
            <span className="text-sm font-semibold px-1.5 whitespace-nowrap">{selectedDocs.length} selected</span>
            <button
              onClick={() => setMovingDocs(selectedDocs)}
              disabled={selectedDocs.length === 0}
              className="px-3 py-2 rounded-xl text-sm font-semibold hover:bg-white/10 transition-colors disabled:opacity-40"
            >
              Move
            </button>
            <button
              onClick={() => handleDeleteDocuments(selectedDocs.map((d) => d.id))}
              disabled={selectedDocs.length === 0}
              className="px-3 py-2 rounded-xl text-sm font-semibold text-coral hover:bg-white/10 transition-colors disabled:opacity-40"
            >
              Delete
            </button>
            <button onClick={exitSelectMode} aria-label="Exit selection" className="p-2 rounded-xl hover:bg-white/10 transition-colors">
              <IconX className="h-4 w-4" />
            </button>
          </div>
        );
      })()}

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
      {movingDocs && (
        <MoveModal
          docs={movingDocs}
          onSave={(folderId) => handleMoveDocuments(movingDocs.map((d) => d.id), folderId)}
          onClose={() => setMovingDocs(null)}
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
      {showNewNote && (
        <NoteModal
          folders={folders}
          currentFolder={currentFolder}
          onSave={handleCreateNote}
          onClose={() => setShowNewNote(false)}
        />
      )}
      {editingNote && (
        <NoteModal
          note={editingNote}
          folders={folders}
          currentFolder={currentFolder}
          onSave={(data) => handleUpdateNote(editingNote.id, data)}
          onClose={() => setEditingNote(null)}
        />
      )}
    </div>
  );
}

function SelectToggle({ active, onClick }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`px-3 py-1.5 rounded-full text-xs font-semibold border-[1.5px] transition-colors ${
        active ? 'border-plum bg-plum-light text-plum' : 'border-light-grey text-warm-grey hover:border-plum hover:text-plum'
      }`}
    >
      {active ? 'Done' : 'Select'}
    </button>
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

function DocumentRow({ doc, showFolder, isFirst, isLast, selectMode, selected, onToggleSelect, onPreview, onDownload, onRename, onMove, onDelete, onOpenNote }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const isNote = doc.kind === 'note';
  const folderName = doc.folder?.name;
  const open = selectMode ? onToggleSelect : (isNote ? onOpenNote : onPreview);

  // Note sub-line: at root show its folder, otherwise a one-line body snippet.
  const snippet = (doc.body || '').replace(/\s+/g, ' ').trim();
  const sub = isNote
    ? (showFolder && folderName ? folderName : (snippet || 'Note'))
    : (showFolder && folderName ? `${folderName} · ${formatFileSize(doc.file_size)}` : formatFileSize(doc.file_size));

  return (
    <div
      className={`flex items-center gap-3.5 px-5 py-3.5 transition-colors ${isFirst ? 'rounded-t-[18px]' : ''} ${isLast ? 'rounded-b-[18px]' : ''}`}
      style={{ borderBottom: isLast ? 'none' : '1px solid var(--color-light-grey)' }}
      onMouseOver={(e) => { e.currentTarget.style.background = SOFT; }}
      onMouseOut={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      {selectMode && (
        <button
          onClick={onToggleSelect}
          role="checkbox"
          aria-checked={selected}
          aria-label={`Select ${doc.name}`}
          className={`w-5 h-5 rounded-md border-[1.5px] shrink-0 flex items-center justify-center transition-colors ${
            selected ? 'bg-plum border-plum' : 'border-light-grey bg-white'
          }`}
        >
          {selected && (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          )}
        </button>
      )}
      <button onClick={open} aria-label={selectMode ? `Select ${doc.name}` : `${isNote ? 'Open' : 'Preview'} ${doc.name}`} className="shrink-0">
        {isNote ? <NoteGlyph /> : <FileGlyph doc={doc} />}
      </button>
      <button onClick={open} className="flex-1 min-w-0 text-left">
        <div className="text-sm font-semibold text-charcoal truncate">{doc.name}</div>
        <div className="text-xs text-warm-grey mt-0.5 truncate">{sub}</div>
      </button>
      <div className="text-xs text-warm-grey shrink-0">{whenLabel(doc.created_at)}</div>

      {/* Overflow menu (hidden while selecting - the bulk bar owns actions) */}
      {!selectMode && (
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
              {isNote ? (
                <MenuItem icon={<IconEdit className="h-3.5 w-3.5" />} onClick={() => { setMenuOpen(false); onOpenNote(); }}>
                  Edit
                </MenuItem>
              ) : (
                <>
                  <MenuItem icon={<IconDownload className="h-3.5 w-3.5" />} onClick={() => { setMenuOpen(false); onDownload(); }}>
                    Download
                  </MenuItem>
                  <MenuItem icon={<IconEdit className="h-3.5 w-3.5" />} onClick={() => { setMenuOpen(false); onRename(); }}>
                    Rename
                  </MenuItem>
                </>
              )}
              {onMove && (
                <MenuItem icon={<IconFolder className="h-3.5 w-3.5" />} onClick={() => { setMenuOpen(false); onMove(); }}>
                  Move to folder
                </MenuItem>
              )}
              <MenuItem icon={<IconTrash className="h-3.5 w-3.5" />} danger onClick={() => { setMenuOpen(false); onDelete(); }}>
                Delete
              </MenuItem>
            </div>
          </>
        )}
      </div>
      )}
    </div>
  );
}

/* ─── Note Glyph ───────────────────────────────────────────────────────────── */

function NoteGlyph() {
  return (
    <div className="w-10 h-10 rounded-[10px] shrink-0 flex items-center justify-center" style={{ background: '#6B3FA01F', color: '#6B3FA0' }}>
      <IconFileText className="h-5 w-5" />
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

/* ─── Move Modal ───────────────────────────────────────────────────────────── */

function MoveModal({ docs, onSave, onClose }) {
  const [allFolders, setAllFolders] = useState(null); // null = loading
  const single = docs.length === 1 ? docs[0] : null;
  const [selected, setSelected] = useState(single?.folder_id || '');

  useEffect(() => {
    let cancelled = false;
    api.get('/documents/folders', { params: { all: '1' } })
      .then(({ data }) => { if (!cancelled) setAllFolders(Array.isArray(data) ? data : []); })
      .catch(() => { if (!cancelled) setAllFolders([]); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-charcoal/40 px-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-lg w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-display text-lg font-medium text-charcoal">Move to folder</h2>
          <button onClick={onClose} aria-label="Close" className="text-warm-grey hover:text-charcoal transition-colors">
            <IconX className="h-5 w-5" />
          </button>
        </div>
        <p className="text-xs text-warm-grey mb-4 truncate">
          {single ? single.name : `${docs.length} items`}
        </p>

        {allFolders === null ? (
          <div className="h-24 rounded-xl animate-pulse" style={{ background: SOFT }} />
        ) : (
          <div className="max-h-[45vh] overflow-y-auto -mx-2 px-2 space-y-1">
            <FolderChoice
              label="No folder (top level)"
              color="#7A8694"
              selected={selected === ''}
              onPick={() => setSelected('')}
            />
            {allFolders.map((f) => (
              <FolderChoice
                key={f.id}
                label={f.name}
                color={f.color || '#6B3FA0'}
                isPrivate={f.visibility === 'private'}
                selected={selected === f.id}
                onPick={() => setSelected(f.id)}
              />
            ))}
          </div>
        )}

        <div className="flex gap-2 pt-4">
          <button type="button" onClick={onClose} className="flex-1 px-4 py-2.5 bg-white border-[1.5px] border-light-grey text-warm-grey rounded-xl text-sm font-semibold hover:bg-cream transition-colors">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSave(selected || null)}
            disabled={allFolders === null || (single ? selected === (single.folder_id || '') : false)}
            className="flex-1 px-4 py-2.5 bg-plum text-white rounded-xl text-sm font-semibold hover:bg-plum/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Move
          </button>
        </div>
      </div>
    </div>
  );
}

function FolderChoice({ label, color, isPrivate, selected, onPick }) {
  return (
    <button
      type="button"
      onClick={onPick}
      className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left text-sm transition-colors border-[1.5px] ${
        selected ? 'border-plum bg-plum-light' : 'border-transparent hover:bg-cream'
      }`}
    >
      <IconFolder className="h-4 w-4 shrink-0" style={{ color }} />
      <span className={`truncate font-medium ${selected ? 'text-plum' : 'text-charcoal'}`}>{label}</span>
      {isPrivate && <IconLock className="h-3 w-3 text-plum shrink-0" />}
    </button>
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

/* ─── Note Modal ───────────────────────────────────────────────────────────── */

function NoteModal({ note, folders = [], currentFolder, onSave, onClose }) {
  const [title, setTitle] = useState(note?.name || '');
  const [body, setBody] = useState(note?.body || '');
  const [folderId, setFolderId] = useState(note?.folder_id ?? currentFolder?.id ?? '');

  // Folder dropdown options from what the page knows: the current folder, its
  // sibling folders, and (when editing) the note's own folder. A safety entry
  // keeps an unresolved folder selected so saving never silently moves the note.
  const optMap = new Map();
  if (currentFolder?.id) optMap.set(currentFolder.id, currentFolder.name);
  for (const f of folders) optMap.set(f.id, f.name);
  if (note?.folder?.id && note.folder.name) optMap.set(note.folder.id, note.folder.name);
  if (folderId && !optMap.has(folderId)) optMap.set(folderId, 'Current folder');
  const options = [...optMap.entries()].map(([id, name]) => ({ id, name }));

  function handleSubmit(e) {
    e.preventDefault();
    const t = title.trim();
    if (!t && !body.trim()) return; // nothing to save
    onSave({ title: t || 'Untitled note', body, folder_id: folderId || null });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-charcoal/40 px-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-lg w-full max-w-2xl flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-light-grey">
          <div className="flex items-center gap-3">
            <span className="w-9 h-9 rounded-[10px] bg-plum-light flex items-center justify-center">
              <IconFileText className="h-5 w-5 text-plum" />
            </span>
            <h2 className="font-display text-lg font-medium text-charcoal">{note ? 'Edit note' : 'New note'}</h2>
          </div>
          <button onClick={onClose} aria-label="Close" className="w-9 h-9 rounded-lg bg-cream flex items-center justify-center text-warm-grey hover:text-charcoal transition-colors">
            <IconX className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5">
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Note title"
              className="w-full font-display text-[28px] text-charcoal placeholder:text-warm-grey/50 outline-none bg-transparent"
              autoFocus
            />
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              placeholder="Start writing… guest lists, instructions, anything the household should keep."
              rows={9}
              className="w-full mt-3 text-[15px] leading-relaxed text-charcoal placeholder:text-warm-grey outline-none bg-transparent resize-none"
            />
          </div>

          <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-light-grey">
            <div className="flex items-center gap-2 min-w-0">
              <label htmlFor="note-folder" className="text-sm text-warm-grey shrink-0">Folder</label>
              <select
                id="note-folder"
                value={folderId}
                onChange={e => setFolderId(e.target.value)}
                className="px-3 py-2 border-[1.5px] border-light-grey bg-white rounded-[10px] text-sm font-semibold text-charcoal outline-none focus:border-plum max-w-[200px] truncate"
              >
                <option value="">No folder</option>
                {options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
            <button type="submit" className="px-6 py-2.5 bg-plum text-white rounded-xl text-sm font-semibold hover:bg-plum/90 transition-colors shrink-0">
              Save note
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
