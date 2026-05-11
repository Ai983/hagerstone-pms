/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        accent: {
          DEFAULT: '#06b6d4', // cyan-500
          foreground: '#fff',
          50: '#ecfeff',
          100: '#cffafe',
          200: '#a5f3fc',
          300: '#67e8f9',
          400: '#22d3ee',
          500: '#06b6d4',
          600: '#0891b2',
          700: '#0e7490',
          800: '#155e75',
          900: '#164e63',
        },
        background: '#0a0f1a',
        surface: '#111827',
        border: '#1f2937',
        muted: '#374151',
        'muted-foreground': '#9ca3af',
        foreground: '#f9fafb',
        'foreground-secondary': '#d1d5db',
        destructive: '#ef4444',
        success: '#22c55e',
        warning: '#f59e0b',
      },
      borderRadius: {
        lg: '0.625rem',
        md: '0.5rem',
        sm: '0.375rem',
      },
    },
  },
  plugins: [],
}
