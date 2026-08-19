export const tokens = {
  colors: {
    bg: {
      primary: '#09090b', // zinc-950
      secondary: '#18181b', // zinc-900
      surface: '#27272a', // zinc-800
      surfaceHover: '#3f3f46', // zinc-700
      glass: 'rgba(9, 9, 11, 0.75)',
      glassModal: 'rgba(15, 15, 20, 0.88)',
    },
    accent: {
      primary: '#e5a00d', // plex gold / amber
      hover: '#f59e0b', // amber-500
      text: '#000000',
    },
    text: {
      primary: '#f4f4f5', // zinc-100
      secondary: '#a1a1aa', // zinc-400
      muted: '#71717a', // zinc-500
    },
    border: {
      subtle: '#27272a', // zinc-800
      medium: '#3f3f46', // zinc-700
      glow: 'rgba(229, 160, 13, 0.3)',
    }
  },
  typography: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  radii: {
    sm: '0.375rem',
    md: '0.5rem',
    lg: '0.75rem',
    xl: '1rem',
    full: '9999px',
  },
  shadows: {
    card: '0 4px 20px -2px rgba(0, 0, 0, 0.5)',
    cardHover: '0 20px 30px -10px rgba(0, 0, 0, 0.8), 0 0 25px 2px rgba(229, 160, 13, 0.15)',
    heroText: '0 2px 10px rgba(0,0,0,0.8)',
  }
} as const;
