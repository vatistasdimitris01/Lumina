import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  
  // Load Firebase config if it exists
  let firebaseEnv = {};
  const firebaseConfigPath = path.resolve(__dirname, 'firebase-applet-config.json');
  if (fs.existsSync(firebaseConfigPath)) {
    try {
      const firebaseConfig = JSON.parse(fs.readFileSync(firebaseConfigPath, 'utf-8'));
      firebaseEnv = {
        'VITE_FIREBASE_API_KEY': firebaseConfig.apiKey,
        'VITE_FIREBASE_AUTH_DOMAIN': firebaseConfig.authDomain,
        'VITE_FIREBASE_PROJECT_ID': firebaseConfig.projectId,
        'VITE_FIREBASE_STORAGE_BUCKET': firebaseConfig.storageBucket,
        'VITE_FIREBASE_MESSAGING_SENDER_ID': firebaseConfig.messagingSenderId,
        'VITE_FIREBASE_APP_ID': firebaseConfig.appId,
        'VITE_FIREBASE_MEASUREMENT_ID': firebaseConfig.measurementId,
        'VITE_FIREBASE_FIRESTORE_DATABASE_ID': firebaseConfig.firestoreDatabaseId,
      };
    } catch (e) {
      console.error('Error parsing firebase-applet-config.json', e);
    }
  }

  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      // Inject Firebase config for local development and build
      ...Object.keys(firebaseEnv).reduce((acc, key) => {
        acc[`import.meta.env.${key}`] = JSON.stringify(firebaseEnv[key]);
        return acc;
      }, {}),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
