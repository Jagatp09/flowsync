const express = require('express');
const router = express.Router();
const { User } = require('../models');

// Helper to get csrfToken
const getCsrfToken = (req, res) => res.locals.csrfToken || req.session.csrfToken || '';

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
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ where: { email } });

    if (!user) {
      return res.render('auth/login', { title: 'Login', error: 'Invalid email or password', csrfToken: getCsrfToken(req, res) });
    }

    const isValidPassword = await user.comparePassword(password);

    if (!isValidPassword) {
      return res.render('auth/login', { title: 'Login', error: 'Invalid email or password', csrfToken: getCsrfToken(req, res) });
    }

    if (!user.isActive) {
      return res.render('auth/login', { title: 'Login', error: 'Your account has been deactivated', csrfToken: getCsrfToken(req, res) });
    }

    // Set session
    req.session.user = {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role
    };

    // Redirect based on role
    if (user.role === 'MANAGER') {
      res.redirect('/manager/dashboard');
    } else {
      res.redirect('/staff/dashboard');
    }
  } catch (error) {
    console.error('Login error:', error);
    res.render('auth/login', { title: 'Login', error: 'An error occurred during login', csrfToken: getCsrfToken(req, res) });
  }
});

// POST /logout
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Session destroy error:', err);
    }
    res.redirect('/login');
  });
});

module.exports = router;
