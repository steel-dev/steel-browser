import { ThemeProvider } from "@/components/theme-provider";
import { QueryClientProvider } from "react-query";
import { SessionsProvider } from "./contexts/sessions-context";
import { queryClient } from "./lib/query-client";
import { Header } from "@/components/header";
import { Toaster } from "@/components/ui/toaster";
import { client } from "@/steel-client";
import { Options } from "@hey-api/client-fetch";
import { useEffect } from "react";
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  useEffect(() => {
    const token = localStorage.getItem("auth_token");
    const options: Options = {
      baseUrl: import.meta.env.VITE_API_URL,
    };

    if (token) {
      options.headers = {
        Authorization: `Bearer ${token}`,
      };
    }
    client.setConfig(options);
    console.log("client", client);
  }, []);
  return (
    <QueryClientProvider client={queryClient}>
      <SessionsProvider>
        <ThemeProvider defaultTheme="dark" storageKey="steel-ui-theme">
          <div className="flex flex-col items-center justify-center flex-1 h-screen max-h-screen overflow-hidden bg-secondary text-primary-foreground">
            <Header />
            <div className="flex flex-col flex-1 w-full overflow-hidden">
              {children}
            </div>
          </div>
          <Toaster />
        </ThemeProvider>
      </SessionsProvider>
    </QueryClientProvider>
  );
}
