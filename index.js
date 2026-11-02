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
// ===== STUDIO ROUTES (commits 4-5) =====
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