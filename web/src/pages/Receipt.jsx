import { useState, useRef, useEffect } from 'react';
import api from '../lib/api';
import ErrorBanner from '../components/ErrorBanner';
import Spinner from '../components/Spinner';
import { IconCamera, IconReceipt, IconSearch, IconCheck, IconClipboard } from '../components/Icons';

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
    <div className="max-w-3xl mx-auto space-y-5">
      <h1
        className="flex text-[36px] font-normal leading-none text-bark items-center gap-2"
        style={{ fontFamily: '"Instrument Serif", Georgia, "Times New Roman", serif' }}
      >
        <div
          className="hidden md:flex"
          style={{
            width: '42px',
            height: '42px',
            borderRadius: '12px',
            background: '#f1eef8',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <IconCamera className="h-5 w-5 text-plum" />
        </div>
        Receipt Scanner
      </h1>
      <p className="text-sm text-cocoa">
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
            className="border-2 border-dashed border-cream-border hover:border-primary rounded-2xl p-8 text-center cursor-pointer transition-colors bg-linen"
          >
            {preview ? (
              <img
                src={preview}
                alt="Receipt preview"
                className="max-h-64 mx-auto rounded-lg object-contain"
              />
            ) : (
              <div className="space-y-2">
                <IconReceipt className="h-10 w-10 mx-auto text-cocoa" />
                <p className="text-bark font-medium">Tap to choose a photo</p>
                <p className="text-cocoa text-sm">or drag and drop here</p>
                <p className="text-cocoa text-xs">JPG, PNG, WebP — max 10 MB</p>
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
                className="flex-1 border border-cream-border text-cocoa hover:bg-oat rounded-2xl py-3 font-medium transition-colors"
              >
                Choose different
              </button>
              <button
                onClick={handleUpload}
                disabled={uploading}
                className="flex-1 bg-primary hover:bg-primary-pressed disabled:bg-primary/50 text-white rounded-2xl py-3 font-medium transition-colors"
              >
                {uploading ? 'Scanning...' : <><IconSearch className="h-4 w-4 inline -mt-0.5" /> Scan receipt</>}
              </button>
            </div>
          )}

          {uploading && <ScanProgress />}
        </>
      ) : (
        /* Results */
        <div className="space-y-4">
          {/* Checked off */}
          <div className="bg-success/10 border border-success/30 rounded-2xl p-5">
            <h2 className="font-semibold text-success mb-3">
              <span className="flex items-center gap-1.5"><IconCheck className="h-4 w-4" /> Checked off ({result.checkedOff?.length ?? 0})</span>
            </h2>
            {result.checkedOff?.length === 0 ? (
              <p className="text-sm text-success">None matched your shopping list.</p>
            ) : (
              <ul className="space-y-1">
                {result.checkedOff.map((item, i) => (
                  <li key={i} className="text-sm text-success flex items-center gap-2">
                    <span>✓</span> {item.name ?? item}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Unmatched items from receipt */}
          {result.unmatched?.length > 0 && (
            <div className="bg-warn/10 border border-warn/30 rounded-2xl p-5">
              <h2 className="font-semibold text-warn mb-3">
                <span className="flex items-center gap-1.5"><IconClipboard className="h-4 w-4" /> On receipt, not in your list ({result.unmatched.length})</span>
              </h2>
              <ul className="space-y-1">
                {result.unmatched.map((item, i) => (
                  <li key={i} className="text-sm text-warn">• {item}</li>
                ))}
              </ul>
            </div>
          )}

          {/* All extracted items */}
          <div className="bg-oat border border-cream-border rounded-2xl p-5">
            <h2 className="font-semibold text-bark mb-3">
              <span className="flex items-center gap-1.5"><IconReceipt className="h-4 w-4" /> Extracted from receipt ({result.extracted?.items?.length ?? 0})</span>
            </h2>
            <ul className="space-y-1">
              {(result.extracted?.items ?? []).map((item, i) => (
                <li key={i} className="text-sm text-cocoa">• {item.normalised_name ?? item.name ?? String(item)}{item.price ? ` — ${item.price}` : ''}</li>
              ))}
            </ul>
          </div>

          <button
            onClick={reset}
            className="w-full bg-primary hover:bg-primary-pressed text-white rounded-2xl py-3 font-medium transition-colors"
          >
            Scan another receipt
          </button>
        </div>
      )}
    </div>
  );
}

const SCAN_STEPS = [
  { label: 'Uploading receipt…', delay: 0 },
  { label: 'Reading items with AI…', delay: 2000 },
  { label: 'Matching against your shopping list…', delay: 8000 },
  { label: 'Almost done…', delay: 15000 },
];

function ScanProgress() {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const timers = SCAN_STEPS.slice(1).map((s, i) =>
      setTimeout(() => setStep(i + 1), s.delay)
    );
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <div className="bg-oat rounded-2xl p-5 text-center space-y-3">
      <Spinner />
      <p className="text-primary text-sm font-medium">{SCAN_STEPS[step].label}</p>
      <div className="w-full bg-secondary/30 rounded-full h-1.5">
        <div
          className="bg-primary h-1.5 rounded-full transition-all duration-1000"
          style={{ width: `${((step + 1) / SCAN_STEPS.length) * 100}%` }}
        />
      </div>
    </div>
  );
}
