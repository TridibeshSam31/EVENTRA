import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./features/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      borderRadius: {
        'none': '0px',
        'sm': '0px',
        DEFAULT: '0px',
        'md': '2px',
        'lg': '2px',
        'xl': '2px',
        '2xl': '4px',
        '3xl': '4px',
      },
      boxShadow: {
        'sm': '2px 2px 0px rgba(255, 255, 255, 0.05)',
        DEFAULT: '4px 4px 0px rgba(255, 255, 255, 0.05)',
        'md': '4px 4px 0px rgba(255, 255, 255, 0.1)',
        'lg': '6px 6px 0px rgba(255, 255, 255, 0.1)',
        'xl': '8px 8px 0px rgba(255, 255, 255, 0.1)',
        '2xl': '12px 12px 0px rgba(255, 255, 255, 0.1)',
      },
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: "hsl(var(--card))",
        "card-foreground": "hsl(var(--card-foreground))",
        primary: {
          DEFAULT: "#3b82f6",
          foreground: "#ffffff",
        },
        emergency: {
          DEFAULT: "#ef4444",
          foreground: "#ffffff",
        },
        warning: {
          DEFAULT: "#f59e0b",
          foreground: "#ffffff",
        },
        success: {
          DEFAULT: "#10b981",
          foreground: "#ffffff",
        },
      },
    },
  },
  plugins: [],
};

export default config;
