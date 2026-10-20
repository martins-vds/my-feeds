import { useState, useEffect } from "react";
import { Snackbar, Alert, Button, Box } from "@mui/material";
import OfflineIcon from "@mui/icons-material/WifiOff";
import OnlineIcon from "@mui/icons-material/Wifi";

/**
 * OfflineIndicator - Shows connectivity status and SW updates
 *
 * Displays:
 * - Offline warning when network is unavailable
 * - Update prompt when new service worker is available
 */
export function OfflineIndicator() {
    const [isOnline, setIsOnline] = useState(navigator.onLine);
    const [showOfflineSnackbar, setShowOfflineSnackbar] = useState(false);
    const [showUpdateSnackbar, setShowUpdateSnackbar] = useState(false);
    const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);

    useEffect(() => {
        // Handle online/offline events
        const handleOnline = () => {
            setIsOnline(true);
            setShowOfflineSnackbar(false);
        };

        const handleOffline = () => {
            setIsOnline(false);
            setShowOfflineSnackbar(true);
        };

        window.addEventListener("online", handleOnline);
        window.addEventListener("offline", handleOffline);

        // Check for SW updates
        if ("serviceWorker" in navigator) {
            navigator.serviceWorker.ready.then((registration) => {
                // Check for waiting worker
                if (registration.waiting) {
                    setWaitingWorker(registration.waiting);
                    setShowUpdateSnackbar(true);
                }

                // Listen for new workers
                registration.addEventListener("updatefound", () => {
                    const newWorker = registration.installing;
                    if (newWorker) {
                        newWorker.addEventListener("statechange", () => {
                            if (
                                newWorker.state === "installed" &&
                                navigator.serviceWorker.controller
                            ) {
                                setWaitingWorker(newWorker);
                                setShowUpdateSnackbar(true);
                            }
                        });
                    }
                });
            });

            // Handle controller change (reload on new SW activation)
            let refreshing = false;
            navigator.serviceWorker.addEventListener("controllerchange", () => {
                if (!refreshing) {
                    refreshing = true;
                    window.location.reload();
                }
            });
        }

        return () => {
            window.removeEventListener("online", handleOnline);
            window.removeEventListener("offline", handleOffline);
        };
    }, []);

    // Handle update button click
    const handleUpdate = () => {
        if (waitingWorker) {
            waitingWorker.postMessage({ type: "SKIP_WAITING" });
        }
        setShowUpdateSnackbar(false);
    };

    return (
        <>
            {/* Offline indicator */}
            <Snackbar
                open={showOfflineSnackbar}
                anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
            >
                <Alert
                    severity="warning"
                    icon={<OfflineIcon />}
                    sx={{ width: "100%" }}
                >
                    You are offline. Some features may be unavailable.
                </Alert>
            </Snackbar>

            {/* Update available indicator */}
            <Snackbar
                open={showUpdateSnackbar}
                anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
            >
                <Alert
                    severity="info"
                    icon={<OnlineIcon />}
                    sx={{ width: "100%" }}
                    action={
                        <Button color="inherit" size="small" onClick={handleUpdate}>
                            Update
                        </Button>
                    }
                >
                    A new version is available!
                </Alert>
            </Snackbar>

            {/* Persistent offline badge (optional - shows in header area) */}
            {!isOnline && (
                <Box
                    sx={{
                        position: "fixed",
                        top: 64,
                        right: 16,
                        zIndex: 1200,
                        bgcolor: "warning.main",
                        color: "warning.contrastText",
                        px: 1,
                        py: 0.5,
                        borderRadius: 1,
                        fontSize: "0.75rem",
                        display: "flex",
                        alignItems: "center",
                        gap: 0.5,
                    }}
                    data-testid="offline-badge"
                >
                    <OfflineIcon fontSize="small" />
                    Offline
                </Box>
            )}
        </>
    );
}

export default OfflineIndicator;
