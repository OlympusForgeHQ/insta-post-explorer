import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LibraryExplorer, type LibraryInitialState } from "@/features/library/components/library-explorer";
import type { LibraryPost } from "@/features/library/types";

const initialState: LibraryInitialState = {
  query: "", tags: [], theme: null, contentType: null, author: null,
  year: null, collection: null, tagMode: "and", sort: "newest",
  view: "grid", postId: null,
};

function post(id: string, overrides: Partial<LibraryPost> = {}): LibraryPost {
  return {
    id, externalId: id, postUrl: `https://www.instagram.com/p/${id}/`,
    thumbnailUrl: "", mediaUrl: null, media: [], authorUsername: id,
    caption: "Une belle découverte", tags: [], mainTheme: "Restaurant",
    savedAt: null, publishedAt: null, contentType: "image",
    likesCount: null, commentsCount: null, metadata: {}, collections: [],
    ...overrides,
  };
}

function explorer(
  items: LibraryPost[],
  state = initialState,
  page = { nextCursor: null as string | null, totalFiltered: items.length },
) {
  return <LibraryExplorer
    posts={items} initialNextCursor={page.nextCursor} initialTotalFiltered={page.totalFiltered}
    initialTotalLibrary={20} initialState={state} initialMainThemes={[]}
    initialTagFacets={[]} initialCollections={[]} initialYears={[]} isAdmin={false}
  />;
}

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ items: [] })));
  vi.stubGlobal("IntersectionObserver", class {
    observe() {}
    disconnect() {}
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("LibraryExplorer server search results", () => {
  it.each([
    { query: "restaurant", sort: "newest" as const, caption: "Une belle découverte" },
    { query: "  restaurant  ", sort: "newest" as const, caption: "Mon restaurant préféré" },
    { query: "pistache flan", sort: "relevance" as const, caption: "Un flan maison à la pistache" },
    // The server searches the full caption but returns only its first 500 characters.
    { query: "ingredient", sort: "newest" as const, caption: "Une longue légende ".repeat(30).slice(0, 500) },
  ])("renders the server's result for '$query' ($sort)", async ({ query, sort, caption }) => {
    render(explorer([post("match", { caption })], { ...initialState, query, sort }));

    expect(screen.getByText("1 chargés")).toBeVisible();
    expect(screen.getByRole("button", { name: "Ouvrir la publication de match" })).toBeVisible();
    await waitFor(() => expect(screen.getByText("1 chargés")).toBeVisible());
  });

  it("keeps fetched theme matches visible through the last search page", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.startsWith("/api/authors?")) return Response.json({ items: [] });
      const params = new URL(url, window.location.origin).searchParams;
      if (params.get("q") !== "restaurant") throw new Error("Unexpected search");
      return Response.json({
        items: [post(params.has("cursor") ? "second" : "first")],
        nextCursor: params.has("cursor") ? null : "next-page",
        total: 2, totalFiltered: 2, totalLibrary: 20,
      });
    }));
    render(explorer([post("unrelated", { mainTheme: "Voyages" })]));

    fireEvent.change(screen.getByRole("searchbox", { name: /Rechercher dans la bibliothèque/ }), {
      target: { value: "restaurant" },
    });

    const loadMore = await screen.findByRole("button", { name: "Charger la suite (1 sur 2)" });
    expect(screen.getByRole("button", { name: "Ouvrir la publication de first" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Ouvrir la publication de unrelated" })).not.toBeInTheDocument();
    fireEvent.click(loadMore);

    await screen.findByRole("button", { name: "Ouvrir la publication de second" });
    expect(screen.getAllByRole("button", { name: /Ouvrir la publication de/ })).toHaveLength(2);
    expect(screen.getByText("2 chargés")).toBeVisible();
    expect(screen.queryByRole("button", { name: /Charger la suite/ })).not.toBeInTheDocument();
  });

  it.each(["pagination", "discovery"] as const)("ignores previous search %s that resolves after the new search", async (requestType) => {
    let resolveOldPage!: (response: Response) => void;
    const oldPage = new Promise<Response>((resolve) => { resolveOldPage = resolve; });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.startsWith("/api/authors?")) return Response.json({ items: [] });
      const params = new URL(url, window.location.origin).searchParams;
      // Ignore cancellation so a late response still exercises the result guard.
      if (params.get("q") === "alpha"
        && (params.get("cursor") === "alpha-next" || params.get("random") === "1")) return oldPage;
      if (params.get("q") === "beta" && !params.has("cursor")) {
        return Response.json({
          items: [post("beta")], nextCursor: null,
          total: 1, totalFiltered: 1, totalLibrary: 20,
        });
      }
      throw new Error("Unexpected search page");
    }));
    render(explorer([post("alpha")], { ...initialState, query: "alpha" }, {
      nextCursor: "alpha-next", totalFiltered: 3,
    }));
    fireEvent.click(screen.getByRole("button", {
      name: requestType === "pagination" ? "Charger la suite (1 sur 3)" : "Découverte",
    }));
    expect(screen.getByRole("button", {
      name: requestType === "pagination" ? "Chargement…" : "Recherche…",
    })).toBeDisabled();

    fireEvent.change(screen.getByRole("searchbox", { name: /Rechercher dans la bibliothèque/ }), {
      target: { value: "beta" },
    });
    await screen.findByRole("button", { name: "Ouvrir la publication de beta" });
    expect(screen.getAllByRole("button", { name: /Ouvrir la publication de/ })).toHaveLength(1);

    await act(async () => {
      resolveOldPage(Response.json(requestType === "discovery" ? { item: post("alpha-late") } : {
        items: [post("alpha-late")], nextCursor: "alpha-last",
        total: 3, totalFiltered: 3, totalLibrary: 20,
      }));
      await oldPage;
    });

    expect(screen.getAllByRole("button", { name: /Ouvrir la publication de/ })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Ouvrir la publication de beta" })).toBeVisible();
    expect(screen.getByText("1 chargés")).toBeVisible();
    expect(document.querySelectorAll(".results-count")).toHaveLength(2);
    for (const counter of document.querySelectorAll(".results-count")) {
      expect(counter).toHaveTextContent(/^1(?: résultats)?$/);
    }
    expect(screen.queryByRole("button", { name: /Charger la suite|Chargement…/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
