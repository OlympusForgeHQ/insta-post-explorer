export function resolvePublicMediaUrl(
  sourcePath: string | null,
  fallbackUrl: string | null,
  options?: { type?: "image" | "video"; position?: number; mediaCount?: number; thumbnail?: boolean },
): string | null {
  if (!sourcePath) return fallbackUrl;
  const baseUrl = parsePublicMediaBaseUrl(process.env.MEDIA_PUBLIC_BASE_URL);
  if (!baseUrl) return fallbackUrl;

  const prefix = normalizePrefix(process.env.MEDIA_PATH_PREFIX ?? "originals");
  // Synced posters have their own object key; the video's basename is only a legacy fallback.
  if (options?.thumbnail && fallbackUrl && isCanonicalMediaUrl(fallbackUrl, baseUrl, prefix)) return fallbackUrl;
  const r2Path = toR2ObjectPath(sourcePath, options);
  const objectKey = [prefix, r2Path].filter(Boolean).join("/");
  const encodedKey = objectKey.split("/").map(encodeURIComponent).join("/");
  return new URL(encodedKey, baseUrl).toString();
}

export function toR2ObjectPath(
  sourcePath: string,
  options?: { type?: "image" | "video"; position?: number; mediaCount?: number; thumbnail?: boolean },
): string {
  const segments = sourcePath.split("/");
  if (segments.length < 2) return sourcePath;
  const username = segments[0];
  if (segments.length === 2) {
    const filename = options?.thumbnail
      ? segments[1].replace(/\.[^.]+$/, ".jpg")
      : segments[1];
    return `${username}/${filename}`;
  }
  const code = segments[1];
  const position = options?.position ?? 0;
  const mediaCount = options?.mediaCount ?? 1;
  const extension = options?.thumbnail || options?.type !== "video" ? "jpg" : "mp4";
  const filename = mediaCount > 1 ? `${code}_${position + 1}.${extension}` : `${code}.${extension}`;
  return `${username}/${filename}`;
}

export function parsePublicMediaBaseUrl(value: string | undefined): URL | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim().replace(/\/+$/, "") + "/");
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

function isCanonicalMediaUrl(value: string, baseUrl: URL, prefix: string): boolean {
  try {
    const url = new URL(value);
    const encodedPrefix = prefix.split("/").map(encodeURIComponent).join("/");
    const root = new URL(encodedPrefix ? `${encodedPrefix}/` : "", baseUrl);
    return url.protocol === "https:" && !url.username && !url.password
      && url.origin === root.origin && !url.search && !url.hash
      && url.pathname.startsWith(root.pathname) && url.pathname.length > root.pathname.length;
  } catch {
    return false;
  }
}

function normalizePrefix(value: string): string {
  return value.trim().replace(/^\/+|\/+$/g, "");
}
