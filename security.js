// security.js — response security headers, hand-rolled since the `helmet`
// package isn't installable here (no npm registry access). Applied to
// every response, API and static alike.
//
// Honest trade-off: this app's pages use inline <script> blocks throughout
// (no build step to hash/nonce them), so the CSP below allows
// 'unsafe-inline' for scripts and styles. That's weaker than a fully locked
// CSP, but it's the real, working policy for how this codebase is actually
// structured — not a copy-pasted strict policy that would break every page.

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https: http:", // Meows/GIFs can point at any http(s) image URL; blob: needed for local file previews before upload
"connect-src 'self' https://api.cloudinary.com https://res.cloudinary.com",  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

export function applySecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=(), payment=()');
  res.setHeader('Content-Security-Policy', CSP);
  // Harmless over plain HTTP (as in this sandbox); real protection once
  // deployed behind HTTPS, which is the only place this header matters.
  res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
}
