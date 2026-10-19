type ApiResult = {
  status: number;
  data: Record<string, any>;
  response: Response;
};

type RequestOptions = {
  authenticated?: boolean;
  csrf?: boolean;
  origin?: string | null;
  headers?: Record<string, string>;
};

export type TestApiRequest = (((
  path: string,
  method?: string,
  body?: unknown,
  options?: RequestOptions,
) => Promise<ApiResult>) & {
  login(username: string, password: string): Promise<ApiResult>;
});

export async function createTestApiClient(
  baseUrl: string,
  initializeAdministrator = true,
): Promise<TestApiRequest> {
  let cookies: string[] = [];
  const request = (async (
    path,
    method = "GET",
    body,
    options = {},
  ) => {
    const headers = new Headers(options.headers);
    if (body !== undefined) headers.set("content-type", "application/json");
    if (options.origin !== null) {
      headers.set("origin", options.origin ?? "http://127.0.0.1:5173");
    }
    if (options.authenticated !== false && cookies.length > 0) {
      headers.set("cookie", cookies.join("; "));
      if (
        options.csrf !== false &&
        !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase())
      ) {
        const csrfCookie = cookies.find((cookie) => cookie.startsWith("pms_csrf="));
        if (csrfCookie) headers.set("x-csrf-token", csrfCookie.slice("pms_csrf=".length));
      }
    }
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookies = response.headers.getSetCookie();
    if (setCookies.length > 0) {
      cookies = setCookies
        .map((cookie) => cookie.split(";", 1)[0])
        .filter((cookie) => !cookie.endsWith("="));
    }
    let data: Record<string, any> = {};
    if (response.status !== 204) {
      try {
        data = await response.json() as Record<string, any>;
      } catch {
        throw new Error(
          `API test request ${method} ${path} returned non-JSON content (${response.status}).`,
        );
      }
    }
    return { status: response.status, data, response };
  }) as TestApiRequest;
  request.login = (username, password) =>
    request("/auth/login", "POST", { username, password });

  if (!initializeAdministrator) return request;
  const setup = await request("/auth/status", "GET", undefined, { authenticated: false });
  if (setup.data.setupRequired !== true || typeof setup.data.setupToken !== "string") {
    throw new Error("Isolated test database did not require initial administrator setup.");
  }
  const created = await request(
    "/auth/setup",
    "POST",
    {
      displayName: "Synthetic Test Administrator",
      username: "test-admin",
      password: "synthetic-test-password-123",
    },
    {
      authenticated: false,
      headers: { "x-setup-token": setup.data.setupToken },
    },
  );
  if (created.status !== 201) {
    throw new Error(`Could not initialize synthetic test administrator (${created.status}).`);
  }
  return request;
}
