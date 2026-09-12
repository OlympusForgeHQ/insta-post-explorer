const errors = [];
const warnings = [];

const required = [
  "DATABASE_URL",
  "AUTH_SECRET",
  "ADMIN_PASSWORD_HASH",
  "APP_OWNER_ID",
];

for (const name of required) {
  if (!process.env[name]?.trim()) errors.push(`${name} is required.`);
}

if (process.env.AUTH_DISABLED === "true") {
  errors.push("AUTH_DISABLED=true is forbidden for a Vercel deployment.");
}

const databaseUrl = process.env.DATABASE_URL?.trim();
if (databaseUrl) {
  try {
    const parsed = new URL(databaseUrl);
    if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
      errors.push("DATABASE_URL must use the postgres or postgresql protocol.");
    }
    if (!parsed.hostname || !parsed.pathname || parsed.pathname === "/") {
      errors.push("DATABASE_URL must include a host and database name.");
    }
  } catch {
    errors.push("DATABASE_URL is not a valid URL.");
  }
  if (/\b(USER|PASSWORD|HOST|DATABASE)\b/i.test(databaseUrl)) {
    errors.push("DATABASE_URL still contains placeholder values.");
  }
}

const authSecret = process.env.AUTH_SECRET ?? "";
if (authSecret && authSecret.length < 32) {
  errors.push("AUTH_SECRET must contain at least 32 characters.");
}
if (/generate|replace|example|change-me/i.test(authSecret)) {
  errors.push("AUTH_SECRET appears to be a placeholder.");
}

const passwordHash = process.env.ADMIN_PASSWORD_HASH ?? "";
if (passwordHash && !/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(passwordHash)) {
  errors.push("ADMIN_PASSWORD_HASH must be a valid bcrypt hash.");
}

const ownerId = process.env.APP_OWNER_ID ?? "";
if (ownerId && !/^[A-Za-z0-9_-]{1,128}$/.test(ownerId)) {
  errors.push("APP_OWNER_ID must contain only letters, digits, underscores, or hyphens.");
}

const importLimit = Number(process.env.IMPORT_MAX_BYTES ?? "1000000");
if (!Number.isInteger(importLimit) || importLimit < 1024 || importLimit > 1_000_000) {
  errors.push("IMPORT_MAX_BYTES must be an integer between 1024 and 1000000.");
}

const externalApiKeyHash = process.env.EXTERNAL_API_KEY_SHA256?.trim();
if (externalApiKeyHash) {
  if (!/^[0-9a-f]{64}$/i.test(externalApiKeyHash)) {
    errors.push("EXTERNAL_API_KEY_SHA256 must be a 64-character hex SHA-256 hash.");
  }
} else {
  warnings.push("EXTERNAL_API_KEY_SHA256 is not set; the external /api/v1 will fail closed (503).");
}

const publicUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
if (process.env.INSTAGRAM_AUTO_SYNC_ENABLED === "1") {
  try {
    new Intl.DateTimeFormat("en", { timeZone: process.env.INSTAGRAM_AUTO_SYNC_TIMEZONE?.trim() || "Europe/Brussels" }).format();
  } catch {
    errors.push("INSTAGRAM_AUTO_SYNC_TIMEZONE must be a valid IANA timezone.");
  }
  const syncHash = process.env.INSTAGRAM_AUTO_SYNC_KEY_SHA256?.trim().toLowerCase();
  if (!syncHash || !/^[a-f0-9]{64}$/.test(syncHash)) {
    errors.push("INSTAGRAM_AUTO_SYNC_KEY_SHA256 must be a 64-character hex SHA-256 hash when automatic sync is enabled.");
  } else if (syncHash === externalApiKeyHash?.toLowerCase()) {
    errors.push("INSTAGRAM_AUTO_SYNC_KEY_SHA256 must differ from EXTERNAL_API_KEY_SHA256.");
  }
  try {
    const url = new URL(publicUrl ?? "");
    if (url.protocol !== "https:" || url.username || url.password ||
        url.pathname !== "/" || url.search || url.hash) {
      throw new Error("INVALID_SYNC_ORIGIN");
    }
  } catch {
    errors.push("Automatic sync requires NEXT_PUBLIC_APP_URL to be an HTTPS origin without credentials, path, query or fragment.");
  }
}
if (publicUrl) {
  try {
    const parsed = new URL(publicUrl);
    if (process.env.VERCEL_ENV === "production" && parsed.protocol !== "https:") {
      errors.push("NEXT_PUBLIC_APP_URL must use HTTPS in production.");
    }
  } catch {
    errors.push("NEXT_PUBLIC_APP_URL is not a valid URL.");
  }
} else {
  warnings.push("NEXT_PUBLIC_APP_URL is not set; Vercel aliases will still work.");
}

const mediaBaseUrl = process.env.MEDIA_PUBLIC_BASE_URL?.trim();
if (mediaBaseUrl) {
  try {
    const parsed = new URL(mediaBaseUrl);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
      errors.push("MEDIA_PUBLIC_BASE_URL must be a public HTTPS URL without credentials.");
    }
  } catch {
    errors.push("MEDIA_PUBLIC_BASE_URL is not a valid URL.");
  }
} else {
  warnings.push("MEDIA_PUBLIC_BASE_URL is not set; source_path media will keep fallback URLs.");
}

