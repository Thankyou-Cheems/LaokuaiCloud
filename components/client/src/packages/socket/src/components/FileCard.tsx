import { useCallback } from "react";

import { i18n as socketI18n, useTranslation as useSocketTranslation } from "@/i18n";

import { PiCode, PiDownloadSimpleFill, PiFileAudioFill, PiFileFill, PiFileTextFill, PiFileVideoFill, PiFileZipFill, PiImageFill } from "../../../../lib/icons";
const FaFilePdf = PiFileTextFill;

import { getUploadsFileUrl } from "@/common";

import { saveOpenedFile, triggerDownload } from "../utils/downloadFile";
import { formatFileSize } from "../utils/formatFileSize";

function getFileIcon(mime: string | null) {
  if (!mime) return <PiFileFill size={24} />;
  if (mime.startsWith("image/")) return <PiImageFill size={24} />;
  if (mime.startsWith("audio/")) return <PiFileAudioFill size={24} />;
  if (mime.startsWith("video/")) return <PiFileVideoFill size={24} />;
  if (mime === "application/pdf") return <FaFilePdf size={24} />;
  if (mime.includes("zip") || mime.includes("tar") || mime.includes("rar") || mime.includes("gzip") || mime.includes("compress")) return <PiFileZipFill size={24} />;
  if (mime.includes("javascript") || mime.includes("json") || mime.includes("xml") || mime.includes("html") || mime.includes("css") || mime.includes("typescript")) return <PiCode size={24} />;
  if (mime.startsWith("text/")) return <PiFileTextFill size={24} />;
  return <PiFileFill size={24} />;
}

function mimeToLabel(mime: string | null): string {
  if (!mime) return socketI18n.t("socketFull.fileCard_b35a5f8e5c");
  if (mime.startsWith("image/")) return socketI18n.t("socketFull.fileCard_dd5e3f2fea");
  if (mime.startsWith("audio/")) return socketI18n.t("ui.audio");
  if (mime.startsWith("video/")) return socketI18n.t("shellFull.videoDebugOverlay_tsx_bc17c1f017");
  if (mime === "application/pdf") return "PDF";
  if (mime.includes("zip")) return socketI18n.t("socketFull.fileCard_d3853e2b19");
  if (mime.includes("tar")) return socketI18n.t("socketFull.fileCard_ce40ccf844");
  if (mime.includes("rar")) return socketI18n.t("socketFull.fileCard_c950c4b3e3");
  if (mime.includes("gzip")) return socketI18n.t("socketFull.fileCard_4c5ae85fd9");
  const sub = mime.split("/")[1];
  if (sub) return sub.toUpperCase();
  return socketI18n.t("socketFull.fileCard_b35a5f8e5c");
}

export const FileCard = ({
  fileId,
  mime,
  size,
  originalName,
  serverHost,
  open,
}: {
  fileId: string;
  mime: string | null;
  size: number | null;
  originalName: string | null;
  serverHost: string;
  /** The file itself, when it is here already. Encrypted, the server copy is ciphertext. */
  open?: () => Promise<Blob>;
}) => {
  useSocketTranslation();
  const fileUrl = getUploadsFileUrl(serverHost, fileId);
  const displayName = originalName || `${fileId.slice(0, 8)}...`;

  const handleDownload = useCallback(() => {
    void (open ? saveOpenedFile(open, originalName) : triggerDownload(fileUrl, originalName));
  }, [fileUrl, originalName, open]);

  return (
    <div className="flex items-center gap-3 chat-file-card">
      <div className="chat-file-card-icon">
        {getFileIcon(mime)}
      </div>
      <div className="flex flex-col" style={{ flex: 1, minWidth: 0 }}>
        <span className="text-sm font-medium" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {displayName}
        </span>
        <span className="text-xs text-gryt-muted">
          {mimeToLabel(mime)}{size != null ? ` \u2022 ${formatFileSize(size)}` : ""}
        </span>
      </div>
      <button
        type="button"
        onClick={handleDownload}
        className="chat-file-card-download"
        title={socketI18n.t("socketFull.fileCard_b512326e7f")}
      >
        <PiDownloadSimpleFill size={14} />
      </button>
    </div>
  );
};
