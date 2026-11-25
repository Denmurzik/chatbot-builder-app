import { forwardRef, type ButtonHTMLAttributes, type ComponentType } from 'react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface IconActionProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: ComponentType<{ className?: string }>;
  // Подсказка и доступное имя кнопки
  label: string;
}

// Маленькая иконка-кнопка с подсказкой; классы nodrag nopan — чтобы клик не двигал холст и блок
export const IconAction = forwardRef<HTMLButtonElement, IconActionProps>(function IconAction(
  { icon: Icon, label, className, ...props },
  ref,
) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            ref={ref}
            type="button"
            aria-label={label}
            className={cn(
              'nodrag nopan pointer-events-auto inline-flex size-7 items-center justify-center rounded-md border bg-card text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
              className,
            )}
            {...props}
          >
            <Icon className="size-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
});
