import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { checkAuth } from "../api/Login.api";

export default function ProtectedRoute() {
    const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(
        null,
    );
    const location = useLocation();

    useEffect(() => {
        let mounted = true;
        checkAuth()
            .then((authed) => {
                if (mounted) setIsAuthenticated(authed);
            })
            .catch(() => {
                if (mounted) setIsAuthenticated(false);
            });

        return () => {
            mounted = false;
        };
    }, []);

    if (isAuthenticated === null) {
        // Loading state... could be a spinner
        return <div>Loading...</div>;
    }

    if (!isAuthenticated) {
        return (
            <Navigate
                to="/login"
                replace
                state={{ message: "Please log in", from: location.pathname }}
            />
        );
    }

    return <Outlet />;
}
