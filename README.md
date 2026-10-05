# Ads & pipeline dashboard

Shows Meta ad spend next to your GoHighLevel pipeline: unique outbound clicks, landing page views, leads, and every pipeline step you choose (calls booked, follow-ups, closes, won deals), with the cost of each. It updates itself every day.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Faccess-sketch%2Fpipeline-dashboard&project-name=ads-dashboard&repository-name=ads-dashboard&env=GHL_TOKEN%2CGHL_LOCATION_ID%2CMETA_ACCESS_TOKEN%2CMETA_AD_ACCOUNT_ID%2CDASHBOARD_PASSWORD%2CCRON_SECRET&envDescription=GHL%20and%20Meta%20access%2C%20plus%20a%20password%20for%20the%20dashboard.%20See%20the%20setup%20guide.&envLink=https%3A%2F%2Fgithub.com%2Faccess-sketch%2Fpipeline-dashboard%23setup&products=%5B%7B%22type%22%3A%22integration%22%2C%22protocol%22%3A%22storage%22%2C%22productSlug%22%3A%22supabase%22%2C%22integrationSlug%22%3A%22supabase%22%7D%5D)

## Setup

Click the button above and follow the screens. You will need:

| Variable | What to paste |
|---|---|
| `GHL_TOKEN` | GHL private integration token for your sub-account (Settings > Private Integrations). Scopes: contacts, opportunities, locations and custom fields (read only). |
| `GHL_LOCATION_ID` | Your GHL sub-account ID (Settings > Business Profile). |
| `META_ACCESS_TOKEN` | A Meta System User token with `ads_read`, set to never expire. |
| `META_AD_ACCOUNT_ID` | Your ad account ID (with or without `act_`). |
| `DASHBOARD_PASSWORD` | Any password. You'll use it to open the dashboard. |
| `CRON_SECRET` | Any long random text. Vercel uses it to run the daily update. |

When Vercel asks to add **Supabase**, create a free database (pick the region closest to you). The tables are created automatically.

After the deploy, open the site, enter your password and click **Load the last 90 days now**.

## How it counts

- **Leads**: GHL contacts with an email, by the day they came in (in the ad account's time zone). Names containing "test" are skipped; add more in `EXCLUDED_EMAILS` / `EXCLUDED_EMAIL_DOMAINS`.
- **Pipeline steps**: a lead counts in a step if it has *ever* been in any of that step's stages. GHL only stores the current stage, so the dashboard keeps its own history from the first sync onward. Choose the stages on the **Settings** page.
- **Won deals**: opportunities marked Won, with their value if one is entered.
- **Unique outbound clicks and CTR** come straight from Meta for the exact date range, so they match Ads Manager.
- **By ad**: leads are matched to ads by ad name, using the `utm_content` each lead arrived with (from GHL attribution or a custom field named `utm_content`).

## Maintenance

- **Refresh now** on the dashboard pulls the last 3 days immediately.
- Reload history: `curl -H "Authorization: Bearer $CRON_SECRET" "https://YOUR-DOMAIN/api/cron/sync?days=90"`
- If something fails, the top of the dashboard says which part and why (hover the red text). Set `SLACK_WEBHOOK_URL` to get a message too.
