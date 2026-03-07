export type LoginRequest = { username: string; password: string };
export type LoginResponse = { authenticated: boolean; user: string };

export async function login(req: LoginRequest): Promise<LoginResponse> {
    const username = req.username.trim();
    const password = req.password;

    if (!username || !password) {
        throw new Error("Invalid username or password");
    }

    const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
        credentials: "include", // cookie/session
    });

    if (!res.ok) {
        throw new Error("Invalid username or password");
    }

    return (await res.json()) as LoginResponse;
}

export async function checkAuth(): Promise<boolean> {
    try {
        const res = await fetch("/api/auth/me", {
            method: "GET",
            // important to include cookies
            credentials: "include",
        });
        if (!res.ok) return false;
        const data = await res.json();
        return !!data.authenticated;
    } catch {
        return false;
    }
}

export async function logout(): Promise<void> {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
}
