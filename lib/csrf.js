const crypto = require('crypto');

// Simple session-based CSRF protection (har POST form mein hidden _csrf field).
module.exports = (req, res, next) => {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(24).toString('hex');
  }
  res.locals.csrfToken = req.session.csrfToken;

  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const sent = (req.body && req.body._csrf) || req.get('x-csrf-token') || '';
    const a = Buffer.from(String(sent));
    const b = Buffer.from(req.session.csrfToken);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return res.status(403).render('404', {
        code: 403,
        title: 'Session expired',
        message: 'Your session expired or the form was invalid. Please go back, refresh the page and try again.',
      });
    }
  }
  next();
};
