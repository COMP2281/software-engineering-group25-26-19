import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { setToken } from "../api/authorToken";
import { login } from "../api/login.author.api"
import "./LoginPage.css";

import logo from "../api/durham-logo.png";
import campus from "../api/durham-campus.jpg";

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation() as any;
  const info = location?.state?.info as string | undefined;

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!username.trim() || !password.trim()) {
      setError("Invalid username or password");
      return;
    }

    try {
      setLoading(true);
      const { token } = await login({ username, password });
      setToken(token);
      navigate("/dashboard");
    } catch (err: any) {
      setError(err?.message ?? "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <header className="brand-header">
        <img className="brand-logo" src={logo} alt="Durham University" />
      </header>

      <main className="login-main">
        <div className="login-card">
          <section className="login-left">
            <h1 className="login-title">Sign In</h1>
            {info && <p className="login-info">{info}</p>}
            {error && <div className="login-error">{error}</div>}

            <form onSubmit={handleSubmit}>
              <div className="field">
                <label className="label">Username</label>
                <div className="input-wrap">
                  <input
                    className="input"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="example@email.com"
                    autoComplete="email"
                  />
                  <span className="icon" aria-hidden="true">✉️</span>
                </div>
              </div>

              <div className="field">
                <label className="label">Password</label>
                <div className="input-wrap">
                  <input
                    className="input"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="**************"
                    autoComplete="current-password"
                  />
                  <span className="icon" aria-hidden="true">🔒</span>
                </div>
              </div>

              <a className="forgot" href="#" onClick={(e) => e.preventDefault()}>
                Forgot password?
              </a>

              <button className="primary-btn" type="submit" disabled={loading}>
                {loading ? "Signing in..." : "Sign In"}
              </button>

              {/* Sign Up (clickable, redirects to /signup) */}
              <div className="bottom-text">
                Don&apos;t have an account?{" "}
                <Link className="signup-link" to="/signup">
                  Sign Up
                </Link>
              </div>
            </form>
          </section>

          {/* Right-side image */}
          <aside className="login-right" aria-label="Campus photo">
            <img src={campus} alt="Durham campus" />
          </aside>
        </div>
      </main>
    </div>
  );
}
