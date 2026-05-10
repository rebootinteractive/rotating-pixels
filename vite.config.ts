import { defineConfig } from 'vite';

// Relative base so the build works on GitHub Pages at any repo subpath
// (e.g. user.github.io/RotatingPixels/) without needing to hardcode the name.
export default defineConfig({
  base: './',
  server: {
    port: 5173,
  },
  build: {
    target: 'es2022',
  },
});
