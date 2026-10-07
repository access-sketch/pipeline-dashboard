/**
 * Starting funnel set up for a specific business, used until someone saves the Settings page.
 * Keyed by a hash of the GHL location ID, so no client details are stored in this public code.
 * Stages are matched by pipeline and stage name (case, emojis and "™" don't matter).
 */
export type StageRef = { pipeline: string; stage: string };
export type Preset = {
  steps: { label: string; stages: StageRef[]; includeWon: boolean }[];
  noShow: StageRef[];
};

const b2b = (stage: string): StageRef => ({ pipeline: "B2B Pipeline", stage });
const sys = (stage: string): StageRef => ({ pipeline: "The Systemised Pipeline", stage });

export const PRESETS: Record<string, Preset> = {
  // Demo-based B2B pipeline, with an older "Systemised" pipeline still holding a few deals.
  "220fb25020b90b80": {
    steps: [
      {
        label: "Demos booked",
        stages: [
          b2b("Demo Booked"), b2b("No Show"), b2b("Didn't Convert"), b2b("Closed"),
          sys("Scheduled Call"), sys("Confirmed Call"), sys("No Show"), sys("Not Ready"), sys("Follow Up Call Booked"), sys("New Client"),
        ],
        includeWon: true,
      },
      {
        label: "Demos attended",
        stages: [b2b("Didn't Convert"), b2b("Closed"), sys("Not Ready"), sys("Follow Up Call Booked"), sys("New Client")],
        includeWon: true,
      },
      { label: "Closed deals", stages: [b2b("Closed"), sys("New Client")], includeWon: true },
    ],
    noShow: [b2b("No Show"), sys("No Show")],
  },
};
