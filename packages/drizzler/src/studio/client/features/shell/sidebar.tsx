import { Button } from "@heroui/react";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import {
  LuBook,
  LuDroplet,
  LuFileText,
  LuGitCompare,
  LuList,
  LuMoon,
  LuPanelLeft,
  LuSun,
  LuTable,
  LuTerminal,
  LuZap,
} from "react-icons/lu";
import { useDb, useDbCounts, useDocs, useSchema } from "../../hooks/index.js";
import { useUiStore } from "../../lib/store.js";
import { PaletteButton } from "../palette/palette.js";

const NAV = "flex items-center gap-2.5 rounded-lg px-3 py-2 text-lead";
const NAV_ACTIVE = { className: `${NAV} bg-accent-soft font-semibold text-accent-text` } as const;
const NAV_INACTIVE = { className: `${NAV} hover:bg-canvas` } as const;

const ENTITY = "flex items-center gap-2 rounded-lg border px-3 py-[7px] font-mono text-body";
const ENTITY_ACTIVE = {
  className: `${ENTITY} border-accent bg-accent-soft font-semibold text-accent-text`,
} as const;
const ENTITY_INACTIVE = { className: `${ENTITY} border-transparent hover:bg-canvas` } as const;

function NavLink({
  to,
  icon,
  children,
}: {
  readonly to: "/" | "/schema" | "/docs" | "/query" | "/sql";
  readonly icon: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <Link
      to={to}
      activeOptions={{ exact: true }}
      activeProps={NAV_ACTIVE}
      inactiveProps={NAV_INACTIVE}
    >
      <span className="inline-flex opacity-85">{icon}</span>
      <span>{children}</span>
    </Link>
  );
}

// Green while followed, red when lost, grey while waiting.
function dotColor(on: boolean, warn: boolean) {
  if (on) return "bg-ok ring-[3px] ring-ok/20";
  return warn ? "bg-danger" : "bg-faint";
}

const CONNECTION_LABELS = {
  live: "Watching",
  offline: "Disconnected",
  connecting: "Connecting",
} as const;

function databaseLabel(
  db: {
    readonly connected: boolean;
    readonly dialect: string | null;
    readonly url: string | null;
    readonly error: string | null;
  } | null,
) {
  if (db === null) return "Database: checking…";
  if (db.connected) return `${db.dialect ?? "database"} · ${db.url ?? ""}`;
  return db.error ? "Database not connected" : "No database connected";
}

function StatusDot({ on, warn = false }: { readonly on: boolean; readonly warn?: boolean }) {
  return <span className={`size-2 shrink-0 rounded-full ${dotColor(on, warn)}`} />;
}

/**
 * The studio's navigation: the pages, the tables of the schema with their row counts, its enums,
 * and whether the file and the database are being followed.
 */
export function Sidebar() {
  const file = useSchema().data?.file ?? null;
  const docs = useDocs().data ?? null;
  const db = useDb().data ?? null;
  const connected = db?.connected === true;
  const counts = useDbCounts({ query: { enabled: connected, retry: false } }).data?.counts ?? {};
  const connection = useUiStore((s) => s.connection);
  const theme = useUiStore((s) => s.theme);
  const toggleTheme = useUiStore((s) => s.toggleTheme);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const tables = docs?.tables ?? [];
  const enums = docs?.enums ?? [];
  const status = CONNECTION_LABELS[connection];
  return (
    <aside className="flex min-h-0 flex-col overflow-y-auto border-r border-line bg-surface">
      <div className="flex items-center gap-1.5 px-[18px] pt-[18px] pb-3.5">
        <Link className="flex min-w-0 items-center gap-2 text-lead font-bold tracking-tight" to="/">
          <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent text-white">
            <LuDroplet size={18} />
          </span>
          <span className="truncate">Drizzler Studio</span>
        </Link>
        <Button
          variant="ghost"
          size="sm"
          isIconOnly
          className="ml-auto size-7 shrink-0 text-muted"
          aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          onPress={toggleTheme}
        >
          {theme === "dark" ? <LuSun /> : <LuMoon />}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          isIconOnly
          className="size-7 shrink-0 text-muted"
          aria-label="Hide the sidebar"
          onPress={toggleSidebar}
        >
          <LuPanelLeft />
        </Button>
      </div>
      <div className="px-2.5 pb-2">
        <PaletteButton />
      </div>
      <nav className="flex flex-col gap-0.5 px-2.5 pb-3">
        <NavLink to="/" icon={<LuGitCompare />}>
          Schema
        </NavLink>
        <NavLink to="/schema" icon={<LuFileText />}>
          Drizzle schema
        </NavLink>
        <NavLink to="/sql" icon={<LuTerminal />}>
          SQL
        </NavLink>
        <NavLink to="/query" icon={<LuZap />}>
          Query
        </NavLink>
        <NavLink to="/docs" icon={<LuBook />}>
          Docs
        </NavLink>
      </nav>
      <div className="px-2.5 pb-2.5">
        <div className="heading px-3 pt-2.5 pb-1.5">Tables</div>
        <ul className="m-0 list-none p-0">
          {tables.map((table) => (
            <li key={table.name}>
              <Link
                to="/tables/$name"
                params={{ name: table.name }}
                search={{}}
                activeProps={ENTITY_ACTIVE}
                inactiveProps={ENTITY_INACTIVE}
              >
                {({ isActive }) => (
                  <>
                    <span className={`shrink-0 ${isActive ? "text-accent" : "text-faint"}`}>
                      <LuTable size={15} />
                    </span>
                    <span className="flex-1 truncate">{table.name}</span>
                    {counts[table.name] === undefined ? null : (
                      <span className="text-meta font-normal text-faint tabular-nums">
                        {counts[table.name]}
                      </span>
                    )}
                  </>
                )}
              </Link>
            </li>
          ))}
        </ul>
        {docs !== null && tables.length === 0 ? (
          <p className="m-0 px-3 py-2 text-meta text-faint">No tables in the schema.</p>
        ) : null}
      </div>
      {enums.length > 0 ? (
        <div className="px-2.5 pb-2.5">
          <div className="heading px-3 pt-2.5 pb-1.5">Enums</div>
          <ul className="m-0 list-none p-0">
            {enums.map((value) => (
              <li key={value.name}>
                <Link
                  to="/enums/$name"
                  params={{ name: value.name }}
                  activeProps={ENTITY_ACTIVE}
                  inactiveProps={ENTITY_INACTIVE}
                >
                  {({ isActive }) => (
                    <>
                      <span className={`shrink-0 ${isActive ? "text-accent" : "text-faint"}`}>
                        <LuList size={15} />
                      </span>
                      <span className="flex-1 truncate">{value.name}</span>
                    </>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="mt-auto flex flex-col gap-1 border-t border-line px-[18px] py-3 text-code text-muted">
        <div className="flex items-center gap-2">
          <StatusDot on={connection === "live"} warn={connection === "offline"} />
          <span className="truncate">
            {status}
            {file ? ` · ${file}` : ""}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <StatusDot on={connected} warn={(db?.error ?? null) !== null} />
          <span
            className="truncate"
            title={
              db?.error ??
              (connected
                ? undefined
                : "Start the studio with --url, or set DATABASE_URL, to browse and edit rows.")
            }
          >
            {databaseLabel(db)}
          </span>
        </div>
      </div>
    </aside>
  );
}
