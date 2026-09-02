import React, { useRef, useState } from 'react';
import Icon from './AppIcon';
import { MAX_SCAN_IMAGES, compressImage, planImageAdditions, removeImageAt } from '../lib/imageScan';
import { useI18n } from '../i18n';

// Reusable multi-image picker tray: "Add screenshots" -> thumbnails with remove
// + "+ Add" -> "Scan N images". Compresses client-side and caps at
// MAX_SCAN_IMAGES. Presentational: the parent owns `images` and the scan action.
//
// Props:
//   images      : string[] (compressed data URLs)
//   setImages   : (updater) => void
//   onScan      : () => void   (parent sends { images } to its endpoint)
//   scanning    : boolean
//   addLabel    : initial button label (default "Add screenshots")
export default function ImageScanTray({
  images,
  setImages,
  onScan,
  scanning = false,
  addLabel,
}) {
  const { t } = useI18n();
  const inputRef = useRef(null);
  const [note, setNote] = useState('');
  const label = addLabel || t('scanner.addScreenshots');

  const pick = () => { setNote(''); inputRef.current?.click(); };

  const onFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0) return;
    setNote('');

    // planImageAdditions decides how many are accepted; the note is localized here.
    const { accepted } = planImageAdditions(images.length, files.length);
    if (accepted <= 0) { setNote(t('scanner.maxImages', { max: MAX_SCAN_IMAGES })); return; }
    if (files.length > accepted) setNote(t('scanner.onlyFirst', { max: MAX_SCAN_IMAGES }));

    try {
      const compressed = await Promise.all(files.slice(0, accepted).map((f) => compressImage(f)));
      setImages((prev) => [...prev, ...compressed].slice(0, MAX_SCAN_IMAGES));
    } catch {
      setNote(t('scanner.couldNotReadImage'));
    }
  };

  const remove = (idx) => setImages((prev) => removeImageAt(prev, idx));

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={onFiles}
        className="hidden"
      />

      {images.length === 0 ? (
        <button
          type="button"
          onClick={pick}
          disabled={scanning}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-3 min-h-[48px] rounded-xl text-sm font-bold transition-colors bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          <Icon name="Camera" size={18} />
          {label}
        </button>
      ) : (
        <>
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
            {t('scanner.imagesSelected', { count: images.length })}
          </p>
          <div className="flex flex-wrap gap-2">
            {images.map((src, idx) => (
              <div key={idx} className="relative">
                <img src={src} alt={`Page ${idx + 1}`} className="h-20 w-16 object-cover rounded-lg border border-border" />
                <button
                  type="button"
                  onClick={() => remove(idx)}
                  aria-label={t('scanner.removePage')}
                  className="absolute -top-2 -right-2 bg-card border border-border rounded-full p-0.5 text-muted-foreground hover:text-destructive shadow-sm"
                >
                  <Icon name="X" size={14} />
                </button>
                <span className="absolute bottom-0 left-0 right-0 text-[10px] text-center text-white bg-black/40 rounded-b-lg">
                  {idx + 1}
                </span>
              </div>
            ))}
            {images.length < MAX_SCAN_IMAGES && (
              <button
                type="button"
                onClick={pick}
                className="h-20 w-16 rounded-lg border border-dashed border-border flex flex-col items-center justify-center text-muted-foreground hover:text-foreground hover:border-primary"
              >
                <Icon name="Plus" size={18} />
                <span className="text-[10px] mt-0.5">{t('scanner.add')}</span>
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={onScan}
            disabled={scanning}
            className={`mt-3 w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-3 min-h-[48px] rounded-xl text-sm font-bold transition-colors ${
              scanning ? 'bg-muted text-muted-foreground cursor-wait' : 'bg-primary text-primary-foreground hover:bg-primary/90'
            }`}
          >
            <Icon name="ScanLine" size={18} />
            {scanning ? t('scanner.reading') : (images.length === 1 ? t('scanner.scanImage') : t('scanner.scanImages', { count: images.length }))}
          </button>
        </>
      )}
      {note && <p className="mt-2 text-xs text-amber-700">{note}</p>}
    </div>
  );
}
