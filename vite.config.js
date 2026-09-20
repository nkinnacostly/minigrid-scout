import { defineConfig, loadEnv } from 'vite';
import cesium from 'vite-plugin-cesium';
import { minigridApi } from './server/api.js';

// Keys are optional: without them the app runs on the free Esri imagery.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [
      cesium(),
      minigridApi({ googleApiKey: env.GOOGLE_MAPS_API_KEY, ionToken: env.CESIUM_ION_TOKEN }),
    ],
    server: {
      host: 'localhost',
      port: 5178,
      fs: { deny: ['.env', '.env.*', '**/.git/**'] },
    },
    preview: { host: 'localhost', port: 5178 },
  };
});
