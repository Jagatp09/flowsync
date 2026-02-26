# FlowSync - Staff Management & Task Scheduling System

FlowSync is a Node.js + Express + PostgreSQL application for managing staff, shifts, checklists, and inventory.

## Features

- **Manager Dashboard**: Overview of operations, active shifts, staff status
- **Staff Management**: Add, edit, view, and manage staff members
- **Shift Management**: Create, schedule, start, and close shifts
- **Task Checklists**: Daily checklists with completion tracking
- **Inventory Management**: Track inventory levels and low stock alerts
- **Reports**: Daily operations, staff performance, checklist completion reports with CSV export
- **Activity Log**: Track all system activities

## Tech Stack

- **Backend**: Node.js, Express.js
- **Database**: PostgreSQL with Sequelize ORM
- **Frontend**: EJS templates with Tailwind CSS
- **Authentication**: express-session with bcrypt password hashing

## Setup

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Configure environment**:
   Copy `.env.example` to `.env` and update with your database credentials:
   ```
   DB_HOST=localhost
   DB_PORT=5432
   DB_NAME=flowsync
   DB_USER=postgres
   DB_PASSWORD=your_password
   SESSION_SECRET=your_secret_key
   ```

3. **Set up database**:
   ```bash
   # Create database (in PostgreSQL)
   createdb flowsync
   ```

4. **Run seed data**:
   ```bash
   node seed.js
   ```

5. **Start server**:
   ```bash
   node index.js
   ```

6. **Access the app**:
   Open http://localhost:3000

## Demo Credentials

| Role | Email | Password |
|------|-------|----------|
| Manager | manager@flowsync.com | password123 |
| Staff | staff@flowsync.com | password123 |

## Key URLs

- **Login**: http://localhost:3000/login
- **Manager Dashboard**: http://localhost:3000/manager/dashboard
- **Staff Management**: http://localhost:3000/manager/staff
- **Shifts**: http://localhost:3000/manager/shifts
- **Inventory**: http://localhost:3000/manager/inventory
- **Reports**: http://localhost:3000/manager/reports
- **Activity Log**: http://localhost:3000/manager/activity
- **Staff Dashboard**: http://localhost:3000/staff/dashboard

## CSV Export

Download reports from the Reports page:
- Daily Operations: `/manager/reports/download/daily`
- Staff Performance: `/manager/reports/download/staff`
- Checklist Completion: `/manager/reports/download/checklist`

Query parameters: `?start=YYYY-MM-DD&end=YYYY-MM-DD`

## Project Structure

```
flowsync/
├── config/
│   └── database.js       # Sequelize configuration
├── models/               # Database models
├── routes/               # Express routes
│   ├── auth.js          # Authentication
│   ├── checklists.js    # Checklist operations
│   ├── manager.js       # Manager dashboard & CRUD
│   └── staff.js         # Staff operations
├── views/               # EJS templates
│   ├── manager/         # Manager views
│   ├── staff/          # Staff views
│   └── partials/       # Shared partials
├── utils/
│   └── activityLogger.js # Activity logging utility
├── seed.js              # Demo data seeder
└── index.js            # Express server
```
