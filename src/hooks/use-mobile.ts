import { useSyncExternalStore } from "react";

const MOBILE_BREAKPOINT = 768;
const query = () => window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);

/** true en pantallas angostas; se observa el media query como store externo. */
export function useIsMobile() {
  return useSyncExternalStore(
    (cb) => {
      const mql = query();
      mql.addEventListener("change", cb);
      return () => mql.removeEventListener("change", cb);
    },
    () => query().matches,
    () => false,
  );
}
