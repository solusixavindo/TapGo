import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          green: "#00a870",
          ink: "#111827"
        }
      }
    }
  },
  plugins: []
};

export default config;
