require("dotenv").config();
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const { MongoClient, ObjectId } = require("mongodb");

const app = express();
const port = process.env.PORT || 5000;

app.use(cors({ origin: process.env.CLIENT_URL || "http://localhost:3000", credentials: true }));
app.use(express.json());
app.use(cookieParser());

const client = new MongoClient(process.env.MONGODB_URI);
const db = client.db("studiospace");
const studios = db.collection("studios");
const bookings = db.collection("bookings");
const reviews = db.collection("reviews");
const wishlist = db.collection("wishlist");

const toId = (id) => (ObjectId.isValid(id) ? new ObjectId(id) : null);
const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

app.get("/", (req, res) => res.send("StudioSpace API is running"));

// ===== AUTH MIDDLEWARE (commit 3) =====
const verifyToken = (req, res, next) => {
  const token = req.cookies?.token;
  if (!token) return res.status(401).send({ message: "Unauthorized: please log in" });
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) return res.status(401).send({ message: "Unauthorized: invalid or expired token" });
    req.user = decoded; // { email, name }
    next();
  });
};
// ===== STUDIO ROUTES (commits 4-5) =====
app.get("/api/studios/featured", async (req, res) => {
  const data = await studios.find().sort({ rating: -1, createdAt: -1 }).limit(6).toArray();
  res.send(data);
});

app.get("/api/studios/mine", verifyToken, async (req, res) => {
  const data = await studios.find({ ownerEmail: req.user.email }).sort({ createdAt: -1 }).toArray();
  res.send(data);
});

app.get("/api/studios", async (req, res) => {
  const { search, category, sort } = req.query;
  const query = {};
  if (category) query.category = category;
  if (search) {
    const rx = { $regex: escapeRegex(search), $options: "i" };
    query.$or = [{ title: rx }, { location: rx }];
  }
  const sorts = {
    price_asc: { hourlyRate: 1 },
    price_desc: { hourlyRate: -1 },
    rating: { rating: -1 },
    newest: { createdAt: -1 },
  };
  res.send(await studios.find(query).sort(sorts[sort] || { createdAt: -1 }).toArray());
});

app.get("/api/studios/:id", async (req, res) => {
  const _id = toId(req.params.id);
  if (!_id) return res.status(400).send({ message: "Invalid studio id" });
  const studio = await studios.findOne({ _id });
  if (!studio) return res.status(404).send({ message: "Studio not found" });
  res.send(studio);
});

app.get("/api/studios/:id/reviews", async (req, res) => {
  res.send(await reviews.find({ studioId: req.params.id }).sort({ createdAt: -1 }).toArray());
});
// ===== BOOKING ROUTES (commits 6-7) =====
// ===== WISHLIST ROUTES (commit 8) =====

// ===== ERROR HANDLER & START =====
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send({ message: "Internal server error" });
});

client.connect()
  .then(() => app.listen(port, () => console.log(`Server running on port ${port}`)))
  .catch(console.error);