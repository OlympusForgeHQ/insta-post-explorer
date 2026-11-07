import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LibraryExplorer, type LibraryInitialState } from "@/features/library/components/library-explorer";
import type { LibraryCollection, LibraryPost } from "@/features/library/types";

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
  collections: LibraryCollection[] = [],
) {
  return <LibraryExplorer
    posts={items} initialNextCursor={page.nextCursor} initialTotalFiltered={page.totalFiltered}
    initialTotalLibrary={20} initialState={state} initialMainThemes={[]}
    initialTagFacets={[]} initialCollections={collections} initialYears={[]} isAdmin={false}
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
  it("keeps an already active media filter idle and enables reset only for active filters", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ items: [], nextCursor: null, totalFiltered: 0, totalLibrary: 20 })));
    const { container } = render(explorer([post("photo")], { ...initialState, contentType: "image" }));
    fireEvent.click(screen.getByRole("button", { name: "Photo" }));
    expect(screen.getByRole("region", { name: "Publications sauvegardées" })).toHaveAttribute("aria-busy", "false");
    const reset = container.querySelector<HTMLButtonElement>(".filter-content > button")!;
    expect(reset).toBeEnabled();
    fireEvent.click(reset);
    await waitFor(() => expect(reset).toBeDisabled());
    expect(screen.getByRole("button", { name: "Tous" })).toHaveAttribute("aria-pressed", "true");
  });

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

    fireEvent.change(screen.getByRole("combobox", { name: /Rechercher dans la bibliothèque/ }), {
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

    fireEvent.change(screen.getByRole("combobox", { name: /Rechercher dans la bibliothèque/ }), {
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


describe("LibraryExplorer shared favorites", () => {
  it("preserves the collection membership count when removing a legacy tag-only favorite", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url.startsWith("/api/authors?")
      ? Response.json({ items: [] }) : Response.json({ included: false })));
    render(explorer([post("legacy", { tags: ["Favoris"] })], initialState, undefined, [
      { id: "favorites", name: "Favoris", slug: "favoris", isSystem: true, count: 1 },
    ]));
    fireEvent.click(screen.getByRole("button", { name: "Retirer des favoris" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Ajouter aux favoris" })).toBeEnabled());
    expect(screen.getByRole("option", { name: "Favoris (1)" })).toBeInTheDocument();
  });

  it("sends one anonymous mutation per post and rolls back only favorite fields after a later page update", async () => {
    let rejectFirst!: (error: Error) => void;
    let resolveSecond!: (response: Response) => void;
    const firstMutation = new Promise<Response>((_resolve, reject) => { rejectFirst = reject; });
    const secondMutation = new Promise<Response>((resolve) => { resolveSecond = resolve; });
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith("/api/authors?")) return Response.json({ items: [] });
      if (url === "/api/posts/first/favorite" && init?.method === "PUT") return firstMutation;
      if (url === "/api/posts/second/favorite" && init?.method === "PUT") return secondMutation;
      if (url.startsWith("/api/posts?")) return Response.json({
        items: [post("first", { caption: "Légende actualisée", tags: ["Cuisine"], collections: ["recettes"] }), post("third")],
        nextCursor: null, totalFiltered: 3, totalLibrary: 20,
      });
      throw new Error("Unexpected favorite request");
    });
    vi.stubGlobal("fetch", fetcher);
    render(explorer([post("first"), post("second")], initialState, { nextCursor: "page-two", totalFiltered: 3 }));
    const hearts = screen.getAllByRole("button", { name: "Ajouter aux favoris" });
    act(() => { hearts[0].click(); hearts[0].click(); });
    expect(hearts[0]).toBeDisabled();
    expect(hearts[0]).toHaveAttribute("aria-busy", "true");
    expect(hearts[1]).toBeEnabled();
    fireEvent.click(hearts[1]);
    expect(fetcher.mock.calls.filter(([url]) => url === "/api/posts/first/favorite")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Charger la suite (2 sur 3)" }));
    await screen.findByText("Légende actualisée");
    await act(async () => { resolveSecond(Response.json({ included: true })); await secondMutation; });
    await act(async () => { rejectFirst(new Error("offline")); await firstMutation.catch(() => {}); });
    expect(screen.getByText("Légende actualisée")).toBeVisible();
    expect(screen.getByText("#Cuisine")).toBeVisible();
    const first = screen.getByRole("button", { name: "Ouvrir la publication de first" }).closest("article")!;
    const second = screen.getByRole("button", { name: "Ouvrir la publication de second" }).closest("article")!;
    expect(first.querySelector(".favorite-button")).toHaveAttribute("aria-pressed", "false");
    expect(second.querySelector(".favorite-button")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("alert")).toBeVisible();
    expect(screen.getByText("3 chargés")).toBeVisible();
  });

  it.each(["pagination", "discovery"] as const)("refreshes favorite totals and relevance cursor while rejecting late %s", async (requestType) => {
    let resolveOld!: (response: Response) => void;
    const oldRead = new Promise<Response>((resolve) => { resolveOld = resolve; });
    const freshQueries: URLSearchParams[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith("/api/authors?")) return Response.json({ items: [] });
      if (url === "/api/posts/removed/favorite" && init?.method === "DELETE") return Response.json({ included: false });
      const params = new URL(url, window.location.origin).searchParams;
      if (params.get("cursor") === "offset-30" || params.get("random") === "1") return oldRead;
      freshQueries.push(params);
      return Response.json({ items: [post("kept", { collections: ["favoris"] })], nextCursor: "offset-1", totalFiltered: 2, totalLibrary: 20 });
    }));
    render(explorer([post("removed", { collections: ["favoris"] }), post("kept", { collections: ["favoris"] })], {
      ...initialState, collection: "favoris", query: "restaurant", sort: "relevance",
    }, { nextCursor: "offset-30", totalFiltered: 3 }));
    fireEvent.click(screen.getByRole("button", { name: requestType === "pagination" ? "Charger la suite (2 sur 3)" : "Découverte" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Retirer des favoris" })[0]);
    await waitFor(() => expect(screen.getByRole("button", { name: "Charger la suite (1 sur 2)" })).toBeVisible());
    expect(freshQueries).toHaveLength(1);
    expect(freshQueries[0].get("cursor")).toBeNull();
    await act(async () => {
      resolveOld(Response.json(requestType === "pagination" ? {
        items: [post("removed", { collections: ["favoris"] })], nextCursor: "stale-offset", totalFiltered: 3, totalLibrary: 20,
      } : { item: post("removed", { collections: ["favoris"] }) }));
      await oldRead;
    });
    expect(screen.queryByRole("button", { name: "Ouvrir la publication de removed" })).not.toBeInTheDocument();
    expect(screen.getByText("1 chargés")).toBeVisible();
    expect(screen.getByRole("button", { name: "Charger la suite (1 sur 2)" })).toBeVisible();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Charger la suite (1 sur 2)" }));
    await waitFor(() => expect(freshQueries).toHaveLength(2));
    expect(freshQueries[1].get("cursor")).toBe("offset-1");
  });

  it("recovers a failed favorites refresh without retaining its old pagination cursor", async () => {
    let reads = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.startsWith("/api/authors?")) return Response.json({ items: [] });
      if (url === "/api/posts/removed/favorite") return Response.json({ included: false });
      reads += 1;
      if (reads === 1) return new Response(null, { status: 503 });
      return Response.json({ items: [post("kept", { tags: ["Favoris"] })], nextCursor: null, totalFiltered: 1, totalLibrary: 20 });
    }));
    render(explorer([post("removed", { tags: ["Favoris"] }), post("kept", { tags: ["Favoris"] })], {
      ...initialState, collection: "favoris",
    }, { nextCursor: "old-page", totalFiltered: 2 }));
    fireEvent.click(screen.getAllByRole("button", { name: "Retirer des favoris" })[0]);
    const retry = await screen.findByRole("button", { name: "Réessayer l’actualisation" });
    expect(screen.queryByRole("button", { name: /Charger la suite/ })).not.toBeInTheDocument();
    fireEvent.click(retry);
    await screen.findByRole("button", { name: "Ouvrir la publication de kept" });
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(screen.getByText("1 chargés")).toBeVisible();
  });
});


