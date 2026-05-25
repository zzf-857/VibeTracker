/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: "var(--bg-primary)",
        secondary: "var(--bg-secondary)",
        tertiary: "var(--bg-tertiary)",
        sidebar: "var(--bg-sidebar)",
        border: {
          primary: "var(--border-primary)",
          subtle: "var(--border-subtle)",
        },
        text: {
          primary: "var(--text-primary)",
          secondary: "var(--text-secondary)",
          tertiary: "var(--text-tertiary)",
        },
        accent: {
          blue: "var(--accent-blue)",
          purple: "var(--accent-purple)",
          orange: "var(--accent-orange)",
          red: "var(--accent-red)",
        },
        status: {
          completed: "var(--status-completed)",
          paused: "var(--status-paused)",
          developing: "var(--accent-blue)",
        }
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
