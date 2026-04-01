function getFlash(req) {
  return {
    success: req.session?.success || null,
    error: req.session?.error || null
  };
}

function consumeFlash(req) {
  const flash = getFlash(req);

  if (req.session) {
    delete req.session.success;
    delete req.session.error;
  }

  return flash;
}

function setFlash(req, type, message) {
  if (!req.session || !message || !['success', 'error'].includes(type)) {
    return;
  }

  req.session[type] = message;
}

function renderWithFlash(req, res, view, locals = {}) {
  return res.render(view, {
    ...locals,
    ...consumeFlash(req)
  });
}

function saveAndRedirect(req, res, redirectTo) {
  if (req.session && typeof req.session.save === 'function') {
    return req.session.save(() => res.redirect(redirectTo));
  }

  return res.redirect(redirectTo);
}

function redirectWithFlash(req, res, redirectTo, { success = null, error = null } = {}) {
  if (success) {
    setFlash(req, 'success', success);
  }

  if (error) {
    setFlash(req, 'error', error);
  }

  return saveAndRedirect(req, res, redirectTo);
}

module.exports = {
  consumeFlash,
  getFlash,
  redirectWithFlash,
  renderWithFlash,
  saveAndRedirect,
  setFlash
};
