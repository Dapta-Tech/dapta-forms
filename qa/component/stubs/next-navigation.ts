/**
 * `next/navigation` for qa/component: there is no App Router in a blank page,
 * so the real hooks would throw. Components only need a router to call.
 */
const router = { replace: () => {}, push: () => {}, refresh: () => {}, back: () => {}, prefetch: () => {} };
export const useRouter = () => router;
export const usePathname = () => '/';
export const useSearchParams = () => new URLSearchParams();
export const unstable_rethrow = () => {};
