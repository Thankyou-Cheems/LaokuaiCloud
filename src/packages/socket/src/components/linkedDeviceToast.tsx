/* eslint-disable react-refresh/only-export-components -- Toast factories intentionally return subscribed React bodies. */
import { Button } from "@gryt/ui";
import toast from "react-hot-toast";

import { i18n as socketI18n, useTranslation as useSocketTranslation } from "@/i18n";

import { linkedDeviceLine, type LinkedDeviceNotice } from "../mls/linkedDevices";
import { openUserSettings } from "./dmKeyWarningToast";

function LinkedDeviceToastBody({ notice, id }: { notice: LinkedDeviceNotice; id: string }) {
  useSocketTranslation();
  return (
    <div className="flex flex-col gap-2" style={{ minWidth: 0 }}>
      <span className="text-sm" style={{ lineHeight: 1.5 }}>
        {linkedDeviceLine(notice, false)}
      </span>
      <div className="flex items-center gap-2" style={{ alignSelf: "flex-end" }}>
        <Button tone="neutral" size="xsmall" onClick={() => toast.dismiss(id)}>
          {socketI18n.t("ui.close")}
        </Button>
        <Button
          size="xsmall"
          onClick={() => {
            toast.dismiss(id);
            openUserSettings("security");
          }}
        >
          {socketI18n.t("shellFull.approveDevice_tsx_33c455a097")}
        </Button>
      </div>
    </div>
  );
}

/** The live half of "New device linked". Settings, Security keeps it until it's dismissed there. */
export function showLinkedDeviceToast(notice: LinkedDeviceNotice): void {
  const id = `linked-device-${notice.deviceId}`;
  toast(() => <LinkedDeviceToastBody notice={notice} id={id} />, { id, duration: 30_000 });
}
