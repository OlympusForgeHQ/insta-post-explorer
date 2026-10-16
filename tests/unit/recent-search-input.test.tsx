import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RecentSearchInput } from "@/components/recent-search-input";
import { clearRecentSearches, readRecentSearches } from "@/lib/recent-searches";

function Harness({ scope = "posts", initialValue = "" }: { scope?: "posts" | "places"; initialValue?: string }) {
  const [value, setValue] = useState(initialValue);
  return <><RecentSearchInput scope={scope} value={value} onValueChange={setValue} label="Rechercher" placeholder="Rechercher" /><button type="button">Suivant</button></>;
}

function focus(input: HTMLElement) { act(() => input.focus()); }
function submit(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: "Enter" });
}

describe("RecentSearchInput", () => {
  beforeEach(() => {
    localStorage.clear();
    clearRecentSearches("posts");
    clearRecentSearches("places");
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("keeps five finalized distinct searches across remounts, separated by scope", () => {
    const view = render(<Harness />);
    const input = screen.getByRole("combobox", { name: "Rechercher" });
    focus(input);
    fireEvent.change(input, { target: { value: "brouillon" } });
    expect(readRecentSearches("posts")).toEqual([]);
    for (const term of ["Paris", "Rome", "Tokyo", "Lyon", "Café", "Lille", "  cafe  "]) submit(input, term);
    expect(readRecentSearches("posts")).toEqual(["cafe", "Lille", "Lyon", "Tokyo", "Rome"]);
    fireEvent.change(input, { target: { value: "Bruxelles" } });
    act(() => screen.getByRole("button", { name: "Suivant" }).focus());
    fireEvent.change(input, { target: { value: "  Côte   d’Azur  " } });
    fireEvent.change(input, { target: { value: "" } });
    expect(readRecentSearches("posts")).toEqual(["Côte d’Azur", "Bruxelles", "cafe", "Lille", "Lyon"]);
    view.unmount();

    const reloaded = render(<Harness />);
    focus(screen.getByRole("combobox"));
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["Côte d’Azur", "Bruxelles", "cafe", "Lille", "Lyon"]);
    reloaded.unmount();
    render(<Harness scope="places" />);
    focus(screen.getByRole("combobox"));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("requires explicit keyboard selection, ignores IME Enter and preserves focus when closing", () => {
    localStorage.setItem("mosaic:recent-searches:v1:posts", JSON.stringify(["Paris", "Rome"]));
    render(<Harness initialValue="Lyon" />);
    const input = screen.getByRole("combobox");
    focus(input);
    expect(input).not.toHaveAttribute("aria-activedescendant");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input).toHaveValue("Lyon");
    expect(readRecentSearches("posts")).toEqual(["Lyon", "Paris", "Rome"]);

    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: "Enter", isComposing: true, keyCode: 229 });
    expect(input).toHaveValue("Lyon");
    fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input).toHaveValue("Rome");
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(input);
    expect(input).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(input);
    fireEvent.change(input, { target: { value: "Li" } });
    expect(input).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(input);
    const forget = screen.getByRole("button", { name: "Effacer l’historique" });
    fireEvent.keyDown(input, { key: "Tab" });
    expect(forget).toHaveFocus();
    expect(input).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(forget, { key: "Tab", shiftKey: true });
    expect(input).toHaveFocus();
    fireEvent.keyDown(input, { key: "Tab" });
    expect(forget).toHaveFocus();
    expect(fireEvent.keyDown(forget, { key: "Tab" })).toBe(true);
    expect(input).toHaveFocus();
    act(() => screen.getByRole("button", { name: "Suivant" }).focus());
    expect(screen.getByRole("button", { name: "Suivant" })).toHaveFocus();
    expect(input).toHaveAttribute("aria-expanded", "false");

    focus(input);
    fireEvent.keyDown(input, { key: "Tab" });
    fireEvent.keyDown(screen.getByRole("button", { name: "Effacer l’historique" }), { key: "Escape" });
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(input);
    fireEvent.keyDown(input, { key: "Tab" });
    expect(screen.getByRole("button", { name: "Effacer l’historique" })).toHaveFocus();
    fireEvent.click(document.activeElement!);
    expect(input).toHaveFocus();
    expect(readRecentSearches("posts")).toEqual([]);
  });

  it("recalls a touched option without saving the draft during blur", () => {
    localStorage.setItem("mosaic:recent-searches:v1:posts", JSON.stringify(["Paris", "Rome"]));
    render(<Harness initialValue="brouillon" />);
    const input = screen.getByRole("combobox");
    focus(input);
    const option = screen.getByRole("option", { name: "Rome" });
    fireEvent.pointerDown(option, { pointerType: "touch", pointerId: 1 });
    fireEvent.blur(input, { relatedTarget: option });
    fireEvent.pointerUp(option, { pointerType: "touch", pointerId: 1 });
    fireEvent.click(option);
    expect(input).toHaveValue("Rome");
    expect(readRecentSearches("posts")).toEqual(["Rome", "Paris"]);
    expect(input).toHaveFocus();
  });

  it("recovers from malformed storage and keeps a bounded in-memory history when storage is denied", () => {
    localStorage.setItem("mosaic:recent-searches:v1:posts", "{broken");
    const view = render(<Harness />);
    let input = screen.getByRole("combobox");
    focus(input);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    localStorage.setItem("mosaic:recent-searches:v1:posts", JSON.stringify([12, null, " ", "Café", "CAFE", "x".repeat(201), "Rome"]));
    fireEvent.click(input);
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["Café", "Rome"]);

    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Denied", "SecurityError"); });
    submit(input, "Lyon");
    expect(readRecentSearches("posts")).toEqual(["Lyon", "Café", "Rome"]);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new DOMException("Denied", "SecurityError"); });
    view.unmount();
    render(<Harness initialValue="Lyon" />);
    input = screen.getByRole("combobox");
    focus(input);
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["Lyon", "Café", "Rome"]);
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new DOMException("Denied", "SecurityError"); });
    fireEvent.click(screen.getByRole("button", { name: "Effacer l’historique" }));
    act(() => screen.getByRole("button", { name: "Suivant" }).focus());
    expect(readRecentSearches("posts")).toEqual([]);
  });
});
