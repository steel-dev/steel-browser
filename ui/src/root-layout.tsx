import { ThemeProvider } from "@/components/theme-provider";
import { QueryClientProvider } from "@tanstack/react-query";
import { SessionsProvider } from "./contexts/sessions-context";
import { queryClient } from "./lib/query-client";
import { SessionContainer } from "./containers/session-container";
import { Header } from "@/components/header";
import { Toaster } from "@/components/ui/toaster";
import { BrowserRouter, Route, Routes } from "react-router-dom";

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <SessionsProvider>
        <ThemeProvider defaultTheme="dark" storageKey="steel-ui-theme">
          {/* The combined API image serves the UI under /ui (vite --base=/ui),
              so the router has to match routes against that base too. */}
          <BrowserRouter basename={import.meta.env.BASE_URL}>
            <div className="flex flex-col h-screen overflow-hidden max-h-screen items-center justify-center flex-1 bg-secondary text-primary-foreground">
              <Header />
              <div className="flex flex-col overflow-hidden flex-1 w-full">
                <Routes>
                  <Route path="/sessions/:id" element={<SessionContainer />} />
                  {/* Every other path keeps rendering the viewer, as it did
                      before routing existed. */}
                  <Route path="*" element={<SessionContainer />} />
                </Routes>
              </div>
            </div>
          </BrowserRouter>
          <Toaster />
        </ThemeProvider>
      </SessionsProvider>
    </QueryClientProvider>
  );
}