const mediaPathPrefix = process.env.MEDIA_PATH_PREFIX ?? "originals";
if (mediaPathPrefix.includes("..") || mediaPathPrefix.includes("\\")) {
  errors.push("MEDIA_PATH_PREFIX must be a safe relative URL prefix.");
}

const r2Names = ["R2_ENDPOINT", "R2_BUCKET_NAME", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"];
const configuredR2Names = r2Names.filter((name) => process.env[name]?.trim());
if (configuredR2Names.length > 0 && configuredR2Names.length !== r2Names.length) {
  errors.push("R2 upload configuration is incomplete.");
}
if (process.env.R2_ENDPOINT) {
  try {
    const parsed = new URL(process.env.R2_ENDPOINT);
    if (parsed.protocol !== "https:" || !parsed.hostname.endsWith(".r2.cloudflarestorage.com")) {
      errors.push("R2_ENDPOINT must be the HTTPS Cloudflare R2 S3 endpoint.");
    }
  } catch {
    errors.push("R2_ENDPOINT is not a valid URL.");
  }
} else {
  warnings.push("R2 upload is not configured; extension refresh will remain unavailable.");
}

// Places (Phase F) geographic resolver. Only validated when explicitly enabled;
// the key and base URL values are never printed — messages carry variable names
// only. When disabled, missing configuration is not an error.
const placesEnabled = process.env.PLACES_ENABLED?.trim() === "1";
if (placesEnabled) {
  if (!process.env.GEOAPIFY_API_KEY?.trim()) {
    errors.push("PLACES_ENABLED=1 requires a non-empty GEOAPIFY_API_KEY.");
  }
  const resolverProvider = process.env.PLACES_RESOLVER_PROVIDER?.trim() || "geoapify";
  if (resolverProvider !== "geoapify") {
    errors.push("PLACES_RESOLVER_PROVIDER must be geoapify.");
  }
  const geoapifyBaseUrl = process.env.GEOAPIFY_API_BASE_URL?.trim() || "https://api.geoapify.com";
  try {
    const parsed = new URL(geoapifyBaseUrl);
    if (parsed.protocol !== "https:") errors.push("GEOAPIFY_API_BASE_URL must use HTTPS.");
  } catch {
    errors.push("GEOAPIFY_API_BASE_URL is not a valid URL.");
  }
  const resolverTimeout = Number(process.env.PLACES_RESOLVER_TIMEOUT_MS ?? "8000");
  if (!Number.isInteger(resolverTimeout) || resolverTimeout < 1000 || resolverTimeout > 30000) {
    errors.push("PLACES_RESOLVER_TIMEOUT_MS must be an integer between 1000 and 30000.");
  }
  const resolverMaxResults = Number(process.env.PLACES_RESOLVER_MAX_RESULTS ?? "5");
  if (!Number.isInteger(resolverMaxResults) || resolverMaxResults < 1 || resolverMaxResults > 5) {
    errors.push("PLACES_RESOLVER_MAX_RESULTS must be an integer between 1 and 5.");
  }
  const resolverMaxAttempts = Number(process.env.PLACES_RESOLVER_MAX_ATTEMPTS ?? "3");
  if (!Number.isInteger(resolverMaxAttempts) || resolverMaxAttempts < 1 || resolverMaxAttempts > 6) {
    errors.push("PLACES_RESOLVER_MAX_ATTEMPTS must be an integer between 1 and 6.");
  }
  const resolverRetryBase = Number(process.env.PLACES_RESOLVER_RETRY_BASE_MS ?? "250");
  if (!Number.isInteger(resolverRetryBase) || resolverRetryBase < 0 || resolverRetryBase > 60000) {
    errors.push("PLACES_RESOLVER_RETRY_BASE_MS must be an integer between 0 and 60000.");
  }
  const resolverRetryMax = Number(process.env.PLACES_RESOLVER_RETRY_MAX_MS ?? "8000");
  if (!Number.isInteger(resolverRetryMax) || resolverRetryMax < 0 || resolverRetryMax > 60000) {
    errors.push("PLACES_RESOLVER_RETRY_MAX_MS must be an integer between 0 and 60000.");
  } else if (Number.isInteger(resolverRetryBase) && resolverRetryMax < resolverRetryBase) {
    errors.push("PLACES_RESOLVER_RETRY_MAX_MS must be greater than or equal to PLACES_RESOLVER_RETRY_BASE_MS.");
  }
} else if (process.env.GEOAPIFY_API_KEY?.trim()) {
  warnings.push("GEOAPIFY_API_KEY is set but PLACES_ENABLED is not 1; Places analysis stays disabled.");
} else {
  warnings.push("Places analysis is disabled (PLACES_ENABLED is not 1); Geoapify is not required.");
}

if (process.env.DATABASE_DIRECT_URL) {
  warnings.push("DATABASE_DIRECT_URL is not required by the Vercel runtime; keep it in GitHub Environments only.");
}

for (const warning of warnings) console.warn(`[vercel-preflight] warning: ${warning}`);

if (errors.length > 0) {
  for (const error of errors) console.error(`[vercel-preflight] error: ${error}`);
  process.exitCode = 1;
} else {
  console.log(`[vercel-preflight] ready (${process.env.VERCEL_ENV ?? "local"}).`);
}
