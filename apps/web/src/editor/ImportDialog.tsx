import { useId, useRef, useState } from 'react';
import { toast } from 'sonner';
import YAML from 'yaml';
import { ApiError, type ApiIssue } from '@/api/client';
import { type ImportScenarioInput, useImportScenario } from '@/api/import-export';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { ru } from '@/i18n/ru';

// Чтение файла с запасным вариантом через FileReader (для окружений без File.prototype.text)
function readFileText(file: File): Promise<string> {
  if (typeof file.text === 'function') {
    return file.text();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error ?? new Error(ru.importExport.readFileError));
    reader.readAsText(file);
  });
}

export interface ImportDialogProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => Promise<void> | void;
}

// Определяет формат файла и проверяет синтаксис до отправки на сервер
function parseScenarioFile(
  fileName: string,
  text: string,
): { ok: true; input: ImportScenarioInput } | { ok: false; error: string } {
  const lowerName = fileName.toLowerCase();
  const isYamlFile = lowerName.endsWith('.yaml') || lowerName.endsWith('.yml');
  const isJsonFile = lowerName.endsWith('.json');

  if (isYamlFile) {
    try {
      const parsed: unknown = YAML.parse(text);
      if (parsed === null || typeof parsed !== 'object') {
        return { ok: false, error: ru.importExport.invalidYaml };
      }
      return { ok: true, input: { format: 'yaml', text } };
    } catch {
      return { ok: false, error: ru.importExport.invalidYaml };
    }
  }

  try {
    const parsed: unknown = JSON.parse(text);
    return { ok: true, input: { format: 'json', payload: parsed } };
  } catch {
    // Если расширение не .json или файл содержит YAML — пробуем разобрать как YAML
    try {
      const parsed: unknown = YAML.parse(text);
      if (parsed !== null && typeof parsed === 'object') {
        return { ok: true, input: { format: 'yaml', text } };
      }
    } catch {
      // не YAML
    }
    return { ok: false, error: isJsonFile ? ru.importExport.invalidJson : ru.importExport.invalidFile };
  }
}

// Диалог импорта JSON/YAML-сценария с проверкой формата и выводом списка замечаний
export function ImportDialog({ projectId, open, onOpenChange, onImported }: ImportDialogProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const importMutation = useImportScenario(projectId);

  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<ApiIssue[]>([]);
  const [reading, setReading] = useState(false);

  const busy = reading || importMutation.isPending;

  function resetState() {
    setFile(null);
    setError(null);
    setIssues([]);
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && busy) return;
    if (!nextOpen) resetState();
    onOpenChange(nextOpen);
  }

  async function handleConfirm() {
    if (!file || busy) return;
    setError(null);
    setIssues([]);

    let input: ImportScenarioInput;
    setReading(true);
    try {
      const text = await readFileText(file);
      const parsed = parseScenarioFile(file.name, text);
      if (!parsed.ok) {
        setError(parsed.error);
        return;
      }
      input = parsed.input;
    } catch {
      setError(ru.importExport.readFileError);
      return;
    } finally {
      setReading(false);
    }

    try {
      const result = await importMutation.mutateAsync(input);
      await onImported();
      resetState();
      onOpenChange(false);
      toast.success(ru.importExport.importSuccess);
      if (result.secretsToFill > 0) {
        toast.warning(ru.importExport.secretsToFill(result.secretsToFill));
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        setError(err.message || ru.importExport.importInvalidTitle);
        setIssues(err.issues ?? []);
      } else {
        setError(ru.importExport.importError);
        setIssues([]);
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{ru.importExport.importTitle}</DialogTitle>
          <DialogDescription>{ru.importExport.importDescription}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={inputId}>{ru.importExport.fileLabel}</Label>
            <input
              ref={inputRef}
              id={inputId}
              type="file"
              accept=".json,.yaml,.yml,application/json,application/yaml,application/x-yaml,text/yaml"
              disabled={busy}
              onChange={(event) => {
                const selected = event.target.files?.[0] ?? null;
                setFile(selected);
                setError(null);
                setIssues([]);
              }}
              className="block w-full cursor-pointer rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground file:mr-3 file:rounded-sm file:border-0 file:bg-secondary file:px-2.5 file:py-1 file:text-xs file:font-medium file:text-secondary-foreground hover:file:bg-secondary/80 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
            >
              <p className="font-medium">{error}</p>
              {issues.length > 0 && (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
                  {issues.map((issue, index) => (
                    <li key={index}>
                      {issue.path ? `${issue.path}: ${issue.message}` : issue.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => handleOpenChange(false)}
          >
            {ru.common.cancel}
          </Button>
          <Button
            type="button"
            disabled={!file || busy}
            onClick={() => void handleConfirm()}
          >
            {busy ? ru.importExport.importing : ru.importExport.confirmImport}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
