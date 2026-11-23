import express from 'express';
import cors from 'cors';
import 'dotenv/config'
import { MongoClient, ObjectId } from 'mongodb';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const app = express();
const port = process.env.PORT || 5000;

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
    console.dir(err);
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


const verifyToken = async(req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    res.status(401).send({ message: 'Unauthorized' });
    return;
  }
  const token = authHeader.split(' ')[1];
  if (!token) {
    res.status(401).send({ message: 'Unauthorized' });
    return;
  }
  const query = { token };
  const session = await sessions.findOne(query);
  if (!session) {
    res.status(401).send({ message: 'Unauthorized' });
    return;
  }

  const userId = session.userId;

  const userQuery = { _id: new ObjectId(userId) };
  const user = await users.findOne(userQuery);
  if (!user) {
    res.status(401).send({ message: 'Unauthorized' });
    return;
  }
  req.user = user;

  next();
}


// verify Customer
const verifyCustomer = (req, res, next) => {
    if (req.user?.role !== "customer") {
      res.status(403).send({ message: "Forbidden" });
      return;
    }
    next();
};

// verify Vendor
const verifyVendor = (req, res, next) => {
    if (req.user?.role !== "vendor") {
      res.status(403).send({ message: "Forbidden" });
      return;
    }
    next();
};


// verify Admin
const verifyAdmin = (req, res, next) => {
    if (req.user?.role !== "admin") {
      res.status(403).send({ message: "Forbidden" });
      return;
    }
    next();
};

// Get all users
app.get('/users', verifyToken, verifyAdmin, async(req, res) => {
    const cursor = users.find({});
    const result = await cursor.toArray();
    res.send(result);
})

// Get Premium Users
app.get('/users/:id/premium', async (req, res) => {
  const id = req.params.id;
  const query = ObjectId.isValid(id) ? { _id: new ObjectId(id) } : { _id: id };
  const result = await users.findOne(query, { projection: { premium: 1 } });
  res.send(result);
})

// Update Users Role
app.patch('/users/:id/role', verifyToken, verifyAdmin,async(req, res) => {
  const id = req.params.id;
  const query = { _id: new ObjectId(id) };
  const updatedDoc = {
    $set: {
      role: req.body.role,
    }
  }
  const result = await users.updateOne(query, updatedDoc);
  res.send(result);
})


// Bookings Related APIs
// Post Bookings
app.post('/bookings', verifyToken, verifyCustomer, async (req, res) => {
  try {
    const bookingData = req.body;

    // Prevent customers booking own services
    if (bookingData.customerEmail === bookingData.vendorEmail) {
      return res.status(400).send({ message: "You cannot book your own service" });
    }

    // Prevent duplicate booking requests
    const query = {
      serviceId: bookingData.serviceId,
      eventDate: bookingData.eventDate,
    };
    const alreadyBooked = await bookings.findOne(query);

    if (alreadyBooked) {
      return res.status(400).send({ message: "This date is already booked for this service" });
    }

    bookingData.createdAt = new Date();
    bookingData.status = bookingData.status || "Pending";
    const result = await bookings.insertOne(bookingData);
    res.send(result);
  } catch (error) {
    console.error("Error creating booking:", error);
    res.status(500).send({ message: "Failed to create booking" });
  }
});


// Get Bookings 
app.get('/bookings', verifyToken, async (req, res) => {
  const query = {};

  if (req.query.email || req.query.customerEmail) {
    query.customerEmail = req.query.email || req.query.customerEmail;
  }

  if (req.query.vendorId) {
    query.vendorId = req.query.vendorId;
  }
  if (req.query.serviceId) {
    const serviceQuery = { _id: new ObjectId(req.query.serviceId) };
    const service = await services.findOne(serviceQuery);

    if (!service) {
      return res.status(404).send({ message: 'Service not found' });
    }
    
    if (service.vendorId !== req.user._id.toString() && req.user.role !== 'admin') {
      res.status(403).send({ message: 'Forbidden' });
      return;
    }
    
    query.serviceId = req.query.serviceId;
  }
  const cursor = bookings.find(query).sort({ _id: -1 });
  const result = await cursor.toArray();
  res.send(result);
});

// Update / Cancel Booking Status
app.patch('/bookings/:id', verifyToken, async (req, res) => {
  try {
    const id = req.params.id;
    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ message: "Invalid booking ID" });
    }
    const { status } = req.body;
    const query = { _id: new ObjectId(id) };

    const result = await bookings.updateOne(query, { $set: { status } });
    res.send(result);
  } catch (error) {
    console.error("Error updating booking:", error);
    res.status(500).send({ message: "Failed to update booking status" });
  }
});

