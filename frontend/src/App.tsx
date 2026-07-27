import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ThemeWrapper } from "./theme";
import { AuthProvider } from "./contexts/AuthContext";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { Header } from "./components/Header";
import { OfflineIndicator } from "./components/OfflineIndicator";
import { SignInPage } from "./pages/auth/SignInPage";
import { SignUpPage } from "./pages/auth/SignUpPage";
import { AuthCallback } from "./pages/auth/AuthCallback";
import { ReaderPage, PostDetailPage } from "./pages/posts";
import { Box } from "@mui/material";

// Placeholder components - will be implemented in user story phases

function SettingsPage() {
  return <div>Settings Page (US6)</div>;
}

/**
 * Layout component with Header for authenticated pages
 */
function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <Header />
      <OfflineIndicator />
      <Box component="main" sx={{ flexGrow: 1, p: 2 }}>
        {children}
      </Box>
    </Box>
  );
}

/**
 * Main application component with routing
 */
function App() {
  return (
    <ThemeWrapper>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            {/* Public routes */}
            <Route path="/signin" element={<SignInPage />} />
            <Route path="/signup" element={<SignUpPage />} />
            <Route path="/auth/callback" element={<AuthCallback />} />

            {/* Protected routes */}
            <Route path="/" element={<Navigate to="/posts" replace />} />
            <Route
              path="/posts"
              element={
                <ProtectedRoute>
                  <AppLayout>
                    <ReaderPage />
                  </AppLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/posts/:id"
              element={
                <ProtectedRoute>
                  <AppLayout>
                    <PostDetailPage />
                  </AppLayout>
                </ProtectedRoute>
              }
            />
            {/* Feeds management is merged into the reader sidebar. Redirect
                any old /feeds links to the unified reader. */}
            <Route path="/feeds" element={<Navigate to="/posts" replace />} />
            <Route
              path="/settings"
              element={
                <ProtectedRoute>
                  <AppLayout>
                    <SettingsPage />
                  </AppLayout>
                </ProtectedRoute>
              }
            />

            {/* Catch-all redirect */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ThemeWrapper>
  );
}

export default App;
