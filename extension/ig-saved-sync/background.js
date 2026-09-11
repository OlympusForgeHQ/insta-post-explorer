// Instagram Saved Exporter - resilient background engine
//
// Built for large collections. A run is a persisted state machine driven by a
// repeating alarm, so it survives the MV3 worker being killed. Every page is
// written to disk immediately; a killed run resumes from the saved cursor.
//
// Modes:
//   full        : walk the entire saved feed
//   incremental : walk from newest, stop at the first post already archived
//
// Optional media download stores image/video blobs locally for a permanent
// backup (Instagram CDN URLs expire after a few days).

import {
  TASK_ID, TaskStore, TaskStoreRaw, PageStore, MediaStore, ArchiveStore,
} from "./idb.js";
import {
  buildWebsiteReconciliationTargets,
  canonicalizePostIdentities,
  isFeedPageTerminal,
  reconciliationCompletionError,
  selectLocalIncrementalPage,
  selectWebsiteReconciliationPage,
  synchronizeWebsitePage,
} from "./sync-policy.js";

const IG_ORIGIN = "https://www.instagram.com";
const IG_APP_ID = "936619743392459";
const MEDIA_TYPE = { 1: "photo", 2: "video", 8: "carousel" };

const REQUESTS_PER_HOUR = 150;
const SPACING_MS = 3_600_000 / REQUESTS_PER_HOUR; // ~24s
const JITTER_MS = 2000;
const MEDIA_GAP_MS = [200, 800]; // small pause between media downloads

const ALARM_NAME = "ig-export-tick";
const ALARM_PERIOD_MIN = 0.5;
const ZOMBIE_MS = 90_000;
const WEB_SYNC_TASK_ID = "web-sync";
const IG_REQUEST_TIMEOUT_MS = 20_000;
const SYNC_REQUEST_TIMEOUT_MS = 25_000;
const MEDIA_FETCH_TIMEOUT_MS = 25_000;
const MEDIA_UPLOAD_TIMEOUT_MS = 25_000;

const RESUME_MS = {
  rate_limited: 10 * 60_000,
  feedback_required: 30 * 60_000,
  network_error: 60_000,
  unusual_activity: 24 * 60 * 60_000,
};

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

class IgApiError extends Error {
  constructor(message, status, body = null) {
    super(message);
    this.name = "IgApiError";
    this.status = status;
    this.body = body;
  }
}
class IgNotLoggedInError extends IgApiError {
  constructor() {
    super("not_logged_in", 0, null);
    this.name = "IgNotLoggedInError";
  }
}

function mapHttpError(status, body) {
  const message = typeof body?.message === "string" ? body.message : null;
  const errorType = typeof body?.error_type === "string" ? body.error_type : null;
  if (status === 400 && (message === "challenge_required" || message === "checkpoint_required"))
    return new IgApiError("challenge_required", status, body);
  if (status === 400 && message === "feedback_required")
    return new IgApiError("feedback_required", status, body);
  if (status === 400 && errorType === "rate_limit_error")
    return new IgApiError("rate_limit_error", status, body);
  if (status === 403 && message === "login_required")
    return new IgApiError("login_required", status, body);
  if (status === 429) return new IgApiError("hard_rate_limit", status, body);
  if (status === 404) return new IgApiError("not_found", status, body);
  return new IgApiError(`HTTP ${status}`, status, body);
}

function classify(err) {
  if (err instanceof IgNotLoggedInError || err?.message === "login_required")
    return { kind: "pause", reason: "auth_error", note: "Session expired. Log in to Instagram, then resume." };
  if (err?.message === "challenge_required")
    return { kind: "pause", reason: "auth_error", note: "Instagram needs verification. Resolve it on instagram.com, then resume." };
  if (err?.message === "feedback_required")
    return { kind: "pause", reason: "feedback_required", note: "Instagram temporarily limited this action.", resumeMs: RESUME_MS.feedback_required };
  if (err?.message === "rate_limit_error" || err?.message === "hard_rate_limit")
    return { kind: "pause", reason: "rate_limited", note: "Rate limited by Instagram. Waiting before resuming.", resumeMs: RESUME_MS.rate_limited };
  if (err instanceof IgApiError && err.status === 302)
    return { kind: "pause", reason: "unusual_activity", note: "Instagram flagged unusual activity. Waiting 24h before auto-resume.", resumeMs: RESUME_MS.unusual_activity };
  if (err?.message === "not_found")
    return { kind: "fail", note: "Saved feed not found for this account." };
  if (/^(sync|media)_(post|prepare|upload|fetch|size|body)_4\d\d$/.test(err?.message ?? ""))
    return { kind: "fail", note: `Synchronization rejected: ${err.message}.` };
  if (["missing_media_url", "missing_media_size", "missing_media_body"].includes(err?.message))
    return { kind: "fail", note: `Synchronization rejected: ${err.message}.` };
  const networkStage = /^(media_fetch|media_buffer|media_prepare|media_upload)_network:(.+)$/.exec(err?.message ?? "");
  if (networkStage) {
    const labels = {
      media_fetch: "Téléchargement du média Instagram impossible",
      media_buffer: "Lecture du média Instagram impossible",
      media_prepare: "Préparation de l’envoi R2 impossible",
      media_upload: "Envoi du média vers Cloudflare R2 impossible",
    };
    return {
      kind: "pause",
      reason: "network_error",
      note: `${labels[networkStage[1]]} (${networkStage[2]}). Nouvelle tentative automatique.`,
      resumeMs: RESUME_MS.network_error,
    };
  }
  return { kind: "pause", reason: "network_error", note: `Network issue: ${err?.message ?? err}. Will retry shortly.`, resumeMs: RESUME_MS.network_error };
}

function networkStageError(stage, error) {
  const detail = error instanceof Error ? error.message : String(error);
  return new Error(`${stage}_network:${detail}`);
}

async function fetchWithTimeout(url, options, timeoutMs, timeoutCode) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new Error(timeoutCode);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function promiseWithTimeout(promise, timeoutMs, timeoutCode) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(timeoutCode)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// API client
// ---------------------------------------------------------------------------

async function readCookie(name) {
  const c = await chrome.cookies.get({ name, url: IG_ORIGIN }).catch(() => null);
  return c?.value ?? null;
}

