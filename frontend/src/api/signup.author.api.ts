export type SignupRequest = {
  username: string; 
  name: string;
  password: string;
};

export type SignupResponse = { ok: true };

// backend ready : set false 
const USE_MOCK = true;

// use localStorage mock user database
export const USERS_KEY = "mock_users";

function loadUsers(): Record<string, { name: string; password: string }> {
  const raw = localStorage.getItem(USERS_KEY);
  return raw ? (JSON.parse(raw) as Record<string, { name: string; password: string }>) : {};
}

function saveUsers(users: Record<string, { name: string; password: string }>) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

export async function signup(req: SignupRequest): Promise<SignupResponse> {
  const username = req.username.trim();
  const name = req.name.trim();
  const password = req.password;

  if (!username || !name || !password) {
    throw new Error("Please fill in all fields");
  }

  if (password.length < 6) {
    throw new Error("Password must be at least 6 characters");
  }

  if (USE_MOCK) {
    const users = loadUsers();

    if (users[username]) {
      throw new Error("User already exists");
    }

    users[username] = { name, password };
    saveUsers(users);

    return { ok: true };
  }

  const res = await fetch("/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, name, password }),
  });

  if (!res.ok) throw new Error("Sign up failed");
  return { ok: true };
}
