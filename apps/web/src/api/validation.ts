import { useMutation } from '@tanstack/react-query';
import type { ValidationError } from '@chatbot/model';
import { apiFetch } from './client';

export interface ValidateScenarioResponse {
  errors: ValidationError[];
}

// Смысловая проверка сохранённого сценария проекта на сервере
export function useValidateScenario(projectId: string) {
  return useMutation({
    mutationFn: () =>
      apiFetch<ValidateScenarioResponse>(`/projects/${projectId}/validate`, {
        method: 'POST',
      }),
  });
}
