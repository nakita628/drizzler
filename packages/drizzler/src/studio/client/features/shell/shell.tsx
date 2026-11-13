import { Button } from "@heroui/react";
import { Link, Outlet, useLocation } from "@tanstack/react-router";
import { LuPanelLeft } from "react-icons/lu";
import { SchemaErrorBanner } from "../../components/schema-error-banner.js";
import { useSchema } from "../../hooks/index.js";
import { useSchemaFileEvents } from "../../lib/events.js";
import { useUiStore } from "../../lib/store.js";
import { CommandPalette, PaletteButton } from "../palette/palette.js";
import { Sidebar } from "./sidebar.js";

/** The frame around every page: the sidebar, the schema-error banner and the routed page. */
export function Shell() {
  useSchemaFileEvents();
  const parseError = useSchema().data?.parseError ?? null;
  const pathname = useLocation({ select: (location) => location.pathname });
  const open = useUiStore((s) => s.sidebarOpen);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  return (
    <div
      className={`grid h-full ${open ? "grid-cols-[250px_minmax(0,1fr)]" : "grid-cols-[40px_minmax(0,1fr)]"}`}
    >
      {open ? (
        <Sidebar />
      ) : (
        // Folded away, the sidebar leaves a rail behind: the page keeps its place and the way back
        // is where the way out was.
        <div className="flex flex-col items-center gap-1 border-r border-line bg-surface pt-3">
          <Button
            variant="ghost"
            isIconOnly
            className="text-muted"
            aria-label="Show the sidebar"
            onPress={toggleSidebar}
          >
            <LuPanelLeft />
          </Button>
          <PaletteButton compact />
        </div>
      )}
      <main className="flex min-h-0 min-w-0 flex-col overflow-hidden">
        {/* The editor shows the error where it is; every other page says so in one line. */}
        {parseError !== null && pathname !== "/schema" ? (
          <SchemaErrorBanner
            error={parseError}
            note="Showing the last version that parsed."
            action={
              <Link className="shrink-0 underline" to="/schema" search={{ line: parseError.line }}>
                Fix it in the editor
              </Link>
            }
          />
        ) : null}
        <Outlet />
      </main>
      <CommandPalette />
    </div>
  );
}
