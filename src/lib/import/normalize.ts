import { z } from "zod";

import type { ContentType } from "@/features/library/types";
import { parseCaptionMetrics } from "@/features/library/caption-metrics";

type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type NormalizedImportPost = {
  externalId: string | null;
  postUrl: string;
  thumbnailUrl: string;
  mediaUrl: string | null;
  media: NormalizedImportMedia[];
  authorUsername: string;
  caption: string;
  tags: string[];
  savedAt: Date | null;
  publishedAt: Date | null;
  contentType: ContentType;
  mainTheme: string | null;
  likesCount: number | null;
  commentsCount: number | null;
  metadata: { [key: string]: JsonValue };
  searchText: string;
};

export type NormalizedImportMedia = {
  type: "image" | "video";
  url: string | null;
  sourcePath: string | null;
  thumbnailUrl: string | null;
  position: number;
};

export type ImportIssue = {
  index: number;
  fields: string[];
};

export type PreparedImport = {
  items: NormalizedImportPost[];
  total: number;
  invalid: number;
  skipped: number;
  issues: ImportIssue[];
};

const rawPayloadSchema = z.union([
  z.array(z.unknown()),
  z.object({ items: z.array(z.unknown()) }).passthrough(),
]);

const rawRecordSchema = z.record(z.string(), z.unknown());

const safeUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(4_096)
  .refine(isSafeRemoteUrl, "URL distante non sûre")
  .transform(canonicalizeUrl);

const postUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(4_096)
  .refine(isSafeInstagramPostUrl, "URL de publication Instagram non sûre")
  .transform(canonicalizeUrl);

const optionalSafeUrlSchema = z.preprocess(
  emptyToUndefined,
  safeUrlSchema.optional(),
);

const optionalSourcePathSchema = z.preprocess(
  emptyToUndefined,
  z.string().trim().min(1).max(4_096).refine(isSafeRelativeSourcePath, "Chemin source non sûr").optional(),
);

const mediaTypeSchema = z.preprocess(
  (value) => {
    if (typeof value !== "string") return value;
    const normalized = value.trim().toLowerCase();
    if (["photo", "picture", "carousel", "sidecar"].includes(normalized)) return "image";
    if (["reel", "clip"].includes(normalized)) return "video";
    return normalized;
  },
  z.enum(["image", "video"]).default("image"),
);

const mediaObjectSchema = z.object({
  type: mediaTypeSchema,
  url: optionalSafeUrlSchema,
  sourcePath: optionalSourcePathSchema,
  thumbnailUrl: optionalSafeUrlSchema,
});

const optionalDateSchema = z.preprocess(
  emptyToUndefined,
  z.coerce.date().refine((date) => !Number.isNaN(date.getTime())).optional(),
);

const contentTypeSchema = z.preprocess(
  (value) => {
    if (typeof value !== "string") return value;
    const normalized = value.trim().toLowerCase();
    if (["photo", "picture"].includes(normalized)) return "image";
    if (["sidecar", "album"].includes(normalized)) return "carousel";
    if (["video", "clip"].includes(normalized)) return "reel";
    return normalized;
  },
  z.enum(["image", "carousel", "reel", "other"]).default("other"),
);

const tagInputSchema = z
  .union([z.array(z.unknown()), z.string(), z.null(), z.undefined()])
  .transform((value, context) => {
    const rawTags = Array.isArray(value)
      ? value
      : typeof value === "string"
        ? value.split(",")
        : [];
    const tags: string[] = [];
    const seen = new Set<string>();

    for (const rawTag of rawTags) {
      if (typeof rawTag !== "string") {
        context.addIssue({ code: "custom", message: "Un tag doit être du texte" });
        continue;
      }

      const name = normalizeWhitespace(rawTag).slice(0, 80);
      const slug = foldForSearch(name);
      if (!name || !slug || seen.has(slug)) continue;
      seen.add(slug);
      tags.push(name);
    }

    if (tags.length > 50) {
      context.addIssue({ code: "custom", message: "Trop de tags" });
    }

    return tags.slice(0, 50);
  });

