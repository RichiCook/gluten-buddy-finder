import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.lovable.glutenbaby',
  appName: 'Gluten Baby',
  webDir: 'dist',
  server: {
    url: 'https://0a9c4497-4df2-491e-b682-34391186be63.lovableproject.com?forceHideBadge=true',
    cleartext: true,
  },
};

export default config;
