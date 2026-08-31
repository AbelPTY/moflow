// Build Gemini image parts from a scan request body.
//
// Supports both the legacy single `image` field and a multi-image `images: []`
// array (multi-page statements / multi-screenshot activity captured in ONE scan
// session). Capped at MAX_SCAN_IMAGES; anything beyond is ignored. Single-image
// callers are unchanged. No image content is ever logged.

export const MAX_SCAN_IMAGES = 5;

export function buildImageParts(body) {
  const raw = [];
  if (Array.isArray(body?.images)) raw.push(...body.images);
  if (body?.image) raw.push(body.image);

  return raw
    .filter((s) => typeof s === 'string' && s.length > 0)
    .slice(0, MAX_SCAN_IMAGES)
    .map((s) => ({
      inlineData: {
        data: s.replace(/^data:image\/\w+;base64,/, ''),
        mimeType: 'image/jpeg',
      },
    }));
}
