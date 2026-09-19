-- ============================================================
-- Rep-Flow 2.0 — Smart Repair & Service Management System
-- MySQL Schema
-- ============================================================
-- This is a FRESH schema for the 2.0 redesign (new status flow,
-- photos, inventory transactions, payments, handover, audit log).
-- If you are upgrading from Rep-Flow 1.0, importing this file
-- drops and recreates every table — there is no in-place
-- migration path, since this is a development-stage student
-- project with no production data to preserve (see README).
-- ============================================================

CREATE DATABASE IF NOT EXISTS repflow_db
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE repflow_db;

SET FOREIGN_KEY_CHECKS = 0;

-- ------------------------------------------------------------
-- users  (Admin / Staff / Technician login accounts)
-- ------------------------------------------------------------
DROP TABLE IF EXISTS users;
CREATE TABLE users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(100) NOT NULL,
  email         VARCHAR(150) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role          ENUM('admin', 'staff', 'technician') NOT NULL DEFAULT 'staff',
  is_active     TINYINT(1) NOT NULL DEFAULT 1,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_users_role (role)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- customers
-- ------------------------------------------------------------
DROP TABLE IF EXISTS customers;
CREATE TABLE customers (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(120) NOT NULL,
  phone       VARCHAR(20)  NOT NULL,
  email       VARCHAR(150) NULL,
  address     VARCHAR(255) NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_customers_phone (phone),
  INDEX idx_customers_name (name)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- technicians  (business profile; optionally linked to a login)
-- ------------------------------------------------------------
DROP TABLE IF EXISTS technicians;
CREATE TABLE technicians (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  user_id          INT NULL,
  name             VARCHAR(120) NOT NULL,
  phone            VARCHAR(20) NOT NULL,
  specialization   VARCHAR(120) NULL,
  experience_years DECIMAL(4,1) NOT NULL DEFAULT 0,
  status           ENUM('Active', 'Inactive') NOT NULL DEFAULT 'Active',
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_tech_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_tech_status (status)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- parts  (inventory catalogue — current stock only; movements
-- are recorded separately in inventory_transactions)
-- ------------------------------------------------------------
DROP TABLE IF EXISTS parts;
CREATE TABLE parts (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  name           VARCHAR(150) NOT NULL,
  category       VARCHAR(80)  NOT NULL DEFAULT 'General',
  sku            VARCHAR(50)  NOT NULL UNIQUE,
  supplier       VARCHAR(120) NULL,
  location       VARCHAR(80)  NULL,
  quantity       INT NOT NULL DEFAULT 0,
  purchase_price DECIMAL(10,2) NOT NULL DEFAULT 0,
  selling_price  DECIMAL(10,2) NOT NULL DEFAULT 0,
  min_stock      INT NOT NULL DEFAULT 2,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_parts_qty CHECK (quantity >= 0),
  INDEX idx_parts_sku (sku)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- inventory_transactions  (every stock movement — auditable)
-- ------------------------------------------------------------
DROP TABLE IF EXISTS inventory_transactions;
CREATE TABLE inventory_transactions (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  part_id          INT NOT NULL,
  ticket_id        INT NULL,
  type             ENUM('IN','OUT','RETURN','CORRECTION') NOT NULL,
  quantity         INT NOT NULL,
  previous_stock   INT NOT NULL,
  new_stock        INT NOT NULL,
  supplier         VARCHAR(120) NULL,
  reference_number VARCHAR(80)  NULL,
  reason           VARCHAR(255) NULL,
  user_id          INT NULL,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_invtx_part FOREIGN KEY (part_id) REFERENCES parts(id) ON DELETE CASCADE,
  CONSTRAINT fk_invtx_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_invtx_qty CHECK (quantity > 0),
  INDEX idx_invtx_part (part_id),
  INDEX idx_invtx_ticket (ticket_id)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- service_tickets  (single source of truth for one repair job)
-- ------------------------------------------------------------
DROP TABLE IF EXISTS service_tickets;
CREATE TABLE service_tickets (
  id                     INT AUTO_INCREMENT PRIMARY KEY,
  ticket_number          VARCHAR(20) NOT NULL UNIQUE,
  customer_id            INT NOT NULL,
  technician_id          INT NULL,

  -- Device
  device_type            VARCHAR(60) NOT NULL,
  brand                  VARCHAR(60) NOT NULL,
  model                  VARCHAR(80) NULL,
  serial_number          VARCHAR(100) NULL,
  device_color           VARCHAR(40) NULL,

  -- Intake condition
  condition_scratches    TINYINT(1) NOT NULL DEFAULT 0,
  condition_cracks       TINYINT(1) NOT NULL DEFAULT 0,
  condition_dents        TINYINT(1) NOT NULL DEFAULT 0,
  screen_condition       VARCHAR(30) NULL,   -- e.g. Good / Scratched / Cracked / Not working
  body_condition         VARCHAR(30) NULL,   -- e.g. Good / Worn / Damaged
  condition_notes        TEXT NULL,

  -- Accessories received (fixed checklist, stored as JSON array of labels)
  accessories            JSON NULL,

  reported_problem       TEXT NOT NULL,
  diagnosis              TEXT NULL,
  repair_notes           TEXT NULL,
  expected_date          DATE NULL,

  -- Charges (entered AFTER diagnosis/repair — never at intake)
  service_charge         DECIMAL(10,2) NOT NULL DEFAULT 0,
  other_charges          DECIMAL(10,2) NOT NULL DEFAULT 0,
  discount               DECIMAL(10,2) NOT NULL DEFAULT 0,

  status                 ENUM(
                            'Received','Assigned','Inspection','Diagnosing',
                            'Waiting for Approval','Waiting for Parts',
                            'Repair In Progress','Testing','Repair Completed',
                            'Ready for Delivery','Delivered','Cancelled'
                          ) NOT NULL DEFAULT 'Received',
  payment_status         ENUM('Pending','Partial','Paid') NOT NULL DEFAULT 'Pending',

  is_draft               TINYINT(1) NOT NULL DEFAULT 0,
  created_by             INT NULL,
  created_at             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_ticket_customer   FOREIGN KEY (customer_id)   REFERENCES customers(id)   ON DELETE RESTRICT,
  CONSTRAINT fk_ticket_technician FOREIGN KEY (technician_id) REFERENCES technicians(id) ON DELETE SET NULL,
  CONSTRAINT fk_ticket_created_by FOREIGN KEY (created_by)    REFERENCES users(id)       ON DELETE SET NULL,
  INDEX idx_ticket_status (status),
  INDEX idx_ticket_customer (customer_id),
  INDEX idx_ticket_technician (technician_id),
  INDEX idx_ticket_payment (payment_status),
  INDEX idx_ticket_draft (is_draft)
) ENGINE=InnoDB;

ALTER TABLE inventory_transactions
  ADD CONSTRAINT fk_invtx_ticket FOREIGN KEY (ticket_id) REFERENCES service_tickets(id) ON DELETE SET NULL;

-- ------------------------------------------------------------
-- ticket_parts  (parts consumed by a ticket)
-- ------------------------------------------------------------
DROP TABLE IF EXISTS ticket_parts;
CREATE TABLE ticket_parts (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  ticket_id         INT NOT NULL,
  part_id           INT NOT NULL,
  quantity          INT NOT NULL,
  unit_cost_at_use  DECIMAL(10,2) NOT NULL,  -- selling price frozen at time of use
  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_tp_ticket FOREIGN KEY (ticket_id) REFERENCES service_tickets(id) ON DELETE CASCADE,
  CONSTRAINT fk_tp_part   FOREIGN KEY (part_id)   REFERENCES parts(id) ON DELETE RESTRICT,
  CONSTRAINT chk_tp_qty CHECK (quantity > 0),
  INDEX idx_tp_ticket (ticket_id)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- ticket_photos  (BEFORE / AFTER repair documentation)
-- ------------------------------------------------------------
DROP TABLE IF EXISTS ticket_photos;
CREATE TABLE ticket_photos (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  ticket_id    INT NOT NULL,
  photo_type   ENUM('BEFORE','AFTER') NOT NULL,
  file_path    VARCHAR(255) NOT NULL,
  caption      VARCHAR(150) NULL,
  uploaded_by  INT NULL,
  uploaded_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_photo_ticket FOREIGN KEY (ticket_id) REFERENCES service_tickets(id) ON DELETE CASCADE,
  CONSTRAINT fk_photo_user   FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_photo_ticket (ticket_id, photo_type)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- ticket_status_history  (drives the ticket timeline)
-- ------------------------------------------------------------
DROP TABLE IF EXISTS ticket_status_history;
CREATE TABLE ticket_status_history (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  ticket_id   INT NOT NULL,
  status      VARCHAR(40) NOT NULL,
  note        VARCHAR(255) NULL,
  changed_by  INT NULL,
  changed_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_hist_ticket FOREIGN KEY (ticket_id) REFERENCES service_tickets(id) ON DELETE CASCADE,
  CONSTRAINT fk_hist_user   FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_hist_ticket (ticket_id)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- invoices  (ONE ticket = ONE invoice — enforced by UNIQUE ticket_id)
-- ------------------------------------------------------------
DROP TABLE IF EXISTS invoices;
CREATE TABLE invoices (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  invoice_number  VARCHAR(20) NOT NULL UNIQUE,
  ticket_id       INT NOT NULL UNIQUE,
  service_charge  DECIMAL(10,2) NOT NULL DEFAULT 0,
  parts_cost      DECIMAL(10,2) NOT NULL DEFAULT 0,
  other_charges   DECIMAL(10,2) NOT NULL DEFAULT 0,
  discount        DECIMAL(10,2) NOT NULL DEFAULT 0,
  total_amount    DECIMAL(10,2) NOT NULL DEFAULT 0,
  paid_amount     DECIMAL(10,2) NOT NULL DEFAULT 0,
  payment_status  ENUM('Pending','Partial','Paid') NOT NULL DEFAULT 'Pending',
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_invoice_ticket FOREIGN KEY (ticket_id) REFERENCES service_tickets(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- payments  (one invoice may have MANY payments — partial support)
-- ------------------------------------------------------------
DROP TABLE IF EXISTS payments;
CREATE TABLE payments (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  invoice_id        INT NOT NULL,
  amount            DECIMAL(10,2) NOT NULL,
  method            ENUM('Cash','UPI','Bank Transfer','Card') NOT NULL,
  reference_number  VARCHAR(80) NULL,
  notes             VARCHAR(255) NULL,
  received_by       INT NULL,
  received_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_payment_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
  CONSTRAINT fk_payment_user FOREIGN KEY (received_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_payment_amount CHECK (amount > 0),
  INDEX idx_payment_invoice (invoice_id)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- handover_records  (Delivered status requires this to exist AND
-- be fully confirmed — confirmed_at stays NULL while staff are
-- still working through the checklist)
-- ------------------------------------------------------------
DROP TABLE IF EXISTS handover_records;
CREATE TABLE handover_records (
  id                     INT AUTO_INCREMENT PRIMARY KEY,
  ticket_id              INT NOT NULL UNIQUE,
  device_tested          TINYINT(1) NOT NULL DEFAULT 0,
  repair_verified        TINYINT(1) NOT NULL DEFAULT 0,
  accessories_returned   TINYINT(1) NOT NULL DEFAULT 0,
  customer_verified      TINYINT(1) NOT NULL DEFAULT 0,
  condition_confirmed    TINYINT(1) NOT NULL DEFAULT 0,
  payment_completed      TINYINT(1) NOT NULL DEFAULT 0,
  customer_received      TINYINT(1) NOT NULL DEFAULT 0,
  notes                  VARCHAR(255) NULL,
  confirmed_by           INT NULL,
  confirmed_at           TIMESTAMP NULL,
  created_at             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_handover_ticket FOREIGN KEY (ticket_id) REFERENCES service_tickets(id) ON DELETE CASCADE,
  CONSTRAINT fk_handover_user FOREIGN KEY (confirmed_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- payment_settings  (single row — Admin-configured business info)
-- ------------------------------------------------------------
DROP TABLE IF EXISTS payment_settings;
CREATE TABLE payment_settings (
  id                INT PRIMARY KEY DEFAULT 1,
  business_name     VARCHAR(150) NULL,
  upi_id            VARCHAR(80)  NULL,
  upi_qr_path       VARCHAR(255) NULL,
  bank_name         VARCHAR(120) NULL,
  account_holder    VARCHAR(120) NULL,
  account_number    VARCHAR(40)  NULL,
  ifsc              VARCHAR(20)  NULL,
  branch            VARCHAR(120) NULL,
  instructions      TEXT NULL,
  updated_by        INT NULL,
  updated_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_paysettings_user FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_paysettings_single_row CHECK (id = 1)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- audit_logs  (accountability trail — Admin-only viewer)
-- ------------------------------------------------------------
DROP TABLE IF EXISTS audit_logs;
CREATE TABLE audit_logs (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  user_id      INT NULL,
  user_name    VARCHAR(100) NULL,  -- snapshot, survives user deletion
  role         VARCHAR(20)  NULL,
  action       VARCHAR(150) NOT NULL,
  entity_type  VARCHAR(40)  NULL,
  entity_id    INT NULL,
  details      VARCHAR(255) NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_audit_created (created_at)
) ENGINE=InnoDB;

SET FOREIGN_KEY_CHECKS = 1;

-- ------------------------------------------------------------
-- Seed demo parts. Demo USERS and technician profiles are
-- created by `npm run seed` (so passwords are properly
-- bcrypt-hashed, and the technician demo login is correctly
-- linked to its technicians row) — not duplicated here.
-- ------------------------------------------------------------
INSERT INTO parts (name, category, sku, supplier, quantity, purchase_price, selling_price, min_stock) VALUES
  ('USB-C Charging Port', 'Laptop Parts', 'CHG-USBC-01', 'TechSource Distributors', 10, 300.00, 450.00, 3),
  ('Laptop Battery (Generic 6-cell)', 'Laptop Parts', 'BAT-GEN-06', 'PowerCell India', 6, 1600.00, 2200.00, 2),
  ('Mobile Display Assembly', 'Mobile Parts', 'DISP-MOB-01', 'ScreenHub', 8, 1300.00, 1800.00, 3),
  ('RAM Module 8GB DDR4', 'Laptop Parts', 'RAM-DDR4-8', 'MemoryWorks', 12, 1100.00, 1500.00, 4),
  ('Laptop Keyboard', 'Laptop Parts', 'KEY-LAP-01', 'TechSource Distributors', 5, 650.00, 900.00, 2),
  ('Mobile Battery (Generic)', 'Mobile Parts', 'BAT-MOB-01', 'PowerCell India', 1, 450.00, 650.00, 3),
  ('Printer Ink Cartridge (Black)', 'Printer Parts', 'INK-BLK-01', 'InkDepot', 15, 380.00, 550.00, 5),
  ('HDD to SSD 480GB', 'Storage', 'SSD-480-01', 'MemoryWorks', 4, 2000.00, 2600.00, 2);

INSERT INTO payment_settings (id, business_name, upi_id, bank_name, account_holder, account_number, ifsc, branch, instructions) VALUES
  (1, 'Rep-Flow Repair Services', 'repflow@upi', 'State Bank of India', 'Rep-Flow Repair Services', '000000000000', 'SBIN0000000', 'Main Branch',
   'Please share the payment screenshot or UTR number with the front desk after paying.');
