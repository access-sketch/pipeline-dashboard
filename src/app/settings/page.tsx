import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/supabase";
import { FunnelSettings, loadFunnelSettings, loadPipelines, setValue, Step } from "@/lib/settings";

export const dynamic = "force-dynamic";

const MAX_STEPS = 5;

async function save(form: FormData) {
  "use server";
  const steps: Step[] = [];
  for (let i = 0; i < MAX_STEPS; i++) {
    const label = String(form.get(`label_${i}`) ?? "").trim();
    const stageIds = form.getAll(`stages_${i}`).map(String);
    if (!label || stageIds.length === 0) continue;
    steps.push({ id: `step${i}`, label, stageIds, includeWon: form.get(`won_${i}`) === "on" });
  }
  const settings: FunnelSettings = { steps, noShowStageIds: form.getAll("noshow").map(String) };
  await setValue("funnel", settings);
  revalidatePath("/");
  redirect("/?saved=1");
}

async function reset() {
  "use server";
  await db().from("pd_settings").delete().eq("key", "funnel");
  revalidatePath("/");
  redirect("/settings");
}

export default async function SettingsPage() {
  const [{ settings, isDefault }, pipelines] = await Promise.all([loadFunnelSettings(), loadPipelines()]);
  const rows: (Step | null)[] = [...settings.steps, ...Array(Math.max(0, MAX_STEPS - settings.steps.length)).fill(null)].slice(0, MAX_STEPS);

  return (
    <main className="page">
      <a className="back" href="/">
        ← Dashboard
      </a>
      <h1 className="title">Funnel settings</h1>
      <p className="subtitle">
        Each step after “Leads” is a group of pipeline stages. A lead counts in a step if it has ever been in any of the ticked
        stages, even if it has moved on since.
        {isDefault ? " These are the automatic choices based on your stage names; save to keep them." : ""}
      </p>

      <form action={save} className="settings">
        {rows.map((step, i) => (
          <fieldset key={i} className="step-box">
            <legend>Step {i + 1}{i >= settings.steps.length ? " (optional)" : ""}</legend>
            <label className="field">
              <span>Name shown on the dashboard</span>
              <input name={`label_${i}`} defaultValue={step?.label ?? ""} placeholder="e.g. Calls booked" />
            </label>
            {pipelines.map((pl) => (
              <div key={pl.id} className="stage-list">
                <span className="pl-name">{pl.name}</span>
                {pl.stages.map((s) => (
                  <label key={s.id} className="check">
                    <input type="checkbox" name={`stages_${i}`} value={s.id} defaultChecked={!!step?.stageIds.includes(s.id)} />
                    {s.name}
                  </label>
                ))}
              </div>
            ))}
            <label className="check">
              <input type="checkbox" name={`won_${i}`} defaultChecked={!!step?.includeWon} />
              Also count deals marked <strong>Won</strong>
            </label>
          </fieldset>
        ))}

        <fieldset className="step-box">
          <legend>No-show stages</legend>
          {pipelines.map((pl) => (
            <div key={pl.id} className="stage-list">
              <span className="pl-name">{pl.name}</span>
              {pl.stages.map((s) => (
                <label key={s.id} className="check">
                  <input type="checkbox" name="noshow" value={s.id} defaultChecked={settings.noShowStageIds.includes(s.id)} />
                  {s.name}
                </label>
              ))}
            </div>
          ))}
        </fieldset>

        <div className="actions">
          <button className="btn primary" type="submit">
            Save
          </button>
        </div>
      </form>
      <form action={reset} className="actions">
        <button className="btn" type="submit">
          Reset to automatic
        </button>
      </form>
    </main>
  );
}
