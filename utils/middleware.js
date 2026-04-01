function respondUnauthorized(req, res) {
  if (req.accepts('html')) {
    return res.redirect('/login');
  }

  return res.status(401).json({ error: 'Authentication required' });
}

function respondForbidden(req, res, message, redirectTo) {
  if (req.accepts('html')) {
    req.session.error = message;
    return req.session.save(() => res.status(403).redirect(redirectTo));
  }

  return res.status(403).json({ error: message });
}

function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    return respondUnauthorized(req, res);
  }

  return next();
}

function requireManager(req, res, next) {
  if (!req.session || !req.session.user) {
    return respondUnauthorized(req, res);
  }

  if (req.session.user.role !== 'MANAGER') {
    return respondForbidden(req, res, 'Manager access required.', '/staff/dashboard');
  }

  return next();
}

function requireStaff(req, res, next) {
  if (!req.session || !req.session.user) {
    return respondUnauthorized(req, res);
  }

  if (req.session.user.role !== 'STAFF') {
    return respondForbidden(req, res, 'Staff access required.', '/manager/dashboard');
  }

  return next();
}

function asyncHandler(handler) {
  return function wrappedHandler(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

module.exports = {
  asyncHandler,
  requireAuth,
  requireManager,
  requireStaff
};
