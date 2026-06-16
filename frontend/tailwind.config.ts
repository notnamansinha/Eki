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
          dark: "#0A1628",      // Near-black background
          surface: "#121E30",   // Card/panel background
          muted: "#1E2D45",     // Secondary surface
        },
        // Anti-Gravity Apple Aesthetics
        anti: {
          canvas: "#FCFCFD",     // Warm cream-white background
          glass: "rgba(255, 255, 255, 0.4)", // Frosted glass cards
          glassBorder: "rgba(255, 255, 255, 0.6)", // Paper-thin edges
          lilac: "#8B5CF6",      // Electric Lilac (accent)
          lilacGlow: "rgba(139, 92, 246, 0.15)", // Lilac bioluminescence
        },
        status: {
          active: "#22C55E",    // Green – bus moving
          idle: "#F59E0B",      // Amber – bus stopped
          maintenance: "#EF4444", // Red – out of service
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        display: ["'Outfit'", "Inter", "sans-serif"],
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "fade-in": "fadeIn 0.4s ease-out forwards",
        "slide-up": "slideUp 0.4s ease-out forwards",
        // Floating animations for Anti-Gravity UI
        "float-slow": "float 8s ease-in-out infinite",
        "float-medium": "float 6s ease-in-out infinite",
        "float-fast": "float 4s ease-in-out infinite",
      },
      boxShadow: {
        "anti-soft": "0 20px 40px -10px rgba(0,0,0,0.03), 0 10px 20px -5px rgba(0,0,0,0.02)",
        "anti-glow": "0 0 40px 10px rgba(139, 92, 246, 0.1)", // Bioluminescent inner glow
      },
      keyframes: {
        fadeIn: {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        slideUp: {
          from: { transform: "translateY(16px)", opacity: "0" },
          to: { transform: "translateY(0)", opacity: "1" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0) rotate(var(--tw-rotate))" },
          "50%": { transform: "translateY(-12px) rotate(var(--tw-rotate))" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