class IgClient {
  async assertLoggedIn() {
    if (!(await readCookie("sessionid"))) throw new IgNotLoggedInError();
  }
  async get(path, searchParams = {}) {
    await this.assertLoggedIn();
    const csrf = await readCookie("csrftoken");
    const url = new URL(IG_ORIGIN + path);
    for (const [k, v] of Object.entries(searchParams)) {
      if (v != null && v !== "") url.searchParams.set(k, String(v));
    }
    let lastError;
    for (let attempt = 0; attempt <= 3; attempt++) {
      if (attempt > 0) await sleep(Math.min(1000 * 2 ** (attempt - 1), 8000));
      let res;
      try {
        res = await fetchWithTimeout(url.toString(), {
          method: "GET",
          credentials: "include",
          headers: { "X-IG-App-ID": IG_APP_ID, ...(csrf ? { "X-CSRFToken": csrf } : {}) },
        }, IG_REQUEST_TIMEOUT_MS, "instagram_request_timeout");
      } catch (err) {
        lastError = err;
        continue;
      }
      if (res.redirected) throw new IgApiError(`Redirected to ${res.url}`, 302, null);
      if (res.status >= 500 && res.status < 600) {
        lastError = new IgApiError(`HTTP ${res.status}`, res.status, null);
        continue;
      }
      const text = await promiseWithTimeout(res.text(), IG_REQUEST_TIMEOUT_MS, "instagram_body_timeout");
      let body = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = null;
      }
      if (!res.ok) throw mapHttpError(res.status, body);
      return body;
    }
    throw lastError instanceof Error ? lastError : new IgApiError("exhausted_retries", 0, null);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function randBetween([lo, hi]) {
  return lo + Math.random() * (hi - lo);
}

// ---------------------------------------------------------------------------
// Field mapping
// ---------------------------------------------------------------------------

function bestImageUrl(media) {
  const c = media.image_versions2?.candidates;
  if (!c?.length) return "";
  let best = c[0];
  for (const x of c) if (x.width * x.height > best.width * best.height) best = x;
  return best.url ?? "";
}
// Smallest available image (for the "reduced quality" option).
function smallImageUrl(media) {
  const c = media.image_versions2?.candidates;
  if (!c?.length) return "";
  let small = c[0];
  for (const x of c) if (x.width * x.height < small.width * small.height) small = x;
  return small.url ?? "";
}
function imageUrlByQuality(media, quality) {
  return quality === "low" ? smallImageUrl(media) : bestImageUrl(media);
}
function bestVideoUrl(media) {
  const v = media.video_versions;
  if (!v?.length) return "";
  let best = v[0];
  for (const x of v) if ((x.bandwidth ?? 0) > (best.bandwidth ?? 0)) best = x;
  return best.url ?? "";
}
// Smallest available video rendition (lowest bandwidth).
function smallVideoUrl(media) {
  const v = media.video_versions;
  if (!v?.length) return "";
  let small = v[0];
  for (const x of v) if ((x.bandwidth ?? Infinity) < (small.bandwidth ?? Infinity)) small = x;
  return small.url ?? "";
}
function videoUrlByQuality(media, quality) {
  return quality === "low" ? smallVideoUrl(media) : bestVideoUrl(media);
}

// Every child of a carousel (or the single media itself), flattened.
function carouselEntries(media) {
  const describe = (m, index) => {
    const type = MEDIA_TYPE[m.media_type] ?? m.media_type ?? "";
    return { index, media_type: type, image_url: bestImageUrl(m), video_url: type === "video" ? bestVideoUrl(m) : "" };
  };
  if (media.media_type === 8 && media.carousel_media?.length) {
    return media.carousel_media.map((c, i) => describe(c, i));
  }
  return [describe(media, 0)];
}

// Reels/music extras, present only on clip posts.
function musicFields(media) {
  const clip = media.clips_metadata;
  const asset = clip?.music_info?.music_asset_info;
  return {
    product_type: media.product_type ?? "",
    music_title: asset?.title ?? "",
    music_artist: asset?.display_artist ?? "",
    original_audio_title: clip?.original_sound_info?.original_audio_title ?? "",
  };
}

// Hashtags parsed from the caption.
function hashtags(text) {
  if (!text) return "";
  const tags = text.match(/#[\p{L}0-9_]+/gu);
  return tags ? tags.join(" ") : "";
}

function toExportRow(media) {
  const children = carouselEntries(media);
  const isCarousel = media.media_type === 8 && media.carousel_media?.length;
  const image = bestImageUrl(media) || (media.carousel_media?.[0] ? bestImageUrl(media.carousel_media[0]) : "");
  const withVideo = media.carousel_media?.find((m) => m.video_versions?.length);
  const video = bestVideoUrl(media) || (withVideo ? bestVideoUrl(withVideo) : "");
  const caption = media.caption?.text ?? "";
  const carouselUrls = children.map((c) => c.video_url || c.image_url).filter(Boolean).join(" | ");

  return {
    pk: media.pk ?? "",
    id: media.id ?? "",
    code: media.code ?? "",
    permalink: media.code ? `${IG_ORIGIN}/p/${media.code}/` : "",
    media_type: MEDIA_TYPE[media.media_type] ?? media.media_type ?? "",
    taken_at: media.taken_at ? new Date(media.taken_at * 1000).toISOString() : "",
    caption,
    hashtags: hashtags(caption),
    like_count: media.like_count ?? "",
    comment_count: media.comment_count ?? "",
    play_count: media.play_count ?? media.view_count ?? "",
    video_duration: media.video_duration ?? "",
    image_url: image,
    video_url: video,
    carousel_count: isCarousel ? children.length : "",
    carousel_media_urls: isCarousel ? carouselUrls : "",
    ...musicFields(media),
    accessibility_caption: media.accessibility_caption ?? "",
    owner_username: media.user?.username ?? "",
    owner_pk: media.user?.pk ?? "",
    carousel: isCarousel ? children : [],
  };
}

// Downloadable media targets for one post (all carousel children).
// opts.filter: "all" | "photos" (skip video files, keep their previews)
// opts.quality: "high" (default, max res/bitrate) | "low" (smallest rendition)
// A video's preview image shares the video's basename with a .jpg extension.
function mediaTargets(media, code, opts = {}) {
  const filter = opts.filter ?? "all";
  const quality = opts.quality ?? "high";
  const out = [];
  const owner = media.user?.username ?? "unknown";
  const add = (url, filename, type) => {
    out.push({ url, filename, path: mediaPath(owner, filename), type, postCode: code });
  };
  const push = (m, idx) => {
    const suffix = idx === undefined ? "" : `_${idx + 1}`;
    const vurl = videoUrlByQuality(m, quality);
    const iurl = imageUrlByQuality(m, quality);
    if (m.media_type === 2 && vurl) {
      if (filter !== "photos") add(vurl, `${code}${suffix}.mp4`, "video");
      if (iurl) add(iurl, `${code}${suffix}.jpg`, "photo");
      return;
    }
    if (iurl) add(iurl, `${code}${suffix}.jpg`, "photo");
  };
  if (media.media_type === 8 && media.carousel_media?.length) {
    media.carousel_media.forEach((child, i) => push(child, i));
  } else {
    push(media);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Post filter (shared by export and media download)
//   spec: { authors?: string[], types?: string[], dateFrom?, dateTo? }
//   - authors: lowercased usernames to keep (empty = all)
//   - types: any of "photo" | "video" | "carousel" (empty = all)
//   - dateFrom/dateTo: ISO date strings (inclusive), compared to taken_at
// ---------------------------------------------------------------------------
function postMatchesFilter(media, spec) {
  if (!spec) return true;

  if (spec.authors?.length) {
    const u = (media.user?.username ?? "").toLowerCase();
    if (!spec.authors.includes(u)) return false;
  }
  if (spec.types?.length) {
    const t = MEDIA_TYPE[media.media_type] ?? "";
    if (!spec.types.includes(t)) return false;
  }
  if (spec.dateFrom || spec.dateTo) {
    const ts = media.taken_at ? media.taken_at * 1000 : null;
    if (ts == null) return false;
    if (spec.dateFrom && ts < Date.parse(spec.dateFrom)) return false;
    // dateTo is inclusive of the whole day.
    if (spec.dateTo && ts > Date.parse(spec.dateTo) + 86400000 - 1) return false;
  }
  return true;
}

// True when a filter spec actually constrains anything.
function filterIsActive(spec) {
  return !!(spec && (spec.authors?.length || spec.types?.length || spec.dateFrom || spec.dateTo));
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

const client = new IgClient();

function savedPath(collectionId) {
  return collectionId
    ? `/api/v1/feed/collection/${collectionId}/posts/`
    : `/api/v1/feed/saved/posts/`;
}

const DOWNLOAD_SUBFOLDER = "instagram-saved";

// Make a string safe for a file/folder path segment: strip characters Chrome
// rejects in download filenames, collapse whitespace, and cap length.
function sanitizeSegment(name) {
  const cleaned = String(name || "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "") // illegal path chars
    .replace(/\s+/g, "_")
    .replace(/^\.+/, "") // no leading dots
    .slice(0, 60)
    .trim();
  return cleaned || "unknown";
}

// Build the on-disk relative path for a media file: author subfolder + name.
function mediaPath(ownerUsername, filename) {
  const author = sanitizeSegment(ownerUsername);
  return `${DOWNLOAD_SUBFOLDER}/${author}/${filename}`;
}

// When enabled, remove the entry from chrome://downloads once the file has
// finished writing. The file stays on disk; only the history row is cleared.
// This keeps the downloads list manageable across thousands of files.
let autoCleanHistory = true;

// Load persisted settings (best-effort; defaults are safe).
chrome.storage?.local.get(["autoCleanHistory"]).then((s) => {
  if (typeof s.autoCleanHistory === "boolean") autoCleanHistory = s.autoCleanHistory;
}).catch(() => {});

function eraseWhenComplete(downloadId) {
  const listener = (delta) => {
    if (delta.id !== downloadId) return;
    if (delta.state?.current === "complete") {
      chrome.downloads.erase({ id: downloadId }).catch(() => {});
      chrome.downloads.onChanged.removeListener(listener);
    } else if (delta.state?.current === "interrupted") {
      chrome.downloads.onChanged.removeListener(listener);
    }
  };
  chrome.downloads.onChanged.addListener(listener);
}

// Download one media file straight to disk via chrome.downloads, into a
// per-author subfolder. Deduped by URL: only URLs that were actually recorded
// as downloaded are skipped, so a failed attempt never blocks a later retry.
// Returns { skipped } | { failed } | { ok }.
async function downloadMedia(target) {
  if (await MediaStore.has(target.url)) return { skipped: true };

  const relPath = target.path ?? `${DOWNLOAD_SUBFOLDER}/${target.filename}`;

  let id = null;
  try {
    id = await chrome.downloads.download({
      url: target.url,
      filename: relPath,
      conflictAction: "uniquify",
      saveAs: false,
    });
  } catch (err) {
    console.warn("[media] download error", target.url, err?.message ?? err);
    return { failed: true };
  }

  if (id == null) return { failed: true };

  if (autoCleanHistory) eraseWhenComplete(id);

  // Record as done only after a successful download call, so failures don't
  // pollute the dedup index and block retries.
  await MediaStore.save({
    url: target.url,
    filename: target.filename,
    path: relPath,
    type: target.type,
    postCode: target.postCode,
    downloadId: id,
    createdAt: new Date().toISOString(),
  });
  return { ok: true };
}

// Fetch and persist one page. Returns { done, stopEarly }.
async function stepOnce(task, seenSet) {
  const requestedCursor = task.cursor ?? null;
  const data = await client.get(savedPath(task.collectionId), { max_id: requestedCursor });
  const media = (data.items ?? []).map((entry) => entry.media).filter(Boolean);
  const observedPostsAfterPage = task.webSync
    ? canonicalizePostIdentities(
        task.observedPosts ?? [],
        media.map((post) => ({ pk: post.pk, code: post.code })),
      )
    : null;

  // Incremental local exports stop on the local archive. Web reconciliation
  // stops only on website-owned identifiers after archive-only gaps are resolved.
  let stopEarly = false;
  let fresh = media;
  let reconciliationTargetIdsAfterPage = null;
  if (task.mode === "incremental" && seenSet) {
    if (task.webSync) {
      const selection = selectWebsiteReconciliationPage(
        media,
        seenSet,
        task.reconciliationTargetIds ?? [],
      );
      fresh = selection.fresh;
      stopEarly = selection.stopEarly;
      reconciliationTargetIdsAfterPage = selection.remainingTargetIds;
    } else {
      const selection = selectLocalIncrementalPage(media, seenSet);
      fresh = selection.fresh;
      stopEarly = selection.stopEarly;
    }
  }

  // Apply the user's content filter (authors / types / dates), if any.
  if (filterIsActive(task.filterSpec)) {
    fresh = fresh.filter((m) => postMatchesFilter(m, task.filterSpec));
  }

  const rows = fresh.map(toExportRow);
  const raw = fresh; // raw is always stored now
  if (rows.length) await PageStore.add(task.id, task.seq, rows, raw);

  // The web app always receives the best available media URLs, independently
  // from the quality selected for optional local downloads.
  if (task.webSync) {
    await synchronizeWebsitePage(
      rows,
      (row) => syncPostToExplorer(row, task.webSync, async () => {
        task.progressVersion = (task.progressVersion ?? 0) + 1;
        await TaskStoreRaw.put(task);
      }),
      async (_row, uploadedCount) => {
        task.stats.synced = (task.stats.synced ?? 0) + 1;
        task.stats.mediaUploaded = (task.stats.mediaUploaded ?? 0) + uploadedCount;
        await TaskStoreRaw.put(task);
      },
      async () => {
        if (reconciliationTargetIdsAfterPage) {
          task.reconciliationTargetIds = reconciliationTargetIdsAfterPage;
        }
        if (observedPostsAfterPage) {
          task.observedPosts = observedPostsAfterPage;
        }
        task.progressVersion = (task.progressVersion ?? 0) + 1;
        await TaskStoreRaw.put(task);
      },
    );
  }

  // Optional media download straight to disk.
  if (task.includeMedia) {
    for (const m of fresh) {
      for (const target of mediaTargets(m, m.code ?? String(m.pk), { filter: task.mediaFilter, quality: task.mediaQuality })) {
        const r = await downloadMedia(target);
        if (r.ok) {
          task.stats.mediaDownloaded += 1;
          await sleep(randBetween(MEDIA_GAP_MS));
        }
      }
    }
  }

  // Running content stats.
  for (const m of fresh) {
    const t = MEDIA_TYPE[m.media_type];
    if (t === "photo") task.stats.photos += 1;
    else if (t === "video") task.stats.videos += 1;
    else if (t === "carousel") task.stats.carousels += 1;
    const u = m.user?.username;
    if (u) task.stats.owners[u] = (task.stats.owners[u] ?? 0) + 1;
  }

  task.seq += 1;
  task.processedCount += rows.length;
  const nextCursor = data.next_max_id ?? null;
  task.cursor = nextCursor;
  task.nextAllowedAt = Date.now() + SPACING_MS + Math.random() * JITTER_MS;

  const done = stopEarly || isFeedPageTerminal({
    currentCursor: requestedCursor,
    nextCursor,
    moreAvailable: Boolean(data.more_available),
  });
  return { done, newest: media[0]?.pk ? String(media[0].pk) : task.newestPk };
}

async function setBadge(text, color) {
  try {
    await chrome.action.setBadgeText({ text });
    if (color) await chrome.action.setBadgeBackgroundColor({ color });
  } catch {}
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

let ticking = false;
let seenSetCache = null; // Set of pks, loaded once per run

async function loadSeenSet(task) {
  if (task.mode !== "incremental") return null;
  if (seenSetCache) return seenSetCache;
  if (task.webSync) {
    seenSetCache = new Set([
      ...(task.knownExternalIds ?? []).map(String),
      ...(task.knownPostCodes ?? []).map(String),
    ]);
    return seenSetCache;
  }
  const archive = await ArchiveStore.get();
  seenSetCache = new Set(archive.seenPks.map(String));
  return seenSetCache;
}

async function schedulerTask() {
  const web = await TaskStoreRaw.get(WEB_SYNC_TASK_ID);
  if (web && !["completed", "failed"].includes(web.status)) return web;
  return TaskStore.get();
}

async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    let task = await schedulerTask();
    if (!task) return;

    if (task.status === "running" && Date.now() - new Date(task.updatedAt).getTime() > ZOMBIE_MS) {
      task.status = "pending";
      await TaskStoreRaw.put(task);
    }

    const duePaused =
      task.status === "paused" && task.resumeAt && new Date(task.resumeAt).getTime() <= Date.now();
    if (task.status !== "pending" && !duePaused) return;
    if (task.nextAllowedAt && task.nextAllowedAt > Date.now()) return;

    task.status = "running";
    task.resumeAt = null;
    task.pausedReason = null;
    await TaskStoreRaw.put(task);
    await setBadge("…", "#c9820a");

    const seenSet = await loadSeenSet(task);

    while (true) {
      const fresh = await TaskStoreRaw.get(task.id);
      if (!fresh || fresh.status !== "running") return;
      task = fresh;

      let result;
      try {
        result = await stepOnce(task, seenSet);
      } catch (err) {
        const c = classify(err);
        if (c.kind === "fail") {
          task.status = "failed";
          task.error = c.note;
          await TaskStoreRaw.put(task);
          if (task.webSync) await finishWebSync(task.webSync, "failed", c.note, task.stats.mediaFailed ?? 0);
          await setBadge("!", "#b4462f");
          return;
        }
        task.status = "paused";
        task.pausedReason = { reason: c.reason, note: c.note };
        task.resumeAt = c.resumeMs ? new Date(Date.now() + c.resumeMs).toISOString() : null;
        await TaskStoreRaw.put(task);
        await setBadge("‖", "#b4462f");
        return;
      }

      if (task.newestPk == null && result.newest) task.newestPk = result.newest;

      if (result.done) {
        const reconciliationError = task.webSync
          ? reconciliationCompletionError(task.reconciliationTargetIds ?? [])
          : null;
        if (reconciliationError) {
          task.status = "failed";
          task.error = reconciliationError;
          await TaskStoreRaw.put(task);
          await finishWebSync(
            task.webSync,
            "failed",
            reconciliationError,
            task.stats.mediaFailed ?? 0,
          );
          await setBadge("!", "#b4462f");
          return;
        }
        task.status = "completed";
        task.totalCount = task.processedCount;
        await TaskStoreRaw.put(task);
        await finalizeArchive(task);
        if (task.webSync) await finishWebSync(task.webSync, "completed", null, task.stats.mediaFailed ?? 0);
        await setBadge("✓", "#3f7d54");
        return;
      }

      await TaskStoreRaw.put(task);
      const waitMs = Math.max(0, (task.nextAllowedAt ?? 0) - Date.now());
      if (waitMs > 0) await sleep(waitMs);
    }
  } finally {
    ticking = false;
  }
}

// ---------------------------------------------------------------------------
// Media-only download (no API calls)
//
// Reads the raw post objects already stored from a completed export and streams
// their media to disk. This never touches Instagram's API, so there is no
// rate-limit risk and no re-scanning. Progress is persisted in its own task
// record so it survives worker death and can pause/resume.
// ---------------------------------------------------------------------------

const MEDIA_TASK_ID = "media-download";

async function getMediaTask() {
  return TaskStoreRaw.get(MEDIA_TASK_ID);
}
async function putMediaTask(task) {
  return TaskStoreRaw.put(task);
}

async function startMediaDownload({ filter, quality, filterSpec }) {
  // Build the full target list up front from stored raw data (no API).
  const pages = await PageStore.all(TASK_ID);
  const targets = [];
  for (const p of pages) {
    if (!p.raw) continue;
    for (const media of p.raw) {
      if (filterIsActive(filterSpec) && !postMatchesFilter(media, filterSpec)) continue;
      const code = media.code ?? String(media.pk);
      for (const t of mediaTargets(media, code, { filter, quality })) targets.push(t);
    }
  }

  const now = new Date().toISOString();
  await putMediaTask({
    id: MEDIA_TASK_ID,
    kind: "media",
    status: "pending",
    filter: filter === "photos" ? "photos" : "all",
    targets,          // full plan
    index: 0,         // next target to process
    downloaded: 0,
    skipped: 0,
    failed: 0,
    total: targets.length,
    createdAt: now,
    updatedAt: now,
  });
  await setBadge("…", "#c9820a");
  mediaTick();
}

// Start a media download from a target list built by the options page (e.g.
// parsed from an imported JSON/CSV file). Each target is { url, filename, type }.
async function startMediaFromTargets(targets) {
  const now = new Date().toISOString();
  await putMediaTask({
    id: MEDIA_TASK_ID,
    kind: "media",
    status: "pending",
    filter: "imported",
    targets,
    index: 0,
    downloaded: 0,
    skipped: 0,
    failed: 0,
    total: targets.length,
    createdAt: now,
    updatedAt: now,
  });
  await setBadge("…", "#c9820a");
  mediaTick();
}

let mediaTicking = false;

async function mediaTick() {
  if (mediaTicking) return;
  mediaTicking = true;
  try {
    let task = await getMediaTask();
    if (!task) return;
    if (task.status !== "pending" && task.status !== "running") return;

    task.status = "running";
    task.updatedAt = new Date().toISOString();
    await putMediaTask(task);

    while (task.index < task.targets.length) {
      // Check for pause/stop on EVERY iteration by reading just the current
      // status from storage. If the UI paused us, stop now. This read is cheap
      // and avoids the loop clobbering an externally-set status.
      const current = await getMediaTask();
      if (!current || current.status !== "running") return;

      const target = task.targets[task.index];
      try {
        const r = await downloadMedia(target);
        if (r.skipped) task.skipped += 1;
        else if (r.failed) task.failed += 1;
        else {
          task.downloaded += 1;
          await sleep(randBetween(MEDIA_GAP_MS));
        }
      } catch (err) {
        console.warn("[media] download error", target?.url, err?.message ?? err);
        task.failed += 1; // unexpected error — keep going
      }

      task.index += 1;

      // Persist progress, but merge onto the latest stored record so we never
      // overwrite a status the UI just changed (pause/stop) between our read
      // above and this write.
      const latest = await getMediaTask();
      if (!latest || latest.status !== "running") return;
      latest.index = task.index;
      latest.downloaded = task.downloaded;
      latest.skipped = task.skipped;
      latest.failed = task.failed;
      latest.updatedAt = new Date().toISOString();
      await putMediaTask(latest);
      task = latest;
    }

    task.status = "completed";
    task.updatedAt = new Date().toISOString();
    await putMediaTask(task);
    await setBadge("✓", "#3f7d54");
  } finally {
    mediaTicking = false;
  }
}

async function pauseMediaDownload() {
  const task = await getMediaTask();
  if (task && (task.status === "running" || task.status === "pending")) {
    task.status = "paused";
    task.updatedAt = new Date().toISOString();
    await putMediaTask(task);
  }
}

async function resumeMediaDownload() {
  const task = await getMediaTask();
  if (task && task.status === "paused") {
    task.status = "pending";
    task.updatedAt = new Date().toISOString();
    await putMediaTask(task);
    mediaTick();
  }
}

async function clearMediaDownload() {
  await TaskStoreRaw.clear(MEDIA_TASK_ID);
}

// Seed the durable archive index from an externally-provided pk list (e.g.
// parsed from a JSON/CSV the user already exported). This lets "Update only"
// work after the local cache was cleared, without re-fetching everything.
//
// newestPk: the pk of the newest post. The saved feed is newest-first, so the
// caller passes the first pk in the file. Update only stops when it reaches a
// known pk, so a correct archive means it fetches only posts newer than these.
async function seedArchiveFromPks(pks, newestPk) {
  const archive = await ArchiveStore.get();
  const canonicalPosts = canonicalizePostIdentities(
    archive.seenPosts?.length
      ? archive.seenPosts
      : archive.seenPks.map((pk) => ({ pk })),
    pks.map((pk) => ({ pk })),
  );

  await ArchiveStore.put({
    seenPks: canonicalPosts.map((post) => post.pk ?? post.code).filter(Boolean),
    seenPosts: canonicalPosts,
    newestPk: newestPk ? String(newestPk) : archive.newestPk,
    count: canonicalPosts.length,
    lastExportAt: new Date().toISOString(),
  });
  return canonicalPosts.length;
}

// After a successful run, fold this run's pks into the durable archive index.
async function finalizeArchive(task) {
  const pages = await PageStore.all(task.id);
  const archive = await ArchiveStore.get();
  const existingPosts = archive.seenPosts?.length
    ? archive.seenPosts
    : archive.seenPks.map((pk) => ({ pk, code: null }));
  const pagePosts = pages.flatMap((page) =>
    page.rows.map((row) => ({ pk: row.pk, code: row.code }))
  );
  const canonicalPosts = task.webSync && task.knownWebsitePosts?.length
    ? canonicalizePostIdentities(
        task.knownWebsitePosts,
        task.observedPosts ?? [],
        pagePosts,
        existingPosts,
      )
    : canonicalizePostIdentities(existingPosts, pagePosts);

  await ArchiveStore.put({
    seenPks: canonicalPosts.map((post) => post.pk ?? post.code).filter(Boolean),
    seenPosts: canonicalPosts,
    newestPk: task.newestPk ?? archive.newestPk,
    count: canonicalPosts.length,
    lastExportAt: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function freshStats() {
  return { photos: 0, videos: 0, carousels: 0, mediaDownloaded: 0, mediaUploaded: 0, mediaFailed: 0, synced: 0, owners: {} };
}

function taskIsActive(task) {
  return task && !["completed", "failed"].includes(task.status);
}

function taskBlocksCompetingStart(task) {
  if (!task) return false;
  if (["pending", "running"].includes(task.status)) return true;
  return task.status === "paused" && Boolean(task.resumeAt);
}

async function startExport({
  collectionId,
  includeMedia,
  mode,
  filterSpec,
  mediaFilter,
  mediaQuality,
  webSync = null,
  taskId = TASK_ID,
  knownExternalIds = [],
  knownPostCodes = [],
  knownWebsitePosts = [],
  reconciliationTargetIds = [],
}) {
  const competingTaskId = taskId === WEB_SYNC_TASK_ID ? TASK_ID : WEB_SYNC_TASK_ID;
  if (taskIsActive(await TaskStoreRaw.get(taskId))) throw new Error("export_already_running");
  const competingTask = await TaskStoreRaw.get(competingTaskId);
  const competingBlocks = taskId === WEB_SYNC_TASK_ID
    ? taskBlocksCompetingStart(competingTask)
    : taskIsActive(competingTask);
  if (competingBlocks) throw new Error("another_export_is_running");
  await PageStore.clear(taskId);
  seenSetCache = null;
  const now = new Date().toISOString();
  await TaskStoreRaw.put({
    id: taskId,
    status: "pending",
    mode: mode === "incremental" ? "incremental" : "full",
    collectionId: collectionId || null,
    includeMedia: !!includeMedia,
    filterSpec: filterSpec || null,
    mediaFilter: mediaFilter === "photos" ? "photos" : "all",
    mediaQuality: mediaQuality === "low" ? "low" : "high",
    cursor: null,
    seq: 0,
    progressVersion: 0,
    processedCount: 0,
    totalCount: null,
    newestPk: null,
    stats: freshStats(),
    nextAllowedAt: 0,
    resumeAt: null,
    pausedReason: null,
    error: null,
    webSync,
    knownExternalIds,
    knownPostCodes,
    knownWebsitePosts,
    observedPosts: [],
    reconciliationTargetIds,
    createdAt: now,
    updatedAt: now,
  });
  await setBadge("…", "#c9820a");
  tick();
}

async function startWebSync(data) {
  if (!data || typeof data.token !== "string" || typeof data.apiBaseUrl !== "string") {
    throw new Error("invalid_sync_session");
  }
  const apiUrl = new URL(data.apiBaseUrl);
  if (![
    "https://insta-explorer.hz.kalyros.dev",
    "https://preview-insta-explorer.hz.kalyros.dev",
    "http://localhost:3000",
  ].includes(apiUrl.origin)) {
    throw new Error("invalid_sync_origin");
  }
  const incomingSync = { apiBaseUrl: apiUrl.origin, token: data.token, jobId: String(data.jobId ?? "") };
  const legacy = await TaskStoreRaw.get(TASK_ID);
  if (legacy?.webSync) {
    if (taskIsActive(legacy)) {
      await finishWebSync(incomingSync, "failed", "A legacy synchronization is already running.", 0);
      tick();
      return;
    }
    await PageStore.clear(TASK_ID);
    await TaskStoreRaw.clear(TASK_ID);
  }
  const previous = await TaskStoreRaw.get(WEB_SYNC_TASK_ID);
  if (previous && ["pending", "running"].includes(previous.status)) {
    await finishWebSync(incomingSync, "failed", "An existing synchronization is already running.", 0);
    tick();
    return;
  }
  if (previous?.status === "paused") {
    if (previous.webSync) await finishWebSync(previous.webSync, "failed", "Synchronization replaced by a new explicit request.", previous.stats?.mediaFailed ?? 0);
    await PageStore.clear(WEB_SYNC_TASK_ID);
    await TaskStoreRaw.clear(WEB_SYNC_TASK_ID);
  }
  const knownIds = Array.isArray(data.knownExternalIds) ? data.knownExternalIds.map(String) : [];
  const knownCodes = Array.isArray(data.knownPostCodes) ? data.knownPostCodes.map(String) : [];
  const known = [...new Set(knownIds)].slice(0, 10_000);
  const postCodes = [...new Set(knownCodes)].slice(0, 10_000);
  const knownWebsitePosts = Array.isArray(data.knownPosts)
    ? canonicalizePostIdentities(
        data.knownPosts.slice(0, 10_000).map((post) => ({
          pk: post?.externalId,
          code: post?.postCode,
        })),
      )
    : [];
  const websiteKnownIdentities = knownWebsitePosts.length
    ? knownWebsitePosts
    : canonicalizePostIdentities(
        known.map((pk) => ({ pk })),
        postCodes.map((code) => ({ code })),
      );
  const archive = await ArchiveStore.get();
  const reconciliationTargetIds = buildWebsiteReconciliationTargets(
    archive.seenPosts?.length ? archive.seenPosts : archive.seenPks,
    websiteKnownIdentities,
  );
  await startExport({
    taskId: WEB_SYNC_TASK_ID,
    mode: "incremental",
    includeMedia: false,
    mediaQuality: "high",
    knownExternalIds: known,
    knownPostCodes: postCodes,
    knownWebsitePosts,
    reconciliationTargetIds,
    webSync: incomingSync,
  });
}

async function syncPostToExplorer(row, sync, recordProgress = async () => {}) {
  const carousel = row.media_type === "carousel";
  const sources = carousel
    ? row.carousel.map((item) => ({
        type: item.media_type === "video" ? "video" : "image",
        url: item.media_type === "video" ? item.video_url : item.image_url,
        thumbnailUrl: item.media_type === "video" ? item.image_url : "",
      }))
    : [{
        type: row.media_type === "video" ? "video" : "image",
        url: row.media_type === "video" ? row.video_url : row.image_url,
        thumbnailUrl: row.media_type === "video" ? row.image_url : "",
      }];
  const uploaded = [];
  for (let position = 0; position < sources.length; position++) {
    const source = sources[position];
    const original = await uploadSource(source.url, {
      sync, authorUsername: row.owner_username, postCode: row.code,
      position, carousel, kind: source.type,
    });
    let thumbnail = null;
    if (source.thumbnailUrl) {
      thumbnail = await uploadSource(source.thumbnailUrl, {
        sync, authorUsername: row.owner_username, postCode: row.code,
        position, carousel, kind: "thumbnail",
      });
    }
    uploaded.push({
      type: source.type,
      objectKey: original.objectKey,
      sourcePath: original.sourcePath,
      byteSize: original.byteSize,
      thumbnailObjectKey: thumbnail?.objectKey ?? null,
      thumbnailByteSize: thumbnail?.byteSize ?? null,
    });
    await recordProgress();
  }
  const response = await syncFetch(sync, "/api/sync/posts", {
    external_id: String(row.pk || row.id),
    post_url: row.permalink,
    username: row.owner_username,
    caption: row.caption,
    published_at: row.taken_at || null,
    content_type: row.media_type === "photo" ? "image" : row.media_type === "video" ? "reel" : "carousel",
    likes_count: numberOrNull(row.like_count),
    comments_count: numberOrNull(row.comment_count),
    media: uploaded,
  });
  if (!response.ok) throw new Error(`sync_post_${response.status}`);
  return uploaded.length;
}

async function uploadSource(url, input) {
  if (!url) throw new Error("missing_media_url");
  let source;
  try {
    source = await fetchWithTimeout(
      url,
      { credentials: "include" },
      MEDIA_FETCH_TIMEOUT_MS,
      "media_fetch_timeout",
    );
  } catch (error) {
    throw networkStageError("media_fetch", error);
  }
  if (!source.ok) throw new Error(`media_fetch_${source.status}`);
  if (!source.body) throw new Error("missing_media_body");
  let mediaBlob;
  try {
    mediaBlob = await promiseWithTimeout(
      source.blob(),
      MEDIA_FETCH_TIMEOUT_MS,
      "media_buffer_timeout",
    );
  } catch (error) {
    throw networkStageError("media_buffer", error);
  }
  const byteSize = mediaBlob.size;
  if (!Number.isSafeInteger(byteSize) || byteSize <= 0) throw new Error("missing_media_size");
  const contentType = normalizeContentType(source.headers.get("content-type"), input.kind);
  let prepared;
  try {
    prepared = await syncFetch(input.sync, "/api/sync/media/prepare", {
      authorUsername: input.authorUsername,
      postCode: input.postCode,
      position: input.position,
      carousel: input.carousel,
      kind: input.kind,
      contentType,
      byteSize,
    });
  } catch (error) {
    throw networkStageError("media_prepare", error);
  }
  if (!prepared.ok) throw new Error(`media_prepare_${prepared.status}`);
  const target = await promiseWithTimeout(prepared.json(), SYNC_REQUEST_TIMEOUT_MS, "sync_response_timeout");
  let upload;
  try {
    upload = await fetchWithTimeout(target.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: mediaBlob,
    }, MEDIA_UPLOAD_TIMEOUT_MS, "media_upload_timeout");
  } catch (error) {
    throw networkStageError("media_upload", error);
  }
  if (!upload.ok) throw new Error(`media_upload_${upload.status}`);
  return { ...target, byteSize };
}

function normalizeContentType(value, kind) {
  const type = String(value || "").split(";", 1)[0].toLowerCase();
  if (["image/jpeg", "image/png", "image/webp", "video/mp4"].includes(type)) return type;
  return kind === "video" ? "video/mp4" : "image/jpeg";
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : null;
}

async function syncFetch(sync, path, body) {
  return fetchWithTimeout(`${sync.apiBaseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${sync.token}` },
    body: JSON.stringify(body),
  }, SYNC_REQUEST_TIMEOUT_MS, "sync_request_timeout");
}

async function finishWebSync(sync, status, error, mediaFailed) {
  await syncFetch(sync, "/api/sync/complete", { status, error, mediaFailed }).catch(() => null);
}

function publicWebSyncState(task) {
  if (!task) return null;
  return {
    status: task.status,
    progressVersion: task.progressVersion ?? task.seq ?? 0,
    processedCount: task.processedCount ?? 0,
    totalCount: task.totalCount ?? null,
    stats: task.stats ?? freshStats(),
    pausedReason: task.pausedReason ?? null,
    resumeAt: task.resumeAt ?? null,
    error: task.error ?? null,
  };
}

async function currentWebSyncTask() {
  const current = await TaskStoreRaw.get(WEB_SYNC_TASK_ID);
  if (current) return current;
  const legacy = await TaskStore.get();
  return legacy?.webSync ? legacy : null;
}

async function pauseExport() {
  const task = await TaskStore.get();
  if (task && (task.status === "running" || task.status === "pending")) {
    task.status = "paused";
    task.pausedReason = { reason: "manual", note: "Paused by you." };
    task.resumeAt = null;
    await TaskStore.put(task);
    await setBadge("‖", "#b4462f");
  }
}

async function resumeExport() {
  const task = await TaskStore.get();
  if (task && task.status === "paused") {
    task.status = "pending";
    task.nextAllowedAt = 0;
    await TaskStore.put(task);
    tick();
  }
}

async function resetExport() {
  await PageStore.clear(TASK_ID);
  await TaskStore.clear();
  seenSetCache = null;
  await setBadge("", null);
}

async function collectRows() {
  const pages = await PageStore.all(TASK_ID);
  const rows = [];
  const raw = [];
  for (const p of pages) {
    for (const r of p.rows) rows.push(r);
    if (p.raw) for (const m of p.raw) raw.push(m);
  }
  return { rows, raw };
}

// Return how many stored pages exist, so the UI can request them in batches
// (a single getRows for thousands of posts with raw data exceeds Chrome's
// 64 MiB message limit).
async function getPageCount() {
  const pages = await PageStore.all(TASK_ID);
  return { pageCount: pages.length };
}

// Return a slice of stored pages [from, to). includeRaw controls whether the
// heavy _raw objects are included, keeping each batch well under the limit.
async function getRowsBatch(from, to, includeRaw) {
  const pages = await PageStore.all(TASK_ID);
  const slice = pages.slice(from, to);
  const rows = [];
  const raw = [];
  for (const p of slice) {
    for (const r of p.rows) rows.push(r);
    if (includeRaw && p.raw) for (const m of p.raw) raw.push(m);
  }
  return { rows, raw };
}

// A few recent thumbnail URLs for the live gallery preview.
async function recentThumbs(limit = 12) {
  const pages = await PageStore.all(TASK_ID);
  const urls = [];
  for (let i = pages.length - 1; i >= 0 && urls.length < limit; i--) {
    const rows = pages[i].rows;
    for (let j = rows.length - 1; j >= 0 && urls.length < limit; j--) {
      const u = rows[j].image_url || rows[j].video_url;
      if (u) urls.push(u);
    }
  }
  return urls;
}

async function archiveInfo() {
  const a = await ArchiveStore.get();
  return { count: a.count, newestPk: a.newestPk, lastExportAt: a.lastExportAt };
}

// Count of media files downloaded to disk so far.
async function getMediaManifest() {
  const keys = await MediaStore.allKeys();
  return { count: keys.length, subfolder: DOWNLOAD_SUBFOLDER };
}

// Average bytes per file, by type and quality. Instagram's saved feed doesn't
// return reliable file sizes, so these are empirical averages used only to give
// the user a rough "~X GB" heads-up before a large download. Clearly approximate.
const AVG_BYTES = {
  high: { photo: 350 * 1024, video: 3.2 * 1024 * 1024 },
  low: { photo: 90 * 1024, video: 900 * 1024 },
};

// Estimate a media download from stored raw data, honoring filter+quality.
// Returns counts and a rough byte estimate. Also returns the author list and
// per-type counts, which the UI uses to populate filter choices.
async function estimateFromStored({ filter = "all", quality = "high", filterSpec = null } = {}) {
  const pages = await PageStore.all(TASK_ID);
  let photos = 0, videos = 0;
  const authors = new Map(); // username -> post count
  const types = { photo: 0, video: 0, carousel: 0 };

  for (const p of pages) {
    if (!p.raw) continue;
    for (const media of p.raw) {
      const t = MEDIA_TYPE[media.media_type];
      if (t) types[t] = (types[t] ?? 0) + 1;
      const u = media.user?.username ?? "unknown";
      authors.set(u, (authors.get(u) ?? 0) + 1);

      if (filterIsActive(filterSpec) && !postMatchesFilter(media, filterSpec)) continue;
      const code = media.code ?? String(media.pk);
      for (const tg of mediaTargets(media, code, { filter, quality })) {
        if (tg.type === "video") videos += 1;
        else photos += 1;
      }
    }
  }

  const bytes = photos * AVG_BYTES[quality].photo + videos * AVG_BYTES[quality].video;
  const authorList = [...authors.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([username, count]) => ({ username, count }));

  return { photos, videos, files: photos + videos, bytes, authors: authorList, types };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg?.type) {
      case "checkLogin":
        return client.assertLoggedIn().then(() => ({ ok: true })).catch(() => ({ ok: false }));
      case "getState":
        return { ok: true, task: (await TaskStore.get()) ?? null, archive: await archiveInfo() };
      case "startExport":
        await startExport(msg.data ?? {});
        return { ok: true };
      case "startWebSync":
        await startWebSync(msg.data ?? {});
        return { ok: true };
      case "getWebSyncState":
        return { ok: true, task: publicWebSyncState(await currentWebSyncTask()) };
      case "pauseExport":
        await pauseExport();
        return { ok: true };
      case "resumeExport":
        await resumeExport();
        return { ok: true };
      case "resetExport":
        await resetExport();
        return { ok: true };
      case "getRows":
        return { ok: true, ...(await collectRows()) };
      case "getPageCount":
        return { ok: true, ...(await getPageCount()) };
      case "getRowsBatch":
        return { ok: true, ...(await getRowsBatch(msg.from, msg.to, msg.includeRaw)) };
      case "getThumbs":
        return { ok: true, thumbs: await recentThumbs(msg.limit ?? 12) };
      case "getMediaInfo":
        return { ok: true, ...(await getMediaManifest()) };
      case "estimateMedia":
        return { ok: true, ...(await estimateFromStored(msg.data ?? {})) };
      case "getSettings":
        return { ok: true, autoCleanHistory };
      case "setSettings":
        if (typeof msg.data?.autoCleanHistory === "boolean") {
          autoCleanHistory = msg.data.autoCleanHistory;
          chrome.storage?.local.set({ autoCleanHistory }).catch(() => {});
        }
        return { ok: true, autoCleanHistory };
      case "clearMediaStore":
        await MediaStore.clearAll();
        return { ok: true };
      case "seedArchiveFromPks": {
        const count = await seedArchiveFromPks(msg.pks ?? [], msg.newestPk ?? null);
        return { ok: true, count };
      }
      case "startMediaDownload":
        await startMediaDownload(msg.data ?? {});
        return { ok: true };
      case "startMediaFromTargets":
        await startMediaFromTargets(msg.targets ?? []);
        return { ok: true };
      case "pauseMediaDownload":
        await pauseMediaDownload();
        return { ok: true };
      case "resumeMediaDownload":
        await resumeMediaDownload();
        return { ok: true };
      case "clearMediaDownload":
        await clearMediaDownload();
        return { ok: true };
      case "getMediaTask":
        return { ok: true, task: (await getMediaTask()) ?? null };
      default:
        return { ok: false, error: "unknown_command" };
    }
  })()
    .then(sendResponse)
    .catch((err) => sendResponse({ ok: false, error: String(err?.message ?? err) }));
  return true;
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

function ensureAlarm() {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: ALARM_PERIOD_MIN });
}
chrome.runtime.onInstalled.addListener(ensureAlarm);
chrome.runtime.onStartup.addListener(() => {
  ensureAlarm();
  tick();
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    tick().catch(() => {});
    // Resume a media-download task that was interrupted by worker death.
    getMediaTask().then((t) => {
      if (t && (t.status === "running" || t.status === "pending")) mediaTick().catch(() => {});
    });
  }
});
chrome.alarms.get(ALARM_NAME).then((a) => {
  if (!a) ensureAlarm();
});
