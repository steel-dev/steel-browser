import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import crossOriginIsolation from 'vite-plugin-cross-origin-isolation'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), crossOriginIsolation()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
