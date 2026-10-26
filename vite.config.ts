import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

// Resolve the app version at build time:
// 1. VITE_APP_VERSION env var (set by CI from the GitHub Release tag)
// 2. Latest Git tag
// 3. package.json version
const resolveAppVersion = (): string => {
  const fromEnv = process.env.VITE_APP_VERSION?.trim()
  if (fromEnv) return fromEnv.replace(/^v/, '')

  try {
    const tag = execSync('git describe --tags --abbrev=0', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
    if (tag) return tag.replace(/^v/, '')
  } catch {
    // Not a git checkout (e.g. Docker build) or no tags - fall through
  }

  const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'))
  return String(pkg.version).replace(/^v/, '')
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE_PATH || '/',
  define: {
    __APP_VERSION__: JSON.stringify(resolveAppVersion()),
  },
})
