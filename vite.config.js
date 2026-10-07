import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [tailwindcss(), react()],

  server: {
    // Stop chokidar from scanning multi-GB dev-only folders. On Windows, a
    // single unignored .venv adds tens of thousands of files to the watcher
    // and makes `npm run dev` startup and HMR visibly slow.
    watch: {
      ignored: [
        '**/models/.venv/**',
        '**/models/saved_model/**',
        '**/models/*.onnx',
        '**/tfjs_env/**',
        '**/tfjs_conversion_pipeline/venv/**',
        '**/model_raw/**',
        '**/.venv/**',
        '**/SweetCherry_*.docx',
        '**/SweetCherry_*.pptx',
        '**/~$*',
        '**/*.docx',
        '**/*.pptx',
      ],
    },
    // Also hide these from Vite's file-system access during dev so deep links
    // can't accidentally reach them.
    fs: {
      deny: ['.env', '.env.*', '*.{crt,pem,key}', '**/.git/**', '**/.venv/**', '**/tfjs_env/**', '**/tfjs_conversion_pipeline/**', '**/model_raw/**'],
    },
  },

  // Pre-bundle heavy browser deps so dev server doesn't re-process them on
  // every page load once Edge AI wiring lands.
  optimizeDeps: {
    include: ['@tensorflow/tfjs-core', '@tensorflow/tfjs-converter', '@tensorflow/tfjs-backend-cpu', '@tensorflow/tfjs-backend-webgl'],
  },

  build: {
    // Raise warning threshold — xlsx is large but only used in Admin
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        // A manual chunk also takes every dependency not claimed by another
        // manual chunk. With React unclaimed it landed in the recharts chunk,
        // and every page, the landing page included, downloaded recharts.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react';
          // xlsx: loaded only when Admin opens the Excel upload
          if (/[\\/]node_modules[\\/]xlsx[\\/]/.test(id)) return 'xlsx';
          // Recharts and its charting dependencies: only the dashboards draw charts
          if (/[\\/]node_modules[\\/](recharts|d3-[^\\/]+|victory-vendor|internmap|decimal\.js-light)[\\/]/.test(id)) return 'recharts';
          // Firebase SDKs chunked together
          if (/[\\/]node_modules[\\/](firebase|@firebase)[\\/]/.test(id)) return 'firebase';
          // TFJS: only loaded when the model tester runs
          if (/[\\/]node_modules[\\/]@tensorflow[\\/]/.test(id)) return 'tfjs';
          return undefined;
        },
      },
    },
  },
})
