"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Database, Plus, Search, X } from "lucide-react";
import { useRouter } from "next/navigation";

import type { NavigationGroup } from "@/lib/navigation";
import { getAuthorizedGlobalCommandActions } from "@/modules/module-registry";
import {
  globalSearchKindLabels,
  type GlobalSearchResponse,
  type GlobalSearchResultItem,
} from "@/modules/search/search";

interface CommandPaletteProps {
  groups: NavigationGroup[];
  permissions: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ groups, permissions, open, onOpenChange }: CommandPaletteProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [records, setRecords] = useState<GlobalSearchResultItem[]>([]);
  const [loading, setLoading] = useState(false);

  const actionResults = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const actions = getAuthorizedGlobalCommandActions(new Set(permissions));
    if (!normalized) return actions.slice(0, 8);
    return actions
      .filter((action) =>
        [action.label, action.module, ...action.keywords]
          .join(" ")
          .toLowerCase()
          .includes(normalized),
      )
      .slice(0, 8);
  }, [permissions, query]);

  const navigationResults = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const allItems = groups.flatMap((group) =>
      group.items.map((item) => ({ ...item, group: group.label })),
    );
    if (!normalized) return allItems.slice(0, 8);
    return allItems.filter((item) => item.label.toLowerCase().includes(normalized)).slice(0, 5);
  }, [groups, query]);

  useEffect(() => {
    const normalized = query.trim();
    if (!open || normalized.length < 2) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(normalized)}&limit=12`, {
          signal: controller.signal,
          credentials: "same-origin",
          cache: "no-store",
        });
        if (!response.ok) {
          setRecords([]);
          return;
        }
        const data = (await response.json()) as GlobalSearchResponse;
        setRecords(data.items);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) setRecords([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 180);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [open, query]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  function close() {
    setQuery("");
    setRecords([]);
    onOpenChange(false);
  }

  function navigate(href: string) {
    router.push(href);
    close();
  }

  const hasResults = actionResults.length > 0 || navigationResults.length > 0 || records.length > 0;

  return (
    <dialog
      className="command-dialog"
      ref={dialogRef}
      onClose={close}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      aria-labelledby="command-palette-title"
    >
      <div className="command-panel">
        <h2 className="sr-only" id="command-palette-title">
          Search AgencyOS
        </h2>
        <div className="command-search">
          <Search aria-hidden="true" size={20} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              const value = event.target.value;
              setQuery(value);
              if (value.trim().length < 2) {
                setRecords([]);
                setLoading(false);
              }
            }}
            placeholder="Search records or jump to a module…"
            aria-label="Search AgencyOS"
          />
          <kbd>Esc</kbd>
          <button
            className="icon-button"
            type="button"
            onClick={close}
            aria-label="Close navigation"
          >
            <X aria-hidden="true" size={18} />
          </button>
        </div>

        <div className="command-results" role="listbox" aria-label="Search results">
          {actionResults.length > 0 ? (
            <section className="command-section">
              <h3>Actions</h3>
              {actionResults.map((action) => (
                <button
                  className="command-result"
                  key={action.id}
                  type="button"
                  onClick={() => navigate(action.href)}
                >
                  <span className="command-result__icon">
                    <Plus aria-hidden="true" size={18} />
                  </span>
                  <span>
                    <strong>{action.label}</strong>
                    <small>{action.module}</small>
                  </span>
                  <ArrowRight aria-hidden="true" size={16} />
                </button>
              ))}
            </section>
          ) : null}

          {navigationResults.length > 0 ? (
            <section className="command-section">
              <h3>Modules</h3>
              {navigationResults.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    className="command-result"
                    key={item.href}
                    type="button"
                    onClick={() => navigate(item.href)}
                  >
                    <span className="command-result__icon">
                      <Icon aria-hidden="true" size={18} />
                    </span>
                    <span>
                      <strong>{item.label}</strong>
                      <small>{item.group}</small>
                    </span>
                    <ArrowRight aria-hidden="true" size={16} />
                  </button>
                );
              })}
            </section>
          ) : null}

          {query.trim().length >= 2 ? (
            <section className="command-section">
              <h3>{loading ? "Searching authorized records…" : "Records"}</h3>
              {records.map((item) => (
                <button
                  className="command-result"
                  key={`${item.kind}:${item.id}`}
                  type="button"
                  onClick={() => navigate(item.href)}
                >
                  <span className="command-result__icon">
                    <Database aria-hidden="true" size={18} />
                  </span>
                  <span>
                    <strong>{item.title}</strong>
                    <small>
                      {globalSearchKindLabels[item.kind]} · {item.module}
                      {item.subtitle ? ` · ${item.subtitle}` : ""}
                    </small>
                  </span>
                  <ArrowRight aria-hidden="true" size={16} />
                </button>
              ))}
              <button
                className="command-view-all"
                type="button"
                onClick={() => navigate(`/search?q=${encodeURIComponent(query.trim())}`)}
              >
                View all authorized results <ArrowRight aria-hidden="true" size={15} />
              </button>
            </section>
          ) : null}

          {!hasResults && !loading ? (
            <div className="command-empty">
              <strong>No results for “{query}”</strong>
              <span>
                Try a module, project, client, ticket, asset tag, vendor, or invoice reference.
              </span>
            </div>
          ) : null}
        </div>
      </div>
    </dialog>
  );
}
