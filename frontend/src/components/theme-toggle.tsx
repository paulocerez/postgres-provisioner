import { useTheme, type Theme } from '../theme';
import { MonitorIcon, MoonIcon, SunIcon } from './icons';

const LABELS: Record<Theme, string> = {
  system: 'System theme',
  light: 'Light theme',
  dark: 'Dark theme',
};

export function ThemeToggle() {
  const { theme, cycleTheme } = useTheme();
  const Icon = theme === 'light' ? SunIcon : theme === 'dark' ? MoonIcon : MonitorIcon;

  return (
    <button
      type="button"
      className="btn-ghost btn-icon"
      onClick={cycleTheme}
      title={`${LABELS[theme]} — click to change`}
      aria-label={`${LABELS[theme]}. Switch theme.`}
    >
      <Icon />
    </button>
  );
}
