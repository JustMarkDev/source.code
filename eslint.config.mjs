import { defineConfig, globalIgnores } from 'eslint/config'
import { tanstackConfig } from '@tanstack/eslint-config'
import convexPlugin from '@convex-dev/eslint-plugin'

export default defineConfig([
  ...tanstackConfig,
  ...convexPlugin.configs.recommended,
  // Dither Kit is vendored from its shadcn registry; keep it as shipped so `dither-kit update` stays a clean overwrite.
  globalIgnores(['convex/_generated', 'src/components/dither-kit']),
])
