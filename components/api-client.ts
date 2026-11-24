let inMemoryToken: string | null = null;

export function setAuthToken(token: string | null): void {
  inMemoryToken = token;
}

export function getAuthToken(): string | null {
  return inMemoryToken;
}

export function buildAuthHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    'X-Requested-With': 'XMLHttpRequest',
    ...extra,
  };
  if (inMemoryToken) {
    headers.Authorization = `Bearer ${inMemoryToken}`;
  }
  return headers;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export async function apiFetch<T>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const isJsonBody =
    options.body !== undefined && typeof options.body === 'string';

  const headers = buildAuthHeaders({
    ...(isJsonBody ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers as Record<string, string> | undefined),
  });

  const res = await fetch(url, {
    ...options,
    headers,
    credentials: 'include',
  });

  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('application/json')
    ? await res.json()
    : { error: await res.text() };

  if (!res.ok) {
    throw new ApiError(
      (data as { error?: string }).error || `HTTP ${res.status}`,
      res.status
    );
  }

  return data as T;
}
