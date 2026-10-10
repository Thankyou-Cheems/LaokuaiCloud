import { Button, Chip, type ChipProps, Dialog } from "@gryt/ui";
import type { Icon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { Trans } from "react-i18next";

import { LogoIcon } from "@/common";
import { i18n as socketI18n, useTranslation as useSocketTranslation } from "@/i18n";

import {
  PiBellFill,
  PiChatCircleFill,
  PiCloudArrowDownFill,
  PiDeviceMobileFill,
  PiDotsThreeCircleFill,
  PiGearFill,
  PiHardDrivesFill,
  PiHouseFill,
  PiMicrophoneFill,
  PiShieldCheckFill,
} from "../../../../lib/icons";

export interface WhatsNewChange {
  kind: string;
  /** The part of Gryt it touches. Releases before 1.11.0, and older sites, have none. */
  area?: string;
  text: string;
}

/** Set when the releases are ones a server has not updated to yet (GRYT-1413). */
export interface WhatsNewAhead {
  running: string;
  latest: string;
  /** Said in place of the list while there is none: still loading, or no lines yet. */
  empty?: string;
}

export interface WhatsNewRelease {
  version: string;
  date: string;
  line: string;
  changes?: WhatsNewChange[];
  /** Slug of the blog post telling this release's story, where there is one. */
  post?: string;
}

/**
 * The order the kinds are drawn in, which is not the order they are written in.
 * Security leads wherever it appears: below the features it is what gets skipped.
 */
const KIND_ORDER = ["security", "new", "changed", "fixed"];

const LABELS: Record<string, string> = {
  get new() { return socketI18n.t("shellFull.discovery_tsx_6403f2b7eb"); },
  get fixed() { return socketI18n.t("socketFull.whatsNewDialog_cb01508da2"); },
  get changed() { return socketI18n.t("socketFull.whatsNewDialog_b6809a4954"); },
  get security() { return socketI18n.t("ui.security"); },
};

/**
 * The two kinds that decide whether somebody reads this or presses Done. The
 * rest, and a kind this build cannot name, stay neutral.
 */
const TONES: Record<string, ChipProps["tone"]> = {
  new: "primary",
  security: "danger",
};

/**
 * The changes in KIND_ORDER, as written within a kind, with anything the site
 * has started emitting that this build does not know about kept on the end.
 */
function ordered(changes: WhatsNewChange[]): WhatsNewChange[] {
  const kinds = [...new Set(changes.map((c) => c.kind))];
  const order = [
    ...KIND_ORDER.filter((k) => kinds.includes(k)),
    ...kinds.filter((k) => !KIND_ORDER.includes(k)),
  ];

  return order.flatMap((kind) => changes.filter((c) => c.kind === kind));
}

/** The site's AREAS, in the order the headings are drawn. A copy, like the kinds above. */
const AREAS = new Map([
  ["voice", socketI18n.t("ui.voiceVideo")],
  ["chat", socketI18n.t("ui.chat")],
  ["notifications", socketI18n.t("ui.notifications")],
  ["servers", socketI18n.t("socketFull.whatsNewDialog_6a8fb495f0")],
  ["settings", socketI18n.t("socketFull.whatsNewDialog_f6552d1a92")],
  ["phone", socketI18n.t("socketFull.whatsNewDialog_e364611bf5")],
  ["self-hosting", "Self-hosting"],
]);

/**
 * A mark per area, from what the app already draws: the settings rail's own icons, and
 * the house the Add Server screen offers to run a server on this machine with.
 */
const AREA_ICONS = new Map<string, Icon>([
  ["voice", PiMicrophoneFill],
  ["chat", PiChatCircleFill],
  ["notifications", PiBellFill],
  ["servers", PiHardDrivesFill],
  ["settings", PiGearFill],
  ["phone", PiDeviceMobileFill],
  ["self-hosting", PiHouseFill],
]);

/** For Other, and for an area the site has added since this build. */
const OTHER_ICON = PiDotsThreeCircleFill;

interface AreaGroup {
  /** The site's id for the area. Empty for the changes that carry none. */
  area: string;
  label: string;
  icon: Icon;
  changes: WhatsNewChange[];
}

const areaOf = (change: WhatsNewChange) => (typeof change.area === "string" ? change.area : "");

/**
 * The changes under their area's heading, in AREAS order. An area this build doesn't
 * know keeps its own name, and a change with no area goes last, under Other.
 */
function grouped(changes: WhatsNewChange[]): AreaGroup[] {
  const present = new Set(changes.map(areaOf));
  const order = [
    ...[...AREAS.keys()].filter((area) => present.has(area)),
    ...[...present].filter((area) => area !== "" && !AREAS.has(area)),
    ...(present.has("") ? [""] : []),
  ];

  return order.map((area) => ({
    area,
    label: AREAS.get(area) ?? (area || socketI18n.t("settingsFull.m6e6a6f2086")),
    icon: AREA_ICONS.get(area) ?? OTHER_ICON,
    changes: changes.filter((c) => areaOf(c) === area),
  }));
}

/**
 * The day and month, in the reader's locale. From the parts, because
 * `new Date("2026-09-08")` is UTC midnight and reads as the 7th in the Americas.
 */
function readableDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  return new Date(year, month - 1, day).toLocaleDateString(socketI18n.resolvedLanguage, {
    day: "numeric",
    month: "long",
  });
}

