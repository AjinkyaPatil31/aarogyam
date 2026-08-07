# Aarogyam — Cloud Edition

> A secure, role-based digital healthcare management platform for clinics, designed to streamline patient registration, appointments, consultations, prescriptions, medical records, and clinic communication.

**Cloud Edition v1.0**  
Production baseline: `v1.0-cloud`

---

## Overview

Aarogyam is a full-stack healthcare management platform built to digitize the day-to-day workflow of a clinic.

It provides dedicated workflows for:

- 👨‍⚕️ Doctors
- 🧑‍⚕️ Compounders / Clinic Staff
- 🧑‍🦽 Patients

The platform brings patient management, appointment scheduling, consultations, prescriptions, medical records, authentication, role-based access control, and WhatsApp communication into a single application.

The **Cloud Edition** was designed for deployment on the internet using a managed PostgreSQL database and cloud hosting infrastructure.

> **Note:** This repository also contains a later Local Edition development branch. The `v1.0-cloud` tag represents the frozen Cloud Edition baseline and should be treated independently from the Local Edition architecture.

---

# ✨ Features

## 🔐 Authentication & Security

- JWT-based authentication
- HttpOnly cookie-based session architecture
- Sliding-session / idle-timeout mechanism
- Secure authentication middleware
- Role-based access control (RBAC)
- Protected API routes
- Protected dashboards
- Password hashing using `bcryptjs`
- Server-side authorization
- Session expiration handling
- Logout and token invalidation flow

### Supported roles

| Role | Primary responsibilities |
|------|---------------------------|
| 👨‍⚕️ Doctor | Consultations, prescriptions, medical records, appointments |
| 🧑‍⚕️ Compounder | Patient and appointment management, clinic operations |
| 🧑‍🦽 Patient | Profile, appointments, medical information |

---

# 🏥 Doctor Workflow

Doctors receive a dedicated dashboard for managing clinical operations.

### Doctor capabilities

- View clinic statistics
- View appointments
- Manage consultations
- Access patient information
- Record patient vitals
- Create medical records
- Generate prescriptions
- View consultation history
- Generate prescription PDFs
- Manage appointment status
- Communicate prescription/login information through WhatsApp

The consultation workflow is designed to move from:

**Patient → Appointment → Consultation → Medical Record → Prescription**

without requiring the doctor to maintain separate systems.

---

# 🧑‍⚕️ Compounder Workflow

Compounders provide operational support to the doctor.

Features include:

- Patient registration
- Patient lookup
- Appointment management
- Patient information management
- Clinic workflow support
- Role-restricted access to protected operations

Compounders cannot access operations reserved for doctors.

---

# 🧑‍🦽 Patient Workflow

Patients have their own authenticated dashboard.

Patients can:

- Register with the clinic
- Log in securely
- View their profile
- Book appointments
- View appointment information
- Access relevant medical information
- View prescription/consultation information made available to them

---

# 📅 Appointment Management

Aarogyam provides an appointment workflow designed around clinic availability.

Features include:

- Appointment booking
- Doctor availability
- Slot validation
- Duplicate booking prevention
- Appointment status management
- Doctor-side appointment management
- Patient-side appointment booking

Appointment creation uses transactional database operations to protect against conflicting bookings.

---

# 🩺 Digital Consultation

The consultation system provides an end-to-end digital clinical workflow.

A doctor can:

1. Open an appointment
2. Review patient information
3. Record vitals
4. Document consultation information
5. Create medical records
6. Add medications
7. Generate a prescription
8. Save the consultation
9. Generate a prescription PDF

Clinical information is persisted in the database through transactional operations.

---

# 💊 Medicine & Drug Management

Aarogyam includes a searchable medicine catalogue.

The system supports:

- Drug search
- Client-side autocomplete
- API-backed search
- Prescription medication selection
- Large medicine catalogue support

The drug search workflow uses `Fuse.js` for responsive client-side searching while retaining an authenticated API fallback.

---

# 📄 Prescription Generation

Prescriptions can be generated digitally from the consultation workflow.

The system supports:

- Patient information
- Doctor information
- Consultation information
- Vitals
- Medication details
- Dosage information
- Prescription instructions

Prescriptions can be rendered into PDF documents using:

- `jsPDF`
- `jsPDF-AutoTable`

