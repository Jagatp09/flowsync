# FlowSync Functional Test Plan

## Project Overview
FlowSync is a shift management application with role-based access control (Manager and Staff roles).

---

## Test Scenarios

### Scenario 1: Authentication and Session Flow

**Objective:** Verify login, logout, and session management work correctly.

| Test ID | Test Description | Expected Result |
|---------|-----------------|------------------|
| 1.1 | Submit valid manager credentials | 302 redirect to /manager/dashboard |
| 1.2 | Submit valid staff credentials | 302 redirect to /staff/dashboard |
| 1.3 | Submit invalid credentials | 401 with "Invalid email or password" message |
| 1.4 | GET /login when already authenticated (manager) | 302 redirect to /manager/dashboard |
| 1.5 | POST /logout | 302 redirect to /login, session cleared |
| 1.6 | Access protected route after logout | 302 redirect to /login |
| 1.7 | Submit blank email field | 400 Bad Request |
| 1.8 | Submit malformed email | 400 Bad Request |
| 1.9 | Submit login without CSRF token | 403 Forbidden |

---

### Scenario 2: Role-Based Access Control

**Objective:** Verify users can only access routes appropriate to their role.

| Test ID | Test Description | Expected Result |
|---------|-----------------|------------------|
| 2.1 | Unauthenticated GET /manager/dashboard | 302 redirect to /login |
| 2.2 | Unauthenticated GET /staff/dashboard | 302 redirect to /login |
| 2.3 | Staff GET /manager/staff | 302/403 redirect to /staff/dashboard |
| 2.4 | Staff GET /manager/shifts/new | 302/403 redirect to /staff/dashboard |
| 2.5 | Staff GET /manager/inventory | 302/403 redirect to /staff/dashboard |
| 2.6 | Staff POST /manager/staff (create user attempt) | 302/403 blocked |
| 2.7 | Staff POST /manager/shifts (create shift attempt) | 302/403 blocked |
| 2.8 | Manager GET /staff/dashboard | 200 access granted |
| 2.9 | Staff cannot approve leave requests | 302/403 blocked |
| 2.10 | Staff cannot approve swap requests | 302/403 blocked |

---

### Scenario 3: Staff Management CRUD

**Objective:** Verify manager can create, read, update, and delete staff accounts.

| Test ID | Test Description | Expected Result |
|---------|-----------------|------------------|
| 3.1 | Manager creates valid staff member | 302 redirect to /manager/staff, user created in DB |
| 3.2 | Manager creates staff with duplicate email | 302 redirect back, error shown, no duplicate record |
| 3.3 | Manager creates staff with password < 6 chars | 302 redirect back, error shown |
| 3.4 | Manager creates staff with missing fields | 302 redirect back, validation error |
| 3.5 | Manager updates staff with valid data | 302 redirect to /manager/staff, changes persisted |
| 3.6 | Manager updates staff with short password | 302 redirect back, password unchanged |
| 3.7 | Manager updates staff with duplicate email | 302 redirect back, error shown |
| 3.8 | Manager deletes staff member | 302 redirect to /manager/staff, user removed |
| 3.9 | Manager cannot delete themselves | 302/400/403 - deletion prevented |
| 3.10 | Staff cannot access /manager/staff routes | 302/403 access denied |

---

### Scenario 4: Shift Scheduling and Assignment Validation

**Objective:** Verify shift creation and overlap detection work correctly.

| Test ID | Test Description | Expected Result |
|---------|-----------------|------------------|
| 4.1 | Manager creates valid shift with staff assigned | 302 redirect to /manager/shifts, Shift + Assignments created |
| 4.2 | Manager creates shift with no staff assigned | 302 redirect to /manager/shifts, shift created |
| 4.3 | Manager creates shift with invalid date | 302 redirect to /manager/shifts/new, no shift created |
| 4.4 | Manager creates shift with missing shiftType | 302 redirect to form, error shown |
| 4.5 | Manager creates shift with end time before start time | 302 redirect to form, validation error |
| 4.6 | Manager assigns same staff twice to same shift | 302 redirect to form, error shown |
| 4.7 | Manager creates overlapping assignment for same staff | 302 redirect to form, overlap error |
| 4.8 | Staff cannot access /manager/shifts/new | 302/403 access denied |

---

### Scenario 5: Shift Lifecycle and Checklist Execution

**Objective:** Verify shift status transitions and checklist completion.

| Test ID | Test Description | Expected Result |
|---------|-----------------|------------------|
| 5.1 | Manager starts a scheduled shift | 302 to /manager/shifts, status becomes ACTIVE |
| 5.2 | Manager closes an active shift | 302 to /manager/shifts, status becomes CLOSED |
| 5.3 | Staff cannot start a shift | 302/403 action blocked |
| 5.4 | Staff cannot close a shift | 302/403 action blocked |
| 5.5 | Assigned staff completes checklist item | 302 to /checklists/daily, ChecklistCompletion created |
| 5.6 | Assigned staff undoes completed checklist item | 302 to /checklists/daily, completion reset to PENDING |
| 5.7 | Unassigned staff attempts to complete checklist item | 302 redirect back, no completion record created |
| 5.8 | Unassigned staff cannot undo checklist item | 302 redirect back, action blocked |
| 5.9 | Manager assigns additional staff to existing shift | 302 redirect, new assignment created |
| 5.10 | Manager cannot assign staff already on shift | 302 redirect back, duplicate error |