const jsonObjectSchema = z
  .record(z.string().max(128), z.unknown())
  .refine(
    (value) => isBoundedJsonObject(value, 8, 32_768),
    "Les métadonnées dépassent les limites JSON",
  )
  .transform((value) => value as { [key: string]: JsonValue });

const normalizedPostSchema = z.object({
  externalId: z.preprocess(
    (value) => {
      const normalized = emptyToUndefined(value);
      return typeof normalized === "number" && Number.isFinite(normalized)
        ? String(normalized)
        : normalized;
    },
    z.string().trim().max(256).optional(),
  ),
  postUrl: postUrlSchema,
  thumbnailUrl: safeUrlSchema,
  mediaUrl: optionalSafeUrlSchema,
  authorUsername: z.string().trim().min(1).max(128),
  caption: z.preprocess(
    (value) => (value == null ? "" : value),
    z.string().max(100_000),
  ),
  tags: tagInputSchema,
  savedAt: optionalDateSchema,
  publishedAt: optionalDateSchema,
  contentType: contentTypeSchema,
  mainTheme: z.preprocess(emptyToUndefined, z.string().trim().max(120).optional()),
  likesCount: z.preprocess(emptyToUndefined, z.coerce.number().int().min(0).optional()),
  commentsCount: z.preprocess(emptyToUndefined, z.coerce.number().int().min(0).optional()),
  metadata: jsonObjectSchema.default({}),
});

const aliases = {
  externalId: ["externalId", "external_id", "id"],
  postUrl: ["postUrl", "post_url", "url"],
  thumbnailUrl: ["thumbnailUrl", "thumbnail_url", "thumbnail"],
  mediaUrl: ["mediaUrl", "media_url"],
  authorUsername: ["authorUsername", "author_username", "username", "author"],
  caption: ["caption", "description"],
  tags: ["tags", "tag_names", "tagNames"],
  savedAt: ["savedAt", "saved_at"],
  publishedAt: ["publishedAt", "published_at", "takenAt", "taken_at", "date"],
  contentType: ["contentType", "content_type", "type"],
  mainTheme: ["mainTheme", "main_theme", "theme"],
  likesCount: ["likesCount", "likes_count", "likes"],
  commentsCount: ["commentsCount", "comments_count", "comments"],
  metadata: ["metadata", "meta"],
  media: ["media", "media_items", "mediaItems", "children"],
} as const;

export function normalizeImportPayload(input: unknown): {
  items: NormalizedImportPost[];
  total: number;
  invalid: number;
  issues: ImportIssue[];
} {
  const parsedPayload = rawPayloadSchema.parse(input);
  const rawItems = Array.isArray(parsedPayload) ? parsedPayload : parsedPayload.items;
  const items: NormalizedImportPost[] = [];
  const issues: ImportIssue[] = [];

  rawItems.forEach((rawItem, index) => {
    const rawRecord = rawRecordSchema.safeParse(rawItem);
    if (!rawRecord.success) {
      issues.push({ index, fields: ["item"] });
      return;
    }

    const candidate = Object.fromEntries(
      Object.entries(aliases).map(([field, fieldAliases]) => [
        field,
        pickAlias(rawRecord.data, fieldAliases),
      ]),
    );
    const parsedPost = normalizedPostSchema.safeParse(candidate);

    if (!parsedPost.success) {
      issues.push({
        index,
        fields: [
          ...new Set(
            parsedPost.error.issues.map((issue) => String(issue.path[0] ?? "item")),
          ),
        ],
      });
      return;
    }

    const post = parsedPost.data;
    const media = normalizeMedia(candidate.media, {
      mediaUrl: post.mediaUrl ?? null,
      thumbnailUrl: post.thumbnailUrl,
      contentType: post.contentType,
    });
    const metrics = parseCaptionMetrics(post.caption);
    items.push({
      externalId: post.externalId ?? null,
      postUrl: post.postUrl,
      thumbnailUrl: post.thumbnailUrl,
      mediaUrl: post.mediaUrl ?? null,
      media,
      authorUsername: normalizeWhitespace(post.authorUsername),
      caption: post.caption.trim(),
      tags: post.tags,
      savedAt: post.savedAt ?? null,
      publishedAt: post.publishedAt ?? metrics.publishedAt,
      contentType: post.contentType,
      mainTheme: post.mainTheme ? normalizeMainTheme(post.mainTheme) : null,
      likesCount: post.likesCount ?? metrics.likes,
      commentsCount: post.commentsCount ?? metrics.comments,
      metadata: post.metadata,
      searchText: buildSearchText({
        authorUsername: post.authorUsername,
        caption: post.caption,
        tags: post.tags,
        mainTheme: post.mainTheme ?? null,
      }),
    });
  });

  return {
    items,
    total: rawItems.length,
    invalid: issues.length,
    issues,
  };
}

