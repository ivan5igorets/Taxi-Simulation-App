/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,ts}'],
  theme: {
    extend: {
      colors: {
        idle: '#facc15',
        busy: '#3b82f6',
        user: '#22c55e',
      },
    },
  },
  plugins: [],
};
