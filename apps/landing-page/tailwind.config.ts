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
          mist: "#F4FAFB",
          // Warna identitas TapGo yang sesungguhnya (sama dengan
          // admin_dashboard/tailwind.config.ts dan logo lion-shield resmi) —
          // dipakai di seluruh halaman situs ini untuk konsisten dengan
          // produk lain. Token biru/hijau terang di atas masih dipakai
          // sebagai warna aksen (mis. tombol WhatsApp hijau), bukan tema latar.
          gold: "#FFC857",
          goldDark: "#E0AE3F",
          navyDeep: "#04101C",
          navySoft: "#0E2C4C"
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
