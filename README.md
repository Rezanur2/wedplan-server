# WedPlan — Wedding Planning Platform (Server)

Express.js (ES Modules) REST API backend for **WedPlan**, handling MongoDB persistence (`wedplandb`), Better Auth JWKS JWT verification, role-based access control, service and booking validation, profile syncing, and **Stripe Checkout + Webhook** verification for monthly Premium vendor subscriptions.

---

## Live Website & Repository Links

* **Live API Server:** [https://wedplan-server-orpin.vercel.app](https://wedplan-server-orpin.vercel.app)
* **Live Website Link:** [https://wedplan-client-cyan.vercel.app](https://wedplan-client-cyan.vercel.app)
* **Server Repository:** [https://github.com/Rezanur2/wedplan-server](https://github.com/Rezanur2/wedplan-server)
* **Client Repository:** [https://github.com/Rezanur2/wedplan-client](https://github.com/Rezanur2/wedplan-client)

---

## Important Features

* **JWKS JWT Authentication (`verifyToken`):** Verifies incoming Bearer JWT tokens against Better Auth's `/api/auth/jwks` endpoint using `jose` (`createRemoteJWKSet` & `jwtVerify`) and rejects requests from invalid tokens or blocked accounts (`401`/`403`).
* **Role-Based Authorization (`verifyRole`):** Enforces strict server-side role permissions (`admin`, `vendor`, `customer`) and resource ownership validation on updates and deletions.
* **Service Management & Free Tier Limits:** Enforces a maximum of 3 non-rejected services for Free vendors, validates pricing and image URLs, supports search/category/location filtering, and sorts by Premium priority or price (`price-low` / `price-high`).
* **Booking Rules & Validation:** Prevents booking unavailable/paused/unapproved services, blocks vendors from booking their own services, rejects past event dates, and prevents duplicate active bookings for the same service and date.
* **Verified Stripe Monthly Subscriptions & Webhook Flow:** Creates recurring monthly (`$49/month`) Stripe Checkout sessions (`mode: 'subscription'`), records checkout attempts (`pending`, `paid`, `cancelled`), verifies `stripe-signature` on `POST /api/webhooks/stripe` (`checkout.session.completed`, `checkout.session.expired`, `customer.subscription.updated`, `customer.subscription.deleted`), automatically downgrades expired subscriptions, and supports period-end cancellation (`POST /subscriptions/cancel`).

---

## Technology Stack

* **Runtime:** Node.js (ES Modules)
* **Framework:** Express.js 5 (`express`)
* **Database:** MongoDB (`mongodb` native driver)
* **Authentication / JWT:** `jose` (Remote JWKS verification for Better Auth JWTs)
* **Payments:** Stripe Node SDK (`stripe`)
* **Middleware & Utilities:** `cors`, `dotenv`

---

## Database Architecture (`wedplandb`)

* **`user`:** Managed with Better Auth (`name`, `email`, `image`, `role`, `isBlocked`, `businessName`, `subscriptionPlan`, `subscriptionExpiresAt`).
* **`services`:** Vendor listings (`vendorId`, `serviceName`, `category`, `description`, `price`, `location`, `images`, `status`, `isAvailable`, `isPremium`, `createdAt`).
* **`bookings`:** Customer inquiries (`serviceId`, `vendorId`, `customerId`, `eventDate`, `eventLocation`, `message`, `status`, `createdAt`).
* **`transactions`:** Verified Stripe payments (`vendorId`, `plan`, `amount`, `currency`, `stripeSessionId`, `stripeSubscriptionId`, `status`, `createdAt`).

---

## Installation Instructions

### Prerequisites
* **Node.js** `v20+` and `npm`
* **MongoDB** connection string (`wedplandb`)
* **Stripe** Test Mode secret key and webhook signing secret

### 1. Clone Both Repositories
```bash
git clone https://github.com/Rezanur2/wedplan-server.git
git clone https://github.com/Rezanur2/wedplan-client.git
```

### 2. Install Dependencies
```bash
cd wedplan-server
npm install
```
*(Also run `npm install` inside `wedplan-client` if running the full stack locally.)*

### 3. Configure Environment Variables
Create a `.env` file in the root of `wedplan-server/` using [`.env.example`](./.env.example) as a reference (never commit `.env`):
```env
# MongoDB Connection String
MONGODB_URI=mongodb+srv://<username>:<password>@cluster0.mongodb.net/wedplandb

# Server Port
PORT=5000

# Stripe Secret Key & Webhook Secret
STRIPE_SECRET_KEY=sk_test_your_stripe_secret_key
STRIPE_WEBHOOK_SECRET=whsec_your_stripe_webhook_secret

# Frontend Client Origin (for CORS, JWKS, and Stripe redirects — no trailing slash)
CLIENT_URL=http://localhost:3000
```

---

## How to Run the Project Locally

### 1. Start the Backend Server
```bash
cd wedplan-server
npm start
```
The API server runs at `http://localhost:5000` (health check available at `GET /`).

### 2. Start the Frontend Client (in another terminal)
```bash
cd wedplan-client
npm run dev
```
The Next.js client runs at `http://localhost:3000`.

### 3. Test Stripe Webhooks Locally (Optional)
```bash
stripe listen --events checkout.session.completed,checkout.session.expired,customer.subscription.updated,customer.subscription.deleted --forward-to localhost:5000/api/webhooks/stripe
```
Paste the CLI webhook secret into `wedplan-server/.env` as `STRIPE_WEBHOOK_SECRET` and restart the server.

---

## API Endpoints Overview

### Public
* `GET /` — Health check message.
* `GET /services` — Approved & available services with search, category, location, and price sorting (`price-low`, `price-high`).

### Authenticated (All Valid Roles)
* `GET /services/:id` — Service details (pending/paused listings restricted to owner or admin).
* `GET /users/:id/premium` — Check live vendor premium status, `subscriptionExpiresAt`, and `cancelAtPeriodEnd` (auto-downgrades expired subscriptions).
* `GET /bookings` — Role-scoped bookings (customer's own, vendor's service bookings, or admin all bookings).
* `PATCH /bookings/:id` — Vendor accepts/rejects or customer cancels a pending booking.

### Customer Only
* `POST /bookings` — Create a validated booking request.

### Vendor Only
* `GET /my-services` — List logged-in vendor's services.
* `GET /services/count` — Count non-rejected vendor services for free-tier limit checks.
* `POST /services` — Create a new service (defaults to `Pending`).
* `PATCH /services/:id` — Update service details or availability (also accessible by admin for moderation).
* `DELETE /services/:id` — Delete service (also accessible by admin).
* `PATCH /users/profile/sync` — Sync updated vendor profile info to existing services.
* `POST /create-checkout-session` — Create Stripe Monthly Subscription Checkout session (`$49/month`) and record a `pending` transaction.
* `POST /transactions/checkout-verify` — Read-only verification of completed Stripe Checkout session for the Success page.
* `POST /transactions/checkout-cancel` — Verify unpaid checkout cancellation with Stripe and update pending attempts to `cancelled`.
* `GET /transactions/my` — Fetch the logged-in vendor's recent payment history (omitting Stripe session/subscription IDs).
* `POST /subscriptions/cancel` — Schedule monthly subscription cancellation at the end of the current billing period (`cancel_at_period_end: true`).

### Admin Only
* `GET /users` — List all registered users.
* `PATCH /users/:id/role` — Update user role and invalidate active sessions.
* `PATCH /users/:id/block` — Block or unblock user and invalidate active sessions on block.
* `GET /admin/services` — List all submitted services for review.
* `GET /admin/transactions` — List all platform transactions enriched with vendor name, email, and avatar image.

### Stripe Webhook
* `POST /api/webhooks/stripe` — Verifies `stripe-signature` and handles `checkout.session.completed`, `checkout.session.expired`, `customer.subscription.updated`, and `customer.subscription.deleted` to sync transactions, expiry dates, and vendor/service Premium flags.
