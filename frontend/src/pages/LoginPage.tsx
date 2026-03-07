import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { login } from "../api/Login.api";
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

    // Sign In states
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

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
            await login({ username, password });
            // Session cookie is set automatically by backend
            navigate(from, { replace: true });
        } catch {
            // BR1.2 fixed wording
            setError("Invalid username or password");
        } finally {
            setLoading(false);
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
                <img
                    className="brand-logo"
                    src={logo}
                    alt="Durham University"
                />
            </header>

            <main className="login-main">
                <div className="login-card">
                    {/*Left: Sign In*/}
                    <section className="form-panel sign-in-panel">
                        <h1 className="login-title">
                            {showReset ? "Reset Password" : "Sign In"}
                        </h1>

                        {info && !showReset && (
                            <p className="login-info">{info}</p>
                        )}

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
                                        <label className="label">
                                            Username
                                        </label>
                                        <div className="input-wrap">
                                            <input
                                                className="input"
                                                value={username}
                                                onChange={(e) =>
                                                    setUsername(e.target.value)
                                                }
                                                placeholder="example@email.com"
                                                autoComplete="email"
                                                disabled={loading}
                                            />
                                            <span
                                                className="icon"
                                                aria-hidden="true"
                                            >
                                                ✉️
                                            </span>
                                        </div>
                                    </div>

                                    <div className="field">
                                        <label className="label">
                                            Password
                                        </label>
                                        <div className="input-wrap">
                                            <input
                                                className="input"
                                                type="password"
                                                value={password}
                                                onChange={(e) =>
                                                    setPassword(e.target.value)
                                                }
                                                placeholder="**************"
                                                autoComplete="current-password"
                                                disabled={loading}
                                            />
                                            <span
                                                className="icon"
                                                aria-hidden="true"
                                            >
                                                🔒
                                            </span>
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

                                    <button
                                        className="primary-btn"
                                        type="submit"
                                        disabled={loading}
                                    >
                                        {loading ? "Signing in..." : "Sign In"}
                                    </button>
                                </form>
                            </>
                        ) : (
                            <>
                                <p className="login-info">
                                    Enter your email and we’ll send you a reset
                                    link.
                                </p>

                                {resetMsg && (
                                    <p className="login-info">{resetMsg}</p>
                                )}

                                <form onSubmit={handleResetPassword}>
                                    <div className="field">
                                        <label className="label">Email</label>
                                        <div className="input-wrap">
                                            <input
                                                className="input"
                                                value={resetEmail}
                                                onChange={(e) =>
                                                    setResetEmail(
                                                        e.target.value,
                                                    )
                                                }
                                                placeholder="example@email.com"
                                                autoComplete="email"
                                                disabled={resetLoading}
                                            />
                                            <span
                                                className="icon"
                                                aria-hidden="true"
                                            >
                                                ✉️
                                            </span>
                                        </div>
                                    </div>

                                    <button
                                        className="primary-btn"
                                        type="submit"
                                        disabled={resetLoading}
                                    >
                                        {resetLoading
                                            ? "Sending..."
                                            : "Send reset link"}
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

                    {/*Right: Image Only*/}
                    <div className="image-panel">
                        <img src={campus} alt="Campus" />
                        <div className="overlay-tint" />
                        <div className="image-content">
                            <h2>Welcome Back!</h2>
                            <p>Please sign in to access the dashboard.</p>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}
