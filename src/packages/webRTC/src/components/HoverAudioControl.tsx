import { Button, IconButton, Popover } from "@gryt/ui";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { useTranslation } from "@/i18n";
import { useSettings } from "@/settings";

import { PiCaretRightBold } from "../../../../lib/icons";

/** Pointer and keyboard paths share a popup; the main action stays an ordinary button. */
export function HoverAudioControl({ label, side, action, children }: {
  label: string;
  side: "top" | "right";
  action: ReactNode;
  children: ReactNode;
}) {
  const { t: tr } = useTranslation();
  const { openSettings } = useSettings();
  const [returnFocus, setReturnFocus] = useState(true);
  const [open, setOpen] = useState(false);
  const [hoverOpen, setHoverOpen] = useState(false);
  const group = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const arrow = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragging = useRef(false);
  const keyboardMode = useRef(true);
  const explicitlyOpened = useRef(false);
  const overGroup = useRef(false);
  const overPanel = useRef(false);

  const clearTimer = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  const focusInside = () => group.current?.contains(document.activeElement) || panel.current?.contains(document.activeElement);
  const scheduleClose = () => {
    clearTimer();
    timer.current = setTimeout(() => {
      if (!explicitlyOpened.current && !dragging.current && !overGroup.current && !overPanel.current && !(keyboardMode.current && focusInside())) setOpen(false);
    }, 220);
  };

  useEffect(() => {
    if (!open) {
      overGroup.current = false;
      overPanel.current = false;
      dragging.current = false;
      explicitlyOpened.current = false;
    }
  }, [open]);

  useEffect(() => {
    const release = () => {
      dragging.current = false;
      // A slider retains focus on release; it remains open until blur or Escape.
      if (!explicitlyOpened.current && !overGroup.current && !overPanel.current &&
          !(keyboardMode.current && (group.current?.contains(document.activeElement) || panel.current?.contains(document.activeElement)))) {
        setOpen(false);
      }
    };
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    return () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, []);

  return (
    <Popover.Root open={open} onOpenChange={(next) => {
      clearTimer();
      setHoverOpen(false);
      explicitlyOpened.current = next;
      if (next) setReturnFocus(true);
      setOpen(next);
    }}>
      <div ref={group} className="flex items-center" data-gryt="hover-audio-control"
        onPointerEnter={(event) => {
          if (event.pointerType === "touch") return;
          overGroup.current = true;
          if (explicitlyOpened.current) { clearTimer(); return; }
          keyboardMode.current = false;
          clearTimer();
          timer.current = setTimeout(() => { setHoverOpen(true); setReturnFocus(true); setOpen(true); }, 150);
        }}
        onPointerLeave={() => { overGroup.current = false; scheduleClose(); }}
        onPointerDownCapture={() => { keyboardMode.current = false; }}
        onKeyDownCapture={() => { keyboardMode.current = true; }}
        onFocusCapture={(event) => {
          if (keyboardMode.current) clearTimer();
          if (keyboardMode.current && !arrow.current?.contains(event.target)) { setHoverOpen(true); setReturnFocus(true); setOpen(true); }
        }}
        onBlurCapture={scheduleClose}
      >
        {action}
        <Popover.Trigger ref={arrow}
          render={<IconButton tone="neutral" size="xsmall" className="!w-4 !min-w-4 !px-0" />}
          aria-label={tr("voiceAudio.expand", { control: label })}
          title={tr("voiceAudio.expand", { control: label })}
        >
          <PiCaretRightBold size={10} className={side === "top" ? "-rotate-90" : undefined} />
        </Popover.Trigger>
      </div>
      <Popover.Portal>
        <Popover.Positioner side={side} sideOffset={4} collisionPadding={8}>
          <Popover.Popup ref={panel}
            initialFocus={hoverOpen ? false : undefined}
            finalFocus={returnFocus && !hoverOpen ? arrow : false}
            className="transition-[opacity,transform] duration-150 w-60 max-w-[calc(100vw-16px)] max-h-[calc(100dvh-16px)] overflow-y-auto motion-reduce:!transition-none motion-reduce:!duration-0 motion-reduce:!animate-none data-[starting-style]:opacity-0 data-[ending-style]:opacity-0"
            onPointerEnter={(event) => { if (event.pointerType !== "touch") overPanel.current = true; clearTimer(); }}
            onPointerLeave={(event) => { if (event.pointerType === "touch") return; overPanel.current = false; scheduleClose(); }}
            onPointerDownCapture={(event) => {
              keyboardMode.current = false;
              if (event.pointerType === "touch") explicitlyOpened.current = true;
              dragging.current = true; clearTimer();
            }}
            onKeyDownCapture={() => { keyboardMode.current = true; }}
            onFocusCapture={clearTimer}
            onBlurCapture={scheduleClose}
          >
            <Popover.Title>{label}</Popover.Title>
            <div className="mt-2 flex flex-col gap-2">{children}</div>
            <Button tone="neutral" className="mt-2" onClick={() => {
              clearTimer();
              setReturnFocus(false);
              setOpen(false);
              openSettings("audio");
            }}>{tr("receiveVolume.more")}</Button>
            <Popover.Close className="mt-2 text-sm underline">{tr("receiveVolume.close")}</Popover.Close>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
