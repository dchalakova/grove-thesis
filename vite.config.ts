import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages project sites are served under /<repo-name>/; Vite must match or assets 404.
// CI is set in GitHub Actions so local `npm run dev` keeps base `/`.
const base = process.env.CI ? '/grove-thesis/' : '/'

// https://vite.dev/config/
export default defineConfig({
  base,
  plugins: [react()],
})
