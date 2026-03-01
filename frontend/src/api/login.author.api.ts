export type LoginRequest = { username: string; password: string };
export type LoginResponse = { token: string };

// When the backend is ready, change it to false 
const USE_MOCK = true;
const USERS_KEY = "mock_users";

function loadUsers(): Record<string, { name: string; password: string }> {
  const raw = localStorage.getItem(USERS_KEY);
  return raw ? (JSON.parse(raw) as Record<string, { name: string; password: string }>) : {};
}

export async function login(req: LoginRequest): Promise<LoginResponse> {
  const username = req.username.trim();
  const password = req.password;

  if (!username || !password) {
    throw new Error("Invalid username or password");
  }

  if (USE_MOCK) {
    if (username === "test" && password === "123456") {
      return { token: "demo-token" };
    }

    const users = loadUsers();
    const user = users[username];

    if (user && user.password === password) {
      return { token: "demo-token" };
    }

    // BR1.2
    throw new Error("Invalid username or password");
  }

  // change to api
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
    credentials: "include", //cookie/session
  });

  if (!res.ok) {
    throw new Error("Invalid username or password");
  }

  return (await res.json()) as LoginResponse;
}
