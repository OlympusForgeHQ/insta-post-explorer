import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PostDetailDialog } from "@/features/library/components/post-detail-dialog";
import type { LibraryPost } from "@/features/library/types";

const post: LibraryPost = {
  id: "post-one", externalId: "one", postUrl: "https://instagram.com/p/one/", thumbnailUrl: "",
  mediaUrl: null, media: [], authorUsername: "alice", caption: "Un voyage", tags: [], savedAt: null,
  publishedAt: null, contentType: "image", mainTheme: "Voyages", likesCount: null, commentsCount: null,
  metadata: {}, collections: [],
};
const props = { position: 0, total: 2, onClose: vi.fn(), onPrevious: vi.fn(), onNext: vi.fn(), isAdmin: false };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("post to Places navigation", () => {
  it("exposes each linked place from full detail and drops stale links when changing post", async () => {
    const places = [
      { id: "place/primary", displayName: "Café Paris", address: "12 rue de l'Église & Café", city: "Paris", region: null, country: "France" },
      { id: "place-second", displayName: "Lyon", address: null, city: "Lyon", region: null, country: "France" },
    ];
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ...post, places })));
    const view = render(<PostDetailDialog {...props} post={post} />);
    const links = await screen.findAllByRole("link", { name: "Voir dans Places" });
    expect(links).toHaveLength(2);
    for (const [index, link] of links.entries()) {
      const url = new URL(link.getAttribute("href")!, "https://example.test");
      expect(url.pathname).toBe("/places");
      expect(url.searchParams.get("placeId")).toBe(places[index].id);
    }
    const maps = screen.getAllByRole("link", { name: /Google Maps/ });
    expect(new URL(maps[0].getAttribute("href")!).searchParams.get("query"))
      .toBe("12 rue de l'Église & Café, Paris, France");
    view.rerender(<PostDetailDialog {...props} post={{ ...post, id: "post-two" }} />);
    expect(screen.queryByRole("link", { name: "Voir dans Places" })).not.toBeInTheDocument();
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("link", { name: "Voir dans Places" })).not.toBeInTheDocument();
  });

  it("does not offer Places for an unlinked post", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ...post, places: [] })));
    render(<PostDetailDialog {...props} post={post} />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("link", { name: "Voir dans Places" })).not.toBeInTheDocument();
  });
});
