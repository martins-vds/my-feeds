/**
 * Protected Route wrapper component
 * Redirects unauthenticated users to sign-in page,
 * pending sign-up users to /signup page.
 */

import { Fragment, ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Box, CircularProgress, Modal } from "@mui/material";
import { useAuth } from "../contexts/AuthContext";

interface ProtectedRouteProps {
  children: ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { isAuthenticated, isLoading, isPendingSignup, privateStateKey } = useAuth();
  const location = useLocation();

  if (isAuthenticated) {
    return (
      <>
        <Box
          inert={isLoading}
          aria-hidden={isLoading || undefined}
          sx={{ visibility: isLoading ? "hidden" : "visible" }}
        >
          <Fragment key={privateStateKey}>{children}</Fragment>
        </Box>
        <Modal
          open={isLoading}
          sx={{ zIndex: (theme) => theme.zIndex.tooltip + 1 }}
          slotProps={{ backdrop: { sx: { bgcolor: "background.default" } } }}
        >
          <Box
            role="status"
            aria-label="Checking your session"
            tabIndex={-1}
            sx={{
              position: "absolute",
              inset: 0,
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              bgcolor: "background.default",
              outline: "none",
            }}
          >
            <CircularProgress />
          </Box>
        </Modal>
      </>
    );
  }

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

  return null;
}

export default ProtectedRoute;
