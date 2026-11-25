import { useState } from 'react';
import { toast } from 'sonner';
import type { EnvVarView } from '@chatbot/model';
import { ApiError } from '@/api/client';
import { useSaveEnvironment } from '@/api/projects';
import { EnvironmentEditor } from '@/components/EnvironmentEditor';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ru } from '@/i18n/ru';

function environmentErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 400) {
    const message = (error.body as { message?: unknown } | undefined)?.message;
    return typeof message === 'string' ? message : ru.testEnvironment.invalid;
  }
  return ru.common.unknownError;
}

export interface TestEnvironmentDialogProps {
  projectId: string;
  environment: EnvVarView[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Диалог настройки тестового окружения проекта (используется только в превью)
export function TestEnvironmentDialog({
  projectId,
  environment,
  open,
  onOpenChange,
}: TestEnvironmentDialogProps) {
  const save = useSaveEnvironment(projectId);
  const [error, setError] = useState<string | null>(null);
  // Сброс ключа после сохранения очищает введённые значения секретов из локального состояния
  const [resetKey, setResetKey] = useState(0);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) setError(null);
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{ru.testEnvironment.title}</DialogTitle>
          <DialogDescription>{ru.testEnvironment.description}</DialogDescription>
        </DialogHeader>
        <EnvironmentEditor
          key={resetKey}
          value={environment}
          saving={save.isPending}
          error={error}
          onSave={(input) => {
            setError(null);
            save.mutate(input, {
              onSuccess: () => {
                setResetKey((prev) => prev + 1);
                toast.success(ru.testEnvironment.saved);
              },
              onError: (err) => setError(environmentErrorMessage(err)),
            });
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
