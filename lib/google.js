// Google OAuth 2.0 (authorization code flow). Koi nayi npm package nahi: Node 22 ka fetch kaafi hai.
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const enabled = !!(CLIENT_ID && CLIENT_SECRET);

function authUrl({ state, redirectUri }) {
  const q = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + q.toString();
}

// code -> access token -> userinfo. Dono calls seedhi Google (HTTPS) se hoti hain.
async function fetchProfile(code, redirectUri) {
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!tokenRes.ok) throw new Error('Google token exchange fail: ' + tokenRes.status);
  const { access_token: accessToken } = await tokenRes.json();
  if (!accessToken) throw new Error('Google ne access token nahi diya');

  const infoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: 'Bearer ' + accessToken },
    signal: AbortSignal.timeout(10000),
  });
  if (!infoRes.ok) throw new Error('Google userinfo fail: ' + infoRes.status);
  const info = await infoRes.json();

  return {
    sub: String(info.sub || ''),
    email: String(info.email || '').trim().toLowerCase(),
    emailVerified: info.email_verified === true || info.email_verified === 'true',
    name: String(info.name || ''),
  };
}

module.exports = { enabled, authUrl, fetchProfile };
