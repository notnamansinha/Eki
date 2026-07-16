/**
 * BusTrack - Shared Tailwind Utilities / Design Tokens
 * Custom CSS variables for the BusTrack color palette and typography.
 * Extends the default Tailwind config for all portals.
 */
import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Brand
        brand: {
          primary: "#0F4C81",   // Deep BRTS blue
          accent: "#F5A623",    // Ahmedabad amber
          dark: "#09090b",      // Deep Zinc for that premium dark look
          surface: "#18181b",   // Elevated Zinc for cards/panels
          muted: "#27272a",     // Zinc muted borders/fills
        },
        transit: {
          bus: "#f5a623",
          stop: "#3b82f6",
          route: "#10b981",
        },
        status: {
          active: "#10b981",    // Green – bus moving / on time
          idle: "#f59e0b",      // Amber – bus stopped / delayed
          maintenance: "#ef4444", // Red – out of service
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        display: ["'Outfit'", "Inter", "sans-serif"],
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "fade-in": "fadeIn 0.4s ease-out forwards",
        "slide-up": "slideUp 0.5s cubic-bezier(0.32, 0.72, 0, 1) forwards",
        "slide-down": "slideDown 0.4s cubic-bezier(0.32, 0.72, 0, 1) forwards",
        "scale-in": "scaleIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards",
      },
      boxShadow: {
        "glass": "0 8px 32px 0 rgba(0, 0, 0, 0.37)",
        "glass-sm": "0 4px 16px 0 rgba(0, 0, 0, 0.2)",
        "glow": "0 0 20px rgba(245, 166, 35, 0.15)",
        "premium": "0 25px 50px -12px rgba(0, 0, 0, 0.5)",
      },
      keyframes: {
        fadeIn: {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        slideUp: {
          from: { transform: "translateY(100%)", opacity: "0" },
          to: { transform: "translateY(0)", opacity: "1" },
        },
        slideDown: {
          from: { transform: "translateY(-10px)", opacity: "0" },
          to: { transform: "translateY(0)", opacity: "1" },
        },
        scaleIn: {
          from: { transform: "scale(0.95)", opacity: "0" },
          to: { transform: "scale(1)", opacity: "1" },
        }
      },
      backdropBlur: {
        xs: '2px',
        glass: '16px',
      }
    },
  },
  plugins: [],
};

export default config;
