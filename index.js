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

const pickStudio = (b) => ({
  title: b.title,
  category: b.category,
  hourlyRate: Number(b.hourlyRate),
  securityDeposit: Number(b.securityDeposit) || 0,
  capacity: Number(b.capacity) || 1,
  location: b.location,
  image: b.image,
  gallery: Array.isArray(b.gallery) ? b.gallery : [],
  amenities: Array.isArray(b.amenities) ? b.amenities : [],
  overview: b.overview || "",
});

app.post("/api/studios", verifyToken, async (req, res) => {
  const b = req.body;
  if (!b.title || !b.category || !b.hourlyRate || !b.location || !b.image)
    return res.status(400).send({ message: "Please fill all required fields" });
  const doc = {
    ...pickStudio(b),
    ownerEmail: req.user.email,
    ownerName: req.user.name,
    ownerPhoto: b.ownerPhoto || "",
    rating: 0,
    reviewCount: 0,
    createdAt: new Date(),
  };
  const result = await studios.insertOne(doc);
  res.status(201).send(result);
});

app.put("/api/studios/:id", verifyToken, async (req, res) => {
  const _id = toId(req.params.id);
  if (!_id) return res.status(400).send({ message: "Invalid studio id" });
  const existing = await studios.findOne({ _id });
  if (!existing) return res.status(404).send({ message: "Studio not found" });
  if (existing.ownerEmail !== req.user.email)
    return res.status(403).send({ message: "You can only edit your own studios" });
  await studios.updateOne({ _id }, { $set: { ...pickStudio(req.body), updatedAt: new Date() } });
  res.send({ message: "Studio updated" });
});

app.delete("/api/studios/:id", verifyToken, async (req, res) => {
  const _id = toId(req.params.id);
  if (!_id) return res.status(400).send({ message: "Invalid studio id" });
  const existing = await studios.findOne({ _id });
  if (!existing) return res.status(404).send({ message: "Studio not found" });
  if (existing.ownerEmail !== req.user.email)
    return res.status(403).send({ message: "You can only delete your own studios" });
  await studios.deleteOne({ _id });
  res.send({ message: "Studio deleted" });
});

app.post("/api/studios/:id/reviews", verifyToken, async (req, res) => {
  const _id = toId(req.params.id);
  const rating = Number(req.body.rating);
  const comment = (req.body.comment || "").trim();
  if (!_id || !(rating >= 1 && rating <= 5) || !comment)
    return res.status(400).send({ message: "Provide a rating (1-5) and a comment" });
  const studio = await studios.findOne({ _id });
  if (!studio) return res.status(404).send({ message: "Studio not found" });
  if (studio.ownerEmail === req.user.email)
    return res.status(403).send({ message: "You cannot review your own studio" });
  await reviews.insertOne({
    studioId: req.params.id, userEmail: req.user.email, userName: req.user.name,
    rating, comment, createdAt: new Date(),
  });
  const agg = await reviews.aggregate([
    { $match: { studioId: req.params.id } },
    { $group: { _id: null, avg: { $avg: "$rating" }, count: { $sum: 1 } } },
  ]).toArray();
  await studios.updateOne({ _id }, { $set: { rating: Number(agg[0].avg.toFixed(1)), reviewCount: agg[0].count } });
  res.status(201).send({ message: "Review added" });
});
// ===== BOOKING ROUTES (commits 6-7) =====
app.post("/api/bookings", verifyToken, async (req, res) => {
  const { studioId, date, startTime, endTime, notes } = req.body;
  const _id = toId(studioId);
  if (!_id || !date || !startTime || !endTime)
    return res.status(400).send({ message: "Date, start time and end time are required" });
  if (toMin(endTime) <= toMin(startTime))
    return res.status(400).send({ message: "End time must be after start time" });
  if (date < new Date().toISOString().slice(0, 10))
    return res.status(400).send({ message: "You cannot book a past date" });

  const studio = await studios.findOne({ _id });
  if (!studio) return res.status(404).send({ message: "Studio not found" });
  if (studio.ownerEmail === req.user.email)
    return res.status(400).send({ message: "You cannot book your own studio" });

  // overlap: existing.start < new.end AND existing.end > new.start ("HH:MM" strings compare correctly)
  const clash = await bookings.findOne({
    studioId, date, status: "Confirmed",
    startTime: { $lt: endTime }, endTime: { $gt: startTime },
  });
  if (clash)
    return res.status(409).send({
      message: `This studio is already booked from ${clash.startTime} to ${clash.endTime} on ${date}. Please choose another slot.`,
    });

  const hours = (toMin(endTime) - toMin(startTime)) / 60;
  const doc = {
    studioId, studioTitle: studio.title, studioImage: studio.image,
    ownerEmail: studio.ownerEmail,
    userEmail: req.user.email, userName: req.user.name,
    date, startTime, endTime, hours,
    hourlyRate: studio.hourlyRate,
    totalPrice: hours * studio.hourlyRate,
    securityDeposit: studio.securityDeposit || 0,
    notes: notes || "",
    status: "Pending",
    createdAt: new Date(),
  };
  const result = await bookings.insertOne(doc);
  res.status(201).send(result);
});
// ===== WISHLIST ROUTES (commit 8) =====

// ===== ERROR HANDLER & START =====
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send({ message: "Internal server error" });
});

client.connect()
  .then(() => app.listen(port, () => console.log(`Server running on port ${port}`)))
  .catch(console.error);