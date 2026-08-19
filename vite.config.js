import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base: './' makes the build use relative asset paths, so it works
// correctly on GitHub Pages regardless of the repository name
// (https://<user>.github.io/<any-repo-name>/) without editing this file.
export default defineConfig({
  plugins: [react()],
  base: "./",
});
