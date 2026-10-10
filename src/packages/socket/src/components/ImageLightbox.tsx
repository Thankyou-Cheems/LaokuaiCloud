import { useCallback, useEffect, useRef, useState } from "react";

import { i18n as socketI18n, useTranslation as useSocketTranslation } from "@/i18n";

import { PiCheck, PiCloudArrowDownFill, PiImageFill } from "../../../../lib/icons";
import { triggerDownload } from "../utils/downloadFile";
import { copyImageToClipboard } from "../utils/mediaClipboard";

type ZoomLevel = "fit" | "2x" | "full";

export const ImageLightbox = ({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt?: string;
  onClose: () => void;
}) => {
  useSocketTranslation();
  const [zoom, setZoom] = useState<ZoomLevel>("fit");
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 });
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const isDragging = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });

  const handleImageLoad = useCallback(() => {
    if (imgRef.current) {
      setNaturalSize({ w: imgRef.current.naturalWidth, h: imgRef.current.naturalHeight });
    }
  }, []);

  const cycleZoom = useCallback(() => {
    setZoom((prev) => {
      if (prev === "fit") return "2x";
      if (prev === "2x") return "full";
      return "fit";
    });
    setPan({ x: 0, y: 0 });
  }, []);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === containerRef.current) onClose();
    },
    [onClose]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (zoom === "fit") return;
      isDragging.current = true;
      lastMouse.current = { x: e.clientX, y: e.clientY };
    },
    [zoom]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging.current || zoom === "fit") return;
      const dx = e.clientX - lastMouse.current.x;
      const dy = e.clientY - lastMouse.current.y;
      lastMouse.current = { x: e.clientX, y: e.clientY };
      setPan((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
    },
    [zoom]
  );

  const handleMouseUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  let imgStyle: React.CSSProperties;
  if (zoom === "fit") {
    imgStyle = {
      maxWidth: "90vw",
      maxHeight: "90vh",
      objectFit: "contain",
      cursor: "zoom-in",
    };
  } else if (zoom === "2x") {
    const w = naturalSize.w > 0 ? naturalSize.w * 2 : undefined;
    const h = naturalSize.h > 0 ? naturalSize.h * 2 : undefined;
    imgStyle = {
      width: w,
      height: h,
      maxWidth: "none",
      maxHeight: "none",
      cursor: isDragging.current ? "grabbing" : "grab",
      transform: `translate(${pan.x}px, ${pan.y}px)`,
    };
  } else {
    imgStyle = {
      width: naturalSize.w || undefined,
      height: naturalSize.h || undefined,
      maxWidth: "none",
      maxHeight: "none",
      cursor: isDragging.current ? "grabbing" : "grab",
      transform: `translate(${pan.x}px, ${pan.y}px)`,
    };
  }

  return (
    <div
      ref={containerRef}
      className="lightbox-backdrop"
      onClick={handleBackdropClick}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <img
        ref={imgRef}
        src={src}
        alt={alt || socketI18n.t("socketFull.imageLightbox_dd5e3f2fea")}
        draggable={false}
        className="lightbox-image"
        style={imgStyle}
        onClick={(e) => {
          e.stopPropagation();
          cycleZoom();
        }}
        onMouseDown={handleMouseDown}
        onLoad={handleImageLoad}
      />
      <div style={{ position: "fixed", top: "calc(var(--titlebar-inset) + 16px)", right: 16, display: "flex", gap: 8, zIndex: 1 }}>
        <button
          onClick={(e) => {
            e.stopPropagation();
            copyImageToClipboard(src).then(() => {
              setCopied(true);
              if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
              copyTimeoutRef.current = setTimeout(() => setCopied(false), 2000);
            });
          }}
          title={copied ? socketI18n.t("ui.copied") : socketI18n.t("socketFull.imageLightbox_2141db002c")}
          aria-label={copied ? socketI18n.t("settingsFull.m8e3df45a49") : socketI18n.t("socketFull.imageLightbox_2141db002c")}
          className="lightbox-toolbar-btn"
        >
          {copied ? <PiCheck size={18} /> : <PiImageFill size={18} />}
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            void triggerDownload(src, alt);
          }}
          title={socketI18n.t("socketFull.imageLightbox_34cebf59ef")}
          aria-label={socketI18n.t("socketFull.imageLightbox_34cebf59ef")}
          className="lightbox-toolbar-btn"
        >
          <PiCloudArrowDownFill size={18} />
        </button>
      </div>
      <div className="lightbox-hint">
        {zoom === "fit" && socketI18n.t("socketFull.imageLightbox_24fd433afb")}
        {zoom === "2x" && socketI18n.t("socketFull.imageLightbox_d67ec994ef")}
        {zoom === "full" && socketI18n.t("socketFull.imageLightbox_3664294a77")}
      </div>
    </div>
  );
};
