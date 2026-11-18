import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.roomledger.app",
  appName: "Room Ledger",
  webDir: ".output/public",
  server: {
    url: "https://c67-seven.vercel.app",
    cleartext: false,
  },
  android: {
    backgroundColor: "#ffffff",
  },
};

export default config;
