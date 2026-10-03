import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BulkDeletePostsAlert } from "@/features/library/components/admin/bulk-delete-posts-alert";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function confirm() {
  fireEvent.click(screen.getByRole("button", { name: "Supprimer la sélection" }));
  fireEvent.click(screen.getByRole("button", { name: "Supprimer définitivement" }));
}

describe("confirmed multiple post deletion", () => {
  it("refreshes on close when the first deletion's response may have been lost", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Network response lost"); }));
    const onDeleted = vi.fn();
    render(<BulkDeletePostsAlert postIds={["one", "two"]} disabled={false} onDeleted={onDeleted} />);
    confirm();
    expect(await screen.findByRole("alert")).toHaveTextContent("0 sur 2");
    fireEvent.click(screen.getByRole("button", { name: "Fermer" }));
    expect(onDeleted).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("stops issuing deletions and does not reload after leaving the selection", async () => {
    let resolveFirst!: (response: Response) => void;
    const first = new Promise<Response>((resolve) => { resolveFirst = resolve; });
    const fetchMock = vi.fn(() => first);
    vi.stubGlobal("fetch", fetchMock);
    const onDeleted = vi.fn();
    const view = render(<BulkDeletePostsAlert postIds={["one", "two"]} disabled={false} onDeleted={onDeleted} />);
    confirm();
    view.unmount();
    await act(async () => { resolveFirst(Response.json({ deleted: true })); await first; });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it.each(["retry", "close"])("stops on failure and preserves completed deletions on %s", async (finish) => {
    const calls: string[] = [];
    let failed = false;
    vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
      expect(options?.method).toBe("DELETE");
      calls.push(url);
      if (url === "/api/posts/two" && !failed) { failed = true; return new Response(null, { status: 500 }); }
      return Response.json({ deleted: true });
    }));
    const onDeleted = vi.fn();
    render(<BulkDeletePostsAlert postIds={["one", "two", "three"]} disabled={false} onDeleted={onDeleted} />);
    confirm();

    expect(await screen.findByRole("alert")).toHaveTextContent("1 sur 3");
    expect(calls).toEqual(["/api/posts/one", "/api/posts/two"]);
    expect(onDeleted).not.toHaveBeenCalled();
    if (finish === "retry") {
      fireEvent.click(screen.getByRole("button", { name: "Réessayer les 2 restantes" }));
      await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
      expect(calls).toEqual(["/api/posts/one", "/api/posts/two", "/api/posts/two", "/api/posts/three"]);
    } else {
      fireEvent.click(screen.getByRole("button", { name: "Fermer" }));
      expect(onDeleted).toHaveBeenCalledTimes(1);
      expect(calls).toHaveLength(2);
    }
  });

  it("freezes the confirmed IDs, prevents duplicate submits and accepts already-deleted aliases", async () => {
    let resolveFirst!: (response: Response) => void;
    const first = new Promise<Response>((resolve) => { resolveFirst = resolve; });
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      calls.push(url);
      return url === "/api/posts/one" ? first : new Response(null, { status: 404 });
    }));
    const onDeleted = vi.fn();
    const view = render(<BulkDeletePostsAlert postIds={["one", "alias"]} disabled={false} onDeleted={onDeleted} />);
    fireEvent.click(screen.getByRole("button", { name: "Supprimer la sélection" }));
    view.rerender(<BulkDeletePostsAlert postIds={["unconfirmed"]} disabled={false} onDeleted={onDeleted} />);
    const button = screen.getByRole("button", { name: "Supprimer définitivement" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(button).toBeDisabled();
    expect(screen.getByRole("button", { name: "Annuler" })).toBeDisabled();
    expect(calls).toEqual(["/api/posts/one"]);
    await act(async () => { resolveFirst(Response.json({ deleted: true })); await first; });
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
    expect(calls).toEqual(["/api/posts/one", "/api/posts/alias"]);
  });
});
