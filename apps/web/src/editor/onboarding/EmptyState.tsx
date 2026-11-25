import { ViewportPortal } from '@xyflow/react';
import { Plus } from 'lucide-react';
import { ru } from '@/i18n/ru';
import { Button } from '@/components/ui/button';
import { NODE_GAP } from '../placement';
import { TEMPLATES, type ScenarioTemplate } from './templates';

// Пунктирная карточка справа от «Старт»: клик открывает панель выбора блока
export function FirstStepCard({
  entry,
  onClick,
}: {
  entry: { position: { x: number; y: number }; measured?: { width?: number } };
  onClick: () => void;
}) {
  const t = ru.editor.onboarding;
  return (
    <ViewportPortal>
      <button
        type="button"
        onClick={onClick}
        className="pointer-events-auto nodrag nopan absolute flex w-64 flex-col items-start gap-1 rounded-lg border-2 border-dashed bg-card/60 px-4 py-3 text-left text-muted-foreground transition-colors hover:border-primary hover:bg-accent hover:text-accent-foreground"
        style={{
          transform: `translate(${entry.position.x + (entry.measured?.width ?? 280) + NODE_GAP}px, ${entry.position.y}px)`,
        }}
      >
        <span className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Plus className="size-4" />
          {t.firstStep}
        </span>
        <span className="text-xs">{t.firstStepHint}</span>
      </button>
    </ViewportPortal>
  );
}

// Оверлей «С чего начнём?» при первом открытии проекта с пустым сценарием
export function WelcomeOverlay({ onChoose }: { onChoose: (template: ScenarioTemplate) => void }) {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/70 p-4 backdrop-blur-[1px] sm:p-6">
      <div
        role="region"
        aria-label={ru.editor.onboarding.welcomeTitle}
        className="max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-xl border bg-card p-4 shadow-lg sm:p-6"
      >
        <h2 className="mb-4 text-lg font-semibold">{ru.editor.onboarding.welcomeTitle}</h2>
        <div className="flex flex-col gap-2">
          {TEMPLATES.map((template) => (
            <Button
              key={template.id}
              type="button"
              variant="outline"
              className="h-auto flex-col items-start gap-0.5 px-4 py-3 text-left whitespace-normal"
              onClick={() => onChoose(template)}
            >
              <span className="text-left text-sm font-medium">{template.title}</span>
              <span className="text-left text-xs font-normal text-muted-foreground">
                {template.hint}
              </span>
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
