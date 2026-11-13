import { Toast } from "@heroui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { IconContext } from "react-icons";
import { routeTree } from "./routeTree.gen.js";

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } },
});

// Every icon is 16px in the colour of the text around it, and hidden from screen readers:
// labels and aria-labels are what a reader hears.
const ICONS = { size: "16", attr: { "aria-hidden": true } } as const;
const router = createRouter({ routeTree, context: { queryClient } });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element not found");

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <IconContext value={ICONS}>
        <RouterProvider router={router} />
        <Toast.Provider placement="bottom end" />
      </IconContext>
    </QueryClientProvider>
  </StrictMode>,
);
