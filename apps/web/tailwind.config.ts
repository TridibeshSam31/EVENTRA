import type { Config } from "tailwindcss";

/*
 * EVENTRA design system — "Run Sheet"
 *
 * The product borrows from live-event production: run-of-show sheets,
 * timecodes and stage cue lights (standby = amber, go = green, hold = red).
 *
 * Every legacy hue used across the codebase is remapped onto a small set of
 * semantic families so the ~4k hard-coded utility classes render as one
 * coherent system:
 *   slate / gray / zinc / neutral / stone  -> ink      (warm neutrals)
 *   rose / red / pink                      -> cue      (brand crimson, hold/critical)
 *   emerald / green / lime                 -> go       (confirmed, live, healthy)
 *   amber / yellow / orange                -> standby  (waiting, attention)
 *   indigo / violet / purple / fuchsia     -> agent    (✦ AI proposals & activity)
 *   cyan / teal                            -> engine   (✓ deterministic verification)
 *   blue / sky                             -> info     (external sources, neutral info)
 */

const ink = {
  50: "#F8F6F2",
  100: "#F0EDE7",
  200: "#E4DFD6",
  300: "#CFC8BC",
  400: "#A49C8F",
  500: "#7B7367",
  600: "#5D564C",
  700: "#443E36",
  800: "#2C2823",
  900: "#1B1815",
  950: "#100E0C",
};

const cue = {
  50: "#FFF1F3",
  100: "#FFE1E7",
  200: "#FFC4D0",
  300: "#FF92A8",
  400: "#F5547B",
  500: "#E8174F",
  600: "#D6003C",
  700: "#B00032",
  800: "#8C062C",
  900: "#6E0A27",
  950: "#3F0012",
};

const go = {
  50: "#EEFAF2",
  100: "#D5F3DF",
  200: "#ACE6C1",
  300: "#74D29A",
  400: "#3BB870",
  500: "#179E56",
  600: "#0C8245",
  700: "#0B6839",
  800: "#0D5230",
  900: "#0C4429",
  950: "#032615",
};

const standby = {
  50: "#FFF8EB",
  100: "#FDECC9",
  200: "#FAD58D",
  300: "#F5B94F",
  400: "#EE9E25",
  500: "#DD800B",
  600: "#BF6206",
  700: "#9A4709",
  800: "#7C380E",
  900: "#662F0F",
  950: "#3B1603",
};

const agent = {
  50: "#F4F2FF",
  100: "#E9E6FF",
  200: "#D4D0FE",
  300: "#B4ACFB",
  400: "#9082F6",
  500: "#715FEE",
  600: "#5D47E1",
  700: "#4D38C6",
  800: "#402FA0",
  900: "#372D7E",
  950: "#211A4A",
};

const engine = {
  50: "#EEFAF8",
  100: "#D2F3EE",
  200: "#A8E6DD",
  300: "#71D2C5",
  400: "#3BB7A9",
  500: "#1E9B8F",
  600: "#157D76",
  700: "#156460",
  800: "#15514E",
  900: "#154442",
  950: "#062827",
};

const info = {
  50: "#F1F5FE",
  100: "#E0E8FC",
  200: "#C6D5FA",
  300: "#9EB8F6",
  400: "#6E92EF",
  500: "#4C6DE4",
  600: "#3752D0",
  700: "#2E42AD",
  800: "#2A388C",
  900: "#273370",
  950: "#1A2044",
};

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./features/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-body)", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "var(--font-body)", "ui-sans-serif", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      borderRadius: {
        none: "0px",
        sm: "4px",
        DEFAULT: "6px",
        md: "6px",
        lg: "8px",
        xl: "12px",
        "2xl": "16px",
        "3xl": "22px",
      },
      boxShadow: {
        sm: "0 1px 0 rgba(27, 24, 21, 0.04), 0 1px 2px rgba(27, 24, 21, 0.06)",
        DEFAULT: "0 1px 0 rgba(27, 24, 21, 0.04), 0 2px 6px -1px rgba(27, 24, 21, 0.08)",
        md: "0 1px 0 rgba(27, 24, 21, 0.04), 0 6px 16px -4px rgba(27, 24, 21, 0.10)",
        lg: "0 2px 0 rgba(27, 24, 21, 0.03), 0 14px 32px -8px rgba(27, 24, 21, 0.16)",
        xl: "0 24px 48px -12px rgba(27, 24, 21, 0.22)",
        "2xl": "0 36px 72px -18px rgba(27, 24, 21, 0.30)",
        inner: "inset 0 1px 2px rgba(27, 24, 21, 0.06)",
        ring: "0 0 0 1px rgba(27, 24, 21, 0.08)",
        lift: "0 1px 0 rgba(255,255,255,0.7) inset, 0 1px 2px rgba(27,24,21,0.06), 0 8px 24px -10px rgba(27,24,21,0.14)",
      },
      colors: {
        // Legacy hue remap (see header comment)
        slate: ink,
        gray: ink,
        zinc: ink,
        neutral: ink,
        stone: ink,
        rose: cue,
        red: cue,
        pink: cue,
        emerald: go,
        green: go,
        lime: go,
        amber: standby,
        yellow: standby,
        orange: standby,
        indigo: agent,
        violet: agent,
        purple: agent,
        fuchsia: agent,
        cyan: engine,
        teal: engine,
        blue: info,
        sky: info,

        // Semantic families
        ink,
        cue,
        go,
        standby,
        agent,
        engine,
        info,
        paper: "#F4F1EB",

        // Token-driven roles
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: "hsl(var(--card))",
        "card-foreground": "hsl(var(--card-foreground))",
        border: "hsl(var(--border))",
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        primary: {
          DEFAULT: "#D6003C",
          foreground: "#ffffff",
        },
        emergency: {
          DEFAULT: "#D6003C",
          foreground: "#ffffff",
        },
        warning: {
          DEFAULT: "#DD800B",
          foreground: "#ffffff",
        },
        success: {
          DEFAULT: "#179E56",
          foreground: "#ffffff",
        },
      },
      letterSpacing: {
        label: "0.14em",
      },
      keyframes: {
        "cue-blink": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.35" },
        },
        "rise-in": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        sweep: {
          from: { transform: "translateX(-100%)" },
          to: { transform: "translateX(100%)" },
        },
      },
      animation: {
        "cue-blink": "cue-blink 1.6s ease-in-out infinite",
        "rise-in": "rise-in 360ms cubic-bezier(0.2, 0.7, 0.2, 1) both",
        sweep: "sweep 1.8s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
