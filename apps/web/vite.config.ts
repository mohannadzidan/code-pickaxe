import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import { tanstackRouter } from '@tanstack/router-vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import tsconfigPaths from 'vite-tsconfig-paths';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), tanstackRouter(), tsconfigPaths()],
});
