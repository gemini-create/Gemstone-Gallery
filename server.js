//access env file 
require("dotenv").config()

const express= require("express")
const app=express()

const db=require("better-sqlite3")("Gemstones.db")
db.pragma("journal_mode=WAL")

const bcrypt=require("bcrypt")

const jwt=require("jsonwebtoken")

const cookieParser=require("cookie-parser")

//Creating Tables
const createTables = db.transaction(() => {
    db.prepare(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password TEXT NOT NULL,
            isAdmin INTEGER DEFAULT 0
        )
    `).run();

    
    db.prepare(`
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT NOT NULL,
            price REAL NOT NULL,
            image TEXT NOT NULL
        )
    `).run();

    db.prepare(`
        CREATE TABLE IF NOT EXISTS cart (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            userid INTEGER NOT NULL,
            productid INTEGER NOT NULL,
            quantity INTEGER NOT NULL DEFAULT 1,
            FOREIGN KEY(userid) REFERENCES users(id),
            FOREIGN KEY(productid) REFERENCES products(id)
        )
    `).run();

    db.prepare(`
        CREATE TABLE IF NOT EXISTS customerInfo (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            userid INTEGER NOT NULL,
            fullname TEXT NOT NULL,
            email TEXT NOT NULL,
            phone TEXT NOT NULL,
            address TEXT NOT NULL,
            city TEXT NOT NULL,
            zip TEXT NOT NULL,
            FOREIGN KEY(userid) REFERENCES users(id)
        )
    `).run();

        db.prepare(`
        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            userid INTEGER NOT NULL,
            orderDate TEXT NOT NULL DEFAULT (datetime('now')),
            total REAL NOT NULL,
            FOREIGN KEY(userid) REFERENCES users(id)
        )
    `).run();

    db.prepare(`
        CREATE TABLE IF NOT EXISTS orderItems (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            orderid INTEGER NOT NULL,
            productid INTEGER NOT NULL,
            quantity INTEGER NOT NULL,
            price REAL NOT NULL,
            FOREIGN KEY(orderid) REFERENCES orders(id),
            FOREIGN KEY(productid) REFERENCES products(id)
        )
    `).run();

});

createTables();

app.set("view engine","ejs")

app.use(express.static("public"))

app.use(express.urlencoded({extended:false}))

app.use(cookieParser())

app.use(function(req,res,next){
    res.locals.orderMessage=[]

    //TRY TO DECODE INCOMING COOKIE
    try{
        const decoded=jwt.verify(req.cookies.gem,process.env.JWTSECRET)
        req.user=decoded
    }
    catch(err)
    {
        req.user=false
    }
    res.locals.user=req.user //help frontend know who is logged in.
    console.log(req.user) 
    next()
})

function adminOnly(req, res, next) {
    // req.user was set from the JWT cookie in  middleware already
    if (!req.user || !req.user.admin) {
        // If user is not logged in OR isAdmin is false
        return res.status(403).send("Access denied. Admins only.");
    }
    
    next();
}

//HOME
app.get("/",(req,res)=>{
    res.render("home");
})

//SHOP
app.get("/shop", (req, res) => {
    const products = db.prepare("SELECT * FROM products").all();
    res.render("shop", { products }); 
});

//CART
app.get("/cart",(req,res)=>{
    if (!req.user)
         return res.redirect("login")

    const items=db.prepare(`SELECT cart.id AS cartid,products.*,cart.quantity FROM cart 
                            Join products ON cart.productid==products.id WHERE cart.userid=?`).all(req.user.userid);

    res.render("cart", { items });
})

//Adding Cart
app.post("/cart/add",(req,res)=>{

    if(!req.user)
     res.redirect("/login")

    const productId=req.body.productId 

    const productExist=db.prepare(`SELECT * FROM cart WHERE userid=? AND productid=?`).get(req.user.userid,productId);

    if (productExist)
    {
        db.prepare(`UPDATE cart SET quantity=quantity+1 WHERE id=?`).run(productExist.id)
    }
    else 
    {
        // If not, insert new entry
        db.prepare("INSERT INTO cart (userid, productid, quantity) VALUES (?, ?, ?)").run(req.user.userid, productId, 1);
    }
    res.redirect("/cart"); 
})

//Remove From Cart
app.post("/cart/remove", (req, res) => {
    if (!req.user)   res.redirect("/login")

    const cartId = req.body.cartid;

    const cartItem = db.prepare("SELECT quantity FROM cart WHERE id = ? AND userid = ?").get(cartId, req.user.userid);

    if (cartItem) {
        if (cartItem.quantity > 1) {
            db.prepare("UPDATE cart SET quantity = quantity - 1 WHERE id = ? AND userid = ?")
              .run(cartId, req.user.userid);
        } else {
            db.prepare("DELETE FROM cart WHERE id = ? AND userid = ?")
              .run(cartId, req.user.userid);
        }
    }
    res.redirect("/cart");
});

//ABOUT
app.get("/about",(req,res)=>{
    res.render("about")
})

//Admin
app.get("/admin",adminOnly,(req,res)=>{
    res.render("admin")
})

//Add Products
app.get("/add",adminOnly,(req,res)=>{
    res.render("add",{errors:[]})
})

app.post("/add",adminOnly,(req,res)=>{
    const  name=req.body.productname;
    const description=req.body.description;
    const price=req.body.price;
    const image=req.body.image;

    const errors = [];

    if (!name || !description || !price||!image) errors.push("All fields  are required");
    if (isNaN(price)) errors.push("Price must be a number");

    if (errors.length > 0) return res.render("add", { errors });

    const add = db.prepare("INSERT INTO products (name, description, price,image) VALUES (?, ?, ?,?)");
    add.run(name, description, parseFloat(price),image);

    res.redirect("/view");
});

//View Products
app.get("/view", adminOnly, (req, res) => {
    const products = db.prepare("SELECT * FROM products").all();
    console.log(products);
    res.render("view", { products });
});

//Update Products
app.get("/update/:id", adminOnly, (req, res) => {
    const product = db.prepare("SELECT * FROM products WHERE id = ?").get(req.params.id);

    if (!product) 
        return res.status(404).send("Product not found");

    res.render("update", { product });
});

app.post("/update/:id", adminOnly, (req, res) => {
    const  name=req.body.productname;
    const description=req.body.description;
    const price=req.body.price;

    const update = db.prepare("UPDATE products SET name = ?, description = ?, price = ? WHERE id = ?");
    update.run(name, description, parseFloat(price), req.params.id);
    res.redirect("/view");
});

//Delete Products
app.get("/delete/:id", adminOnly, (req, res) => {
    db.prepare("DELETE FROM products WHERE id = ?").run(req.params.id);
    res.redirect("/view");
});


//View Customers 
app.get('/viewCustomers', (req, res) => {
    const customers = db.prepare('SELECT * FROM customerInfo').all();
    // Render the customers page with the data
    res.render('viewCustomers', { customers });
});

//Login
app.get("/login",(req,res)=>{
    res.render("login",{ errors:[] })
})

app.post("/login",(req,res)=>{
    let errors=[]

    if(typeof req.body.username!=="string")
        req.body.username=""
    if(typeof req.body.password!=="string")
        req.body.password=""

    if(req.body.username.trim()=="") errors.push("INVALID USERNAME");
    if(req.body.password=="") errors.push("INVALID PASSWORD");

    if(errors.length){
    return res.render("login",{errors})}

    const searchuserquery=db.prepare("SELECT * FROM users WHERE username=?");
    const searcheduser=searchuserquery.get(req.body.username);

    if(!searcheduser)
    {
        errors.push("User Does not Exist!");
        return res.render("login",{errors})
    }
    const matchOrnot=bcrypt.compareSync(req.body.password,searcheduser.password)

    if(!matchOrnot)
    {
       errors.push("INVALID PASSWORD");
        return res.render("login",{errors})
    }

    //IF PASSWORD MATCH GIVE THEM A COOKIE
    //log in a user by giving them cookie
    const token=jwt.sign({
        exp:Math.floor(Date.now()/1000)+60*60*24,
        userid:searcheduser.id,
        username:searcheduser.username,
        admin:searcheduser.isAdmin},
        process.env.JWTSECRET)

    res.cookie("gem",token,{
        httpOnly:true,
        secure:false,
        maxAge:1000*60*60*24,
        sameSite:"strict"
    })
    if(!searcheduser.isAdmin)
    res.redirect("/")
    else
    res.redirect("/admin")
})

//SIGN UP
app.get("/signup",(req,res)=>{
    res.render("signup",{errors:[]})
})

app.post("/register",(req,res)=>{
    
    const errors=[]

    if(typeof req.body.username !="string") req.body.username=""
    if(typeof req.body.password !="string") req.body.password=""

    //Username Validation
    req.body.username=req.body.username.trim()

    if(!req.body.username) 
        errors.push("You must provide a username")
    
    if (req.body.username && req.body.username.length < 5) 
        errors.push("Username should be atleast 5 characters long")
    
    if(req.body.username && req.body.username.length > 10) 
        errors.push("Username should not exceed 10 characters.")

    if(req.body.username && ! /^[a-zA-Z0-9_.]+$/.test(req.body.username)) 
        errors.push("Username can only contain uppercase,lowercase,digits[0-9],underscore[-] or period(.)")

    const checkTakenUsernameQuery=db.prepare("SELECT * FROM users WHERE username=?");
    const checkTakenUsername=checkTakenUsernameQuery.get(req.body.username);

    if(checkTakenUsername)
        errors.push("Username already exists!")

    //Password Validation
    if (!req.body.password)
        errors.push("You must provide  password!")
                
    //Minlength
    if (req.body.password && req.body.password.length < 8)            
        errors.push("Password should atleast be 8 characters long")
    //Maxlength
    if (req.body.password && req.body.password.length>12)          
        errors.push("Password should not exceed more than 12 characters")

    if(errors.length)
        return res.render("signup",{errors})

    //Inserting New Users

    //Hashing Password before Storage
    const salt=bcrypt.genSaltSync(10);
    req.body.password=bcrypt.hashSync(req.body.password,salt)

    const insertUser = db.prepare(`INSERT INTO users(username,password,isAdmin) Values (?,?,0)`);
    const result=insertUser.run(req.body.username,req.body.password);

    const search=db.prepare(`SELECT * FROM users WHERE id=?`);
    const user=search.get(result.lastInsertRowid);

    //Token Creation
    const token=jwt.sign({
        exp:Math.floor(Date.now()/1000)+60*60*24,
        userid:user.id,
        username:user.username,
        isAdmin: user.isAdmin === 1
    },process.env.JWTSECRET)

    //Logging in by Cookie
    res.cookie("gem",token,{
        httpOnly:true,
        secure:false,
        sameSite:"strict",
        maxAge:1000*60*60*24
    })
        res.redirect();

})

//Logout
app.get("/logout",(req,res)=>{
    res.clearCookie("gem")
    res.redirect("/")
})

//Checkout
app.get("/checkout",(req,res)=>{
    res.render("purchase",{errors:[] ,orderMessage: null})
})

app.post("/checkout", (req, res) => {
    if (!req.user) {
        return res.status(401).send("Please login to proceed with checkout.");
    }

    const fullname = req.body.fullname;
    const email = req.body.email;
    const phone = req.body.phone;
    const address = req.body.address;
    const city = req.body.city;
    const zip = req.body.zip;

    const errors = [];

    //  VALIDATIONS 
    if (!fullname || fullname.trim().length < 3)
        errors.push("Full name must be at least 3 characters long.");
    
    if (!email || !/.+@.+\..+/.test(email))
        errors.push("Invalid email format.");

    if (email && !email.toLowerCase().endsWith("@gmail.com")) {
         errors.push("Only Gmail addresses are accepted.");
  }

    if (!phone || !/^\d{11}$/.test(phone)) // handles 03001234567 format
        errors.push("Phone number must be 11 digits.");

    if (!address || address.trim().length < 10)
        errors.push("Address must be at least 10 characters long.");

    if (!city || city.trim().length < 2)
        errors.push("City name must be valid.");

    if (!zip || !/^\d{5}$/.test(zip))
        errors.push("Postal code must be 5 digits.");

    if (errors.length > 0) {
         return res.render("purchase", { errors});
}

//INSERT INTO Db
    try {
        const insertCustomer = db.prepare(`
            INSERT INTO customerInfo(userid, fullname, email, phone, address, city, zip)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        insertCustomer.run(req.user.userid, fullname.trim(), email.trim(), phone.trim(), address.trim(), city.trim(), zip.trim());
        // redirect: 
        
    } catch (err) {
        console.error("Checkout DB error:", err.message);
        res.status(500).send("Server error. Please try again later.");
    }

    // Get cart items
        const cartItems = db.prepare(`SELECT cart.*, products.price FROM cart
            JOIN products ON cart.productid = products.id 
            WHERE cart.userid = ?`).all(req.user.userid);

    // If cart is empty
        if (cartItems.length === 0) {
            return res.status(400).send("Your cart is empty.");
        }

    // Calculate total
        const total = cartItems.reduce((sum, item) => {
            return sum + item.quantity * item.price;
        }, 0);

    // Insert order
        const insertOrder = db.prepare(` INSERT INTO orders (userid, total) VALUES (?, ?)`);
        const orderResult = insertOrder.run(req.user.userid, total);

    // Insert order items
        const insertOrderItem = db.prepare(` INSERT INTO orderItems (orderid, productid, quantity, price)VALUES (?, ?, ?, ?)`);

        for (const item of cartItems) {
            insertOrderItem.run(orderResult.lastInsertRowid, item.productid, item.quantity, item.price);
        }

    // Clear cart
        db.prepare("DELETE FROM cart WHERE userid = ?").run(req.user.userid);

    res.render("purchase", { errors: [], orderMessage: "Order made successfully!" });

});

//viewOrders
app.get("/viewOrders",adminOnly,(req,res)=>{

    const orders=db.prepare(`SELECT orders.*,users.username FROM orders 
        JOIN users ON orders.userid==users.id 
        ORDER BY orderDate DESC`).all();

    const storeOrderItems={} //empty obj that stores items in an order
    
    orders.forEach(order=>{
        const items=db.prepare(`SELECT orderItems.* ,products.name FROM orderItems 
            JOIN products ON orderItems.productid==products.id 
            WHERE orderItems.orderid=?`).all(order.id);
        
        storeOrderItems[order.id]=items;     
    })
    res.render("viewOrders",{orders,storeOrderItems});
})
app.listen(3000)