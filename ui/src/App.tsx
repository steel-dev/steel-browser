import "@fontsource/inter";
import "@radix-ui/themes/styles.css";
import RootLayout from "@/root-layout";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Login } from "@/pages/Login";
import { useEffect, useState } from "react";
import { SessionsProvider } from "@/contexts/sessions-context/sessions-context";
import { client, getSessions } from "@/steel-client";
import { SessionContainer } from "./containers/session-container";

client.setConfig({
  baseUrl: import.meta.env.VITE_API_URL,
});

type ProtectedRouteProps = {
  children: React.ReactNode;
};

function ProtectedRoute({ children }: ProtectedRouteProps) {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const { error, data } = await getSessions();
        if (error || !data) {
          throw error;
        }
        setIsAuthenticated(true);
      } catch (err) {
        setIsAuthenticated(false);
        localStorage.removeItem("auth_token");
      }
    };

    checkAuth();
  }, []);

  if (isAuthenticated === null) {
    // You might want to show a loading spinner here
    return null;
  }

  return isAuthenticated ? children : <Navigate to="/login" />;
}

function App() {
  return (
    <SessionsProvider>
      <RootLayout>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <SessionContainer />
                </ProtectedRoute>
              }
            />
          </Routes>
        </BrowserRouter>
      </RootLayout>
    </SessionsProvider>
  );
}

export default App;
