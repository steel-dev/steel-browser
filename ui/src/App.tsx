import "@fontsource/inter";
import "@radix-ui/themes/styles.css";
import RootLayout from "@/root-layout";
import { client } from "@/steel-client";
import { env } from "@/env";

client.setConfig({
  baseUrl: env.VITE_API_URL,
});

function App() {
  return <RootLayout />;
}

export default App;
