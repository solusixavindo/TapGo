import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          blue: "#0B66E4",
          cyan: "#13B8C8",
          green: "#12B981",
          navy: "#08233F",
          ink: "#102033",
          mist: "#F4FAFB"
        }
      },
      boxShadow: {
        glow: "0 24px 80px rgba(11, 102, 228, 0.16)",
        glass: "0 24px 70px rgba(8, 35, 63, 0.12)"
      }
    }
  },
  plugins: []
};

export default config;
