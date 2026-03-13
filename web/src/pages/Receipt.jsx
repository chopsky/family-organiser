import { useState, useRef } from 'react';
import api from '../lib/api';
import ErrorBanner from '../components/ErrorBanner';
import Spinner from '../components/Spinner';

export default function Receipt() {
  const [file, setFile]         = useState(null);
  const [preview, setPreview]   = useState('');
  const [uploading, setUploading] = useState(false);
  const [result, setResult]     = useState(null);
  const [error, setError]       = useState('');
  const inputRef                = useRef();

  function handleFile(f) {
    if (!f) return;
    setFile(f);
    setResult(null);
    setError('');
    const reader = new FileReader();
    reader.onload = (e) => setPreview(e.target.result);
    reader.readAsDataURL(f);
  }

  function handleDrop(e) {
    e.preventDefault();
    handleFile(e.dataTransfer.files[0]);
  }

  async function handleUpload() {
    if (!file) return;
    setUploading(true);
    setError('');
    setResult(null);
    const form = new FormData();
    form.append('receipt', file);
    try {
      const { data } = await api.post('/receipt', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setResult(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not scan receipt. Please try again.');
    } finally {
      setUploading(false);
    }
  }

  function reset() {
    setFile(null);
    setPreview('');
    setResult(null);
    setError('');
  }

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-gray-900">📷 Receipt Scanner</h1>
      <p className="text-sm text-gray-500">
        Upload a receipt photo to automatically check off matching items from your shopping list.
      </p>

      <ErrorBanner message={error} onDismiss={() => setError('')} />

      {!result ? (
        <>
          {/* Drop zone */}
          <div
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => inputRef.current?.click()}
            className="border-2 border-dashed border-gray-300 hover:border-emerald-400 rounded-xl p-8 text-center cursor-pointer transition-colors bg-white"
          >
            {preview ? (
              <img
                src={preview}
                alt="Receipt preview"
                className="max-h-64 mx-auto rounded-lg object-contain"
              />
            ) : (
              <div className="space-y-2">
                <p className="text-4xl">📄</p>
                <p className="text-gray-600 font-medium">Tap to choose a photo</p>
                <p className="text-gray-400 text-sm">or drag and drop here</p>
                <p className="text-gray-400 text-xs">JPG, PNG, WebP — max 10 MB</p>
              </div>
            )}
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              onChange={(e) => handleFile(e.target.files[0])}
              className="hidden"
            />
          </div>

          {file && !preview && <Spinner />}

          {file && (
            <div className="flex gap-3">
              <button
                onClick={reset}
                className="flex-1 border border-gray-300 text-gray-600 hover:bg-gray-50 rounded-lg py-3 font-medium transition-colors"
              >
                Choose different
              </button>
              <button
                onClick={handleUpload}
                disabled={uploading}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-300 text-white rounded-lg py-3 font-medium transition-colors"
              >
                {uploading ? 'Scanning…' : '🔍 Scan receipt'}
              </button>
            </div>
          )}

          {uploading && (
            <div className="bg-emerald-50 rounded-xl p-5 text-center">
              <Spinner />
              <p className="text-emerald-600 text-sm mt-2">Analysing your receipt with AI…</p>
            </div>
          )}
        </>
      ) : (
        /* Results */
        <div className="space-y-4">
          {/* Checked off */}
          <div className="bg-green-50 border border-green-200 rounded-xl p-5">
            <h2 className="font-semibold text-green-800 mb-3">
              ✅ Checked off ({result.checkedOff?.length ?? 0})
            </h2>
            {result.checkedOff?.length === 0 ? (
              <p className="text-sm text-green-700">None matched your shopping list.</p>
            ) : (
              <ul className="space-y-1">
                {result.checkedOff.map((item, i) => (
                  <li key={i} className="text-sm text-green-700 flex items-center gap-2">
                    <span>✓</span> {item.item ?? item}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Unmatched items from receipt */}
          {result.unmatched?.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
              <h2 className="font-semibold text-amber-800 mb-3">
                📋 On receipt, not in your list ({result.unmatched.length})
              </h2>
              <ul className="space-y-1">
                {result.unmatched.map((item, i) => (
                  <li key={i} className="text-sm text-amber-700">• {item}</li>
                ))}
              </ul>
            </div>
          )}

          {/* All extracted items */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-5">
            <h2 className="font-semibold text-gray-700 mb-3">
              🧾 Extracted from receipt ({result.extracted?.items?.length ?? 0})
            </h2>
            <ul className="space-y-1">
              {(result.extracted?.items ?? []).map((item, i) => (
                <li key={i} className="text-sm text-gray-600">• {item.name ?? item}</li>
              ))}
            </ul>
          </div>

          <button
            onClick={reset}
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg py-3 font-medium transition-colors"
          >
            Scan another receipt
          </button>
        </div>
      )}
    </div>
  );
}
