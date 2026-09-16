/**
 * Colours are semantic tokens only — every one resolves to a CSS custom
 * property defined for both themes in `src/index.css`. Using raw channels
 * (`12 34 56`) rather than `rgb(...)` keeps Tailwind's `/opacity` syntax
 * working, which is what lets the whole app avoid `dark:` variants.
 */
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        canvas: token('canvas'),
        surface: token('surface'),
        raised: token('raised'),
        line: token('line'),
        'line-strong': token('line-strong'),
        fg: token('fg'),
        muted: token('muted'),
        subtle: token('subtle'),
        accent: {
          DEFAULT: token('accent'),
          hover: token('accent-hover'),
          fg: token('accent-fg'),
        },
        danger: { DEFAULT: token('danger'), fg: token('danger-fg') },
        success: token('success'),
        warning: token('warning'),
      },
      fontFamily: {
        sans: ['Inter Variable', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'SF Mono', 'Menlo', 'monospace'],
      },
      fontSize: {
        // A tighter scale than Tailwind's default: 13px is the base UI size,
        // and headings carry negative tracking the way Linear's do.
        '2xs': ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.02em' }],
        xs: ['0.75rem', { lineHeight: '1.125rem' }],
        sm: ['0.8125rem', { lineHeight: '1.25rem' }],
        base: ['0.875rem', { lineHeight: '1.375rem' }],
        lg: ['1rem', { lineHeight: '1.5rem', letterSpacing: '-0.01em' }],
        xl: ['1.125rem', { lineHeight: '1.625rem', letterSpacing: '-0.015em' }],
        '2xl': ['1.375rem', { lineHeight: '1.875rem', letterSpacing: '-0.02em' }],
      },
      borderRadius: { md: '6px', lg: '8px', xl: '12px' },
      boxShadow: {
        // Softer than Tailwind's defaults — in dark mode the hairline borders
        // carry the elevation and these all but disappear.
        sm: '0 1px 2px rgb(var(--shadow) / 0.06)',
        md: '0 2px 4px rgb(var(--shadow) / 0.06), 0 1px 2px rgb(var(--shadow) / 0.04)',
        popover:
          '0 12px 32px rgb(var(--shadow) / 0.16), 0 2px 8px rgb(var(--shadow) / 0.08), 0 0 0 1px rgb(var(--line) / 1)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-up-fade': {
          from: { opacity: '0', transform: 'translateY(6px) scale(0.985)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'toast-in': {
          from: { opacity: '0', transform: 'translateY(12px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: { from: { backgroundPosition: '200% 0' }, to: { backgroundPosition: '-200% 0' } },
        indeterminate: {
          '0%': { transform: 'translateX(-100%) scaleX(0.4)' },
          '100%': { transform: 'translateX(250%) scaleX(0.4)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 120ms ease-out',
        'slide-up-fade': 'slide-up-fade 160ms cubic-bezier(0.16, 1, 0.3, 1)',
        'toast-in': 'toast-in 180ms cubic-bezier(0.16, 1, 0.3, 1)',
        shimmer: 'shimmer 1.6s linear infinite',
        indeterminate: 'indeterminate 1.1s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
