"use client";

import * as Popover from "@radix-ui/react-popover";
import { History, Search, X } from "lucide-react";
import { useId, useImperativeHandle, useRef, useState, type Ref } from "react";

import { clearRecentSearches, readRecentSearches, rememberRecentSearch, type RecentSearchScope } from "@/lib/recent-searches";
import { cn } from "@/lib/utils";

type RecentSearchInputProps = {
  scope: RecentSearchScope;
  value: string;
  onValueChange: (value: string) => void;
  label: string;
  placeholder: string;
  inputRef?: Ref<HTMLInputElement>;
  className?: string;
  showShortcut?: boolean;
  showClear?: boolean;
};

export function RecentSearchInput({ scope, value, onValueChange, label, placeholder, inputRef, className, showShortcut = false, showClear = true }: RecentSearchInputProps) {
  const listboxId = useId();
  const anchorRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLInputElement>(null);
  const forgetRef = useRef<HTMLButtonElement>(null);
  const composing = useRef(false);
  const interacting = useRef(false);
  const restoringFocus = useRef(false);
  const finalizedValue = useRef<string | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const visible = open && recent.length > 0;
  useImperativeHandle(inputRef, () => fieldRef.current!, []);

  function closeHistory() { setOpen(false); setActiveIndex(-1); }
  function openHistory() {
    if (restoringFocus.current) return;
    interacting.current = false;
    setRecent(readRecentSearches(scope));
    setActiveIndex(-1);
    setOpen(true);
  }
  function remember(valueToSave: string) {
    if (valueToSave === finalizedValue.current) return;
    finalizedValue.current = valueToSave;
    setRecent(rememberRecentSearch(scope, valueToSave));
  }
  function focusField() {
    restoringFocus.current = true;
    fieldRef.current?.focus({ preventScroll: true });
    restoringFocus.current = false;
  }
  function select(term: string) {
    finalizedValue.current = term;
    setRecent(rememberRecentSearch(scope, term));
    onValueChange(term);
    interacting.current = false;
    closeHistory();
    focusField();
  }

  return <Popover.Root open={visible} onOpenChange={(nextOpen) => { if (!nextOpen) closeHistory(); }}>
    <Popover.Anchor asChild><div ref={anchorRef} className={cn("recent-search", className)}>
      <Search aria-hidden="true" className="size-4" />
      <input ref={fieldRef} type="search" role="combobox" aria-label={label} aria-autocomplete="list" aria-haspopup="listbox"
        aria-expanded={visible} aria-controls={visible ? listboxId : undefined}
        aria-activedescendant={visible && activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined}
        autoComplete="off" placeholder={placeholder} value={value}
        onFocus={openHistory} onClick={openHistory}
        onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
        onChange={(event) => {
          if (!event.target.value && value) remember(value);
          finalizedValue.current = null;
          onValueChange(event.target.value);
          closeHistory();
        }}
        onBlur={(event) => {
          if (interacting.current || (event.relatedTarget instanceof Node && contentRef.current?.contains(event.relatedTarget))) return;
          if (!composing.current) remember(value);
          closeHistory();
        }}
        onKeyDown={(event) => {
          if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            const terms = readRecentSearches(scope);
            if (!terms.length) return;
            event.preventDefault();
            setRecent(terms);
            setOpen(true);
            setActiveIndex((current) => !visible || current < 0
              ? event.key === "ArrowDown" ? 0 : terms.length - 1
              : (current + (event.key === "ArrowDown" ? 1 : -1) + terms.length) % terms.length);
          } else if (event.key === "Enter") {
            event.preventDefault();
            if (visible && activeIndex >= 0 && recent[activeIndex]) select(recent[activeIndex]);
            else { remember(value); closeHistory(); }
          } else if (event.key === "Escape") {
            if (visible) { event.preventDefault(); event.stopPropagation(); }
            closeHistory();
          } else if (event.key === "Tab" && !event.altKey && !event.ctrlKey && !event.metaKey) {
            if (visible && !event.shiftKey && forgetRef.current) {
              event.preventDefault();
              setActiveIndex(-1);
              forgetRef.current.focus();
            } else closeHistory();
          }
        }} />
      {showClear && value ? <button type="button" className={cn("recent-search-clear", className?.includes("places-search") && "places-search-clear")}
        aria-label="Effacer la recherche" onPointerDown={(event) => event.preventDefault()}
        onClick={() => { remember(value); finalizedValue.current = ""; onValueChange(""); closeHistory(); focusField(); }}>
        <X aria-hidden="true" className="size-4" />
      </button> : null}
      {showShortcut ? <kbd aria-hidden="true">⌘ K</kbd> : null}
    </div></Popover.Anchor>
    <Popover.Portal><Popover.Content ref={contentRef} className="recent-search-popover" role="presentation" side="bottom" sideOffset={6} align="start" collisionPadding={12}
      onOpenAutoFocus={(event) => event.preventDefault()} onCloseAutoFocus={(event) => event.preventDefault()}
      onInteractOutside={(event) => {
        if (event.target instanceof Node && anchorRef.current?.contains(event.target)) event.preventDefault();
        else interacting.current = false;
      }}>
      <div className="recent-search-heading">Recherches récentes</div>
      <div id={listboxId} role="listbox" aria-label="Recherches récentes" className="recent-search-list">
        {recent.map((term, index) => <button key={term} id={`${listboxId}-${index}`} type="button" role="option" tabIndex={-1}
          aria-selected={index === activeIndex} className={cn("recent-search-option", index === activeIndex && "is-active")}
          onPointerMove={() => setActiveIndex(index)} onPointerDown={() => { interacting.current = true; }}
          onPointerCancel={() => { interacting.current = false; }} onMouseDown={(event) => event.preventDefault()}
          onClick={() => select(term)}><History aria-hidden="true" className="size-4" /><span className="truncate">{term}</span></button>)}
      </div>
      <button ref={forgetRef} type="button" className="recent-search-forget" tabIndex={visible ? 0 : -1}
        onKeyDown={(event) => {
          if (event.key === "Tab" && !event.altKey && !event.ctrlKey && !event.metaKey) {
            event.stopPropagation();
            if (event.shiftKey) event.preventDefault();
            else closeHistory();
            // Let forward Tab continue from the input's natural position, not the portal.
            focusField();
          } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            closeHistory();
            focusField();
          }
        }}
        onBlur={(event) => {
          if (event.relatedTarget instanceof Node && (anchorRef.current?.contains(event.relatedTarget) || contentRef.current?.contains(event.relatedTarget))) return;
          remember(value);
          closeHistory();
        }}
        onPointerDown={() => { interacting.current = true; }}
        onPointerCancel={() => { interacting.current = false; }} onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          clearRecentSearches(scope);
          finalizedValue.current = value;
          interacting.current = false;
          setRecent([]);
          closeHistory();
          focusField();
        }}>Effacer l’historique</button>
    </Popover.Content></Popover.Portal>
  </Popover.Root>;
}
