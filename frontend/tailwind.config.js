/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        navy: {
          dark: '#0a192f',
          panel: '#0b1426',
          card: '#172a45',
        },
        ocean: {
          light: '#38bdf8',
          cyan: '#00f0ff',
        }
      }
    },
  },
  plugins: [],
}
