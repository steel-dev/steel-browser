import { ThemeProvider } from "@/components/theme-provider";
import { QueryClientProvider } from "@tanstack/react-query";
import { SessionsProvider } from "./contexts/sessions-context";
import { queryClient } from "./lib/query-client";
import { SessionContainer } from "./containers/session-container";
import { Header } from "@/components/header";
import { Toaster } from "@/components/ui/toaster";

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <SessionsProvider>
        <ThemeProvider defaultTheme="dark" storageKey="steel-ui-theme">
          <div className="flex flex-col h-screen overflow-hidden max-h-screen items-center justify-center flex-1 bg-secondary text-primary-foreground">
            <Header />
            <div className="flex flex-col overflow-hidden flex-1 w-full">
              <SessionContainer />
            </div>
          </div>
          <Toaster />
        </ThemeProvider>
      </SessionsProvider>
    </QueryClientProvider>
  );
}
