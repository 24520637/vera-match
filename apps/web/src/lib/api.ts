export class ApiError extends Error {
  constructor(readonly status: number | null, readonly code: string, message: string, readonly details?: { field: string; messages: string[] }[]) { super(message); this.name = 'ApiError'; }
}
const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000/api';
export async function apiFetch(path: string, init: RequestInit = {}) {
  let response: Response;
  try { response = await fetch(`${API_BASE}${path}`, { ...init, credentials: 'include', cache: 'no-store' }); }
  catch (error) { if (init.signal?.aborted) throw error; throw new ApiError(null, 'NETWORK_UNAVAILABLE', 'The service could not be reached. Check your connection and try again.'); }
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { code?: string; message?: string; details?: { field: string; messages: string[] }[] };
    throw new ApiError(response.status, body.code ?? `HTTP_${response.status}`, typeof body.message === 'string' ? body.message : 'The request could not be completed. Try again.', body.details);
  }
  return response;
}
export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await apiFetch(path, init);
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}
export const postAuth = <T>(path: string, body: object) => apiRequest<T>(`/auth/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
