export interface ApiIssue {
  path: string;
  message: string;
}

// Ошибка ответа API: код статуса, сообщение и (для 400) список замечаний
export class ApiError extends Error {
  readonly status: number;
  readonly issues?: ApiIssue[];
  // Тело ответа целиком (например, { errors } при 422 публикации)
  readonly body?: unknown;

  constructor(status: number, message: string, issues?: ApiIssue[], body?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.issues = issues;
    this.body = body;
  }
}

interface ErrorBody {
  message?: unknown;
  issues?: unknown;
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && init.body !== null && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`/api${path}`, { ...init, headers, credentials: 'include' });

  if (!response.ok) {
    let body: ErrorBody = {};
    try {
      body = (await response.json()) as ErrorBody;
    } catch {
      // тело ответа не JSON — оставляем пустым
    }
    const message = typeof body.message === 'string' ? body.message : response.statusText;
    const issues = Array.isArray(body.issues) ? (body.issues as ApiIssue[]) : undefined;
    throw new ApiError(response.status, message, issues, body);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}
