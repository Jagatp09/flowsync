const express = require('express');
const router = express.Router();
const { User } = require('../models');
const { asyncHandler } = require('../utils/middleware');

// Helper to get csrfToken
const getCsrfToken = (req, res) => res.locals.csrfToken || req.session.csrfToken || '';
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => {
      if (error) {
        return reject(error);
      }

      return resolve();
    });
  });
}

function saveSession(req) {
  return new Promise((resolve, reject) => {
    req.session.save((error) => {
      if (error) {
        return reject(error);
      }

      return resolve();
    });
  });
}

function destroySession(req) {
  return new Promise((resolve, reject) => {
    req.session.destroy((error) => {
      if (error) {
        return reject(error);
      }

      return resolve();
    });
  });
}

// GET /login
router.get('/login', (req, res) => {
  if (req.session.user) {
    if (req.session.user.role === 'MANAGER') {
      return res.redirect('/manager/dashboard');
    } else {
      return res.redirect('/staff/dashboard');
    }
  }
  res.render('auth/login', { title: 'Login', error: null, csrfToken: getCsrfToken(req, res) });
});

// POST /login
router.post('/login', asyncHandler(async (req, res) => {
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';

  if (!email || !password || !EMAIL_REGEX.test(email)) {
    return res.status(400).render('auth/login', {
      title: 'Login',
      error: 'Please enter a valid email and password',
      csrfToken: getCsrfToken(req, res)
    });
  }

  const user = await User.findOne({ where: { email } });
  if (!user) {
    return res.status(401).render('auth/login', {
      title: 'Login',
      error: 'Invalid email or password',
      csrfToken: getCsrfToken(req, res)
    });
  }

  const isValidPassword = await user.comparePassword(password);
  if (!isValidPassword) {
    return res.status(401).render('auth/login', {
      title: 'Login',
      error: 'Invalid email or password',
      csrfToken: getCsrfToken(req, res)
    });
  }

  if (!user.isActive) {
    return res.status(403).render('auth/login', {
      title: 'Login',
      error: 'Your account has been deactivated',
      csrfToken: getCsrfToken(req, res)
    });
  }

  await regenerateSession(req);
  req.session.user = {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role
  };
  await saveSession(req);

  if (user.role === 'MANAGER') {
    return res.redirect('/manager/dashboard');
  }

  return res.redirect('/staff/dashboard');
}));

// POST /logout
router.post('/logout', asyncHandler(async (req, res) => {
  if (req.session) {
    await destroySession(req);
  }

  res.clearCookie('flowsync.sid');
  return res.redirect('/login');
}));

module.exports = router;