function normalizeMedia(
  input: unknown,
  legacy: { mediaUrl: string | null; thumbnailUrl: string; contentType: ContentType },
): NormalizedImportMedia[] {
  const rawItems = input === undefined || input === null
    ? []
    : Array.isArray(input)
      ? input
      : [input];
  const media = rawItems.flatMap((rawItem) => {
    const candidate = typeof rawItem === "string"
      ? { url: rawItem }
      : rawRecordSchema.safeParse(rawItem).success
        ? {
            type: pickAlias(rawItem as Record<string, unknown>, ["type"]),
            url: pickAlias(rawItem as Record<string, unknown>, ["url", "media_url"]),
            sourcePath: pickAlias(rawItem as Record<string, unknown>, ["path", "source_path", "sourcePath"]),
            thumbnailUrl: pickAlias(rawItem as Record<string, unknown>, ["thumbnail_url", "thumbnailUrl", "thumbnail"]),
          }
        : null;
    if (!candidate) return [];
    const parsed = mediaObjectSchema.safeParse(candidate);
    if (!parsed.success) return [];
    const item = parsed.data;
    if (!item.url && !item.sourcePath && !item.thumbnailUrl) return [];
    return [{
      type: item.type,
      url: item.url ?? null,
      sourcePath: item.sourcePath ?? null,
      thumbnailUrl: item.thumbnailUrl ?? null,
    }];
  });

  if (media.length === 0) {
    media.push({
      type: legacy.contentType === "reel" ? "video" : "image",
      url: legacy.mediaUrl,
      sourcePath: null,
      thumbnailUrl: legacy.thumbnailUrl,
    });
  }

  return media.slice(0, 20).map((item, position) => ({ ...item, position }));
}

function isSafeRelativeSourcePath(value: string): boolean {
  if (value !== value.normalize("NFC")) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) || /^[\\/]/.test(value)) return false;
  if (value.includes("\\") || /[\0-\x1f\x7f]/.test(value)) return false;
  const segments = value.split("/");
  return segments.length >= 2 && segments.every((segment) => segment.length > 0 && segment.length <= 255 && segment !== "." && segment !== "..");
}

export function prepareImportPayload(input: unknown): PreparedImport {
  const normalized = normalizeImportPayload(input);
  const deduplicated = new Map<string, NormalizedImportPost>();
  let skipped = 0;

  for (const item of normalized.items) {
    if (deduplicated.has(item.postUrl)) skipped += 1;
    deduplicated.set(item.postUrl, item);
  }

  return {
    ...normalized,
    items: [...deduplicated.values()],
    skipped,
  };
}

export function foldForSearch(value: string): string {
  return normalizeWhitespace(
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("fr"),
  );
}

export function tagSlug(value: string): string {
  const folded = foldForSearch(value);
  const slug = folded
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
  return slug || `tag-${stableHash(folded)}`;
}

