interface ApiError {
  error?: string;
}

export async function apiRequest<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error("Could not reach the local PMS API. Check that the server is running.");
  }

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
    throw new Error(message ?? `Request failed (${response.status}).`);
  }
  return data as T;
}
