// validate.js — a real, hand-rolled input-validation layer (no Zod/Joi —
// they aren't installable here without npm registry access). Every function
// either returns a cleaned value or throws ApiError, so routes stay short
// and every rejection carries a machine-readable code + human message.

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function field(name) {
  return name ? `"${name}"` : 'This field';
}

export const V = {
  requiredString(value, { field: name, min = 1, max = 1000 } = {}) {
    if (typeof value !== 'string') throw new ApiError(400, 'INVALID_TYPE', `${field(name)} must be text.`);
    const trimmed = value.trim();
    if (trimmed.length < min) throw new ApiError(400, 'TOO_SHORT', `${field(name)} must be at least ${min} character${min === 1 ? '' : 's'}.`);
    if (trimmed.length > max) throw new ApiError(400, 'TOO_LONG', `${field(name)} must be ${max} characters or fewer.`);
    return trimmed;
  },

  optionalString(value, { field: name, max = 1000 } = {}) {
    if (value === undefined || value === null || value === '') return '';
    return V.requiredString(value, { field: name, min: 0, max });
  },

  email(value, { field: name = 'email' } = {}) {
    const trimmed = V.requiredString(value, { field: name, max: 254 });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      throw new ApiError(400, 'INVALID_EMAIL', 'Please enter a valid email address.');
    }
    return trimmed.toLowerCase();
  },

  username(value) {
    const trimmed = V.requiredString(value, { field: 'username', min: 3, max: 20 });
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(trimmed)) {
      throw new ApiError(400, 'INVALID_USERNAME', 'Username must be 3-20 letters, numbers, or underscores.');
    }
    return trimmed;
  },

  password(value) {
    if (typeof value !== 'string' || value.length < 8) {
      throw new ApiError(400, 'WEAK_PASSWORD', 'Password must be at least 8 characters.');
    }
    if (value.length > 200) throw new ApiError(400, 'WEAK_PASSWORD', 'Password is too long.');
    return value;
  },

  oneOf(value, choices, { field: name } = {}) {
    if (!choices.includes(value)) {
      throw new ApiError(400, 'INVALID_VALUE', `${field(name)} must be one of: ${choices.join(', ')}.`);
    }
    return value;
  },

  number(value, { field: name, min = -Infinity, max = Infinity, integer = false } = {}) {
    const n = Number(value);
    if (!Number.isFinite(n)) throw new ApiError(400, 'INVALID_TYPE', `${field(name)} must be a number.`);
    if (integer && !Number.isInteger(n)) throw new ApiError(400, 'INVALID_TYPE', `${field(name)} must be a whole number.`);
    if (n < min || n > max) throw new ApiError(400, 'OUT_OF_RANGE', `${field(name)} must be between ${min} and ${max}.`);
    return n;
  },

  optionalNumber(value, opts = {}) {
    if (value === undefined || value === null || value === '') return undefined;
    return V.number(value, opts);
  },

  // Only allows http(s) URLs — rejects javascript:, data:, file:, etc. Used
  // for image_url/gif_url fields, which are plain strings rendered as <img
  // src>, not real file uploads (there's no upload endpoint in this app).
  url(value, { field: name, max = 500 } = {}) {
    const trimmed = V.requiredString(value, { field: name, max });
    let parsed;
    try { parsed = new URL(trimmed); } catch { throw new ApiError(400, 'INVALID_URL', `${field(name)} must be a valid URL.`); }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new ApiError(400, 'INVALID_URL', `${field(name)} must start with http:// or https://.`);
    }
    return trimmed;
  },

  optionalUrl(value, opts = {}) {
    if (value === undefined || value === null || value === '') return '';
    return V.url(value, opts);
  },
};
