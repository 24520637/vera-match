/** Credentialed API client scaffold. NOT a finished auth provider. */
const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000/api';
export async function apiFetch(path: string, init: RequestInit = {}) {
  const response = await fetch(`${API_BASE}${path}`, { ...init, credentials: 'include' });
  if (response.status === 401) throw new Error('UNAUTHENTICATED');
  if (response.status === 403) throw new Error('FORBIDDEN');
  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  return response;
}
