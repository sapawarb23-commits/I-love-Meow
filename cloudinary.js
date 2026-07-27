// cloudinary.js — signed direct-to-Cloudinary uploads, real implementation
// with zero SDK dependency (Cloudinary's signing scheme is just a sorted
// param string HMAC'd with SHA-1 — documented at
// https://cloudinary.com/documentation/upload_images#generating_authentication_signatures).
//
// Flow: browser asks our server for a signature (this module), then
// uploads the file directly to Cloudinary's API using that signature —
// the file bytes never pass through our Node process, so this scales
// independently of app server capacity and gives every image a real CDN
// URL + Cloudinary's automatic resizing/format optimization (f_auto,q_auto).
//
// Fully inert (returns a clear 501) unless CLOUDINARY_CLOUD_NAME,
// CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET are all set — this app's
// image_url field works fine without Cloudinary (users can already post
// any http(s) image URL), so this is additive, not required.

import crypto from 'node:crypto';

function configured() {
  return !!(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);
}

// Upload "kind" -> Cloudinary subfolder. Mirrors the /uploads/{avatars,
// covers,posts} structure a local disk implementation would use, just
// expressed as Cloudinary folders since files are stored there instead.
const FOLDERS = { avatar: 'ilovemeow/avatars', cover: 'ilovemeow/covers', post: 'ilovemeow/posts' };
export const MAX_BYTES = 10 * 1024 * 1024; // 10MB
const ALLOWED_FORMATS = 'jpg,jpeg,png,webp';

export function handleUploadSignature(req, res, query = {}) {
  if (!configured()) {
    res.writeHead(501, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      error: 'Image uploads are not configured on this server (CLOUDINARY_* env vars unset). Post an existing image URL instead.',
      code: 'CLOUDINARY_NOT_CONFIGURED',
    }));
  }

  const kind = Object.prototype.hasOwnProperty.call(FOLDERS, query.type) ? query.type : 'post';
  const timestamp = Math.floor(Date.now() / 1000);
  const folder = FOLDERS[kind];

  // IMPORTANT: only sign parameters that are real Cloudinary Upload API
  // parameters. `allowed_formats` is real and Cloudinary enforces it
  // server-side against the actual file bytes (rejects GIF/SVG/HEIC/etc).
  // There is deliberately no "bytes"/"max_bytes" param here — Cloudinary's
  // raw Upload API has no such parameter (file-size limits only exist on
  // saved Upload Presets or the browser Upload Widget), so signing one
  // doesn't restrict anything — it just makes the client send a field that
  // was never part of the signed set, which Cloudinary then rejects as an
  // invalid/mismatched parameter and the *entire upload fails*. Max file
  // size is instead enforced for real after the upload completes, by
  // /api/upload/verify below (checks the actual returned `bytes` and
  // deletes the asset via the Admin API if it's over the limit).
  const paramsToSign = { allowed_formats: ALLOWED_FORMATS, folder, timestamp };
  const toSign = Object.keys(paramsToSign)
    .sort()
    .map((k) => `${k}=${paramsToSign[k]}`)
    .join('&');

  const signature = crypto
    .createHash('sha1')
    .update(toSign + process.env.CLOUDINARY_API_SECRET)
    .digest('hex');

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    timestamp,
    folder,
    allowedFormats: ALLOWED_FORMATS,
    maxBytes: MAX_BYTES,
    signature,
    uploadUrl: `https://api.cloudinary.com/v1_1/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload`,
  }));
}

// Deletes an asset from Cloudinary via the signed Admin "destroy" endpoint.
// Used by /api/upload/verify to remove any upload that turns out (from the
// real, Cloudinary-reported `bytes` in the upload response) to be over the
// 10MB limit — real server-side size enforcement that doesn't depend on
// trusting the browser.
export async function deleteAsset(publicId) {
  if (!configured() || !publicId) return false;
  const timestamp = Math.floor(Date.now() / 1000);
  const paramsToSign = { public_id: publicId, timestamp };
  const toSign = Object.keys(paramsToSign)
    .sort()
    .map((k) => `${k}=${paramsToSign[k]}`)
    .join('&');
  const signature = crypto
    .createHash('sha1')
    .update(toSign + process.env.CLOUDINARY_API_SECRET)
    .digest('hex');

  const form = new URLSearchParams({
    public_id: publicId,
    timestamp: String(timestamp),
    api_key: process.env.CLOUDINARY_API_KEY,
    signature,
  });

  try {
    const resp = await fetch(`https://api.cloudinary.com/v1_1/${process.env.CLOUDINARY_CLOUD_NAME}/image/destroy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
    });
    const data = await resp.json();
    return data.result === 'ok';
  } catch {
    return false;
  }
}

// Cloudinary secure_urls look like:
//   https://res.cloudinary.com/<cloud>/image/upload/v.../ilovemeow/posts/<id>.jpg
// public_id is everything after the version segment, minus the extension —
// derived here (rather than trusting a client-supplied public_id) so a
// malicious client can't ask us to delete an asset it doesn't own.
export function publicIdFromUrl(url) {
  try {
    const u = new URL(url);
    if (!configured() || u.hostname !== 'res.cloudinary.com') return null;
    const marker = `/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload/`;
    const idx = u.pathname.indexOf(marker);
    if (idx === -1) return null;
    let rest = u.pathname.slice(idx + marker.length);
    rest = rest.replace(/^v\d+\//, ''); // strip version segment
    return rest.replace(/\.[a-zA-Z0-9]+$/, ''); // strip extension
  } catch {
    return null;
  }
}
