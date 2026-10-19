interface ApiError {
  error?: string;
}

export class ApiRequestError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export async function apiRequest<T>(
  path: string,
  method = "GET",
  body?: unknown,
  extraHeaders?: Record<string, string>,
): Promise<T> {
  let response: Response;
  try {
    const headers = new Headers(extraHeaders);
    if (body !== undefined) headers.set("content-type", "application/json");
    if (!["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase())) {
      const csrfToken = cookieValue("pms_csrf");
      if (csrfToken) headers.set("x-csrf-token", csrfToken);
    }
    response = await fetch(`/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
    });
  } catch {
    throw new Error("Could not reach the local PMS API. Check that the server is running.");
  }

  if (response.status === 204) return undefined as T;

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error("The local PMS API returned an unreadable response.");
  }

  if (!response.ok) {
    const message = typeof data === "object" && data !== null && "error" in data
      ? (data as ApiError).error
      : undefined;
    if (response.status === 401 && !path.startsWith("/auth/")) {
      window.dispatchEvent(new Event("pms:unauthenticated"));
    }
    throw new ApiRequestError(message ?? `Request failed (${response.status}).`, response.status);
  }
  return data as T;
}

function cookieValue(name: string): string | null {
  const prefix = `${name}=`;
  const cookie = document.cookie.split(";").map((value) => value.trim())
    .find((value) => value.startsWith(prefix));
  return cookie ? cookie.slice(prefix.length) : null;
}
