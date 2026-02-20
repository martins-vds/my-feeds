/**
 * Protected Route wrapper component
 * Redirects unauthenticated users to sign-in page,
 * pending sign-up users to /signup page.
 */

import { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Box, CircularProgress } from "@mui/material";
import { useAuth } from "../contexts/AuthContext";

interface ProtectedRouteProps {
  children: ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { isAuthenticated, isLoading, isPendingSignup } = useAuth();
  const location = useLocation();

  // Show loading while checking auth status
  if (isLoading) {
    return (
      <Box
        sx={{
          minHeight: "100vh",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <CircularProgress />
      </Box>
    );
  }

  // Redirect pending sign-up users to the sign-up form
  if (!isAuthenticated && isPendingSignup) {
    return <Navigate to="/signup" state={{ from: location }} replace />;
  }

  // Redirect to sign-in if not authenticated
  if (!isAuthenticated) {
    return <Navigate to="/signin" state={{ from: location }} replace />;
  }

  // Render protected content
  return <>{children}</>;
}

export default ProtectedRoute;
