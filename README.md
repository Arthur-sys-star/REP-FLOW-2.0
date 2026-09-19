# Rep-Flow 2.0 — Smart Repair & Service Management System

**Tagline:** From Service Request to Successful Delivery.

A full-stack web application for small repair/service businesses (computer, laptop,
mobile, electronics, appliance repair shops) to manage the complete repair lifecycle —
now with three genuinely separate role experiences, before/after repair photos, a full
inventory transaction ledger, multi-method payments, a handover checklist, and an
activity log:

`Customer → Ticket → Before Photos → Diagnosis → Parts → Repair → After Photos → Charges → Invoice → Payment → Handover → Delivered → Service History`

Built as a B.Sc. Computer Science mini-project.

---

## Tech stack

| Layer          | Technology                          |
|----------------|--------------------------------------|
| Frontend       | HTML5, CSS3, Vanilla JavaScript      |
| Backend        | Node.js, Express.js                  |
| Database       | MySQL (relational, with FKs, transactions, row locking) |
| Authentication | JWT + bcryptjs (hashed passwords)    |
| File uploads   | Multer (before/after repair photos, UPI QR code) |

No frameworks, no MongoDB/Firebase/SQLite/localStorage-as-database — matches the
project brief exactly.

---

## Folder structure

```
repflow/
├── database/
│   └── schema.sql              # Full MySQL schema (15 tables) + starter parts
├── server/
│   ├── config/db.js            # MySQL connection pool
│   ├── middleware/
│   │   ├── auth.js             # JWT verification + role-based authorization
│   │   └── errorHandler.js     # Centralized error handling — never leaks raw SQL errors
│   ├── routes/
│   │   ├── auth.js             # Login
│   │   ├── users.js            # Admin-only user management
│   │   ├── customers.js        # + profile: summary, device history, service history
│   │   ├── technicians.js      # + login-account linking
│   │   ├── inventory.js        # Parts + Stock In / Stock Out / Correction ledger
│   │   ├── tickets.js          # Intake, status flow, charges, parts, photos, drafts
│   │   ├── handover.js         # Handover checklist — the ONLY way to reach Delivered
│   │   ├── billing.js          # One ticket = one invoice, enforced two ways
│   │   ├── payments.js         # Partial/full payments against an invoice
│   │   ├── paymentSettings.js  # Admin-configured UPI/bank receiving details
│   │   ├── reports.js          # Admin-only: customers, tickets, finance, inventory
│   │   ├── dashboard.js        # 3 genuinely different payloads, one per role
│   │   ├── notifications.js    # Computed live — low stock, overdue, unpaid, due today
│   │   ├── search.js           # Global search across tickets/customers/invoices/parts
│   │   └── auditLogs.js        # Admin-only accountability trail
│   ├── utils/
│   │   ├── asyncHandler.js
│   │   ├── audit.js            # logActivity() — called from every mutating route
│   │   ├── idGenerator.js      # SR-xxxx / INV-xxxx code generator
│   │   └── upload.js           # Multer config — safe filenames, type/size limits
│   ├── seed.js                 # Creates demo login accounts (bcrypt-hashed)
│   ├── app.js                  # Express app (routes + static frontend + uploads)
│   └── server.js               # Entry point
├── public/                     # Frontend (vanilla JS, multi-page)
│   ├── index.html              # Login (single form, role auto-detected by backend)
│   ├── dashboard.html          # Renders one of 3 different views based on role
│   ├── customers.html          # List + profile modal (summary, devices, history)
│   ├── tickets.html            # Intake wizard + tabbed ticket detail (the core screen)
│   ├── technicians.html
│   ├── inventory.html          # + Stock In/Out/Correction + transaction history
│   ├── billing.html            # Invoice list + printable invoice + payment recording
│   ├── reports.html            # Admin only
│   ├── payment-settings.html   # Admin edits; everyone else views read-only
│   ├── audit-log.html          # Admin only
│   ├── users.html              # Admin only
│   ├── css/style.css
│   ├── uploads/                # Created automatically — before/after photos, QR code
│   └── js/                     # api.js (fetch/auth helpers), nav.js (shared shell + search + notifications), one file per page
├── package.json
├── .env.example
├── .gitignore
└── README.md
```

