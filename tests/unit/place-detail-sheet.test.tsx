import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const loadPlacePostsAction = vi.fn(async () => ({
  ok: true as const,
  posts: [
    { postId: "post-1", postUrl: "https://instagram.com/p/1", thumbnailUrl: "/one.jpg", authorUsername: "first", caption: "Première caption", mainTheme: "Restaurant", isPrimary: true, precision: "EXACT" as const, confidence: 1, linkedAt: "2026-01-01" },
    { postId: "post-2", postUrl: "https://instagram.com/p/2", thumbnailUrl: "/two.jpg", authorUsername: "second", caption: "Deuxième caption", mainTheme: "Voyages", isPrimary: false, precision: "EXACT" as const, confidence: 1, linkedAt: "2026-01-01" },
  ],
}));

vi.mock("@/features/places/actions", () => ({
  loadPlacePostsAction,
  confirmPlaceAction: vi.fn(),
  rejectPlaceAction: vi.fn(),
}));

const { PlaceDetailSheet } = await import("@/features/places/components/place-detail-sheet");

afterEach(cleanup);

describe("Place detail sheet", () => {
  it.each([
    { address: "12 rue de l'Église & Café", precision: "EXACT", expected: "12 rue de l'Église & Café, Paris, France" },
    { address: null, precision: "APPROXIMATE", expected: "Fraté, Paris, France" },
  ])("opens the known location in Google Maps ($precision)", async ({ address, precision, expected }) => {
    render(<PlaceDetailSheet place={{ id: "place-1", displayName: "Fraté", address, city: "Paris", region: null, country: "France", precision, approximationRadiusMeters: null, isUserConfirmed: false, sourceThemes: ["Restaurant"], postCount: 2, confidence: 1 } as never} isAdmin={false} onClose={() => {}} />);
    const link = await screen.findByRole("link", { name: /Google Maps/ });
    const url = new URL(link.getAttribute("href")!);
    expect(url.origin + url.pathname).toBe("https://www.google.com/maps/search/");
    expect(url.searchParams.get("api")).toBe("1");
    expect(url.searchParams.get("query")).toBe(expected);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("does not duplicate the post thumbnail when only one post is linked", async () => {
    loadPlacePostsAction.mockResolvedValueOnce({
      ok: true,
      posts: [
        { postId: "post-1", postUrl: "https://instagram.com/p/1", thumbnailUrl: "/one.jpg", authorUsername: "first", caption: "Première caption", mainTheme: "Restaurant", isPrimary: true, precision: "EXACT" as const, confidence: 1, linkedAt: "2026-01-01" },
      ],
    });

    render(<PlaceDetailSheet place={{ id: "place-1", displayName: "Fraté", city: "Paris", region: null, country: "France", precision: "EXACT", approximationRadiusMeters: null, isUserConfirmed: false, sourceThemes: ["Restaurant"], postCount: 1, confidence: 1 } as never} isAdmin={false} onClose={() => {}} />);

    await waitFor(() => expect(screen.getByText("Première caption")).toBeDefined());
    expect(screen.queryByRole("button", { name: "Afficher le post de first" })).toBeNull();
  });

  it("shows full post details and lets desktop users switch between linked posts", async () => {
    render(<PlaceDetailSheet place={{ id: "place-1", displayName: "Fraté", city: "Paris", region: null, country: "France", precision: "EXACT", approximationRadiusMeters: null, isUserConfirmed: false, sourceThemes: ["Restaurant"], postCount: 2, confidence: 1 } as never} isAdmin={false} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("Première caption")).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: "Afficher le post de second" }));
    expect(screen.getByText("Deuxième caption")).toBeDefined();
    expect(screen.getByRole("link", { name: /Voir le post/ }).getAttribute("href")).toBe("https://instagram.com/p/2");
  });
});
