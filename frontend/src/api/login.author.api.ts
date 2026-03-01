export type LoginRequest = { username: string; password: string };
export type LoginResponse = { token: string };

const USE_MOCK = true;

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
    const res = await fetch(url, options);
    if (!res.ok) throw new Error(`Request failed: ${res.status}`);
    return (await res.json()) as T;
}

export async function login(req: LoginRequest): Promise<LoginResponse> {
    if (USE_MOCK) {
        return { token: "demo-token" };
    }

    //
    return fetchJson<LoginResponse>("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
    });
}
