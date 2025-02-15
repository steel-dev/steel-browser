import "@fontsource/inter";
import "@radix-ui/themes/styles.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import RootLayout from "@/root-layout";
import { client } from "@/steel-client";
import { env } from "@/env";
import { HomePage } from "./pages/home-page";
import { PlaygroundPage } from "./pages/playground-page";

client.setConfig({
  baseUrl: env.VITE_API_URL,
});

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<RootLayout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/playground" element={<PlaygroundPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;