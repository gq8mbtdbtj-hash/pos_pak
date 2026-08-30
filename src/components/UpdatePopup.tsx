import { useState } from "react";
import {
  installDesktopUpdate,
  openAndroidApkDownload,
  type UpdateInfo,
  updatePlatformHint,
} from "../lib/appUpdate";
import { isMobile } from "../lib/platform";
import { showToast } from "./Toast";

type Props = {
  info: UpdateInfo;
  onDismiss: () => void;
};

function errText(e: unknown) {
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e) {
    return String((e as { message: unknown }).message);
  }
  return String(e);
}

/** Update prompt — same visual language as debt-popup. */
export default function UpdatePopup({ info, onDismiss }: Props) {
  const [busy, setBusy] = useState(false);
  const mobile = isMobile();

  const primary = async () => {
    setBusy(true);
    try {
      if (mobile) {
        await openAndroidApkDownload(info.apkUrl);
        showToast("ok", "已打开下载页");
        onDismiss();
        return;
      }
      await installDesktopUpdate();
    } catch (e) {
      showToast("err", errText(e));
      setBusy(false);
    }
  };

  return (
    <div
      className="debt-popup-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="update-popup-title"
    >
      <div className="debt-popup debt-popup--low update-popup">
        <p className="debt-popup-level">Update</p>
        <p className="debt-popup-days" id="update-popup-title">
          发现新版本
        </p>
        <h3 className="debt-popup-title">
          {info.currentVersion} → {info.latestVersion}
        </h3>
        <p className="debt-popup-body">
          {info.notes?.trim() || updatePlatformHint()}
        </p>
        <div className="update-popup__actions">
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy}
            onClick={onDismiss}
          >
            稍后
          </button>
          <button type="button" className="btn" disabled={busy} onClick={primary}>
            {busy ? "处理中…" : mobile ? "去下载" : "立即更新"}
          </button>
        </div>
      </div>
    </div>
  );
}
