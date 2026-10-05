// LiveKit (media server) ke liye access token. Koi npm package nahi chahiye: token ek HS256 JWT hota hai.
// Env: LIVEKIT_URL (wss://....livekit.cloud), LIVEKIT_API_KEY, LIVEKIT_API_SECRET
const crypto = require('crypto');
const config = require('../config');

const enabled = () => !!(config.livekitUrl && config.livekitKey && config.livekitSecret);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

// identity: har connection ka unique naam. canPublish: sirf host true.
function token({ identity, name, room, canPublish, ttl = 4 * 3600 }) {
  const now = Math.floor(Date.now() / 1000);
  const data = b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({
    iss: config.livekitKey,
    sub: identity,
    name: String(name || identity).slice(0, 60),
    nbf: now - 10,
    exp: now + ttl,
    video: { room, roomJoin: true, canPublish: !!canPublish, canPublishData: false, canSubscribe: true },
  });
  const sig = crypto.createHmac('sha256', config.livekitSecret).update(data).digest('base64url');
  return data + '.' + sig;
}

const roomName = (streamId) => 'live-' + streamId;
const info = (opts) => ({ url: config.livekitUrl, token: token(opts) });

module.exports = { enabled, token, roomName, info };
