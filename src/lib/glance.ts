export const SELECT_GOAL_KEY = "personal-os:select-goal";
export const EDIT_PAY_SNAPSHOT = "personal-os:edit-pay-snapshot";

export function openPaySnapshotEditor(snapshotId?: string) {
  window.dispatchEvent(
    new CustomEvent(EDIT_PAY_SNAPSHOT, { detail: { snapshotId } }),
  );
}