export function isSafeRemoteUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    if (url.username || url.password) return false;

    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost")) {
      return false;
    }
    if (hostname.endsWith(".local") || hostname === "0.0.0.0") return false;

    if (isIpv4(hostname)) {
      const [a, b] = hostname.split(".").map(Number);
      if (
        a === 10 ||
        a === 127 ||
        a === 0 ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168)
      ) {
        return false;
      }
    }

    if (hostname.includes(":")) {
      if (
        hostname === "::1" ||
        hostname === "::" ||
        hostname.startsWith("fe8") ||
        hostname.startsWith("fe9") ||
        hostname.startsWith("fea") ||
        hostname.startsWith("feb") ||
        hostname.startsWith("fc") ||
        hostname.startsWith("fd") ||
        hostname.startsWith("::ffff:")
      ) {
        return false;
      }
    }

    return isAllowedMediaHostname(hostname);
  } catch {
    return false;
  }
}

export function instagramPostCode(postUrl: string): string | null {
  if (!isSafeInstagramPostUrl(postUrl)) return null;
  try {
    const segment = new URL(postUrl).pathname.split("/").filter(Boolean).at(-1) ?? "";
    const code = decodeURIComponent(segment);
    return /^[A-Za-z0-9_-]+$/.test(code) ? code : null;
  } catch {
    return null;
  }
}

export function isSafeInstagramPostUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    if (url.username || url.password) return false;
    const hostname = url.hostname.toLowerCase();
    if (hostname !== "instagram.com" && !hostname.endsWith(".instagram.com")) return false;
    return /^\/(p|reel|tv)\/[^/]+\/?$/i.test(url.pathname);
  } catch {
    return false;
  }
}

function isAllowedMediaHostname(hostname: string): boolean {
  if (hostname === "cdninstagram.com" || hostname.endsWith(".cdninstagram.com")) {
    return true;
  }

  let configuredPublicMediaHost = "";
  try {
    configuredPublicMediaHost = process.env.MEDIA_PUBLIC_BASE_URL
      ? new URL(process.env.MEDIA_PUBLIC_BASE_URL).hostname.toLowerCase()
      : "";
  } catch {
    configuredPublicMediaHost = "";
  }

  const allowed = new Set([
    "cdn.example.com",
    "example.com",
    "images.unsplash.com",
    configuredPublicMediaHost,
    ...(process.env.MEDIA_HOST_ALLOWLIST ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  ]);
  return allowed.has(hostname);
}

function isIpv4(value: string): boolean {
  const parts = value.split(".");
  return (
    parts.length === 4 &&
    parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255)
  );
}

function stableHash(value: string): string {
  let hash = 2_166_136_261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function canonicalizeUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();

  if (url.hostname === "instagram.com" || url.hostname.endsWith(".instagram.com")) {
    url.protocol = "https:";
    url.search = "";
  } else {
    for (const key of [...url.searchParams.keys()]) {
      if (key.toLowerCase().startsWith("utm_")) url.searchParams.delete(key);
    }
  }

  if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}

function buildSearchText(input: {
  authorUsername: string;
  caption: string;
  tags: string[];
  mainTheme: string | null;
}): string {
  return foldForSearch(
    [input.authorUsername, input.caption, ...input.tags, input.mainTheme ?? ""].join(" "),
  );
}

function pickAlias(
  record: Record<string, unknown>,
  fieldAliases: readonly string[],
): unknown {
  for (const alias of fieldAliases) {
    if (record[alias] !== undefined) return record[alias];
  }
  return undefined;
}

function emptyToUndefined(value: unknown): unknown {
  return value === null || value === "" ? undefined : value;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeMainTheme(value: string): string {
  const normalized = normalizeWhitespace(value);
  return ["cusine", "cuisne"].includes(foldForSearch(normalized)) ? "Cuisine" : normalized;
}

function isBoundedJsonObject(
  value: Record<string, unknown>,
  maxDepth: number,
  maxBytes: number,
): boolean {
  if (!isJsonValue(value, maxDepth)) return false;
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength <= maxBytes;
  } catch {
    return false;
  }
}

function isJsonValue(value: unknown, remainingDepth: number): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (remainingDepth <= 0 || typeof value !== "object") return false;
  if (Array.isArray(value)) {
    return value.length <= 1_000 && value.every((item) => isJsonValue(item, remainingDepth - 1));
  }
  return (
    Object.keys(value).length <= 256 &&
    Object.values(value).every((item) => isJsonValue(item, remainingDepth - 1))
  );
}
