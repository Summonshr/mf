# Vercel Cron Setup Instructions

This project is configured to automatically rebuild every 30 minutes using Vercel's cron jobs.

## How it works

1. **Build Script**: When Vercel builds the project, it runs all three data collection scripts:
   - `generate-mf-navs.js` - Generates mutual fund NAV data
   - `scrape-nepalstock-market.mjs` - Scrapes NEPSE market data
   - `scrape-report.mjs` - Scrapes company reports

2. **Cron Job**: A Vercel cron job (`/api/cron`) runs every 30 minutes

3. **Deploy Hook**: The cron job triggers a Vercel deploy hook, which starts a new build

## Setup Steps

### 1. Create a Deploy Hook

1. Go to your Vercel project dashboard
2. Navigate to **Settings** → **Git**
3. Scroll down to **Deploy Hooks**
4. Click **Create Hook**
5. Name it (e.g., "Cron Rebuild")
6. Select the branch (usually `main` or `master`)
7. Click **Create Hook**
8. Copy the generated URL (looks like: `https://api.vercel.com/v1/integrations/deploy/...`)

### 2. Set Environment Variables

In your Vercel project settings:

1. Go to **Settings** → **Environment Variables**
2. Add the following variables:

   - **`DEPLOY_HOOK_URL`**
     - Value: The deploy hook URL you copied above
     - Environments: Production, Preview, Development

   - **`CRON_SECRET`**
     - Value: A random secret string (e.g., generate with: `openssl rand -base64 32`)
     - Environments: Production, Preview, Development

### 3. Deploy to Vercel

```bash
# If not already deployed
vercel --prod

# Or push to your connected Git repository
git add .
git commit -m "Add Vercel cron setup"
git push
```

### 4. Verify the Setup

After deployment:

1. Check **Deployments** tab - you should see the build complete successfully
2. Check **Cron Jobs** in your Vercel dashboard to see the scheduled job
3. Wait for the next scheduled run (every 30 minutes) or trigger manually via the API:

```bash
curl -X POST https://your-project.vercel.app/api/cron \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

## Cron Schedule

The cron runs on this schedule: `*/30 * * * *`
- Every 30 minutes
- 24/7

To modify the schedule, edit `vercel.json` and change the `schedule` field. See [Vercel Cron documentation](https://vercel.com/docs/cron-jobs) for syntax.

## Monitoring

- View cron execution logs in Vercel dashboard under **Deployments** → **Functions**
- Each successful cron execution will trigger a new deployment
- Build logs will show the execution of all three scraping scripts

## Troubleshooting

If builds aren't triggering:

1. Verify environment variables are set correctly
2. Check the cron function logs in Vercel dashboard
3. Ensure the deploy hook URL is valid
4. Check that `CRON_SECRET` matches between Vercel settings and your requests

## Disabling GitHub Actions

Since you're now using Vercel cron, you may want to disable or remove the GitHub Actions workflow at `.github/workflows/update-nav.yml` to avoid duplicate data fetching.
