import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
export default {
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  resolve: { alias: { "@": path.resolve(here, "../src") } },
  esbuild: { jsx: "automatic" },
  build: {
    outDir: path.resolve(
      here,
      "../../../services/office-editor/workspace-dist",
    ),
    lib: {
      entry: path.join(here, "main.tsx"),
      formats: ["iife"],
      name: "PresentWorkspace",
      fileName: () => "workspace.js",
      cssFileName: "workspace",
    },
  },
};
