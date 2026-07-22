import { defineConfig } from "tsdown"

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "node20",
  dts: true,
  clean: true,
  exports: {
    devExports: true,
  },
  publint: true,
  unbundle: true,
})