/** A row per change, each with its kind's pill. */
function ChangeRows({ changes }: { changes: WhatsNewChange[] }) {
  useSocketTranslation();
  return (
    <ul className="whats-new-changes">
      {ordered(changes).map((change, i) => (
        <li key={i} className="whats-new-change">
          <Chip className="whats-new-kind" tone={TONES[change.kind] ?? "neutral"}>
            {LABELS[change.kind] ?? change.kind}
          </Chip>
          <p>{change.text}</p>
        </li>
      ))}
    </ul>
  );
}

/**
 * One area: its heading, then its rows. The two share a grid row, which is the box the
 * heading stays pinned inside while that area is what you are reading (GRYT-1402).
 */
function AreaBlock({
  changes,
  className,
  heading: Heading,
  icon: AreaIcon,
  label,
}: {
  changes: WhatsNewChange[];
  className?: string;
  heading: "h3" | "h4";
  icon: Icon;
  label: string;
}) {
  useSocketTranslation();
  return (
    <div className={className ? `whats-new-group ${className}` : "whats-new-group"}>
      <Heading className="whats-new-area">
        <AreaIcon className="whats-new-area-icon" size={15} />
        <span className="whats-new-area-name">{label}</span>
      </Heading>
      <ChangeRows changes={changes} />
    </div>
  );
}

/** Where a release's blog post lives, given its slug. */
function blogHref(post: string): string {
  return `https://gryt.chat/blog/${post}`;
}

/** A link to the release's blog post, where it has one. Nothing otherwise. */
function PostLink({ post }: { post?: string }) {
  useSocketTranslation();
  if (!post) return null;
  return (
    <a className="gryt-link whats-new-post" href={blogHref(post)} target="_blank" rel="noreferrer">
      {" "}{socketI18n.t("socketFull.whatsNewDialog_21f8b9b5c5")}</a>
  );
}

/**
 * One release: its line, then its security fixes in a block of their own, then the
 * rest under a heading per area. Changes that all share an area get no heading.
 */
function ReleaseBody({
  line,
  changes,
  post,
  heading = "h3",
}: {
  line: string;
  changes?: WhatsNewChange[];
  post?: string;
  heading?: "h3" | "h4";
}) {
  useSocketTranslation();
  /* Releases before 1.10 carry a line and no kinds, so there is nothing to
     label. Their one sentence is shown as it is written. */
  if (!changes?.length) {
    return (
      <p className="whats-new-plain">
        {line}
        <PostLink post={post} />
      </p>
    );
  }

  const security = changes.filter((c) => c.kind === "security");
  const areas = grouped(changes.filter((c) => c.kind !== "security"));
  const Heading = heading;

  return (
    <div className="whats-new-body">
      <p className="whats-new-line">
        {line}
        <PostLink post={post} />
      </p>
      {security.length > 0 && (
        <AreaBlock
          changes={security}
          className="whats-new-security"
          heading={Heading}
          icon={PiShieldCheckFill}
          label={socketI18n.t("ui.security")}
        />
      )}
      {areas.length === 1 ? (
        <ChangeRows changes={areas[0].changes} />
      ) : (
        areas.map((group) => (
          <AreaBlock
            key={group.area}
            changes={group.changes}
            heading={Heading}
            icon={group.icon}
            label={group.label}
          />
        ))
      )}
    </div>
  );
}

/**
 * A server's releases it does not run yet. Said up top, and again as the list's own
 * heading, so the list never reads as what the server already has.
 */
