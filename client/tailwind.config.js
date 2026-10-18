/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: '#2563eb', 50: '#eff6ff', 100: '#dbeafe', 600: '#2563eb', 700: '#1d4ed8' },
        navy: { 950: '#0b1120', 900: '#0f172a', 800: '#1e293b', 700: '#1e3a5f', 600: '#334155' },
        accent: { DEFAULT: '#38bdf8', dark: '#2563eb' },
      },
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
    },
  },
};
