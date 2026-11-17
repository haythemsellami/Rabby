// An approval cannot survive a lock, unlock, account change, or chain change.
let version = 0;
export const getMonadSessionVersion = () => version;
export const invalidateMonadSession = () => {
  version += 1;
};
export function assertMonadSession(expected: number) {
  if (expected !== version)
    throw new Error('Monad approval expired; request a new approval');
}
