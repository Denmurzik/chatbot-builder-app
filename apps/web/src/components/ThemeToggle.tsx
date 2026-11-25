import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ru } from '@/i18n/ru';
import { useTheme } from '@/lib/theme';

export interface ThemeToggleProps {
  variant?: 'ghost' | 'outline';
  size?: 'icon' | 'icon-sm';
  className?: string;
}

/** Компактная кнопка переключения светлой и тёмной темы. */
export function ThemeToggle({
  variant = 'ghost',
  size = 'icon',
  className,
}: ThemeToggleProps) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';
  const label = isDark ? ru.theme.switchToLight : ru.theme.switchToDark;

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      onClick={toggleTheme}
      aria-label={label}
      title={label}
      className={className}
    >
      {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  );
}
