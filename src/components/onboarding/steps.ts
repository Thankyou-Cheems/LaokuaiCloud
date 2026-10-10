import { i18n } from "@/i18n";
/* Hallmark · component: coach-mark tour · genre: modern-minimal · theme: @gryt/ui
 * states: default · hover · focus · active · disabled · loading · error · success */

/**
 * What a step is allowed to do to the app when it becomes current. Half of what a
 * first-run person needs is behind a modal.
 */
export interface TourControls {
  openSettings: (tab: string) => void;
  closeSettings: () => void;
  setShowAddServer: (show: boolean) => void;
}

export interface TourStep {
  id: string;
  /** Matches a data-tour attribute in the app chrome. */
  target: string;
  title: string;
  body: string;
  /** Where the card sits relative to the target. */
  side: "right" | "top";
  /**
   * Run when the step becomes current. Opens whatever this step points into; the
   * target will not exist for a frame or two, which the tour waits out.
   */
  enter?: (app: TourControls) => void;
  /**
   * Controls the cursor travels to and really presses, in order. Genuine pointer
   * events, so the app does its own opening. A step with `via` needs no `enter`.
   */
  via?: string[];
}

/**
 * Five steps, in the order somebody actually needs them. Each points at the real
 * control, so what they learn here still applies tomorrow.
 */
export const tourSteps: TourStep[] = [
  {
    id: "menu",
    target: "profile",
    get title() { return i18n.t("shellFull.steps_ts_770c23505e"); },
    get body() { return i18n.t("shellFull.steps_ts_de756a1faf"); },
    side: "right",
    // Closes anything a re-run of the tour left open, so step one always starts
    // from the same place.
    enter: (app) => {
      app.closeSettings();
      app.setShowAddServer(false);
    },
  },
  {
    id: "profile",
    target: "profile-editor",
    get title() { return i18n.t("shellFull.steps_ts_2d1508faa5"); },
    get body() { return i18n.t("shellFull.steps_ts_9a58e5a232"); },
    side: "right",
    // The honest route: the avatar opens its menu, and Settings is in the menu.
    // Nothing here is simulated — these are the two presses a person makes.
    via: ["profile", "menu-settings"],
  },
  {
    id: "account",
    target: "account-signin",
    get title() { return i18n.t("shellFull.steps_ts_85f13eeaee"); },
    get body() { return i18n.t("shellFull.steps_ts_34d82ed6d2"); },
    side: "right",
    // Already inside Settings, so this is one press on the destination itself.
    via: ["settings-account"],
    // A narrow window has a picker instead of that button, so the hop is skipped and this opens the page.
    enter: (app) => app.openSettings("account"),
  },
  {
    id: "server",
    target: "add-server",
    get title() { return i18n.t("shellFull.steps_ts_c309e01814"); },
    get body() { return i18n.t("shellFull.steps_ts_bee0d1750d"); },
    side: "right",
    // The panel closing needs a cause too, or it vanishes as abruptly as it
    // arrived. The cursor presses the same X the user would.
    via: ["settings-close"],
  },
  {
    id: "join",
    target: "join-address",
    get title() { return i18n.t("shellFull.steps_ts_516b22a5df"); },
    get body() { return i18n.t("shellFull.steps_ts_a874622306"); },
    side: "top",
    // Two hops now that the dialog asks which errand you are on: open it, then
    // choose Join. The cursor makes the same choice a person would.
    via: ["add-server", "choose-join"],
  },
];
