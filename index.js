import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import { MongoClient, ObjectId } from 'mongodb';
import Stripe from 'stripe';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const app = express();
const port = process.env.PORT || 5000;


// Stripe Webhook Endpoint
app.post('/api/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const stripeEvent = req.body;
  const signature = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    if (!webhookSecret || !signature) {
      return res.status(400).send("Webhook Error: Missing signature or webhook secret");
    }
    event = stripe.webhooks.constructEvent(stripeEvent, signature, webhookSecret);
  } catch (error) {
    console.error("Stripe webhook verification failed:", error.message);
    return res.status(400).send(`Webhook Error: ${error.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    if (session.payment_status !== 'paid') {
      return res.json({ received: true });
    }
    const sessionId = session.id;
    const vendorId = session.metadata?.vendorId;

    try {
      // Prevent duplicate transaction entries
      const existingPayment = await transactions.findOne({ stripeSessionId: sessionId });
      if (!existingPayment) {
        const paymentIntentId =
          typeof session.payment_intent === 'object' && session.payment_intent !== null
            ? session.payment_intent.id
            : session.payment_intent;
        const subscriptionId =
          typeof session.subscription === 'object' && session.subscription !== null
            ? session.subscription.id
            : session.subscription;

        const transaction = {
          vendorId,
          plan: session.metadata?.plan || 'premium',
          amount: session.amount_total != null ? session.amount_total / 100 : 49,
          currency: session.currency || 'usd',
          stripeSessionId: sessionId,
          stripeSubscriptionId: subscriptionId || paymentIntentId || null,
          status: session.payment_status || 'paid',
          createdAt: new Date(),
        };

        await transactions.insertOne(transaction);

        // Upgrade vendor to Premium
        if (vendorId) {
          const query = ObjectId.isValid(vendorId) ? { _id: new ObjectId(vendorId) } : { _id: vendorId };
          await users.updateOne(query, {
            $set: {
              subscriptionPlan: 'premium',
              premium: true,
            },
          });

          await services.updateMany(
            { vendorId },
            { $set: { isPremium: true } }
          );
        }
      }
    } catch (error) {
      console.error("Webhook database update error:", error);
    }
  }
  res.json({ received: true });
});

// middleware
app.use(express.json());
app.use(cors());


const client = new MongoClient(process.env.MONGODB_URI);

export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.error("Failed to connect to MongoDB:", err);
    process.exit(1);
  }
}
const connectedClient = await connectToMongoDB();
// DB Collections
const database = connectedClient.db("wedplandb");
const users = database.collection("user");
const sessions = database.collection("session");
const services = database.collection("services");
const bookings = database.collection("bookings");
const transactions = database.collection("transactions");

// Remote JWKS Configuration for Better Auth JWT
const clientUrl = process.env.CLIENT_URL || "http://localhost:3000";
const JWKS = createRemoteJWKSet(new URL(`${clientUrl}/api/auth/jwks`));

// Verify Token (JWT) Middleware
const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).send({ message: "Unauthorized: No token provided" });
  }
  const token = authHeader.split(" ")[1];
  if (!token) {
    return res.status(401).send({ message: "Unauthorized: Invalid token format" });
  }

  try {
    // Verify JWT with Better Auth JWKS
    const { payload } = await jwtVerify(token, JWKS);

    // Fetch authentic user record from database
    let user = null;
    if (payload.email) {
      user = await users.findOne({ email: payload.email });
    } else if (payload.sub) {
      const query = ObjectId.isValid(payload.sub) ? { _id: new ObjectId(payload.sub) } : { _id: payload.sub };
      user = await users.findOne(query);
    }

    if (!user) {
      return res.status(401).send({ message: "Unauthorized: User not found" });
    }

    // Blocked Account Check
    if (user.isBlocked) {
      return res.status(403).send({ message: "Forbidden: Account is blocked" });
    }

    req.user = user;
    req.userId = (user._id || user.id || "").toString();
    req.userRole = (user.role || "").toLowerCase();
    
    next();
  } catch (error) {
    return res.status(401).send({ message: "Unauthorized: Invalid or expired token" });
  }
};


//  Verify Role Handler
const verifyRole = (allowedRoles) => (req, res, next) => {
  if (!allowedRoles.includes(req.userRole)) {
    return res.status(403).send({ message: "Forbidden: No permissions" });
  }
  next();
};

// Get all users
app.get('/users', verifyToken, verifyRole(["admin"]), async(req, res) => {
    const cursor = users.find({});
    const result = await cursor.toArray();
    res.send(result);
})

// Get Premium Users
app.get('/users/:id/premium', verifyToken, async (req, res) => {
  const id = req.params.id;
  if (id !== req.userId && req.userRole !== 'admin') {
    return res.status(403).send({ message: 'Forbidden' });
  }
  const query = ObjectId.isValid(id) ? { _id: new ObjectId(id) } : { _id: id };
  const result = await users.findOne(query, { projection: { premium: 1, subscriptionPlan: 1 } });
  const isPremium = Boolean(result?.premium || result?.subscriptionPlan === 'premium');
  res.send({premium: isPremium});
})

// Update Users Role
app.patch('/users/:id/role', verifyToken, verifyRole(["admin"]), async(req, res) => {
  const id = req.params.id;
  const { role } = req.body;
  if (!ObjectId.isValid(id)) {
    return res.status(400).send({ message: 'Invalid user ID' });
  }
  if (id === req.userId) {
    return res.status(400).send({ message: 'You cannot change your own role' });
  }
  if (!['customer', 'vendor', 'admin'].includes(role)) {
    return res.status(400).send({ message: 'Invalid role' });
  }
  const query = { _id: new ObjectId(id) };
  const updatedDoc = {
    $set: {
      role: role,
    }
  }
  const result = await users.updateOne(query, updatedDoc);

  // Invalidate active sessions so role change takes effect immediately
  await sessions.deleteMany({
    $or: [{ userId: id }, { userId: new ObjectId(id) }],
  });

  res.send(result);
})

// Update User Block / Unblock Status
app.patch('/users/:id/block', verifyToken, verifyRole(["admin"]), async (req, res) => {
  try {
    const id = req.params.id;
    const { isBlocked } = req.body;
    if (typeof isBlocked !== 'boolean') {
      return res.status(400).send({ message: 'Invalid account status value' });
    }
    const query = ObjectId.isValid(id) ? { _id: new ObjectId(id) } : { _id: id };
    const targetUser = await users.findOne(query);

    if (!targetUser) {
      return res.status(404).send({ message: 'User not found' });
    }
    if (targetUser.role === 'admin' && isBlocked) {
      return res.status(400).send({ message: 'Admin accounts cannot be blocked' });
    }

    const result = await users.updateOne(query, { $set: { isBlocked } });

    // Invalidate active sessions immediately when blocked
    if (isBlocked) {
      await sessions.deleteMany({
        $or: [{ userId: id }, { userId: new ObjectId(id) }],
      });
    }

    res.send({ success: true, isBlocked, result });
  } catch (error) {
    res.status(500).send({ message: 'Failed to update user block status' });
  }
});

// Sync updated profile info to vendor's existing services
app.patch('/users/profile/sync', verifyToken, verifyRole(["vendor"]), async (req, res) => {
  try {
    const vendorName = req.user.name || "Verified Vendor";
    const businessName = req.user.businessName || vendorName;
    const vendorAvatar = req.user.image || "";

    const result = await services.updateMany(
      { vendorId: req.userId },
      { $set: { vendorName, businessName, vendorAvatar } }
    );
    res.send(result);
  } catch (error) {
    console.error("Error syncing vendor profile:", error);
    res.status(500).send({ message: "Failed to sync vendor services" });
  }
});

// Check whether a service's vendor is currently blocked
const isVendorBlocked = async (vendorId) => {
  if (!vendorId) return false;
  const vendorQuery = ObjectId.isValid(vendorId)
    ? { _id: new ObjectId(vendorId) }
    : { _id: vendorId };
  const vendorUser = await users.findOne(vendorQuery, { projection: { isBlocked: 1 } });
  return Boolean(vendorUser?.isBlocked);
};

// Bookings Related APIs
// Post Bookings
app.post('/bookings', verifyToken, verifyRole(["customer"]), async (req, res) => {
  try {
    const bookingData = req.body;

    // Validate required fields and upcoming event date
    const eventDate = bookingData.eventDate?.trim();
    const todayStr = new Date().toISOString().split("T")[0];
    if (!ObjectId.isValid(bookingData.serviceId) || !eventDate || !bookingData.eventLocation?.trim()) {
      return res.status(400).send({ message: "Valid service, date, and location are required" });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate) || eventDate < todayStr) {
      return res.status(400).send({ message: "Please select a valid upcoming event date" });
    }

    // Fetch service from database and verify availability
    const service = await services.findOne({ _id: new ObjectId(bookingData.serviceId) });
    if (!service) {
      return res.status(404).send({ message: "Service not found" });
    }
    const serviceStatus = (service.status || "").toLowerCase();
    if (serviceStatus !== "active" && serviceStatus !== "approved") {
      return res.status(400).send({ message: "This service is not available for booking" });
    }
    if (service.isAvailable === false) {
      return res.status(400).send({ message: "This service is currently paused by the vendor" });
    }
    if (await isVendorBlocked(service.vendorId)) {
      return res.status(400).send({ message: "This vendor is currently unavailable for booking" });
    }

    // Prevent customers from booking their own services
    if (service.vendorId === req.userId) {
      return res.status(400).send({ message: "You cannot book your own service" });
    }

    // Prevent duplicate active booking requests
    const query = {
      serviceId: bookingData.serviceId,
      eventDate: bookingData.eventDate.trim(),
      status: { $in: ["Pending", "Accepted"] },
    };
    const alreadyBooked = await bookings.findOne(query);

    if (alreadyBooked) {
      return res.status(400).send({ message: "This date is already booked for this service" });
    }

    // Override sensitive fields with server-verified data
    delete bookingData._id;
    bookingData.customerId = req.userId;
    bookingData.customerEmail = req.user.email;
    bookingData.customerName = req.user.name || "Customer";
    bookingData.vendorId = service.vendorId;
    bookingData.vendorEmail = service.vendorEmail;
    bookingData.vendorName = service.vendorName || "";
    bookingData.businessName = service.businessName || "";
    bookingData.servicePrice = service.price;
    bookingData.status = "Pending";
    bookingData.createdAt = new Date();

    const result = await bookings.insertOne(bookingData);
    res.send(result);
  } catch (error) {
    console.error("Error creating booking:", error);
    res.status(500).send({ message: "Failed to create booking" });
  }
});


// Get Bookings 
app.get('/bookings', verifyToken, async (req, res) => {
  try {
    const query = {};
    if (req.userRole === 'customer') {
      query.customerId = req.userId;
    } else if (req.userRole === 'vendor') {
      query.vendorId = req.userId;
      if (req.query.serviceId) {
        if (!ObjectId.isValid(req.query.serviceId)) {
          return res.status(400).send({ message: 'Invalid service ID' });
        }
        query.serviceId = req.query.serviceId;
      }
    } else if (req.userRole === 'admin') {
      if (req.query.email || req.query.customerEmail) {
        query.customerEmail = req.query.email || req.query.customerEmail;
      }
      if (req.query.vendorId) {
        query.vendorId = req.query.vendorId;
      }
      if (req.query.serviceId) {
        if (!ObjectId.isValid(req.query.serviceId)) {
          return res.status(400).send({ message: 'Invalid service ID' });
        }
        query.serviceId = req.query.serviceId;
      }
    } else {
      return res.status(403).send({ message: 'Forbidden' });
    }
    const result = await bookings.find(query).sort({ _id: -1 }).toArray();
    res.send(result);
  } catch (error) {
    console.error("Error fetching bookings:", error);
    res.status(500).send({ message: "Failed to fetch bookings" });
  }
});

// Update / Cancel Booking Status
app.patch('/bookings/:id', verifyToken, async (req, res) => {
  try {
    const id = req.params.id;
    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ message: "Invalid booking ID" });
    }
    const query = { _id: new ObjectId(id) };
    const booking = await bookings.findOne(query);

    if (!booking) {
      return res.status(404).send({ message: "Booking not found" });
    }

    // Only pending bookings can be updated
    if ((booking.status || "").toLowerCase() !== "pending") {
      return res.status(400).send({ message: "Only pending bookings can be updated" });
    }

    const { status } = req.body;

    // 1. Vendor can accept or reject bookings for their own services
    if (req.userRole === "vendor") {
      if (booking.vendorId !== req.userId) {
        return res.status(403).send({ message: "Forbidden: You can only update bookings for your own services" });
      }
      if (status !== "Accepted" && status !== "Rejected") {
        return res.status(400).send({ message: "Vendors can only Accept or Reject bookings" });
      }
      const result = await bookings.updateOne(query, { $set: { status } });
      return res.send(result);
    }

    // 2. Customer can only cancel their own bookings
    if (req.userRole === "customer") {
      if (booking.customerId !== req.userId) {
        return res.status(403).send({ message: "Forbidden: You can only cancel your own bookings" });
      }
      if (status !== "Cancelled") {
        return res.status(403).send({ message: "Forbidden: Customers can only cancel bookings" });
      }
      const result = await bookings.updateOne(query, { $set: { status: "Cancelled" } });
      return res.send(result);
    }

    return res.status(403).send({ message: "Forbidden" });
  } catch (error) {
    console.error("Error updating booking:", error);
    res.status(500).send({ message: "Failed to update booking status" });
  }
});

// Escape special regex characters for safe MongoDB search
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Service Related APIs
// Get Public Services (Browse Services - filtered by search, category, location, and sort)
app.get('/services', async (req, res) => {
  const blockedVendors = await users
    .find({ isBlocked: true }, { projection: { _id: 1 } })
    .toArray();
  const blockedVendorIds = blockedVendors.map((vendorUser) => vendorUser._id.toString());

  const query = {
    status: { $in: ["Active", "active", "Approved", "approved"] },
    isAvailable: { $ne: false },
    ...(blockedVendorIds.length > 0 ? { vendorId: { $nin: blockedVendorIds } } : {}),
  };

  if (req.query) {
    if (req.query.category && req.query.category !== 'All' && req.query.category !== 'All Categories') {
      query.category = req.query.category;
    }
    if (req.query.location && req.query.location.trim()) {
      const safeLocation = escapeRegex(req.query.location.trim());
      query.location = { $regex: safeLocation, $options: 'i' };
    }
    if (req.query.search && req.query.search.trim()) {
      const safeSearch = escapeRegex(req.query.search.trim());
      query.$or = [
        { serviceName: { $regex: safeSearch, $options: 'i' } },
        { vendorName: { $regex: safeSearch, $options: 'i' } },
        { businessName: { $regex: safeSearch, $options: 'i' } },
        { category: { $regex: safeSearch, $options: 'i' } },
        { location: { $regex: safeSearch, $options: 'i' } },
        { description: { $regex: safeSearch, $options: 'i' } },
      ];
    }
  }
  let sortOption = { isPremium: -1, _id: -1 };
  if (req.query.sort === 'price-low') {
    sortOption = { price: 1 };
  } else if (req.query.sort === 'price-high') {
    sortOption = { price: -1 };
  }
  const cursor = services.find(query, { projection: { vendorEmail: 0 } }).sort(sortOption);
  const result = await cursor.toArray();
  res.send(result);
});

// Get Services Count (all or filtered by vendorId)
app.get('/services/count', verifyToken, verifyRole(["vendor"]), async (req, res) => {
  try {
    const count = await services.countDocuments({
      vendorId: req.userId,
      status: { $ne: "Rejected" },
    });
    res.send({ count });
  } catch (error) {
    console.error("Error counting services:", error);
    res.status(500).send({ count: 0, message: "Failed to count services" });
  }
});

// Get Service Details With Error Handling
app.get('/services/:id', verifyToken, async (req, res) => {
  try {
    const id = req.params.id;
    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ message: "Invalid service ID" });
    }
    const service = await services.findOne({ _id: new ObjectId(id) });
    if (!service) {
      return res.status(404).send({ message: "Service not found" });
    }
    const status = (service.status || "").toLowerCase();
    const isApproved = status === "active" || status === "approved";
    const isOwner = service.vendorId === req.userId;
    if (!isApproved && !isOwner && req.userRole !== "admin") {
      return res.status(403).send({ message: "Forbidden: Service is not available" });
    }
    if (!isOwner && req.userRole !== "admin" && (await isVendorBlocked(service.vendorId))) {
      return res.status(403).send({ message: "Forbidden: Service is not available" });
    }
    res.send(service);
  } catch (error) {
    console.error("Error fetching service details:", error);
    res.status(500).send({ message: "Failed to fetch service" });
  }
});

// Get Services (vendor-filtered)   
app.get('/my-services',verifyToken, verifyRole(['vendor']), async (req, res) => {
  const result = await services
    .find({ vendorId: req.userId })
    .sort({ _id: -1 })
    .toArray();
  res.send(result);
});

// Post Services 
app.post('/services', verifyToken, verifyRole(["vendor"]), async(req, res) => {
  const service = req.body;
  if (
    !service.serviceName ||
    !service.category ||
    !service.location ||
    !service.description ||
    Number(service.price) <= 0 ||
    Number.isNaN(Number(service.price)) ||
    !Array.isArray(service.images) ||
    service.images.length === 0
  ) {
    return res.status(400).send({ message: 'Please provide valid service details, price, and at least one image' });
  }
  const vendorId = req.userId;

  // Free plan limit: max 3 services
  const isPremium = Boolean(req.user.premium || req.user.subscriptionPlan === 'premium');
  if (!isPremium) {
    const count = await services.countDocuments({
      vendorId,
      status: { $ne: "Rejected" },
    });
    if (count >= 3) {
      return res.status(403).send({
        limitReached: true,
        message: 'Free plan limit reached. Free vendors can publish a maximum of 3 active services. Please upgrade to Premium for unlimited listings.',
      });
    }
  }

  delete service._id;
  service.price = Number(service.price);
  service.vendorId = req.userId;
  service.vendorEmail = req.user.email;
  service.vendorName = req.user.name || "Verified Vendor";
  service.businessName = req.user.businessName || req.user.name || "Wedding Specialist";
  service.vendorAvatar = req.user.image || "";
  service.status = 'Pending';
  service.isAvailable = true;
  service.isPremium = isPremium;
  service.createdAt = new Date();

  const result = await services.insertOne(service);
  res.send(result);
})

// Delete Service
app.delete('/services/:id', verifyToken, verifyRole(["vendor", "admin"]), async(req, res) => {
  const id = req.params.id;
  if (!ObjectId.isValid(id)) return res.status(400).send({ message: "Invalid service ID" });
  const query = { _id: new ObjectId(id) };

  const service = await services.findOne(query);
  if (!service) {
    return res.status(404).send({ message: 'Service not found' });
  }

  // Ownership verification
  const isOwner = service.vendorId === req.userId;
  if (!isOwner && req.userRole !== 'admin') {
    res.status(403).send({ message: 'Forbidden' });
    return;
  }

  const result = await services.deleteOne(query);
  res.send(result);
})

// Update / Edit Service With Error Handling
app.patch('/services/:id', verifyToken, verifyRole(['admin', 'vendor']), async (req, res) => {
  try {
    const id = req.params.id;
    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ message: "Invalid service ID" });
    }

    const query = { _id: new ObjectId(id) };
    const service = await services.findOne(query);

    if (!service) {
      return res.status(404).send({ message: 'Service not found' });
    }

    // Ownership verification
    const isOwner = service.vendorId === req.userId;
    if (!isOwner && req.userRole !== 'admin') {
      res.status(403).send({ message: 'Forbidden' });
      return;
    }

    const updateData = {};
    if (req.userRole === 'admin') {
      const allowedStatuses = ['Pending', 'Active', 'Approved', 'Paused', 'Rejected'];
      if (req.body.status && !allowedStatuses.includes(req.body.status)) {
        return res.status(400).send({ message: "Invalid service status" });
      }
      if (req.body.status) updateData.status = req.body.status;
    } else {
      const allowedFields = ['serviceName', 'category', 'pricingType', 'price', 'location', 'description', 'images', 'isAvailable'];
      for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
          if (field === 'price') {
            const parsedPrice = Number(req.body.price);
            if (Number.isNaN(parsedPrice) || parsedPrice <= 0) {
              return res.status(400).send({ message: "Price must be greater than 0" });
            }
            updateData.price = parsedPrice;
          } else {
            updateData[field] = req.body[field];
          }
        }
      }
    }
    delete updateData._id;

    if (Object.keys(updateData).length === 0) {
      return res.status(400).send({ message: 'No valid fields to update' });
    }
    const result = await services.updateOne(query, { $set: updateData });
    res.send(result);
  } catch (error) {
    console.error("Error updating service:", error);
    res.status(500).send({ message: "Failed to update service" });
  }
});

// Get All Services for Admin
app.get('/admin/services', verifyToken, verifyRole(["admin"]), async (req, res) => {
  try {
    const cursor = services.find({}).sort({ _id: -1 });
    const result = await cursor.toArray();
    res.send(result);
  } catch (error) {
    console.error("Error fetching admin services:", error);
    res.status(500).send({ message: "Failed to fetch admin services" });
  }
});

// Get All Transactions for Admin
app.get('/admin/transactions', verifyToken, verifyRole(["admin"]), async (req, res) => {
  try {
    const result = await transactions.find({}).sort({ _id: -1 }).toArray();
    const vendorIds = [
      ...new Set(result.map((item) => item.vendorId).filter((id) => ObjectId.isValid(id))),
    ];
    const vendorDocs = vendorIds.length > 0
      ? await users
          .find(
            { _id: { $in: vendorIds.map((id) => new ObjectId(id)) } },
            { projection: { name: 1, email: 1, businessName: 1 } }
          )
          .toArray()
      : [];
    const vendorMap = new Map(vendorDocs.map((vendor) => [vendor._id.toString(), vendor]));

    const enrichedTransactions = result.map((item) => {
      const vendor = vendorMap.get(item.vendorId);
      return {
        ...item,
        vendorName: vendor?.businessName || vendor?.name || "Vendor Account",
        vendorEmail: vendor?.email || "",
      };
    });

    res.send(enrichedTransactions);
  } catch (error) {
    console.error("Error fetching admin transactions:", error);
    res.status(500).send({ message: "Failed to fetch admin transactions" });
  }
});

// Payments related APIs (Verify Transaction for Success Page - Read-Only)
app.post('/transactions/checkout-verify', verifyToken, verifyRole(["vendor"]), async (req, res) => {
  try {
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).send({ success: false, message: 'Session ID is required' });
    }
    // Find the transaction record
    const transaction = await transactions.findOne({ stripeSessionId: sessionId });
    if (transaction) {
      if (transaction.vendorId && transaction.vendorId !== req.userId) {
        return res.status(403).send({ success: false, message: 'Forbidden: Not your transaction' });
      }
      return res.send({ success: true, transaction });
    }

    // If webhook hasn't finished writing yet, check directly with Stripe for receipt display
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const sessionVendorId = session.metadata?.vendorId;
    if (sessionVendorId && sessionVendorId !== req.userId) {
      return res.status(403).send({ success: false, message: 'Forbidden: Not your checkout session' });
    }

    if (session.status === 'complete' && session.payment_status === 'paid') {
      const paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : null;
      const subscriptionId = typeof session.subscription === 'string' ? session.subscription : null;
      const pendingTransaction = {
        vendorId: req.userId,
        plan: session.metadata?.plan || 'premium',
        amount: session.amount_total != null ? session.amount_total / 100 : 49,
        currency: session.currency || 'usd',
        stripeSessionId: session.id,
        stripeSubscriptionId: subscriptionId || paymentIntentId || null,
        status: session.payment_status,
        createdAt: new Date(),
      };
      return res.send({ success: true, transaction: pendingTransaction });
    }

    return res.status(404).send({ success: false, message: 'Transaction not found or unpaid' });
  } catch (error) {
    console.error("Error retrieving checkout session:", error);
    res.status(500).send({ success: false, message: error.message });
  }
});


app.post('/create-checkout-session', verifyToken, verifyRole(["vendor"]), async (req, res) => {
  try {
    const vendor = req.user;
    if (!vendor) {
      return res.status(404).json({ error: 'Vendor not found' });
    }
    if (vendor.subscriptionPlan === 'premium' || vendor.premium) {
      return res.status(400).json({ error: 'You are already a premium vendor' });
    }
    const session = await stripe.checkout.sessions.create({
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'WedPlan Premium Vendor Membership',
              description: 'Lifetime unlimited wedding service listings',
            },
            unit_amount: 4900,
          },
          quantity: 1,
        },
      ],
      customer_email: vendor.email, 
      success_url: `${clientUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${clientUrl}/checkout/cancel`,
      mode: 'payment',
      allowed_payment_method_types: ['card'],
      metadata: {
        vendorId: vendor._id.toString(),
        plan: 'premium',
      }
    })
    res.send({ success: true, message: "Checkout session created", url: session.url , sessionId: session.id});
  } catch (error) {
    console.error('Error creating checkout session:', error);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
})

app.get('/', (req, res) => {
    res.send('Hello from WedPlan Server');
})

// Central Error Handler
app.use((err, req, res, next) => {
  console.error("Server Error:", err);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).send({ message: err.message || "Internal Server Error" });
});

app.listen(port, () => {
    console.log(`WedPlan is running on port ${port}`);
})

export default app;