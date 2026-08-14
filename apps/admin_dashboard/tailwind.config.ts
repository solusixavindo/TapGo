import type { Config } from "tailwindcss";

/*
 * Palet diambil dari situs tapgolion.id dan aplikasi TapGo Driver, supaya
 * konsol admin terasa bagian dari sistem yang sama — bukan alat terpisah.
 *
 * Nama lama `ink` dan `green` sengaja DIPERTAHANKAN dan diarahkan ulang ke
 * warna baru. Keduanya sudah tersebar di banyak kelas pada halaman; mengganti
 * namanya berarti menyunting puluhan tempat dan berisiko ada yang terlewat
 * lalu tampil dengan warna lama.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          navy: "#061A2F",
          navyDeep: "#04101C",
          navySoft: "#0E2C4C",
          gold: "#FFC857",
          goldDark: "#E0AE3F",
          blue: "#0877E8",
          cyan: "#00D4FF",

          // Alias lama.
          ink: "#061A2F",
          green: "#0877E8"
        }
      },
      fontFamily: {
        display: ["Sora", "Inter", "system-ui", "sans-serif"]
      }
    }
  },
  plugins: []
};

export default config;
