export function getApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
}

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return localStorage.getItem('hn_access_token');
}

export async function apiGet<T>(path: string): Promise<T> {
  const token = getAccessToken();
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    cache: 'no-store',
  });

  const payload = await response.json();
  if (!response.ok || !payload?.success) {
    throw new Error(payload?.error?.message || 'Request failed');
  }

  return payload.data as T;
}
