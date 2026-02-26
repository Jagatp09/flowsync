const express = require('express');
const session = require('express-session');
const SequelizeStore = require('connect-session-sequelize')(session.Store);
const methodOverride = require('method-override');
const expressLayouts = require('express-ejs-layouts');
const path = require('path');
const sequelize = require('./config/database');

const app = express();

// Load environment variables
require('dotenv').config();

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('layout', 'layouts/main');

// Use express-ejs-layouts
app.use(expressLayouts);

// Configure EJS for includes
const ejs = require('ejs');
ejs.localsName = 'locals';

// Session configuration - Using Sequelize store
const sessionStore = new SequelizeStore({
  db: sequelize
});

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'flowsync-secret',
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 24 // 24 hours
    }
  })
);

// Create sessions table
sessionStore.sync();

// Make user available to all views
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.activePage = '';
  // Flash messages
  res.locals.success = req.session.success || null;
  res.locals.error = req.session.error || null;
  // Clear flash messages after reading
  delete req.session.success;
  delete req.session.error;
  next();
});

// Routes
app.use('/', require('./routes/auth'));
app.use('/manager', require('./routes/manager'));
app.use('/staff', require('./routes/staff'));
app.use('/checklists', require('./routes/checklists'));

// Home redirect
app.get('/', (req, res) => {
  if (req.session.user) {
    if (req.session.user.role === 'MANAGER') {
      return res.redirect('/manager/dashboard');
    } else {
      return res.redirect('/staff/dashboard');
    }
  }
  res.redirect('/login');
});

// Error handler - show detailed error in development
app.use((err, req, res, next) => {
  console.error('=== ERROR ===');
  console.error(err.stack);
  console.error('==========');
  res.status(err.status || 500);
  res.send(`
    <html>
    <head><title>Error</title></head>
    <body style="font-family: monospace; padding: 20px;">
      <h1 style="color: red;">ERROR: ${err.message}</h1>
      <pre style="background: #f5f5f5; padding: 20px; overflow: auto;">${err.stack}</pre>
    </body>
    </html>
  `);
});

// Sync database and start server
const PORT = process.env.PORT || 3000;

sequelize.sync({ alter: true })
  .then(() => {
    console.log('Database synced');
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  })
  .catch(err => {
    console.error('Unable to sync database:', err);
  });

module.exports = app;
