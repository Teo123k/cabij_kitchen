/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                app: {
                    bg: 'var(--app-bg)',
                    surface: 'var(--app-surface)',
                    border: 'var(--app-border)',
                    text: 'var(--app-text)',
                    muted: 'var(--app-muted)',
                    accent: {
                        DEFAULT: '#10b981', // Emerald
                        glow: 'rgba(16, 185, 129, 0.4)'
                    },
                    danger: '#ef4444',
                    success: '#22c55e',
                }
            },
            backdropBlur: {
                xs: '2px',
            },
            boxShadow: {
                'glass': '0 8px 32px 0 rgba(0, 0, 0, 0.37)',
                'accent-glow': '0 0 15px rgba(16, 185, 129, 0.3)'
            }
        },
    },
    plugins: [],
}
