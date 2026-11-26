# WedPlan — Backend API Server

Express.js (ES Modules) REST API server for **WedPlan**, handling MongoDB persistence, Better Auth JWKS JWT verification, role-based access control, booking validation, and Stripe Checkout + Webhook verification.

---

## 🔗 Live & Repository Links

* **Live API Server:** [https://wedplan-server-orpin.vercel.app](https://wedplan-server-orpin.vercel.app)
* **Live Website:** [https://wedplan-client-cyan.vercel.app](https://wedplan-client-cyan.vercel.app)
* **Server Repository:** [https://github.com/Rezanur2/wedplan-server](https://github.com/Rezanur2/wedplan-server)
* **Client Repository:** [https://github.com/Rezanur2/wedplan-client](https://github.com/Rezanur2/wedplan-client)

---

## ✨ Important Features

* **JWKS JWT Authentication (`verifyToken`):** Verifies incoming Bearer JWT tokens against Better Auth's `/api/auth/jwks` endpoint using `jose` (`createRemoteJWKSet` & `jwtVerify`) and checks blocked account status on every protected request.
* **Role-Based Authorization (`verifyRole`):** Enforces strict server-side role permissions (`admin`, `vendor`, `customer`) and resource ownership validation on updates and deletions.
* **Service Management & Free Tier Limits:** Enforces a maximum of 3 active/non-rejected services for free vendors, validates pricing/images, supports category/location/keyword filtering, and sorts by Premium priority or price (ascending/descending).
* **Booking Rules & Validation:** Prevents booking unavailable/paused/unapproved services, blocks vendors from booking their own services, rejects past event dates, and prevents duplicate active bookings for the same service and date.
* **Verified Stripe Checkout & Webhook Flow:** Creates Stripe Checkout sessions, verifies `stripe-signature` on `POST /api/webhooks/stripe` (`checkout.session.completed`) before activating Premium status and updating existing vendor services, and records read-only transaction receipts.

---

## 🛠️ Technology Stack

* **Runtime:** Node.js
* **Framework:** Express.js 5 (ES Modules)
* **Database:** MongoDB (`mongodb` native driver)
* **Authentication / JWT:** `jose` (Remote JWKS verification for Better Auth JWTs)
* **Payments:** Stripe Node SDK (`stripe`)
* **Utilities:** `cors`, `dotenv`

---

## 🗄️ Database Architecture (`wedplandb`)

* **`user`:** Managed with Better Auth (`name`, `email`, `image`, `role`, `isBlocked`, `businessName`, `subscriptionPlan`, `subscriptionExpiresAt`).
* **`services`:** Vendor listings (`vendorId`, `serviceName`, `category`, `description`, `price`, `location`, `images`, `status`, `isAvailable`, `isPremium`, `createdAt`).
* **`bookings`:** Customer inquiries (`serviceId`, `vendorId`, `customerId`, `eventDate`, `eventLocation`, `message`, `status`, `createdAt`).
* **`transactions`:** Verified Stripe payments (`vendorId`, `plan`, `amount`, `currency`, `stripeSessionId`, `stripeSubscriptionId`, `status`, `createdAt`).

---

## 📋 Environment Variables

Create a `.env` file in the root of `wedplan-server` (never commit `.env` or secret keys):

```env
# MongoDB Connection String
MONGODB_URI=mongodb+srv://<username>:<password>@cluster0.mongodb.net/wedplandb

# Stripe Credentials
STRIPE_SECRET_KEY=sk_test_your_stripe_secret_key
STRIPE_WEBHOOK_SECRET=whsec_your_stripe_webhook_secret

# Client Application URL (for JWKS JWT verification & Stripe redirects, no trailing slash)
CLIENT_URL=http://localhost:3000

# Optional Local Server Port (defaults to 5000)
PORT=5000
```

---

## 🚀 Installation & Local Setup

### 1. Clone the repository
```bash
git clone https://github.com/Rezanur2/wedplan-server.git
cd wedplan-server
```

### 2. Install dependencies
```bash
npm install
```

### 3. Configure environment variables
Create a `.env` file using the template above.

### 4. Start the server
```bash
npm start
```

The API server runs at `http://localhost:5000`.

### 5. Local Stripe Webhook testing (optional)
```bash
stripe listen --events checkout.session.completed --forward-to localhost:5000/api/webhooks/stripe
```

---

## 📡 API Endpoints Overview

### Public
* `GET /` — Health check message.
* `GET /services` — Approved & available services with search, category, location, and price sorting (`price-low`, `price-high`).

### Authenticated (All Valid Roles)
* `GET /services/:id` — Service details (pending/paused listings restricted to owner or admin).
* `GET /users/:id/premium` — Check vendor premium status.
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
* `POST /create-checkout-session` — Create Stripe Checkout session for Premium upgrade.
* `POST /transactions/checkout-verify` — Read-only verification of completed Stripe Checkout session.

### Admin Only
* `GET /users` — List all registered users.
* `PATCH /users/:id/role` — Update user role and invalidate active sessions.
* `PATCH /users/:id/block` — Block or unblock user and invalidate active sessions on block.
* `GET /admin/services` — List all submitted services for review.
* `GET /admin/transactions` — List verified platform transactions enriched with vendor info.

### Stripe Webhook
* `POST /api/webhooks/stripe` — Verifies `stripe-signature`, records transaction, upgrades vendor to Premium, and marks vendor services as `isPremium: true`.
