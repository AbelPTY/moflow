// Shared client-side helpers for multi-image scan sessions (Account Foundation
// V1.1). Used by the Cards and Loans statement scanners; the Activity and
// Balance scanners use the same behavior/limits.

export const MAX_SCAN_IMAGES = 5;

// Compress one image File to a JPEG data URL (max-width bound + quality), the
// same approach every MoFlow scanner uses. Returns a Promise<dataURL>.
export const compressImage = (file, maxWidth = 1200, quality = 0.7) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read failed'));
    reader.onloadend = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('load failed'));
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const scale = Math.min(1, maxWidth / img.width);
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });

// Pure: how many of `incoming` may be added to `current` under the cap, and any
// user-facing note. Never throws. { accepted: number, note: string }.
export const planImageAdditions = (currentCount, incomingCount, max = MAX_SCAN_IMAGES) => {
  const room = Math.max(0, max - currentCount);
  if (room <= 0) return { accepted: 0, note: `You can scan up to ${max} images at once.` };
  if (incomingCount > room) return { accepted: room, note: `Only the first ${max} images are used per scan.` };
  return { accepted: incomingCount, note: '' };
};

// Pure: remove image at index, returning a new array (rest intact).
export const removeImageAt = (images, idx) => (images || []).filter((_, i) => i !== idx);
