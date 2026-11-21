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

// Get Services (vendor-filtered)
app.get('/services', async (req, res) => {
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
