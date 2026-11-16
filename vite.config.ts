import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

// Resolve the app version at build time:
// 1. VITE_APP_VERSION env var (set by CI from the GitHub Release tag)
// 2. Whichever is higher between the latest Git tag and package.json version
const resolveAppVersion = (): string => {
  const fromEnv = process.env.VITE_APP_VERSION?.trim()
  if (fromEnv) return fromEnv.replace(/^v/, '')

  const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'))
  const pkgVersion = pkg.version ? String(pkg.version).replace(/^v/, '') : ''

  let gitTagVersion = ''
  try {
    const tag = execSync('git describe --tags --abbrev=0', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
    if (tag) gitTagVersion = tag.replace(/^v/, '')
  } catch {
    // Not a git checkout (e.g. Docker build) or no tags
  }

  if (gitTagVersion && pkgVersion) {
    return gitTagVersion.localeCompare(pkgVersion, undefined, { numeric: true, sensitivity: 'base' }) >= 0
      ? gitTagVersion
      : pkgVersion
  }

  return gitTagVersion || pkgVersion || '0.0.0'
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE_PATH || '/',
  define: {
    __APP_VERSION__: JSON.stringify(resolveAppVersion()),
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
})