---

# 📱 WhatsApp Communication

The Cloud Edition supports WhatsApp communication through a provider abstraction layer.

The architecture was designed to support different providers, including:

- WhatsApp Web.js
- Twilio WhatsApp

The Cloud Edition deployment used the provider abstraction to support cloud-based WhatsApp delivery.

> WhatsApp functionality requires the appropriate provider configuration and credentials.

---

# 🏗️ Architecture

Aarogyam follows a modular full-stack architecture.

```text
┌──────────────────────────────────────────────┐
│                 Aarogyam UI                  │
│        Next.js / React / Tailwind CSS        │
└───────────────────────┬──────────────────────┘
                        │
                        ▼
┌──────────────────────────────────────────────┐
│              Next.js API Layer               │
│       Authentication / RBAC / Business       │
│                 Logic / APIs                 │
└───────────────────────┬──────────────────────┘
                        │
                        ▼
┌──────────────────────────────────────────────┐
│                    Prisma                    │
│                ORM / Database                │
└───────────────────────┬──────────────────────┘
                        │
                        ▼
┌──────────────────────────────────────────────┐
│              PostgreSQL / Supabase           │
│              Cloud Edition Database          │
└──────────────────────────────────────────────┘

              External Communication
                        │
                        ▼
                WhatsApp Provider
🧰 Technology Stack
Frontend
Next.js 15
React 19
Tailwind CSS
JavaScript
Backend
Next.js API Routes
Node.js
Prisma ORM
JWT
bcryptjs
Database
PostgreSQL
Supabase
Prisma
Authentication
JWT
HttpOnly cookies
Middleware-based route protection
Role-based authorization
Sliding sessions
Documents
jsPDF
jsPDF-AutoTable
Communication
WhatsApp Web.js
Twilio WhatsApp provider abstraction
Deployment
Vercel
Supabase PostgreSQL
📂 Project Structure
aarogyam/
│
├── app-server/
│   │
│   ├── app/
│   │   ├── api/
│   │   │   ├── auth/
│   │   │   ├── appointments/
│   │   │   ├── drugs/
│   │   │   ├── patients/
│   │   │   ├── prescriptions/
│   │   │   └── ...
│   │   │
│   │   ├── components/
│   │   ├── context/
│   │   ├── dashboard/
│   │   ├── login/
│   │   ├── lib/
│   │   └── ...
│   │
│   ├── prisma/
│   │   ├── schema.prisma
│   │   ├── migrations/
│   │   └── seed.js
│   │
│   ├── scripts/
│   ├── middleware.js
│   ├── next.config.js
│   ├── package.json
│   └── ...
│
├── README.md
└── ...
🔑 Environment Variables

The Cloud Edition requires environment configuration for authentication, database connectivity, sessions, application URLs, and WhatsApp communication.

Example:

DATABASE_URL="your-postgresql-connection-string"
DIRECT_URL="your-direct-postgresql-connection-string"

JWT_SECRET="your-secure-jwt-secret"

SESSION_IDLE_TIMEOUT_MINUTES=60
SESSION_REFRESH_THRESHOLD_MINUTES=15
SESSION_CLOCK_SKEW_SECONDS=30

NEXT_PUBLIC_APP_URL="https://your-domain.com"

WA_PROVIDER="twilio"

TWILIO_ACCOUNT_SID="your-account-sid"
TWILIO_AUTH_TOKEN="your-auth-token"
TWILIO_WHATSAPP_NUMBER="whatsapp:+xxxxxxxxxxx"
⚠️ Security

Never commit:

.env
.env.local
database credentials
JWT secrets
Twilio credentials
API keys
production environment files

Use environment variables provided by the deployment platform.

🚀 Running the Cloud Edition Locally
1. Clone the repository
git clone https://github.com/AjinkyaPatil31/aarogyam.git
cd aarogyam
2. Enter the application
cd app-server
3. Install dependencies
npm install
4. Configure environment variables

Create:

.env.local

and configure the required Cloud Edition environment variables.

5. Generate Prisma Client
npx prisma generate
6. Initialize the database

For a development environment:

npx prisma migrate dev

If the project requires seeded data:

npx prisma db seed
7. Start the development server
npm run dev

The application will normally be available at:

http://localhost:3000
🏭 Production Deployment

The Cloud Edition was designed for:

Frontend / API
      │
      ▼
   Vercel
      │
      ▼
PostgreSQL
      │
      ▼
   Supabase
Deployment requirements
Create a PostgreSQL database.
Configure Prisma for PostgreSQL.
Configure environment variables.
Generate Prisma Client.
Apply migrations.
Seed the database if required.
Deploy the Next.js application.
Configure WhatsApp provider credentials.
Verify authentication and database persistence.
Perform production smoke testing.
🗄️ Database Schema

The application uses Prisma to manage the relational database.

Core entities include:

User
 │
 ├── PatientProfile
 │
 ├── Appointment
 │
 ├── MedicalRecord
 │
 └── Prescription

Drug

The database maintains relationships between:

Users
Patient profiles
Appointments
Medical records
Prescriptions
Drugs

Transactional operations are used for workflows where consistency is important, such as appointment booking and prescription creation.

🔐 Security Model

Security is implemented at multiple layers.

Request
   │
   ▼
Authentication
   │
   ▼
JWT Verification
   │
   ▼
Session Validation
   │
   ▼
Role-Based Authorization
   │
   ▼
API Business Logic
   │
   ▼
Prisma
   │
   ▼
PostgreSQL

The application does not treat frontend restrictions as sufficient authorization.

Protected operations are enforced on the server.

🧪 Verification

The Cloud Edition was validated through:

Authentication smoke tests
Role-based access tests
Patient registration
Appointment creation
Appointment conflict handling
Consultation workflow
Prescription creation
PDF generation
Drug search
Dashboard rendering
WhatsApp provider integration
Database persistence
Production deployment verification
📌 Cloud Edition Release

The Cloud Edition was formally frozen as:

Aarogyam Cloud Edition v1.0

Release tag:

v1.0-cloud

Git commit:

99dc39116527cad29ec9978eb8034f38d95d7c18

Annotated tag:

fce4e91dde66209e0f5eb53e7da1f4503f4b4333

GitHub Release:

https://github.com/AjinkyaPatil31/aarogyam/releases/tag/v1.0-cloud

This tag represents the immutable Cloud Edition baseline before the Local Edition architecture migration.

🌐 Live Cloud Deployment

The Cloud Edition staging deployment was hosted on Vercel with Supabase PostgreSQL.

Staging application:

https://app-server-black.vercel.app

The availability of this deployment may change because the Cloud Edition has been frozen and development has moved toward the Local Edition architecture.

🛣️ Project Evolution

Aarogyam evolved through two major architectural editions.

Cloud Edition
PostgreSQL
   +
Supabase
   +
Vercel
   +
Cloud WhatsApp Provider

Purpose:

Internet-accessible clinic platform
Managed PostgreSQL
Cloud deployment
Remote accessibility
Local Edition

The subsequent architecture moves toward a completely local clinic deployment.

Local Aarogyam Application
        │
        ├── Next.js
        ├── SQLite
        ├── Local Network
        └── WhatsApp Web.js

The Local Edition is being developed independently from the frozen Cloud Edition baseline.

🎯 Design Philosophy

Aarogyam is built around several principles:

Security First

Healthcare information requires strong authentication, authorization, and data isolation.

Workflow First

The software should follow how a clinic actually operates rather than forcing clinical staff to adapt to unnecessary complexity.

Reliability

Critical operations should be transactional and resilient against partial failures.

Simplicity

The interface should make routine clinic operations faster, not introduce another layer of administrative work.

Modular Architecture

Infrastructure, authentication, database access, communication, and application logic should remain independently maintainable.

Privacy

Healthcare data should be handled with appropriate security controls and minimal unnecessary exposure.

📜 License

This project is currently maintained as a personal/academic engineering project.

Unless a separate license is explicitly provided in this repository, no permission is granted to reproduce, distribute, or commercially use the source code.

👨‍💻 Author

Ajinkya Patil

B.Tech — Electronics & Communication Engineering
SVNIT Surat
2025–2029

⭐ Project Status
Edition	Status
Cloud Edition v1.0	🔒 Frozen baseline
Local Edition	🚧 Active development

The Cloud Edition is preserved as a stable historical release while development continues on the Local Edition architecture.

Aarogyam

A digital clinic management platform built to make healthcare workflows simpler, safer, and more connected.
