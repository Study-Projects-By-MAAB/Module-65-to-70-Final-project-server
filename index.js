const express = require("express")
const app = express()
const cors = require("cors")
const jwt = require("jsonwebtoken")
require("dotenv").config()
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY)

const formData = require("form-data")
const Mailgun = require("mailgun.js")
const mailgun = new Mailgun(formData)
const axios = require("axios")
const mg = mailgun.client({
    username: "api",
    key: process.env.MAILGUN_API_KEY || "key-yourkeyhere",
})

const port = process.env.PORT || 5000

// middleware
app.use(cors())
app.use(express.json())
app.use(express.urlencoded()) // for SSLCOMMERZ

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb")
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.wkufpua.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    },
})

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        // await client.connect()

        const userCollection = client.db("bistroDB").collection("users")
        const menuCollection = client.db("bistroDB").collection("menu")
        const reviewsCollection = client.db("bistroDB").collection("reviews")
        const cartsCollection = client.db("bistroDB").collection("carts")
        const paymentCollection = client.db("bistroDB").collection("payments")

        // jwt related api
        app.post("/jwt", async (req, res) => {
            const user = req.body
            const token = jwt.sign(user, process.env.ACCESS_SECRET_TOKEN, { expiresIn: "1h" })
            res.send({ token })
        })

        // middlewares
        const verifyToken = (req, res, next) => {
            // console.log("inside verify token", req.headers.authorization)
            if (!req.headers.authorization) {
                return res.status(401).send({ message: "unauthorized access" })
            }
            const token = req.headers.authorization.split(" ")[1]
            jwt.verify(token, process.env.ACCESS_SECRET_TOKEN, (err, decoded) => {
                if (err) {
                    return res.status(401).send({ message: "unauthorized access" })
                }
                req.decoded = decoded
                next()
            })
        }

        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email
            const query = { email: email }
            const user = await userCollection.findOne(query)
            const isAdmin = user?.role === "admin"
            if (!isAdmin) {
                return res.status(403).send({ message: "forbidden access" })
            }
            next()
        }

        // users related api
        app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
            const result = await userCollection.find().toArray()
            res.send(result)
        })

        app.get("/users/admin/:email", verifyToken, async (req, res) => {
            const email = req.params.email
            if (email !== req.decoded.email) {
                return res.status(403).send({ message: "forbidden access" })
            }

            const query = { email: email }
            const user = await userCollection.findOne(query)
            let admin = false
            if (user) {
                admin = user?.role === "admin"
            }
            res.send({ admin })
        })

        app.post("/users", async (req, res) => {
            const user = req.body
            // insert email if user doesn't exist:
            // you can do this many ways: (1. email unique, 2. upsert, 3. simple checking)
            const query = { email: user.email }

            const existingUser = await userCollection.findOne(query)
            if (existingUser) {
                return res.send({ message: "user already exist", insertedId: null })
            }

            const result = await userCollection.insertOne(user)
            res.send(result)
        })

        app.patch("/users/admin/:id", verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id
            const filter = { _id: new ObjectId(id) }
            const updatedDoc = {
                $set: {
                    role: "admin",
                },
            }
            const result = await userCollection.updateOne(filter, updatedDoc)
            res.send(result)
        })

        app.delete("/users/:id", verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id
            const query = { _id: new ObjectId(id) }
            const result = await userCollection.deleteOne(query)
            res.send(result)
        })

        // menu related api
        app.get("/menu", async (req, res) => {
            const result = await menuCollection.find().toArray()
            res.send(result)
        })

        app.get("/menu/:id", async (req, res) => {
            const id = req.params.id
            const query = { _id: new ObjectId(id) }
            const result = await menuCollection.findOne(query)
            res.send(result)
        })

        app.delete("/menu/:id", verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id
            const query = { _id: new ObjectId(id) }
            const result = await menuCollection.deleteOne(query)
            res.send(result)
        })

        app.post("/menu", verifyToken, verifyAdmin, async (req, res) => {
            const item = req.body
            const result = await menuCollection.insertOne(item)
            res.send(result)
        })

        app.patch("/menu/:id", async (req, res) => {
            const id = req.params.id
            const item = req.body
            const filter = { _id: new ObjectId(id) }
            const updatedDoc = {
                $set: {
                    ...item /* or, 
                    name: item.name,
                    recipe: item.recipe,
                    image: item.image,
                    category: item.category, */,
                },
            }
            console.log(updatedDoc)
            const result = await menuCollection.updateOne(filter, updatedDoc)
            res.send(result)
        })

        app.get("/reviews", async (req, res) => {
            const result = await reviewsCollection.find().toArray()
            res.send(result)
        })

        // carts collection
        app.get("/carts", async (req, res) => {
            const email = req.query.email
            const query = { email: email }
            const result = await cartsCollection.find(query).toArray()
            res.send(result)
        })

        app.post("/carts", async (req, res) => {
            const cartItem = req.body
            const result = await cartsCollection.insertOne(cartItem)
            res.send(result)
        })

        app.delete("/carts/:id", async (req, res) => {
            const id = req.params.id
            const query = { _id: new ObjectId(id) }
            const result = await cartsCollection.deleteOne(query)
            res.send(result)
        })

        // payment intent
        app.post("/create-payment-intent", async (req, res) => {
            const { price } = req.body
            const amount = parseInt(price * 100)
            console.log("amount", amount)
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: "usd",
                payment_method_types: ["card"],
            })
            res.send({ clientSecret: paymentIntent.client_secret })
        })

        // get for payment history
        app.get("/payments/:email", verifyToken, async (req, res) => {
            const query = { email: req.params.email }
            console.log(query)
            if (req.params.email !== req.decoded.email) {
                return res.status(403).send({ message: "forbidden access" })
            }
            const result = await paymentCollection.find(query).toArray()
            res.send(result)
        })

        // add payment history in database and delete from cart database
        app.post("/payments", async (req, res) => {
            const payment = req.body
            const paymentResult = await paymentCollection.insertOne(payment)

            // carefully delete each item from the cart
            console.log("payment info", payment)
            const query = {
                _id: {
                    $in: payment.cartIds.map((id) => new ObjectId(id)),
                },
            }
            const deleteResult = await cartsCollection.deleteMany(query)

            // send user email about payment confirmation
            mg.messages
                .create(process.env.MAIL_SENDING_DOMAIN, {
                    from: "Excited User <mailgun@sandbox-123.mailgun.org>",
                    to: ["bappyhasan9840@gmail.com"],
                    subject: "Bistro Boss Order Confirmation",
                    text: "Testing some Mailgun awesomeness!",
                    html: `
                <div>
                <h2>Thank Your for your order!</h2>
                <h4>Your Transaction ID: <strong>${payment.transactionId}</strong></h4>
                <p>We would like to get your feedback about the food</p>
                </div>`,
                })
                .then((msg) => console.log(msg)) // logs response data
                .catch((err) => console.log(err)) // logs any <error></error>

            res.send({ paymentResult, deleteResult })
        })

        // SSLCOMMERZ payment
        app.post("/create-payment", verifyToken, async (req, res) => {
            const paymentInfo = req.body
            // all calculations are here ...

            const trxId = new ObjectId().toString() // we can also generate id with another any process.
            console.log(trxId)

            // this initiateData will be dynamic.
            const initiateData = {
                store_id: "testd666859d69a4a5", // store id from SSLCOMMERZ Website
                store_passwd: "testd666859d69a4a5@ssl", // store passwd from SSLCOMMERZ Website
                total_amount: paymentInfo.amount, // total amount
                currency: "EUR",
                tran_id: trxId,
                success_url: "https://bistro-boss-server-opal-alpha.vercel.app/success-payment", // server post link
                fail_url: "https://bistro-boss-server-opal-alpha.vercel.app/fail", // server post link
                cancel_url: "https://bistro-boss-server-opal-alpha.vercel.app/cancel", // server post link
                cus_name: "Customer Name",
                cus_email: "cust@yahoo.com",
                cus_add1: "Dhaka",
                cus_add2: "Dhaka",
                cus_city: "Dhaka",
                cus_state: "Dhaka",
                cus_postcode: 1000,
                cus_country: "Bangladesh",
                cus_phone: "01711111111",
                cus_fax: "01711111111",
                shipping_method: "NO",
                product_name: "Laptop",
                product_category: "Laptop",
                product_profile: "general",
                multi_card_name: "mastercard,visacard,amexcard",
                value_a: "ref001_A",
                value_b: "ref002_B",
                value_c: "ref003_C",
                value_d: "ref004_D",
            }

            const response = await axios({
                method: "POST",
                url: "https://sandbox.sslcommerz.com/gwprocess/v4/api.php",
                data: initiateData,
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                },
            })
            // console.log(response)

            const saveData = {
                customer_name: "Dummy",
                paymentId: trxId,
                email: paymentInfo.email,
                amount: paymentInfo.amount,
                date: new Date(),
                status: "pending",
            }

            const save = await paymentCollection.insertOne(saveData)
            if (save) {
                res.send({ paymentUrl: response.data.GatewayPageURL })
            }
        })

        app.post("/success-payment", async (req, res) => {
            const successData = req.body
            if (successData.status !== "VALID") {
                throw new Error("Unauthorized payment", "Invalid payment")
            }
            // update the database on the paymentCollection
            const query = {
                paymentId: successData.tran_id,
            }
            const update = {
                $set: {
                    status: "Success",
                },
            }
            const updateData = await paymentCollection.updateOne(query, update)

            console.log("successData", successData)
            console.log("updateData", updateData)

            res.redirect("https://bistro-boss-client-blond.vercel.app/success")
        })

        app.post("/fail", async (req, res) => {
            res.redirect("https://bistro-boss-client-blond.vercel.app/fail")
        })
        app.post("/cancel", async (req, res) => {
            res.redirect("https://bistro-boss-client-blond.vercel.app/cancel")
        })

        // stats or analytics
        app.get("/admin-stats", verifyToken, verifyAdmin, async (req, res) => {
            const users = await userCollection.estimatedDocumentCount()
            const menuItems = await menuCollection.estimatedDocumentCount()
            const orders = await paymentCollection.estimatedDocumentCount()

            // this is not the best way
            // const payments = await paymentCollection.find().toArray()
            // const revenue = payments.reduce((total, item) => total + item.price, 0)

            const result = await paymentCollection
                .aggregate([
                    {
                        $group: {
                            _id: null,
                            totalRevenue: {
                                $sum: "$price",
                            },
                        },
                    },
                ])
                .toArray()
            console.log(result)
            const revenue = result.length > 0 ? result[0].totalRevenue : 0

            res.send({ users, menuItems, orders, revenue })
        })

        // order status
        /**
         * -------------------
         * Non Efficient way
         * -------------------
         * 1. load all the payments
         * 2. for every menuItemIds (which is an array), go find the item from menu collection
         * 3. for every item in the menu collection that you found from a payment entry (document)
         */

        // using aggregate pipeline
        app.get("/order-stats", verifyToken, verifyAdmin, async (req, res) => {
            const result = await paymentCollection
                .aggregate([
                    {
                        $unwind: "$menuItemIds",
                    },
                    {
                        $addFields: {
                            menuItemObjectId: { $toObjectId: "$menuItemIds" },
                        },
                    },
                    {
                        $lookup: {
                            from: "menu",
                            localField: "menuItemObjectId",
                            foreignField: "_id",
                            as: "menuItems",
                        },
                    },
                    {
                        $unwind: "$menuItems",
                    },
                    {
                        $group: {
                            _id: "$menuItems.category",
                            quantity: { $sum: 1 },
                            revenue: { $sum: "$menuItems.price" },
                        },
                    },
                    {
                        $project: {
                            _id: 0,
                            category: "$_id", // renaming _id to category
                            quantity: "$quantity",
                            revenue: "$revenue",
                        },
                    },
                ])
                .toArray()

            res.send(result)
        })

        // Send a ping to confirm a successful connection
        // await client.db("admin").command({ ping: 1 })
        // console.log("Pinged your deployment. You successfully connected to MongoDB!")
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close()
    }
}
run().catch(console.dir)

app.get("/", (req, res) => {
    res.send("boss is sitting")
})

app.listen(port, () => {
    console.log("bistro boss is sitting on port:", port)
})
