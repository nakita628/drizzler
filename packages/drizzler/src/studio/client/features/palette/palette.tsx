import { Button, Kbd, ListBox, Modal, SearchField } from "@heroui/react";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Autocomplete } from "react-aria-components";
import {
  LuBook,
  LuColumns3,
  LuFileText,
  LuGitCompare,
  LuList,
  LuSearch,
  LuTable,
  LuTerminal,
  LuZap,
} from "react-icons/lu";
import { useDocs } from "../../hooks/index.js";
import { useUiStore } from "../../lib/store.js";
import { search, segments } from "./match.js";

type Entry = {
  readonly id: string;
  readonly label: string;
  readonly kind: string;
  readonly icon: ReactNode;
  readonly go: () => void;
};

/**
 * The chord the palette opens on, spelled the way the platform writes it. Only the label differs:
 * both Meta and Control are accepted everywhere, so a Mac keyboard on Linux is not left out.
 */
function shortcutLabel() {
  const apple = /mac|iphone|ipad/iu.test(globalThis.navigator?.platform ?? "");
  return apple ? "⌘K" : "Ctrl K";
}

/**
 * How many entries the list draws. A schema of a hundred tables has well over a thousand columns
 * and nobody reads past the first screen of them; what a query cannot narrow to this many is
 * narrowed by typing one more letter, not by scrolling.
 */
const SHOWN = 50;

/** The button that says the palette exists: in the sidebar, and on the rail it folds down to. */
export function PaletteButton({ compact = false }: { readonly compact?: boolean }) {
  const openPalette = useUiStore((s) => s.openPalette);
  const label = "Search the schema";
  if (compact) {
    return (
      <Button
        variant="ghost"
        isIconOnly
        aria-label={`${label} (${shortcutLabel()})`}
        onPress={openPalette}
      >
        <LuSearch />
      </Button>
    );
  }
  return (
    <Button variant="ghost" fullWidth className="justify-start text-muted" onPress={openPalette}>
      <LuSearch size={15} />
      <span>{label}</span>
      <Kbd className="ml-auto">{shortcutLabel()}</Kbd>
    </Button>
  );
}

/**
 * Jump to any page, table, enum or column by name. A schema of sixty tables turns the sidebar
 * into a long scroll and the diagram into a haystack; this is the way through both that does not
 * depend on spotting the thing first. Mounted once by the shell, so the chord reaches it from
 * every page.
 */
export function CommandPalette() {
  const docs = useDocs().data ?? null;
  const open = useUiStore((s) => s.paletteOpen);
  const openPalette = useUiStore((s) => s.openPalette);
  const closePalette = useUiStore((s) => s.closePalette);
  const navigate = useNavigate();
  const [query, setQuery] = useState("");

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "k" && event.key !== "K") return;
      if (!event.metaKey && !event.ctrlKey) return;
      event.preventDefault();
      openPalette();
    }
    globalThis.addEventListener("keydown", onKeyDown);
    return () => {
      globalThis.removeEventListener("keydown", onKeyDown);
    };
  }, [openPalette]);

  const entries = useMemo<readonly Entry[]>(() => {
    function page(
      to: "/" | "/schema" | "/docs" | "/query" | "/sql",
      label: string,
      icon: ReactNode,
    ) {
      return {
        id: `page:${to}`,
        label,
        kind: "Page",
        icon,
        go() {
          void navigate({ to });
        },
      };
    }
    return [
      page("/", "Schema", <LuGitCompare />),
      page("/schema", "Drizzle schema", <LuFileText />),
      page("/sql", "SQL", <LuTerminal />),
      page("/query", "Query", <LuZap />),
      page("/docs", "Docs", <LuBook />),
      ...(docs?.tables ?? []).map((table) => ({
        id: `table:${table.name}`,
        label: table.name,
        kind: "Table",
        icon: <LuTable />,
        go() {
          void navigate({ to: "/tables/$name", params: { name: table.name }, search: {} });
        },
      })),
      ...(docs?.enums ?? []).map((value) => ({
        id: `enum:${value.name}`,
        label: value.name,
        kind: "Enum",
        icon: <LuList />,
        go() {
          void navigate({ to: "/enums/$name", params: { name: value.name } });
        },
      })),
      // Last, because they are the many: a schema's columns outnumber everything above them, and
      // an empty query should open on the pages rather than on `account.id`. Written with their
      // table in front, so `usemail` reaches `user.email` and `email` reaches every table that
      // has one.
      ...(docs?.tables ?? []).flatMap((table) =>
        table.columns.map((column) => ({
          id: `column:${table.name}.${column.name}`,
          label: `${table.name}.${column.name}`,
          kind: "Column",
          icon: <LuColumns3 />,
          go() {
            void navigate({
              to: "/tables/$name",
              params: { name: table.name },
              search: { tab: "columns", column: column.name },
            });
          },
        })),
      ),
    ];
  }, [docs, navigate]);

  const found = useMemo(() => search(entries, query), [entries, query]);
  const matches = found.slice(0, SHOWN);

  function close() {
    closePalette();
    setQuery("");
  }

  return (
    <Modal.Backdrop
      isOpen={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) close();
      }}
    >
      <Modal.Container placement="top" size="lg">
        <Modal.Dialog aria-label="Search the schema" className="p-0">
          {/*
            The ranking is the studio's (match.ts), so the list is handed over already sorted and
            the autocomplete only carries the arrow keys from the box to the list. The search box
            clears itself on Escape before anything else sees the key, which would make leaving
            the palette take two presses; the panel says `Esc`, so Escape leaves.
          */}
          <div
            onKeyDownCapture={(event) => {
              if (event.key === "Escape") close();
            }}
          >
            <Autocomplete inputValue={query} onInputChange={setQuery}>
              {/* oxlint-disable-next-line jsx-a11y/no-autofocus -- a palette opened by a chord is a
                box to type in; the focus is what was asked for */}
              <SearchField autoFocus aria-label="Search pages, tables, enums and columns">
                <SearchField.Group className="rounded-none border-0 border-b border-line shadow-none">
                  <SearchField.SearchIcon />
                  <SearchField.Input placeholder="Search pages, tables, enums and columns…" />
                  <Kbd>Esc</Kbd>
                </SearchField.Group>
              </SearchField>
              <ListBox
                aria-label="Results"
                items={matches}
                className="max-h-[50vh] overflow-y-auto p-1.5"
                renderEmptyState={() => (
                  <p className="m-0 px-4 py-6 text-center text-body text-muted">
                    Nothing matches “{query.trim()}”.
                  </p>
                )}
                onAction={(key) => {
                  const entry = matches.find((match) => match.item.id === key)?.item;
                  close();
                  entry?.go();
                }}
              >
                {({ item, indices }) => (
                  <ListBox.Item id={item.id} textValue={item.label} className="gap-2.5">
                    <span className="shrink-0 text-faint">{item.icon}</span>
                    <span className="min-w-0 flex-1 truncate font-mono">
                      {segments(item.label, indices).map((run) =>
                        run.matched ? (
                          <b key={run.start} className="font-semibold text-accent-text underline">
                            {run.text}
                          </b>
                        ) : (
                          <span key={run.start}>{run.text}</span>
                        ),
                      )}
                    </span>
                    <span className="shrink-0 text-meta text-faint uppercase">{item.kind}</span>
                  </ListBox.Item>
                )}
              </ListBox>
            </Autocomplete>
          </div>
          {found.length > matches.length ? (
            <p className="m-0 border-t border-line px-4 py-2 text-center text-meta text-faint">
              {(found.length - matches.length).toLocaleString()} more — keep typing to narrow them
            </p>
          ) : null}
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
