# Aarogyam Project Knowledge Base

## Product Overview
Aarogyam is a web-based healthcare ecosystem providing dedicated dashboards and portals for two specific user roles: Patients and Doctors.

## Technology Stack
- Framework: Next.js (App Router)
- Styling: Tailwind CSS
- State/Routing: Dynamic client-side routing and protected route wrappers

## Core Architectural Rules
1. No Server Reloads: Page transitions and user role-based redirections must happen dynamically on the client side without refreshing the browser window.
2. Direct System Execution: Code modifications must match existing file patterns, directory spacing, and import methodologies.
3. Concurrent Security: Database access calls must handle race conditions explicitly (e.g., preventing duplicate simultaneous appointment selections).