function AheadBody({
  ahead,
  releases,
  capped,
}: {
  ahead: WhatsNewAhead;
  releases: WhatsNewRelease[];
  capped: boolean;
}) {
  useSocketTranslation();
  const count = releases.length;

  return (
    <>
      <div className="whats-new-head">
        <span className="whats-new-mark">
          <LogoIcon size={26} />
        </span>
        <span>
          <Dialog.Title className="whats-new-greet">{socketI18n.t("socketFull.whatsNewDialog_7b8eb082f1")}{" "}{ahead.running}</Dialog.Title>
          <p className="whats-new-meta">
            {count === 0
              ? socketI18n.t("socketFull.whatsNewDialog_5ea2081aa7", { p0: (ahead.latest) })
              : capped
                ? socketI18n.t("socketFull.whatsNewDialog_b92d7db867", { p0: (count), p1: (ahead.latest) })
                : socketI18n.t("socketFull.whatsNewDialog_326921aaf4", { p0: (count), p2: (ahead.latest), count: (count) })}
          </p>
        </span>
      </div>

      {count === 0 ? (
        <p className="whats-new-plain">{ahead.empty}</p>
      ) : (
        <>
          <p className="whats-new-lead"><Trans i18n={socketI18n} i18nKey="socketFull.serverUpdateIncludesAllChanges" values={{ version: ahead.latest }} /></p>
          <div className="whats-new-ahead" data-whats-new-ahead>
            <h3 className="whats-new-area">
              <PiCloudArrowDownFill className="whats-new-area-icon" size={15} />
              <span className="whats-new-area-name">{socketI18n.t("socketFull.whatsNewDialog_faec972a2e")}</span>
            </h3>
            <ReleaseList releases={releases} />
          </div>
        </>
      )}
    </>
  );
}

/** The releases one after another, each under its version and date. */
function ReleaseList({ releases }: { releases: WhatsNewRelease[] }) {
  useSocketTranslation();
  return (
    <div className="whats-new-releases">
      {releases.map((release) => (
        <section key={release.version} className="whats-new-release">
          <h3 className="whats-new-version">
            {release.version} · {readableDate(release.date)}
          </h3>
          <ReleaseBody line={release.line} changes={release.changes} post={release.post} heading="h4" />
        </section>
      ))}
    </div>
  );
}

/**
 * What changed since somebody last opened Gryt, newest release first. The third
 * dialog this app draws, and the only one with a shape ConfirmDialog cannot carry.
 */
export function WhatsNewDialog({
  releases,
  since,
  capped,
  onClose,
  ahead,
  children,
  changelogHref,
}: {
  releases: WhatsNewRelease[];
  since: string | null;
  capped: boolean;
  onClose: () => void;
  /** With it, what a server gets once it updates instead, and `children` says how. */
  ahead?: WhatsNewAhead;
  children?: ReactNode;
  /** Where "Full changelog" goes when there's more than one release. The app's own
      notes leave this at the site's default tab; a server's point at its own. */
  changelogHref?: string;
}) {
  useSocketTranslation();
  const [newest] = releases;
  /* A server's are always a list with versions, and only app releases have a page. */
  const several = releases.length > 1 || !!ahead;

  return (
    <Dialog.Root
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup
          /* A container, so the pills stack on the card's width rather than
             the window's. The width is explicit, so nothing depends on it. */
          style={{
            containerType: "inline-size",
            display: "flex",
            flexDirection: "column",
            gap: 0,
            /* The body scrolls inside this, so the greeting and Done stay put.
               A note long enough to run off the screen took Done with it. */
            maxHeight: "min(38rem, calc(100vh - 4rem))",
            overflow: "hidden",
            padding: 0,
            width: "min(28.75rem, calc(100vw - 3rem))",
          }}
        >
          <div className="whats-new-pad">
            {ahead ? (
              <AheadBody ahead={ahead} releases={releases} capped={capped} />
            ) : (
              <>
                <div className="whats-new-head">
                  <span className="whats-new-mark">
                    <LogoIcon size={26} />
                  </span>
                  <span>
                    <Dialog.Title className="whats-new-greet">
                      {several && since ? (
                        <>{socketI18n.t("socketFull.whatsNewDialog_e14c05b8c9")}{" "}{since}</>
                      ) : (
                        <>{socketI18n.t("socketFull.whatsNewDialog_584bf5a57c")}</>
                      )}
                    </Dialog.Title>
                    <p className="whats-new-meta">
                      {!several
                        ? `${newest.version} · ${readableDate(newest.date)}`
                        : capped
                          ? socketI18n.t("socketFull.whatsNewDialog_e5c08c503c", { p0: (releases.length) })
                          : socketI18n.t("socketFull.whatsNewDialog_b9037ccad9", { p0: (releases.length) })}
                    </p>
                  </span>
                </div>

                {several ? (
                  <ReleaseList releases={releases} />
                ) : (
                  <ReleaseBody line={newest.line} changes={newest.changes} post={newest.post} />
                )}
              </>
            )}
            {children}
          </div>

          <div className="whats-new-foot">
            <a
              className="gryt-link whats-new-link"
              href={several ? changelogHref ?? "https://gryt.chat/changelog" : `https://gryt.chat/changelog/${newest.version}`}
              target="_blank"
              rel="noreferrer"
            >
              {several ? socketI18n.t("socketFull.whatsNewDialog_bc7b0897ec") : socketI18n.t("socketFull.whatsNewDialog_314a873571")}
            </a>
            <Dialog.Close render={<Button size="small">{socketI18n.t("shellFull.approveDevice_tsx_e9b450d14b")}</Button>} />
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
