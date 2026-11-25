import { ru } from '@/i18n/ru';
import { cn } from '@/lib/utils';

export interface BrandLogoProps {
  size?: number;
  showWordmark?: boolean;
  className?: string;
}

/** Векторный знак Flow Bracket с активной точкой порта. */
export function BrandLogo({ size = 24, showWordmark = false, className }: BrandLogoProps) {
  const mark = (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={showWordmark ? 'shrink-0' : cn('shrink-0', className)}
    >
      <path d="M18 24 C18 20.7 20.7 18 24 18 H58 V32 H32 V56 H18 Z" fill="currentColor" />
      <path d="M82 76 C82 79.3 79.3 82 76 82 H42 V68 H68 V44 H82 Z" fill="currentColor" />
      <rect x="42" y="43" width="16" height="14" rx="3" fill="currentColor" />
      <circle cx="75" cy="25" r="8" fill="var(--brand, #A3E635)" />
    </svg>
  );

  if (!showWordmark) {
    return mark;
  }

  return (
    <span className={cn('inline-flex items-center gap-2.5 select-none', className)}>
      {mark}
      <span className="font-semibold tracking-tight text-foreground">{ru.appName}</span>
    </span>
  );
}