describe("LibraryExplorer favorite read races", () => {
  it("revalidates the current query when a favorite finishes during a different filter request", async () => {
    let resolveMutation!: (response: Response) => void;
    let resolveOldRead!: (response: Response) => void;
    const mutation = new Promise<Response>((resolve) => { resolveMutation = resolve; });
    const oldRead = new Promise<Response>((resolve) => { resolveOldRead = resolve; });
    const queries: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.startsWith("/api/authors?")) return Response.json({ items: [] });
      if (url === "/api/posts/removed/favorite") return mutation;
      const params = new URL(url, window.location.origin).searchParams;
      queries.push(params.get("q") ?? "");
      if (queries.length === 1) return oldRead;
      return Response.json({ items: [post("beta")], nextCursor: null, totalFiltered: 1, totalLibrary: 20 });
    }));
    render(explorer([post("removed", { tags: ["Favoris"] })]));
    fireEvent.click(screen.getByRole("button", { name: "Retirer des favoris" }));
    fireEvent.change(screen.getByRole("combobox", { name: /Rechercher dans la bibliothèque/ }), { target: { value: "beta" } });
    await waitFor(() => expect(queries).toEqual(["beta"]));
    await act(async () => { resolveMutation(Response.json({ included: false })); await mutation; });
    await screen.findByRole("button", { name: "Ouvrir la publication de beta" });
    await act(async () => {
      resolveOldRead(Response.json({ items: [post("removed", { tags: ["Favoris"] })], nextCursor: "stale", totalFiltered: 10, totalLibrary: 20 }));
      await oldRead;
    });
    expect(queries).toEqual(["beta", "beta"]);
    expect(screen.queryByRole("button", { name: "Ouvrir la publication de removed" })).not.toBeInTheDocument();
    expect(screen.getByText("1 chargés")).toBeVisible();
    expect(screen.getByRole("region", { name: "Publications sauvegardées" })).toHaveAttribute("aria-busy", "false");
    expect(screen.queryByRole("button", { name: /Charger la suite/ })).not.toBeInTheDocument();
  });

  it("shows empty favorites as an empty filter while preserving the library", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.startsWith("/api/authors?")) return Response.json({ items: [] });
      if (url === "/api/posts/last/favorite") return Response.json({ included: false });
      return Response.json({ items: [], nextCursor: null, totalFiltered: 0, totalLibrary: 20 });
    }));
    render(explorer([post("last", { collections: ["favoris"] })], { ...initialState, collection: "favoris" }));
    fireEvent.click(screen.getByRole("button", { name: "Retirer des favoris" }));
    await waitFor(() => {
      for (const counter of document.querySelectorAll(".results-count")) expect(counter).toHaveTextContent(/^0(?: résultats)?$/);
    });
    expect(screen.getByRole("heading", { name: "Aucun souvenir ne correspond" })).toBeVisible();
    expect(screen.queryByText("La bibliothèque ne contient pas encore de publication.")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /Rechercher dans la bibliothèque/ })).toHaveAttribute("placeholder", "Rechercher parmi 20 souvenirs");
  });
});
