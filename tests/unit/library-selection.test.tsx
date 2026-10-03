import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LibraryExplorer, type LibraryInitialState } from "@/features/library/components/library-explorer";
import type { LibraryPost } from "@/features/library/types";

const state: LibraryInitialState = {
  query: "", tags: [], theme: null, contentType: null, author: null,
  year: null, collection: null, tagMode: "and", sort: "newest",
  view: "grid", postId: null,
};
const posts = ["first", "second"].map((id): LibraryPost => ({
  id, externalId: id, postUrl: `https://www.instagram.com/p/${id}/`,
  thumbnailUrl: "", mediaUrl: null, media: [], authorUsername: id,
  caption: id, tags: [], mainTheme: null, savedAt: null, publishedAt: null,
  contentType: "image", likesCount: null, commentsCount: null, metadata: {}, collections: [],
}));
function explorer(isAdmin = true) {
  return <LibraryExplorer posts={posts} initialNextCursor="next" initialTotalFiltered={90}
    initialTotalLibrary={90} initialState={state} initialMainThemes={[]} initialTagFacets={[]}
    initialCollections={[]} initialYears={[]} isAdmin={isAdmin} />;
}

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  vi.stubGlobal("fetch", vi.fn(async (url: string) => url.startsWith("/api/authors")
    ? Response.json({ items: [] })
    : Response.json({ items: [{ ...posts[0], id: "third", authorUsername: "third" }], nextCursor: null, totalFiltered: 90, totalLibrary: 90 })));
  vi.stubGlobal("IntersectionObserver", class { observe() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("library multiselection", () => {
  it("keeps selection disabled when a new search fails to load", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url.startsWith("/api/authors")
      ? Response.json({ items: [] }) : new Response(null, { status: 500 })));
    render(explorer());
    fireEvent.click(screen.getByRole("button", { name: "Sélectionner des publications" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "failed search" } });
    expect(await screen.findByRole("alert")).toHaveTextContent("Impossible d’actualiser");
    expect(screen.getByRole("button", { name: "Sélectionner les 2 publications affichées" })).toBeDisabled();
    for (const checkbox of screen.getAllByRole("checkbox")) expect(checkbox).toBeDisabled();
    expect(screen.getByRole("button", { name: "Supprimer la sélection" })).toBeDisabled();
  });

  it("limits selection to explicit loaded cards and clears it when the search changes", async () => {
    render(explorer());
    fireEvent.click(screen.getByRole("button", { name: "Sélectionner des publications" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Sélectionner la publication de first" }));
    expect(screen.getByText("1 publication sélectionnée")).toBeVisible();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Charger la suite (2 sur 90)" }));
    const third = await screen.findByRole("checkbox", { name: "Sélectionner la publication de third" });
    expect(third).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Sélectionner la publication de first" })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Sélectionner les 3 publications affichées" }));
    expect(screen.getAllByRole("checkbox", { checked: true })).toHaveLength(3);
    expect(screen.getByText("3 publications sélectionnées")).toBeVisible();
    fireEvent.click(screen.getAllByRole("button", { name: "Grille masonry" })[0]);
    expect(screen.getAllByRole("checkbox", { checked: true })).toHaveLength(3);

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "new search" } });
    expect(screen.getByText("0 publication sélectionnée")).toBeVisible();
    expect(screen.getByRole("button", { name: "Supprimer la sélection" })).toBeDisabled();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)); });
    await waitFor(() => expect(screen.queryAllByRole("checkbox", { checked: true })).toHaveLength(0));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });
    expect(screen.getByText("0 publication sélectionnée")).toBeVisible();
  });

  it("requires a separate confirmation and cancellation does not delete selected posts", async () => {
    render(explorer());
    fireEvent.click(screen.getByRole("button", { name: "Sélectionner des publications" }));
    fireEvent.click(screen.getByRole("button", { name: "Sélectionner les 2 publications affichées" }));
    fireEvent.click(screen.getByRole("button", { name: "Supprimer la sélection" }));
    const dialog = screen.getByRole("alertdialog", { name: "Supprimer 2 publications ?" });
    expect(dialog).toHaveTextContent("ne seront plus réimportées");
    fireEvent.click(within(dialog).getByRole("button", { name: "Annuler" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(vi.mocked(fetch).mock.calls.some(([, options]) => options?.method === "DELETE")).toBe(false);
    expect(screen.getAllByRole("checkbox", { checked: true })).toHaveLength(2);
  });

  it("does not expose multiselection to public visitors", () => {
    render(explorer(false));
    expect(screen.queryByRole("button", { name: "Sélectionner des publications" })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});
