/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        'poppins': ['Poppins', 'sans-serif'],
        'inter': ['Inter', 'sans-serif'],
      },
      colors: {
        'crm': {
          'purple': '#5932EA',
          'bg': '#F9FBFF',
          'dark': '#292D32',
          'muted': '#9197B3',
          'dim': '#B5B7C0',
          'green-bg': 'rgba(22, 192, 152, 0.2)',
          'green-text': '#008767',
          'red-bg': '#FFC5C5',
          'red-text': '#DF0404',
          'divider': '#EEEEEE',
        },
        'agent': {
          'bg': '#000000',
          'panel': '#0a0a0a',
          'border': '#1a1a1a',
          'accent': '#ff1a1a',
          'green': '#10B981',
          'orange': '#F59E0B',
          'red': '#EF4444',
          'blue': '#3B82F6',
        }
      },
      animation: {
        'float': 'float 6s ease-in-out infinite',
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'slide-in': 'slideIn 0.5s ease-out',
        'fade-in': 'fadeIn 0.4s ease-out',
        'bid-pop': 'bidPop 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
        'shimmer': 'shimmer 2s linear infinite',
        'glow-pulse': 'glowPulse 2s ease-in-out infinite',
        'progress-bar': 'progressBar 2s ease-out forwards',
        'spark': 'spark 1s ease-out forwards',
        'status-ping': 'statusPing 1s cubic-bezier(0, 0, 0.2, 1) infinite',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        slideIn: {
          from: { opacity: '0', transform: 'translateX(-20px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        fadeIn: {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        bidPop: {
          '0%': { opacity: '0', transform: 'scale(0.8)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% center' },
          '100%': { backgroundPosition: '200% center' },
        },
        glowPulse: {
          '0%, 100%': { boxShadow: '0 0 20px rgba(99, 102, 241, 0.3)' },
          '50%': { boxShadow: '0 0 40px rgba(99, 102, 241, 0.6)' },
        },
        progressBar: {
          from: { width: '0%' },
        },
        spark: {
          '0%': { opacity: '1', transform: 'scale(0)' },
          '100%': { opacity: '0', transform: 'scale(3)' },
        },
        statusPing: {
          '75%, 100%': { transform: 'scale(2)', opacity: '0' },
        },
      },
      backgroundImage: {
        'shimmer-gradient': 'linear-gradient(90deg, transparent, rgba(99,102,241,0.2), transparent)',
      },
    },
  },
  plugins: [],
}
