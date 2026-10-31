import { useCallback, useContext, useSyncExternalStore } from "react";
import AuthContext from "../contexts/AuthContext";

const PREFIX = "almanac:publisher-images:v1:";
const CHANGE_EVENT = "almanac:publisher-images-change";

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(CHANGE_EVENT, callback);
  };
}

export function usePublisherImages(explicitUserId?: string) {
  const auth = useContext(AuthContext);
  const userId = explicitUserId ?? auth?.user?.id;
  const operatorAllowed = import.meta.env.VITE_ALLOW_EXTERNAL_IMAGES === "true";
  const getSnapshot = useCallback(() => {
    if (!userId || !operatorAllowed) return false;
    try {
      return localStorage.getItem(`${PREFIX}${userId}`) === "true";
    } catch {
      return false;
    }
  }, [userId, operatorAllowed]);
  const allowed = useSyncExternalStore(subscribe, getSnapshot, () => false);
  const setAllowed = useCallback(
    (value: boolean) => {
      if (!userId || !operatorAllowed) return;
      try {
        localStorage.setItem(`${PREFIX}${userId}`, String(value));
      } catch {
        return;
      }
      window.dispatchEvent(new Event(CHANGE_EVENT));
    },
    [userId, operatorAllowed]
  );
  return { allowed, setAllowed, canOptIn: Boolean(userId) && operatorAllowed, operatorAllowed };
}
