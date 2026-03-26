import { getValidatedClientToken } from '@/lib/client-auth';

export function getApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
}

export function getAccessToken(): string | null {
  return getValidatedClientToken();
}

async function parsePayload(response: Response): Promise<any> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function apiRequest<T>(path: string, method: 'GET' | 'POST' | 'PUT' | 'PATCH', body?: Record<string, unknown>): Promise<T> {
  const token = getAccessToken();
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    cache: 'no-store',
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const payload = await parsePayload(response);
  if (response.status === 401) {
    throw new Error('Unauthorized');
  }
  if (!response.ok || !payload?.success) {
    throw new Error(payload?.error?.message || 'Request failed');
  }

  return payload.data as T;
}

export async function apiGet<T>(path: string): Promise<T> {
  return apiRequest<T>(path, 'GET');
}

export async function apiPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  return apiRequest<T>(path, 'POST', body);
}

export async function apiPut<T>(path: string, body: Record<string, unknown>): Promise<T> {
  return apiRequest<T>(path, 'PUT', body);
}

export async function apiPatch<T>(path: string, body: Record<string, unknown>): Promise<T> {
  return apiRequest<T>(path, 'PATCH', body);
}
