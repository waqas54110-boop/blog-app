// Profile badges. Koi alag table nahi: har baar user ke asli numbers se banti hain, is liye hamesha durust rehti hain.
const { tiersFor } = require('./referral');

// s = { role, votes, comments, played, correct, rank, ranked, giveawayWins, referrals }
function compute(s) {
  const out = [];
  if (s.role === 'admin') out.push({ icon: '🛡️', name: 'Blog Owner', desc: 'Runs this site' });

  if (s.votes >= 50) out.push({ icon: '🗳️', name: 'Vote Machine', desc: '50+ contest votes' });
  else if (s.votes >= 10) out.push({ icon: '🗳️', name: 'Super Voter', desc: '10+ contest votes' });
  else if (s.votes >= 1) out.push({ icon: '🗳️', name: 'Voter', desc: 'Voted in a contest' });

  if (s.comments >= 25) out.push({ icon: '💬', name: 'Chatterbox', desc: '25+ comments' });
  else if (s.comments >= 5) out.push({ icon: '💬', name: 'Regular', desc: '5+ comments' });

  if (s.played >= 1) out.push({ icon: '🎯', name: 'Predictor', desc: 'Made a scored prediction' });
  if (s.correct >= 10) out.push({ icon: '🔮', name: 'Oracle', desc: '10+ correct predictions' });
  if (s.rank && s.rank <= 3 && s.played >= 3) out.push({ icon: '🏅', name: 'Top 3 Predictor', desc: 'In the top 3 of the Prediction League' });

  if (s.giveawayWins >= 1) out.push({ icon: '🎁', name: 'Giveaway Winner', desc: 'Won a giveaway' });

  // Referral: sirf sab se bara tier dikhao
  const t = tiersFor(s.referrals || 0);
  if (t.length) { const top = t[t.length - 1]; out.push({ icon: top.icon, name: top.name, desc: top.desc }); }

  return out;
}

module.exports = { compute };