// Service Related APIs
// Get Public Services (Browse Services - filtered by search, category, location, and sort) & pending status filter
app.get('/services', async (req, res) => {
  const query = {
    status: { $nin: ["Pending", "pending", "Rejected", "rejected"] },
  };

  if (req.query) {
    if (req.query.category && req.query.category !== 'All' && req.query.category !== 'All Categories') {
      query.category = req.query.category;
    }
    if (req.query.location) {
      query.location = { $regex: req.query.location, $options: 'i' };
    }
    if (req.query.search) {
      query.$or = [
        { serviceName: { $regex: req.query.search, $options: 'i' } },
        { title: { $regex: req.query.search, $options: 'i' } },
        { name: { $regex: req.query.search, $options: 'i' } },
        { category: { $regex: req.query.search, $options: 'i' } },
        { location: { $regex: req.query.search, $options: 'i' } },
        { description: { $regex: req.query.search, $options: 'i' } },
      ];
    }
  }
  let sortOption = {};
  if (req.query.sort === 'price-low') {
    sortOption = { price: 1 };
  } else if (req.query.sort === 'price-high') {
    sortOption = { price: -1 };
  }
  const cursor = services.find(query).sort(sortOption);
  const result = await cursor.toArray();
  res.send(result);
});

// Get Services Count (all or filtered by vendorId)
app.get('/services/count', async (req, res) => {
  try {
    const query = {};
    if (req.query.vendorId) {
      query.vendorId = req.query.vendorId;
    }
    const result = await services.countDocuments(query);
    res.send({ count: result });
  } catch (error) {
    console.error("Error counting services:", error);
    res.status(500).send({ count: 0, message: "Failed to count services" });
  }
});

// Get Service Details With Error Handling
app.get('/services/:id', async (req, res) => {
  try {
    const id = req.params.id;
    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ message: "Invalid service ID" });
    }
    const query = { _id: new ObjectId(id) };
    const result = await services.findOne(query);
    if (!result) {
      return res.status(404).send({ message: "Service not found" });
    }
    res.send(result);
  } catch (error) {
    console.error("Error fetching service details:", error);
    res.status(500).send({ message: "Failed to fetch service" });
  }
});

// Get Services (vendor-filtered)   
app.get('/my-services', async (req, res) => {
  const query = {};
  if (req.query.vendorId) {
    query.vendorId = req.query.vendorId;
  }
  const result = await services.find(query).sort({ _id: -1 }).toArray();
  res.send(result);
});

// Post Services 
app.post('/services', verifyToken, verifyVendor, async(req, res) => {
  const service = req.body;
  const result = await services.insertOne(service);
  res.send(result);
})

// Delete Service
app.delete('/services/:id', verifyToken, verifyVendor, async(req, res) => {
  const id = req.params.id;
  const query = { _id: new ObjectId(id) };
  const result = await services.deleteOne(query);
  res.send(result);
})

// Update / Edit Service With Error Handling
app.patch('/services/:id', verifyToken, verifyVendor, async (req, res) => {
  try {
    const id = req.params.id;
    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ message: "Invalid service ID" });
    }
    const updateData = req.body;
    delete updateData._id;

    const query = { _id: new ObjectId(id) };
    const result = await services.updateOne(query, { $set: updateData });
    res.send(result);
  } catch (error) {
    console.error("Error updating service:", error);
    res.status(500).send({ message: "Failed to update service" });
  }
});

// Payments related APIs
app.post('/transactions/checkout-verify', async (req, res) => {
  try {
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).send({ success: false, message: 'Session ID is required' });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const {
      status,
      payment_status,
      customer_email,
      metadata,
      payment_intent,
    } = session;

    if (status === "complete" && payment_status === "paid") {
      const sessionQuery = { sessionId };
      const existingPayment = await transactions.findOne(sessionQuery);
      if (existingPayment) {
        console.log("Duplicate check: Payment already verified for sessionId:", sessionId);
        return res.send({ success: false, message: 'Payment already verified' });
      }

      const transactionId =
        typeof payment_intent === "object" && payment_intent !== null
          ? payment_intent.id
          : typeof payment_intent === "string"
          ? payment_intent
          : sessionId;

      const transaction = {
        sessionId,
        transactionId,
        status,
        payment_status,
        customer_email,
        userId: metadata?.userId,
        amount: session.amount_total ? session.amount_total / 100 : 49,
        currency: session.currency || "usd",
        plan: "Premium Vendor (Lifetime)",
        payment_date: new Date(),
        payment_intent,
      };

      const result = await transactions.insertOne(transaction);

      // update the user subscription status in user collection
      const userId = metadata?.userId;
      if (userId) {
        const query = ObjectId.isValid(userId) ? { _id: new ObjectId(userId) } : { _id: userId };
        const updateDoc = {
          $set: {
            subscriptionPlan: 'premium',
            premium: true,
          },
        };
        const updateResult = await users.updateOne(query, updateDoc);
        return res.send({ success: true, result, updateResult });
      }

      return res.send({ success: true, result });
    }

    res.status(400).send({ success: false, message: 'Payment verification failed' });
  } catch (error) {
    console.error("Error verifying checkout session:", error);
    res.status(500).send({ success: false, message: error.message });
  }
});


app.get('/', (req, res) => {
    res.send('Hello from WedPlan Server');
})

app.listen(port, () => {
    console.log(`WedPlan is running on port ${port}`);
})
