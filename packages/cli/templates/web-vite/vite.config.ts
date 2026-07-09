import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // Served behind the gateway at __MOUNT__; all asset URLs must be prefixed.
  base: "__MOUNT__/",
  plugins: [cloudflare(), react()],
});