---

## Installation & setup

### 1. Prerequisites
- Node.js 18+
- MySQL 8.x (or MariaDB 10.5+) running locally or reachable over network

### 2. Install dependencies
```bash
cd repflow
npm install
```

### 3. Create the database
```bash
mysql -u root -p < database/schema.sql
```
This **drops and recreates** every table under a fresh `repflow_db` database, plus
seeds a starter set of inventory parts and the admin payment-settings row. There is
no in-place migration path from Rep-Flow 1.0 — this is a development-stage student
project with no production data to preserve. If you're re-running this after an
earlier attempt, this step wipes and rebuilds everything cleanly, which is normal.

User accounts are **not** created here — that's the next step, so passwords are
never stored as plain text in a SQL file.

### 4. Configure environment variables
```bash
cp .env.example .env
```
Edit `.env` and set your MySQL credentials and a strong `JWT_SECRET`. If you edit
`.env` while the server is already running, restart it — Node only reads `.env` at
startup.

### 5. Seed demo accounts
```bash
npm run seed
```
This creates one Admin, one Staff, and one Technician login (bcrypt-hashed), plus a
sample technician, a second unlinked technician, and a sample customer.

### 6. Run the app
```bash
npm start
# or, for auto-reload during development:
npm run dev
```

Open **http://localhost:5000** in your browser. The `public/uploads/` folder is
created automatically on first photo or QR upload.

---

## Demo credentials

| Role       | Email                     | Password    |
|------------|---------------------------|-------------|
| Admin      | admin@repflow.com         | Admin@123   |
| Staff      | staff@repflow.com         | Staff@123   |
| Technician | technician@repflow.com    | Tech@123    |

(You can change these in `.env` under `SEED_*` before running `npm run seed`,
or reset any password from the Users page as an Admin.)

---

## What each role actually sees

This isn't one dashboard with hidden buttons — each role gets its own dashboard
payload, its own nav, and its own set of allowed status transitions, enforced on
the **server**, not just hidden in the UI:

- **Admin** — everything: revenue, technician workload, all tickets, inventory,
  payment settings, user management, activity log, reports. Only Admin ever
  sees business-wide financial figures.
- **Staff** — front desk: customers, ticket intake (including before-photos),
  billing, recording payments, the handover checklist. No revenue, no
  technician-workload view, no system settings.
- **Technician** — a personal workboard grouped into New Assignment /
  Inspection / Diagnosing / Waiting for Parts / Repairing / Testing / Completed,
  scoped entirely to their own assigned jobs (enforced server-side — a
  technician cannot browse or open another technician's ticket, by URL or
  otherwise). Can enter diagnosis, repair notes, use parts, set the labour
  charge, and upload after-repair photos.

---

## The repair status flow

```
Received → Assigned → Inspection → Diagnosing → Waiting for Approval →
Waiting for Parts → Repair In Progress → Testing → Repair Completed →
Ready for Delivery → Delivered
                                   (Cancelled reachable from any open status)
```

- Transitions are **forward-only** — enforced server-side regardless of role.
- A ticket cannot skip straight to **Delivered**: that status is only ever set
  by confirming the Handover checklist (every item must be checked).
- A ticket cannot move to **Repair Completed** without at least one AFTER-repair
  photo already uploaded.

---

## Demonstrating the core workflow

1. Log in as **Staff**.
2. **Customers** → confirm "Ankit Sharma" exists (or add a new one).
3. **Repair Tickets → + New Ticket**: search/select the customer, fill in
   device details, intake condition, accessories received, and the reported
   problem ("Laptop is not charging") — no charges at this stage. Add a couple
   of BEFORE photos, then finish.
4. Open the ticket, assign technician **Rahul Verma**, move status to
   **Inspection**.
5. Log in as **Technician** (Rahul) → open the ticket on the workboard →
   review the BEFORE photos → enter **Diagnosis** ("Faulty charging port") and
   move to **Diagnosing**.
