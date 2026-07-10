import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/bin.ts"],
  format: ["esm"],
  platform: "node",
  dts: true,
  clean: true,
  deps: {
    alwaysBundle: [/.*/],
  },
});

