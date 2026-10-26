import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
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
    {level: "building", missingDetails: ["venue_identity", "floor"], label: "Adresse à confirmer", detail: "Bâtiment repéré ; l’étage reste à confirmer."},
    {level: "street", missingDetails: ["venue_identity", "street_number"], label: "Rue identifiée", detail: "Adresse à confirmer : le numéro dans cette rue n’est pas vérifié."},
    {level: "district", missingDetails: ["venue_identity", "street_address"], label: "Quartier identifié", detail: "Adresse à confirmer : seule la zone du quartier est identifiée."},
    {level: "city", missingDetails: ["venue_identity", "street_address"], label: "Ville identifiée", detail: "Adresse à confirmer : seule la ville est identifiée."},
  ])("explains a contextual $level area without presenting a confidence score or verified business", async ({level, missingDetails, label, detail}) => {
    render(<PlaceDetailSheet place={{id: "contextual-place", displayName: "Maison Exemple", city: "Paris", region: null, country: "France",
      precision: "APPROXIMATE", approximationRadiusMeters: 1000, areaContext: {level, missingDetails},
      isUserConfirmed: false, sourceThemes: ["Restaurant"], postCount: 2, confidence: 0.5} as never} isAdmin={false} onClose={() => {}} />);
    expect(screen.getByRole("heading", {name: "Maison Exemple"})).toBeVisible();
    expect(screen.getByText(label)).toBeVisible();
    expect(screen.getByText(detail, {exact: false})).toBeVisible();
    expect(screen.getByText(/le centre de la zone n’indique pas une adresse précise/i)).toBeVisible();
    expect(screen.queryByText(/confiance/i)).not.toBeInTheDocument();
    expect(screen.getByText("Zone approximative · rayon ~1 km")).toBeVisible();
    expect(await screen.findByRole("link", {name: "Voir le post"})).toHaveAttribute("href", "https://instagram.com/p/1");
  });

  it("keeps an unlabelled area generic and hides numeric confidence", async () => {
    render(<PlaceDetailSheet place={{id: "generic-area", displayName: "France", city: null, country: "France", precision: "APPROXIMATE",
      approximationRadiusMeters: 500000, isUserConfirmed: false, sourceThemes: ["Voyages"], postCount: 2, confidence: 0.5} as never} isAdmin={false} onClose={() => {}} />);
    expect(screen.getByText(/Emplacement approximatif/)).toBeVisible();
    expect(screen.queryByText("Ville identifiée")).not.toBeInTheDocument();
    expect(screen.queryByText(/confiance/i)).not.toBeInTheDocument();
    await screen.findByRole("link", {name: "Voir le post"});
  });

  it.each([false, true])("moves focus once and returns safely after Escape (inert opener: %s)", async (inertOpener) => {
    const openerRef = createRef<HTMLButtonElement>();
    const fallbackRef = createRef<HTMLButtonElement>();
    const place = { id: "place-focus", displayName: "Zone test", city: "Paris", region: null, country: "France", precision: "APPROXIMATE", approximationRadiusMeters: 10000, isUserConfirmed: false, sourceThemes: ["Restaurant"], postCount: 2, confidence: 1 } as never;
    const onClose = vi.fn();
    const content = () => <><button ref={openerRef}>Ouvrir la zone</button><button ref={fallbackRef}>Zones</button><PlaceDetailSheet place={place} isAdmin={false} onClose={() => onClose()} returnFocusRef={openerRef} fallbackFocusRef={fallbackRef} /></>;
    const view = render(content());
    const detail = screen.getByRole("dialog", { name: "Détail de Zone test" });
    expect(detail).toHaveFocus();
    await screen.findByText("Première caption");

    act(() => fallbackRef.current!.focus());
    view.rerender(content());
    expect(fallbackRef.current).toHaveFocus();

    if (inertOpener) openerRef.current!.setAttribute("inert", "");
    const destination = inertOpener ? fallbackRef.current! : openerRef.current!;
    const focus = vi.spyOn(destination, "focus");
    const close = screen.getByRole("button", { name: "Fermer le détail" });
    act(() => close.focus());
    fireEvent.keyDown(close, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
    expect(destination).toHaveFocus();
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    focus.mockRestore();
  });

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