6. Add the part **USB-C Charging Port** (qty 1) — stock is verified and
   deducted automatically inside a transaction, logged in the inventory
   ledger, with a hard stop if stock is insufficient.
7. Move to **Repair In Progress**, then **Testing**, set the labour/service
   charge, upload an AFTER photo, then move to **Repair Completed** (blocked
   without that AFTER photo) and **Ready for Delivery**.
8. Log back in as Staff/Admin → **Generate Invoice** (parts + service +
   other charges − discount = total, computed the same way everywhere).
9. Record a payment (Cash, UPI, Bank Transfer, or Card) — supports partial
   payment across multiple entries; balance and status update automatically.
10. Work through the **Handover checklist** and confirm — this is the only
    way the ticket becomes **Delivered**.
11. Go back to **Customers → Profile** for that customer — the complete
    service history, device history, and spend summary are there.
12. As Admin, check **Activity Log** — every step above left a trail.

---

## What was completed

- Full JWT + bcrypt authentication, three genuinely different dashboards and
  navs per role, role-based authorization enforced on every protected API
  endpoint (not just hidden nav items).
- Complete redesigned ticket intake (customer search/create, device details,
  condition, accessories, reported problem, expected date, before photos) —
  charges deliberately excluded until after diagnosis/repair.
- Before/after repair photo system with upload, thumbnail grid, lightbox, and
  a before/after comparison view; a repair cannot be marked completed without
  an after photo on record.
- 12-status forward-only repair flow with per-role allowed transitions,
  enforced server-side, plus a recorded, timestamped status timeline.
- Inventory as a real stock-management system: Stock In / Stock Out /
  Correction, a full auditable transaction ledger per part, derived (never
  stored) In Stock / Low Stock / Out of Stock status, and transaction-safe
  automatic deduction (`FOR UPDATE` row locking) when a part is used on a
  ticket.
- Billing with one-ticket-one-invoice enforced at both the application layer
  and a database `UNIQUE` constraint; automatic total calculation
  (parts + service + other − discount) computed identically everywhere it's
  shown.
- Multi-method payments (Cash/UPI/Bank Transfer/Card) with partial-payment
  support, balance tracking, and Admin-configurable UPI/bank receiving
  details (with QR upload) that Staff can view read-only.
- A Handover checklist that's a real gate, not just a button — every item
  must be confirmed before a ticket can become Delivered.
- Draft tickets (save incomplete intake, continue or discard later).
- Customer profiles with summary stats, device history (repeated
  repairs grouped by device), and full service history.
- Global search (tickets/customers/invoices/parts/technicians, scoped for
  technicians to their own jobs) and a computed notification center — both
  built entirely from existing tables, no separate notification service.
- Admin-only Activity Log — every mutating action across the app writes an
  audit row (who, what, when, on what record).
- Centralized error handling that never surfaces raw SQL error text to the
  browser, parameterized queries throughout, confirmation modals before
  destructive actions, loading/empty/error states, responsive layout down to
  mobile widths.

## Known limitations (acceptable for a mini-project scope)

- Notifications and the "due today" / "overdue" figures are computed live on
  each request rather than stored with read/unread state — simpler and
  always-correct, but there's no per-user "mark as read."
- `idGenerator.js` generates ticket/invoice numbers by checking for
  collisions rather than a dedicated DB sequence table — fine at
  classroom/demo scale, not for high-concurrency production use.
- Uploaded photos and the QR code are served as plain static files under
  `/uploads` — anyone with the direct URL can view them without logging in.
  Acceptable for a student project; a production system would put these
  behind an authenticated download route.
- No automated test suite (manual end-to-end workflow only, per the brief).
- The before/after comparison view is a simple side-by-side layout, not an
  interactive slider.
- No AI features, online payment gateway, WhatsApp/SMS API, mobile app, or
  multi-branch support — intentionally out of scope per the project brief;
  listed here only as possible future scope.
- Single currency (₹) and single timezone assumption in the frontend
  formatting helpers.

---

## Exact commands to run locally

```bash
npm install
mysql -u root -p < database/schema.sql
cp .env.example .env      # then edit DB_* and JWT_SECRET
npm run seed
npm start
```

Then visit **http://localhost:5000**.
