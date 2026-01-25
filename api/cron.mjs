export default async function handler(req, res) {
  // Verify the request is from Vercel Cron
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Trigger Vercel deploy hook
    const deployHookUrl = process.env.DEPLOY_HOOK_URL;

    if (!deployHookUrl) {
      return res.status(500).json({ error: 'DEPLOY_HOOK_URL not configured' });
    }

    const response = await fetch(deployHookUrl, {
      method: 'POST',
    });

    if (!response.ok) {
      throw new Error(`Deploy hook failed: ${response.status}`);
    }

    return res.status(200).json({
      message: 'Build triggered successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error triggering build:', error);
    return res.status(500).json({
      error: 'Failed to trigger build',
      details: error.message
    });
  }
}
