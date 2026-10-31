import { afterEach, describe, expect, it } from "vitest";

import { parsePublicMediaBaseUrl, resolvePublicMediaUrl } from "@/lib/media-url";

const originalBaseUrl = process.env.MEDIA_PUBLIC_BASE_URL;
const originalPrefix = process.env.MEDIA_PATH_PREFIX;

afterEach(() => {
  process.env.MEDIA_PUBLIC_BASE_URL = originalBaseUrl;
  process.env.MEDIA_PATH_PREFIX = originalPrefix;
});

describe("resolvePublicMediaUrl", () => {
  it("construit une URL R2 publique depuis le chemin source", () => {
    process.env.MEDIA_PUBLIC_BASE_URL = "https://media.example.com";
    process.env.MEDIA_PATH_PREFIX = "originals";

    expect(resolvePublicMediaUrl("créateur/CODE/media-02.jpg", "https://fallback.test/a.jpg", {
      type: "image",
      position: 1,
      mediaCount: 3,
    })).toBe("https://media.example.com/originals/cr%C3%A9ateur/CODE_2.jpg");
  });

  it("résout séparément une vidéo et son affiche", () => {
    process.env.MEDIA_PUBLIC_BASE_URL = "https://media.example.com";
    process.env.MEDIA_PATH_PREFIX = "originals";
    const sourcePath = "1030micchan/DSPVgoCk7Zg/media-01.mp4";

    expect(resolvePublicMediaUrl(sourcePath, null, { type: "video", position: 0, mediaCount: 1 }))
      .toBe("https://media.example.com/originals/1030micchan/DSPVgoCk7Zg.mp4");
    expect(resolvePublicMediaUrl(sourcePath, null, {
      type: "video",
      position: 0,
      mediaCount: 1,
      thumbnail: true,
    })).toBe("https://media.example.com/originals/1030micchan/DSPVgoCk7Zg.jpg");
  });

  it("preserves stored canonical posters instead of guessing a JPEG beside the video", () => {
    const cases = [
      {
        base: "https://media.example.com", prefix: "originals",
        sourcePath: "auteur/CODE.mp4", position: 0, mediaCount: 1,
        poster: "https://media.example.com/originals/auteur/CODE_thumb.jpg",
      },
      {
        base: "https://media.example.com", prefix: "originals",
        sourcePath: "auteur/CODE_2.mp4", position: 1, mediaCount: 3,
        poster: "https://media.example.com/originals/auteur/CODE_2_thumb.webp",
      },
      {
        base: "https://media.example.com/assets%20public/", prefix: " /archives été/originals/ ",
        sourcePath: "créateur/CODE_2.mp4", position: 1, mediaCount: 3,
        poster: "https://media.example.com/assets%20public/archives%20%C3%A9t%C3%A9/originals/cr%C3%A9ateur/CODE_2_thumb.png",
      },
      {
        base: "https://media.example.com/assets/", prefix: "",
        sourcePath: "auteur/CODE.mp4", position: 0, mediaCount: 1,
        poster: "https://media.example.com/assets/auteur/CODE_thumb.jpg",
      },
    ];
    for (const item of cases) {
      process.env.MEDIA_PUBLIC_BASE_URL = item.base;
      process.env.MEDIA_PATH_PREFIX = item.prefix;
      expect(resolvePublicMediaUrl(item.sourcePath, item.poster, {
        type: "video", position: item.position, mediaCount: item.mediaCount, thumbnail: true,
      })).toBe(item.poster);
    }
    expect(resolvePublicMediaUrl("auteur/CODE.mp4", "https://media.example.com/assets/auteur/CODE_thumb.jpg", {
      type: "video", position: 0, mediaCount: 1,
    })).toBe("https://media.example.com/assets/auteur/CODE.mp4");
  });

  it("keeps legacy poster derivation for fallbacks outside the configured canonical object scope", () => {
    process.env.MEDIA_PUBLIC_BASE_URL = "https://media.example.com/assets/";
    process.env.MEDIA_PATH_PREFIX = "originals";
    const fallbacks = [
      "https://cdninstagram.com/CODE_thumb.jpg",
      "not a URL",
      "http://media.example.com/assets/originals/auteur/CODE_thumb.jpg",
      "https://user:secret@media.example.com/assets/originals/auteur/CODE_thumb.jpg",
      "https://media.example.com/assets-other/originals/auteur/CODE_thumb.jpg",
      "https://media.example.com/assets/originals-old/auteur/CODE_thumb.jpg",
      "https://media.example.com/assets/originals/",
      "https://media.example.com/assets/originals/../CODE_thumb.jpg",
      "https://media.example.com/assets/originals%2Fauteur/CODE_thumb.jpg",
      "https://media.example.com/assets/originals/auteur/CODE_thumb.jpg?token=temporary",
      "https://media.example.com/assets/originals/auteur/CODE_thumb.jpg#fragment",
    ];
    for (const fallback of fallbacks) {
      expect(resolvePublicMediaUrl("auteur/CODE/media-02.mp4", fallback, {
        type: "video", position: 1, mediaCount: 3, thumbnail: true,
      })).toBe("https://media.example.com/assets/originals/auteur/CODE_2.jpg");
    }
  });

  it("conserve une clé R2 canonique déjà transformée", () => {
    process.env.MEDIA_PUBLIC_BASE_URL = "https://media.example.com";
    process.env.MEDIA_PATH_PREFIX = "originals";

    expect(resolvePublicMediaUrl("auteur/CODE_2.jpg", null, {
      type: "image",
      position: 1,
      mediaCount: 3,
    })).toBe("https://media.example.com/originals/auteur/CODE_2.jpg");
  });

  it("conserve le secours lorsque le domaine public n'est pas configuré", () => {
    delete process.env.MEDIA_PUBLIC_BASE_URL;
    expect(resolvePublicMediaUrl("auteur/CODE/media.jpg", "https://fallback.test/a.jpg"))
      .toBe("https://fallback.test/a.jpg");
  });

  it("refuse un endpoint non HTTPS ou credentialisé", () => {
    expect(parsePublicMediaBaseUrl("http://media.example.com")).toBeNull();
    expect(parsePublicMediaBaseUrl("https://user:secret@media.example.com")).toBeNull();
  });
});
