import express from 'express';
import cors from 'cors';
import 'dotenv/config'
import { MongoClient, ObjectId } from 'mongodb';

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
const services = database.collection("services");

// Get all users
app.get('/users', async(req, res) => {
    const cursor = users.find({});
    const result = await cursor.toArray();
    res.send(result);
})

// Service Related APIs
// 1. Get Public Services (Browse Services - filtered by search, category, location, and sort)
app.get('/services', async (req, res) => {
  const query = {};
  console.log('Public services query:', req.query);

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

// Get Services (vendor-filtered)
app.get('/my-services', async (req, res) => {
    const { vendorId } = req.query;
    const query = vendorId ? { vendorId } : {};
    const result = await services.find(query).toArray();
    res.send(result);
})

// Post Services 
app.post('/services', async(req, res) => {
  const service = req.body;
  const result = await services.insertOne(service);
  res.send(result);
})

// Delete Service
app.delete('/services/:id', async(req, res) => {
  const id = req.params.id;
  const query = { _id: new ObjectId(id) };
  const result = await services.deleteOne(query);
  res.send(result);
})

app.get('/', (req, res) => {
    res.send('Hello from WedPlan Server');
})

app.listen(port, () => {
    console.log(`WedPlan is running on port ${port}`);
})
