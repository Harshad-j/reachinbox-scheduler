export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    ...init,
    headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as {
      error?: { code?: string; message?: string; diagnostic?: { code?: string; command?: string; responseCode?: number } };
    } | null;
    const error = payload?.error;
    const diagnostic = error?.diagnostic;
    const detail = [diagnostic?.code, diagnostic?.command, diagnostic?.responseCode]
      .filter(value => value !== undefined).join(" · ");
    throw new Error(`${error?.message ?? `Request failed (${response.status})`}${detail ? ` [${detail}]` : error?.code ? ` [${error.code}]` : ""}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
