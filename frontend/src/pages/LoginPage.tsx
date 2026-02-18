import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { setToken } from "../api/authorToken";
import { login } from "../api/login.author.api";
import { signup } from "../api/signup.author.api";
import "./LoginPage.css";

import logo from "../assets/durham-logo.png";
import campus from "../assets/durham-campus.jpg";

// BR1.3 "Please log in"
type LoginLocationState = {
  message?: string;
  from?: string;
};

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state || {}) as LoginLocationState;
  const info = state.message;

  // overlay (false = Sign In, true = Sign Up)
  const [rightActive, setRightActive] = useState(false);

  // Sign In states
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  //Sign Up states
  const [suName, setSuName] = useState("");
  const [suUsername, setSuUsername] = useState("");
  const [suPassword, setSuPassword] = useState("");
  const [suConfirm, setSuConfirm] = useState("");
  const [suError, setSuError] = useState("");
  const [suSuccess, setSuSuccess] = useState("");
  const [suLoading, setSuLoading] = useState(false);

  //Forgot Password states
  const [showReset, setShowReset] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetMsg, setResetMsg] = useState("");
  const [resetLoading, setResetLoading] = useState(false);

  // Sign In submi
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!username.trim() || !password.trim()) {
      setError("Please enter username and password");
      return;
    }

    const from = state.from ?? "/dashboard";

    try {
      setLoading(true);
      const { token } = await login({ username, password });
      setToken(token);
      navigate(from, { replace: true });
    } catch {
      // BR1.2 fixed wording
      setError("Invalid username or password");
    } finally {
      setLoading(false);
    }
  }

  // Sign Up submit
  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setSuError("");
    setSuSuccess("");

    if (!suName.trim() || !suUsername.trim() || !suPassword.trim() || !suConfirm.trim()) {
      setSuError("Please fill in all fields");
      return;
    }

    if (suPassword.length < 6) {
      setSuError("Password must be at least 6 characters");
      return;
    }

    if (suPassword !== suConfirm) {
      setSuError("Passwords do not match");
      return;
    }

    try {
      setSuLoading(true);
      await signup({
        name: suName.trim(),
        username: suUsername.trim(),
        password: suPassword,
      });

      setSuSuccess("Account created! Please sign in.");

      // clear form
      setSuName("");
      setSuUsername("");
      setSuPassword("");
      setSuConfirm("");

      // switch back to Sign In
      setTimeout(() => setRightActive(false), 700);
    } catch (err) {
      setSuError((err as Error).message || "Sign up failed");
    } finally {
      setSuLoading(false);
    }
  }

  //Forgot Password submit (mock)
  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    setResetMsg("");

    if (!resetEmail.trim()) {
      setResetMsg("Please enter your email");
      return;
    }

    try {
      setResetLoading(true);

      // mock request to backend (later replace with API call)
      await new Promise((res) => setTimeout(res, 800));

      // security-friendly wording (don’t reveal whether email exists)
      setResetMsg("If the email exists, a reset link has been sent.");
      setResetEmail("");
    } finally {
      setResetLoading(false);
    }
  }

  return (
    <div className="login-page">
      <header className="brand-header">
        <img className="brand-logo" src={logo} alt="Durham University" />
      </header>

      <main className="login-main">
        <div className={`login-card overlay-wrap ${rightActive ? "right-active" : ""}`}>
          {/*Left: Sign In*/}
          <section className="form-panel sign-in-panel">
            <h1 className="login-title">{showReset ? "Reset Password" : "Sign In"}</h1>

            {info && !showReset && <p className="login-info">{info}</p>}

            {error && !showReset && (
              <div className="login-error" role="alert">
                {error}
              </div>
            )}

            {/* ✅ 视图切换：要么 Sign In，要么 Reset */}
            {!showReset ? (
              <>
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
                        disabled={loading}
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
                        disabled={loading}
                      />
                      <span className="icon" aria-hidden="true">🔒</span>
                    </div>
                  </div>

                  <button
                    type="button"
                    className="forgot btn-link"
                    onClick={() => {
                      setError("");
                      setShowReset(true);
                      setResetMsg("");
                      setResetEmail("");
                    }}
                    disabled={loading}
                  >
                    Forgot password?
                  </button>

                  <button className="primary-btn" type="submit" disabled={loading}>
                    {loading ? "Signing in..." : "Sign In"}
                  </button>

                  <div className="bottom-text">
                    Don&apos;t have an account?{" "}
                    <button
                      type="button"
                      className="signup-link btn-link"
                      onClick={() => {
                        setError("");
                        setRightActive(true);
                      }}
                    >
                      Sign Up
                    </button>
                  </div>
                </form>
              </>
            ) : (
              <>
                <p className="login-info">
                  Enter your email and we’ll send you a reset link.
                </p>

                {resetMsg && <p className="login-info">{resetMsg}</p>}

                <form onSubmit={handleResetPassword}>
                  <div className="field">
                    <label className="label">Email</label>
                    <div className="input-wrap">
                      <input
                        className="input"
                        value={resetEmail}
                        onChange={(e) => setResetEmail(e.target.value)}
                        placeholder="example@email.com"
                        autoComplete="email"
                        disabled={resetLoading}
                      />
                      <span className="icon" aria-hidden="true">✉️</span>
                    </div>
                  </div>

                  <button className="primary-btn" type="submit" disabled={resetLoading}>
                    {resetLoading ? "Sending..." : "Send reset link"}
                  </button>

                  <button
                    type="button"
                    className="btn-link"
                    onClick={() => {
                      setShowReset(false);
                      setResetMsg("");
                    }}
                    disabled={resetLoading}
                    style={{ marginTop: 10 }}
                  >
                    Back to Sign In
                  </button>
                </form>
              </>
            )}
          </section>


          {/*Right: Sign Up*/}
          <section className="form-panel sign-up-panel" aria-label="Sign up">
            <h1 className="login-title">Sign Up</h1>

            {suSuccess && <p className="login-info">{suSuccess}</p>}
            {suError && (
              <div className="login-error" role="alert">
                {suError}
              </div>
            )}

            <form onSubmit={handleSignup}>
              <div className="field">
                <label className="label">Full name</label>
                <div className="input-wrap">
                  <input
                    className="input"
                    value={suName}
                    onChange={(e) => setSuName(e.target.value)}
                    placeholder="Your name"
                    disabled={suLoading}
                  />
                  <span className="icon" aria-hidden="true">
                    👤
                  </span>
                </div>
              </div>

              <div className="field">
                <label className="label">Email / Username</label>
                <div className="input-wrap">
                  <input
                    className="input"
                    value={suUsername}
                    onChange={(e) => setSuUsername(e.target.value)}
                    placeholder="example@email.com"
                    autoComplete="email"
                    disabled={suLoading}
                  />
                  <span className="icon" aria-hidden="true">
                    ✉️
                  </span>
                </div>
              </div>

              <div className="field">
                <label className="label">Password</label>
                <div className="input-wrap">
                  <input
                    className="input"
                    type="password"
                    value={suPassword}
                    onChange={(e) => setSuPassword(e.target.value)}
                    placeholder="**************"
                    disabled={suLoading}
                  />
                  <span className="icon" aria-hidden="true">
                    🔒
                  </span>
                </div>
              </div>

              <div className="field">
                <label className="label">Confirm password</label>
                <div className="input-wrap">
                  <input
                    className="input"
                    type="password"
                    value={suConfirm}
                    onChange={(e) => setSuConfirm(e.target.value)}
                    placeholder="**************"
                    disabled={suLoading}
                  />
                  <span className="icon" aria-hidden="true">
                    ✅
                  </span>
                </div>
              </div>

              <button className="primary-btn" type="submit" disabled={suLoading}>
                {suLoading ? "Creating..." : "Create Account"}
              </button>

              <div className="bottom-text">
                Already have an account?{" "}
                <button
                  type="button"
                  className="signup-link btn-link"
                  onClick={() => {
                    setSuError("");
                    setSuSuccess("");
                    setRightActive(false);
                  }}
                >
                  Sign In
                </button>
              </div>
            </form>
          </section>

          {/*Overlay*/}
          <div className="overlay-panel" aria-hidden="true">
            <div className="overlay-bg">
              <img src={campus} alt="" />
            </div>
            <div className="overlay-tint" />
            <div className="overlay-content">
              <div className="overlay-side overlay-left">
                <h2>Hello, Friend!</h2>
                <p>Create an account to start exploring.</p>
                <button type="button" className="ghost-btn" onClick={() => setRightActive(false)}>
                  Sign In
                </button>
              </div>

              <div className="overlay-side overlay-right">
                <h2>Welcome Back!</h2>
                <p>Please sign in to access the dashboard.</p>
                <button type="button" className="ghost-btn" onClick={() => setRightActive(true)}>
                  Sign Up
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
