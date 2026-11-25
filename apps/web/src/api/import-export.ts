import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiFetch, type ApiIssue } from './client';

export type ExportFormat = 'json' | 'yaml';

export type ImportScenarioInput =
  | { format: 'json'; payload: unknown }
  | { format: 'yaml'; text: string };

export interface ImportScenarioResponse {
  updatedAt: string;
  secretsToFill: number;
}

interface ErrorBody {
  message?: unknown;
  issues?: unknown;
}

// Извлекает имя файла из заголовка Content-Disposition (с приоритетом RFC 5987 filename*=UTF-8'')
export function parseContentDispositionFileName(header: string | null, fallback: string): string {
  if (!header) return fallback;

  const utf8Match = /filename\*\s*=\s*(?:UTF-8''|utf-8'')([^;\r\n]+)/i.exec(header);
  if (utf8Match?.[1]) {
    try {
      const decoded = decodeURIComponent(utf8Match[1].trim().replace(/^"|"$/g, ''));
      if (decoded) return decoded;
    } catch {
      // некорректная percent-кодировка — пробуем обычный filename
    }
  }

  const plainMatch = /filename\s*=\s*"([^"]+)"|filename\s*=\s*([^;\r\n]+)/i.exec(header);
  const rawName = (plainMatch?.[1] ?? plainMatch?.[2])?.trim();
  return rawName || fallback;
}

// Запрашивает файл экспорта сценария с сервера в формате JSON или YAML
export async function exportScenarioFile(
  projectId: string,
  format: ExportFormat = 'json',
  fallbackName = `scenario.${format}`,
): Promise<{ blob: Blob; fileName: string }> {
  const response = await fetch(`/api/projects/${projectId}/export?format=${format}`, {
    method: 'GET',
    credentials: 'include',
  });

  if (!response.ok) {
    let body: ErrorBody = {};
    try {
      body = (await response.json()) as ErrorBody;
    } catch {
      // тело ответа не JSON
    }
    const message = typeof body.message === 'string' ? body.message : response.statusText;
    const issues = Array.isArray(body.issues) ? (body.issues as ApiIssue[]) : undefined;
    throw new ApiError(response.status, message, issues, body);
  }

  const blob = await response.blob();
  const fileName = parseContentDispositionFileName(
    response.headers.get('Content-Disposition'),
    fallbackName,
  );
  return { blob, fileName };
}

// Запускает скачивание Blob в браузере
export function triggerFileDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    URL.revokeObjectURL(url);
  }
}

// Скачивает сценарий проекта в выбранном формате
export async function exportScenario(
  projectId: string,
  format: ExportFormat = 'json',
  projectName?: string,
): Promise<string> {
  const fallbackName = `${projectName?.trim() || 'scenario'}.${format}`;
  const { blob, fileName } = await exportScenarioFile(projectId, format, fallbackName);
  triggerFileDownload(blob, fileName);
  return fileName;
}

export function useExportScenario(projectId: string, projectName?: string) {
  return useMutation({
    mutationFn: (format: ExportFormat = 'json') => exportScenario(projectId, format, projectName),
  });
}

// Отправляет импортируемый сценарий на сервер (JSON или сырой YAML)
export function importScenario(
  projectId: string,
  input: ImportScenarioInput,
): Promise<ImportScenarioResponse> {
  if (input.format === 'yaml') {
    return apiFetch<ImportScenarioResponse>(`/projects/${projectId}/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/yaml; charset=utf-8' },
      body: input.text,
    });
  }
  return apiFetch<ImportScenarioResponse>(`/projects/${projectId}/import`, {
    method: 'POST',
    body: JSON.stringify(input.payload),
  });
}

export function useImportScenario(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ImportScenarioInput) => importScenario(projectId, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'], exact: true }),
  });
}
