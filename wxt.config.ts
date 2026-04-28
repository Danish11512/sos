import { defineConfig } from "wxt"

export default defineConfig({
  srcDir: "src",
  manifest: {
    name: "SOS",
    version: "0.0.1",
    description: "Auto-apply to jobs with per-site presets",
    permissions: ["storage", "tabs"],
    action: {},
  },
})
