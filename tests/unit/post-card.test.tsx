import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PostCard, validMediaRatio } from "@/features/library/components/post-card";
import type { LibraryPost } from "@/features/library/types";

const videoPost: LibraryPost = {
  id: "carousel-video",
  externalId: null,
  postUrl: "https://www.instagram.com/p/C-5muknob6x",
  thumbnailUrl: "https://cdn.example.com/missing-poster.jpg",
  mediaUrl: "https://cdn.example.com/C-5muknob6x_1.mp4",
  media: [{
    id: "video-1",
    type: "video",
    url: "https://cdn.example.com/C-5muknob6x_1.mp4",
    sourcePath: "proteinrecipesdaily/C-5muknob6x_1.mp4",
    thumbnailUrl: null,
    position: 0,
  }],
  authorUsername: "proteinrecipesdaily",
  caption: "Deux recettes",
  tags: [],
  savedAt: null,
  publishedAt: "2024-08-20T17:27:01.000Z",
  contentType: "carousel",
  mainTheme: "Salé",
  likesCount: 2617,
  commentsCount: null,
  metadata: {},
  collections: ["favoris"],
};

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("PostCard video preview", () => {
  it("recovers an image failure that finished before hydration attached its handler", () => {
    const complete = vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(true);
    try {
      const { container } = render(<PostCard post={videoPost} view="masonry" onOpen={vi.fn()} isAdmin={false} onToggleFavorite={vi.fn()} />);
      expect(screen.getByText("Image indisponible")).toBeVisible();
      expect(container.querySelector(".post-media")).toHaveStyle({ aspectRatio: "4 / 5" });
    } finally { complete.mockRestore(); }
  });

  it("ne charge la vidéo qu'au survol de la carte", () => {
    vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ matches: query.includes("hover: hover") })));
    render(<PostCard post={videoPost} view="grid" onOpen={vi.fn()} isAdmin={false} onToggleFavorite={vi.fn()} />);

    const card = screen.getByRole("button", { name: /ouvrir la publication/i });
    expect(card.querySelector("video")).toBeNull();
    const poster = card.querySelector('img');

    fireEvent.mouseEnter(card);
    const video = card.querySelector("video");
    expect(video).not.toBeNull();
    expect(card.querySelector('img')).toBe(poster);
    expect(video).toHaveAttribute("src", "https://cdn.example.com/C-5muknob6x_1.mp4");
    expect((video as HTMLVideoElement).muted).toBe(true);
    expect(video).toHaveAttribute("loop");

    fireEvent.mouseLeave(card);
    expect(card.querySelector("video")).toBeNull();
  });

  it("réserve un ratio stable puis utilise les proportions intrinsèques", () => {
    const { container } = render(<PostCard post={videoPost} view="masonry" onOpen={vi.fn()} isAdmin={false} onToggleFavorite={vi.fn()} />);
    const media = container.querySelector<HTMLElement>(".post-media");
    const image = media?.querySelector<HTMLImageElement>("img");
    expect(media).toHaveStyle({ aspectRatio: "4 / 5" });
    Object.defineProperties(image, {
      naturalWidth: { configurable: true, value: 1080 },
      naturalHeight: { configurable: true, value: 1350 },
    });
    fireEvent.load(image!);
    expect(media).toHaveStyle({ aspectRatio: "0.8" });
  });

  it("borne les ratios extrêmes et rejette les dimensions invalides", () => {
    expect(validMediaRatio(1920, 1080)).toBeCloseTo(16 / 9);
    expect(validMediaRatio(5000, 100)).toBe(2);
    expect(validMediaRatio(0, 100)).toBeNull();
  });
});