---

### Scenario 6: Leave Request Workflow

**Objective:** Verify leave request creation and approval/rejection flow.

| Test ID | Test Description | Expected Result |
|---------|-----------------|------------------|
| 6.1 | Staff creates valid leave request | 302 to /staff/leave-requests, status PENDING |
| 6.2 | Staff creates leave with end date before start date | 302 redirect back, no request created |
| 6.3 | Staff creates overlapping leave request | 302 redirect back, overlap error |
| 6.4 | Manager approves pending leave request | 302 to /manager/leave-requests, status APPROVED, approvedBy/approvedAt set |
| 6.5 | Manager rejects pending leave request | 302 to /manager/leave-requests, status REJECTED |
| 6.6 | Manager cannot approve already-approved request | 302 redirect back, no status change |
| 6.7 | Staff cannot approve leave requests | 302/403 action blocked |
| 6.8 | Staff cannot reject leave requests | 302/403 action blocked |
| 6.9 | Manager views leave requests list | 200 OK, pending requests visible |
| 6.10 | Manager can see pending leave requests | 200 OK, request details displayed |

---

### Scenario 7: Shift Swap Workflow

**Objective:** Verify shift swap request creation and approval flow.

| Test ID | Test Description | Expected Result |
|---------|-----------------|------------------|
| 7.1 | Staff creates valid swap request | 302 to /staff/swap-requests, status PENDING, targetAccepted null |
| 7.2 | Staff cannot swap with themselves | 302 redirect back, error shown |
| 7.3 | Staff cannot swap shift they are not assigned to | 302 redirect back, error shown |
| 7.4 | Manager cannot approve before target accepts | 302 redirect back, status remains PENDING |
| 7.5 | Target staff accepts swap request | 302 to /staff/incoming-swap-requests, targetAccepted = true |
| 7.6 | Target staff rejects swap request | 302 to /staff/incoming-swap-requests, targetAccepted = false |
| 7.7 | Manager final approval after target accepts | 302 to /manager/swap-requests, status APPROVED, assignments swapped |
| 7.8 | Manager rejects approved swap | 302 redirect, status REJECTED, assignments unchanged |
| 7.9 | Staff cannot approve swap requests | 302/403 action blocked |
| 7.10 | Staff cannot reject swap requests | 302/403 action blocked |

---

### Scenario 8: Inventory Management

**Objective:** Verify inventory CRUD operations and role-based access.

| Test ID | Test Description | Expected Result |
|---------|-----------------|------------------|
| 8.1 | Manager creates valid inventory item | 302 redirect to /manager/inventory, item created |
| 8.2 | Manager creates item with missing fields | 302 redirect to form, validation error |
| 8.3 | Manager creates item with negative quantity | 302 redirect to form, error shown |
| 8.4 | Manager updates item with valid data | 302 redirect to /manager/inventory, changes persisted |
| 8.5 | Manager updates item with missing name | 302 redirect to form, validation error |
| 8.6 | Manager adjusts quantity positively | 302 redirect to edit page, quantity updated, InventoryLog created |
| 8.7 | Manager adjusts quantity negatively | 302 redirect to edit page, quantity updated, log created |
| 8.8 | Manager adjusts below zero | 302 redirect back, quantity unchanged, error shown |
| 8.9 | Manager adjusts with non-integer | 302 redirect back, error shown |
| 8.10 | Manager deletes inventory item | 302 redirect to /manager/inventory, item removed |
| 8.11 | Staff GET /staff/inventory | 200 OK, read-only view displayed |
| 8.12 | Staff GET /manager/inventory | 302/403 redirect to /staff/dashboard |
| 8.13 | Staff GET /manager/inventory/new | 302/403 access denied |
| 8.14 | Staff cannot POST to /manager/inventory | 302/403 action blocked |
| 8.15 | Staff cannot adjust inventory | 302/403 action blocked |
| 8.16 | Staff cannot delete inventory | 302/403 action blocked |

---

## Test Data Requirements

| User | Email | Password | Role |
|------|-------|----------|------|
| Manager | manager@flowsync.com | Password123 | MANAGER |
| Staff | staff@flowsync.com | Password123 | STAFF |
| Staff 2 | taylor@flowsync.com | Password123 | STAFF |
| Staff 3 | casey@flowsync.com | Password123 | STAFF |
| Staff 4 | morgan@flowsync.com | Password123 | STAFF |
| Staff 5 | riley@flowsync.com | Password123 | STAFF |

---

## Test Environment Setup

1. Ensure database is seeded with test users
2. Clear session/cookies before each test
3. Fetch fresh CSRF token before each POST/PUT/DELETE request
4. Use unique identifiers (timestamps/prefixes) for test data to avoid collisions
5. Clean up test data after each test (afterEach hooks)

---

## Acceptance Criteria

- All 8 scenarios must execute successfully
- Each test must pass with correct status codes and assertions
- Test isolation must be maintained (no data leakage between tests)
- CSRF protection must be verified on all form submissions
- Role-based access must be enforced on all protected routes
