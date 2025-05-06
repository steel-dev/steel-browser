import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default {
  mode: "production",
  entry: {
    inject: path.resolve(__dirname, "src/inject.js"),
    background: path.resolve(__dirname, "src/background.js"),
  },
  output: {
    filename: "[name].js",
    path: path.resolve(__dirname, "dist"),
  },
  optimization: {
    minimize: false,
  },
};
