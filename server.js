// app.js
const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const { Pool } = require('pg');
const fs = require('fs');

const app = express();
const PORT = 5173;




// PostgreSQL setup
const pool = new Pool({
    user: 'madhav',
    host: 'localhost',
    database: 'vaccine',
    password: 'madhav',
    port: 5432,
});



async function syncDatabase() {
  try {
    const sql = fs.readFileSync('./SQLcode/SQLcode.sql', 'utf8'); 
    await pool.query(sql);
    console.log('✅ Database synced successfully from adb.sql');
  } catch (err) {
    console.error('❌ Error syncing database:', err);
  }
}

syncDatabase();

// Middleware
app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(session({
    secret: 'your_secret_key',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } // Set to true if using HTTPS
}));

function ensureAuthenticated(req, res, next) {
    if (req.session && req.session.user) {
        return next();
    } else {
        res.redirect('/login'); // Redirect to login if not authenticated
    }
}

async function getHospitalIdByAdminId(adminId) {
    const query = 'SELECT hospital_id FROM Hospitals WHERE hospital_admin_id = $1';
    const result = await pool.query(query, [adminId]);
    return result.rows.length > 0 ? result.rows[0].hospital_id : null;
}

async function sendNotification(userId, message, status = 'pending') {
    const query = `
        INSERT INTO Notifications (user_id, message, status) 
        VALUES ($1, $2, $3)
    `;

    try {
        await pool.query(query, [userId, message, status]);
    } catch (error) {
        console.error('Error sending notification:', error);
    }
}

// Routes
app.get('/', (req, res) => {
    res.redirect('/login');
});

// Login Route
app.get('/login', (req, res) => {
    res.render('login');
});

// Registration Route
app.get('/register', async (req, res) => {
    try {
        const hospitalsQuery = 'SELECT * FROM Hospitals';
        const hospitalsResult = await pool.query(hospitalsQuery);
        const hospitals = hospitalsResult.rows;

        res.render('register', { hospitals });
    } catch (error) {
        console.error(error);
        res.send('Error fetching hospitals');
    }
});

// Logout Route
app.get('/logout', (req, res) => {
    res.render('login');
});

// Handle Registration
app.post('/register', async (req, res) => {
    const { username, password, email, role, hospital_id } = req.body;

    // Validate role
    if (!['user', 'hospital_admin'].includes(role)) {
        return res.status(400).send('Invalid role specified.');
    }

    try {
        // Check if email already exists
        const emailCheckQuery = 'SELECT * FROM Users WHERE email = $1';
        const emailCheckResult = await pool.query(emailCheckQuery, [email]);

        if (emailCheckResult.rows.length > 0) {
            // Email already exists, render registration page with warning
            const hospitalsQuery = 'SELECT * FROM Hospitals';
            const hospitalsResult = await pool.query(hospitalsQuery);
            const hospitals = hospitalsResult.rows;
            return res.render('register', { hospitals, warning: 'Email already exists. Please use a different email.' });
        }

        // If email is unique, proceed with registration
        const insertQuery = `
            INSERT INTO Users (username, password, email, role, hospital_admin_id) 
            VALUES ($1, $2, $3, $4, $5)
        `;
        await pool.query(insertQuery, [username, password, email, role, role === 'hospital_admin' ? hospital_id : null]);
        res.redirect('/login');
    } catch (error) {
        console.error(error);
        res.send('Error during registration');
    }
});

//Handle Login
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const query = 'SELECT * FROM Users WHERE username = $1';

    try {
        const result = await pool.query(query, [username]);
        
        if (result.rows.length > 0) {
            const user = result.rows[0];

            // Password validation (to be replaced with bcrypt)
            const isValidPassword = password === user.password; // Use bcrypt.compare if using hashed passwords

            if (isValidPassword) {
                req.session.user = {
                    user_id: user.user_id,
                    username: user.username,
                    role: user.role,
                    hospital_id: user.role === 'hospital_admin' ? user.hospital_id : null
                };

                return res.redirect(user.role === 'hospital_admin' ? '/admin-dashboard' : '/vaccines');
            } else {
                // Incorrect password
                return res.render('login', { warning: 'Invalid Username or password. Please try again.' });
            }
        } else {
            // Username does not exist
            return res.render('login', { warning: 'Username not found. Please register or try again.' });
        }
    } catch (error) {
        console.error(error);
        res.send('Error during login');
    }
});

// Vaccines Route
app.get('/vaccines', async (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }
    
    const query = 'SELECT * FROM Vaccines';
    
    try {
        const result = await pool.query(query);
        res.render('vaccines', { vaccines: result.rows });
    } catch (error) {
        console.error(error);
        res.send('Error fetching vaccines');
    }
});

// Add this route in app.js
app.get('/vaccines/:vaccineId/hospitals', async (req, res) => {
    const vaccineId = req.params.vaccineId;
    const cityFilter = req.query.city ? req.query.city.toLowerCase() : null;

    let query = `
        SELECT h.hospital_id, h.hospital_name, h.location, h.phone 
        FROM Hospitals h 
        JOIN Vaccine_Inventory vi ON h.hospital_id = vi.hospital_id 
        WHERE vi.vaccine_id = $1
    `;
    const values = [vaccineId];

    if (cityFilter) {
        query += ` AND LOWER(h.location) LIKE '%' || $2 || '%'`;
        values.push(cityFilter);
    }

    try {
        const result = await pool.query(query, values);
        res.render('hospitals', { hospitals: result.rows, vaccineId });
    } catch (error) {
        console.error(error);
        res.send('Error fetching hospitals');
    }
});

// Update this route in app.js
app.get('/hospitals/:hospitalId/doctors', async (req, res) => {
    const hospitalId = req.params.hospitalId;

    const query = `
        SELECT d.doctor_id, d.doctor_name, d.specialization 
        FROM Doctors d 
        WHERE d.hospital_id = $1
    `;

    try {
        const result = await pool.query(query, [hospitalId]);
        res.render('doctors', { doctors: result.rows, hospitalId });
    } catch (error) {
        console.error(error);
        res.send('Error fetching doctors');
    }
});

// Update this route in app.js
app.get('/hospitals/:hospitalId/doctors/:doctorId', async (req, res) => {
    const { hospitalId, doctorId } = req.params;
    const query = `
        SELECT vi.vaccine_id, v.vaccine_name, vi.stock_quantity, vi.expiry_date, vi.price
        FROM Vaccine_Inventory vi 
        JOIN Vaccines v ON vi.vaccine_id = v.vaccine_id 
        WHERE vi.hospital_id = $1
    `;

    try {
        const result = await pool.query(query, [hospitalId]);
        res.render('inventory', { vaccines: result.rows, hospitalId, doctorId });
    } catch (error) {
        console.error(error);
        res.send('Error fetching inventory');
    }
});

// Route to handle appointment booking
app.post('/book-appointment', async (req, res) => {
    // Check if the user is logged in
    if (!req.session.user) {
        return res.redirect('/login');
    }

    const { vaccine_id, hospital_id, doctor_id, appointment_date, appointment_time } = req.body;
    const userId = req.session.user.user_id;

    // Combine appointment date and time into a single timestamp
    const selectedDateTime = new Date(`${appointment_date}T${appointment_time}`);

    // Check if the appointment date is in the future
    const today = new Date();
    if (selectedDateTime < today) {
        return res.status(400).send('Cannot book an appointment in the past.');
    }

    const existingAppointmentQuery = `
        SELECT * FROM Appointments 
        WHERE user_id = $1 
          AND doctor_id = $2 
          AND vaccine_id = $3 
          AND hospital_id = $4 
          AND appointment_date = $5
    `;

    const appointmentInsertQuery = `
        INSERT INTO Appointments (user_id, doctor_id, vaccine_id, hospital_id, appointment_date, status) 
        VALUES ($1, $2, $3, $4, $5, 'pending')
        RETURNING appointment_id;
    `;

    const inventoryUpdateQuery = `
        UPDATE Vaccine_Inventory 
        SET stock_quantity = stock_quantity - 1 
        WHERE vaccine_id = $1 AND hospital_id = $2
    `;

    const historyInsertQuery = `
        INSERT INTO Vaccination_History (user_id, vaccine_id, hospital_id, doctor_id, date_administered) 
        VALUES ($1, $2, $3, $4, $5)
    `;

    const notificationInsertQuery = `
        INSERT INTO Notifications (user_id, message, status) 
        VALUES ($1, $2, 'sent')
    `;

    const getNamesQuery = `
        SELECT d.doctor_name, h.hospital_name 
        FROM Doctors d 
        JOIN Hospitals h ON d.hospital_id = h.hospital_id 
        WHERE d.doctor_id = $1 AND h.hospital_id = $2
    `;

    try {
        await pool.query('BEGIN');

        // Check for existing appointment
        const existingAppointment = await pool.query(existingAppointmentQuery, [userId, doctor_id, vaccine_id, hospital_id, selectedDateTime]);
        if (existingAppointment.rows.length > 0) {
            return res.status(400).send('You already have an appointment booked for this time with this doctor.');
        }

        const appointmentResult = await pool.query(appointmentInsertQuery, [userId, doctor_id, vaccine_id, hospital_id, selectedDateTime]);
        const appointment_id = appointmentResult.rows[0].appointment_id;

        await pool.query(inventoryUpdateQuery, [vaccine_id, hospital_id]);

        // Insert into vaccination history if it doesn't already exist
        const dateAdministered = selectedDateTime.toISOString().split('T')[0];
        const existingHistory = await pool.query(`
            SELECT * FROM Vaccination_History 
            WHERE user_id = $1 
              AND vaccine_id = $2 
              AND hospital_id = $3 
              AND doctor_id = $4 
              AND date_administered = $5
        `, [userId, vaccine_id, hospital_id, doctor_id, dateAdministered]);
        
        if (existingHistory.rows.length === 0) {
            await pool.query(historyInsertQuery, [userId, vaccine_id, hospital_id, doctor_id, dateAdministered]);
        }

        const namesResult = await pool.query(getNamesQuery, [doctor_id, hospital_id]);
        const doctorName = namesResult.rows[0].doctor_name;
        const hospitalName = namesResult.rows[0].hospital_name;

        const message = `Your appointment for the ${vaccine_id} vaccine at ${hospitalName} with Doctor ${doctorName} is confirmed for ${appointment_date} at ${appointment_time}.`;
        await pool.query(notificationInsertQuery, [userId, message]);

        await pool.query('COMMIT');

        res.redirect(`/review?appointment_id=${appointment_id}`);

    } catch (error) {
        await pool.query('ROLLBACK');
        console.error(error);
        res.status(500).send('Error booking appointment');
    }
});

// Add this route in app.js
app.get('/my-appointments', async (req, res) => {
    // Check if the user is logged in
    if (!req.session.user) {
        return res.redirect('/login');
    }

    const userId = req.session.user.user_id;

    const query = `
        SELECT a.appointment_id, v.vaccine_name, h.hospital_name, d.doctor_name, a.appointment_date, a.status 
        FROM Appointments a
        JOIN Vaccines v ON a.vaccine_id = v.vaccine_id
        JOIN Hospitals h ON a.hospital_id = h.hospital_id
        JOIN Doctors d ON a.doctor_id = d.doctor_id
        WHERE a.user_id = $1
    `;

    try {
        const result = await pool.query(query, [userId]);
        res.render('my-appointments', { appointments: result.rows });
    } catch (error) {
        console.error(error);
        res.send('Error fetching appointments');
    }
});

app.post('/cancel-appointment/:appointmentId', async (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }

    console.log("Cancel appointment request received:", req.params.appointmentId);

    const appointmentId = req.params.appointmentId;

    console.log("Cancel appointment request received:", appointmentId); // Debug log

    const appointmentQuery = `
        SELECT vaccine_id, hospital_id FROM Appointments WHERE appointment_id = $1 AND user_id = $2
    `;

    try {
        const appointmentResult = await pool.query(appointmentQuery, [appointmentId, req.session.user.user_id]);
        
        if (appointmentResult.rows.length === 0) {
            return res.status(404).send('Appointment not found or you do not have permission to cancel it.');
        }

        const { vaccine_id, hospital_id } = appointmentResult.rows[0];

        // Delete the appointment
        await pool.query('DELETE FROM Appointments WHERE appointment_id = $1', [appointmentId]);

        // Update the inventory
        await pool.query(`
            UPDATE Vaccine_Inventory 
            SET stock_quantity = stock_quantity + 1 
            WHERE vaccine_id = $1 AND hospital_id = $2
        `, [vaccine_id, hospital_id]);

        // Send a notification about the cancellation
        const message = `Your appointment for vaccine ID ${vaccine_id} at hospital ID ${hospital_id} has been canceled.`;
        await pool.query(`
            INSERT INTO Notifications (user_id, message, status) 
            VALUES ($1, $2, 'sent')
        `, [req.session.user.user_id, message]);

        res.send('Appointment canceled successfully!');
    } catch (error) {
        console.error(error);
        res.status(500).send('Error canceling appointment: ' + error.message);
    }
});

// Reschedule Appointment Route
app.post('/reschedule-appointment', async (req, res) => {
    // Check if the user is logged in
    if (!req.session.user) {
        return res.redirect('/login');
    }

    const { appointment_id, new_appointment_date } = req.body;

    // Check if the new appointment date is in the future
    const today = new Date();
    const selectedDate = new Date(new_appointment_date);
    
    if (selectedDate < today) {
        return res.send('Cannot reschedule to a past date.');
    }

    // Update the appointment date in the database
    const updateQuery = `
        UPDATE Appointments 
        SET appointment_date = $1, updated_at = CURRENT_TIMESTAMP 
        WHERE appointment_id = $2 AND user_id = $3
    `;


    try {
        await pool.query(updateQuery, [new_appointment_date, appointment_id, req.session.user.user_id]);
        res.redirect('/my-appointments'); // Redirect back to appointments page
    } catch (error) {
        console.error(error);
        res.send('Error rescheduling appointment');
    }
});

// Route to display user notifications and mark them as read
app.get('/notifications', async (req, res) => {
    // Check if the user is logged in
    if (!req.session.user) {
        return res.redirect('/login');
    }

    const userId = req.session.user.user_id;

    // Query to fetch notifications for the logged-in user, ordered by most recent
    const notificationsQuery = `
        SELECT notification_id, message, sent_at, status 
        FROM Notifications 
        WHERE user_id = $1 
        ORDER BY sent_at DESC
    `;

    // Query to mark all notifications as 'read' or 'delivered'
    const markAsReadQuery = `
        UPDATE Notifications 
        SET status = 'delivered' 
        WHERE user_id = $1 AND status = 'pending'
    `;

    try {
        // Fetch notifications
        const result = await pool.query(notificationsQuery, [userId]);

        // Mark notifications as read
        await pool.query(markAsReadQuery, [userId]);

        res.render('notifications', { notifications: result.rows });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error fetching notifications');
    }
});

// Add this route in app.js
app.get('/review', async (req, res) => {
    const appointmentId = req.query.appointment_id;

    // Optionally fetch appointment details to show on the review page
    const query = `
        SELECT v.vaccine_name, h.hospital_name, d.doctor_id, d.doctor_name, a.hospital_id
        FROM Appointments a
        JOIN Vaccines v ON a.vaccine_id = v.vaccine_id
        JOIN Hospitals h ON a.hospital_id = h.hospital_id
        JOIN Doctors d ON a.doctor_id = d.doctor_id
        WHERE a.appointment_id = $1
    `;

    try {
        const result = await pool.query(query, [appointmentId]);
        if (result.rows.length === 0) {
            return res.status(404).send('Appointment not found');
        }
        res.render('review', { appointment: result.rows[0] });
    } catch (error) {
        console.error(error);
        res.send('Error fetching appointment details for review');
    }
});

// Add this route in app.js
app.post('/submit-review', ensureAuthenticated, async (req, res) => {
    const { rating, review_text, hospital_id, doctor_id } = req.body;
    const userId = req.session.user.user_id;

    // Validate hospital_id and doctor_id
    if (!hospital_id || !doctor_id) {
        return res.status(400).send('Invalid hospital or doctor information.');
    }

    const insertReviewQuery = `
        INSERT INTO Reviews (user_id, hospital_id, doctor_id, rating, review_text) 
        VALUES ($1, $2, $3, $4, $5)
    `;

    try {
        await pool.query(insertReviewQuery, [userId, parseInt(hospital_id), parseInt(doctor_id), rating, review_text]);
        res.redirect('/vaccines'); // Redirect to the vaccine list after submission
    } catch (error) {
        console.error(error);
        res.send('Error submitting review');
    }
});

app.get('/admin-dashboard', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'hospital_admin') {
        return res.redirect('/login');
    }

    res.render('admin-dashboard');
});

// View Inventory
app.get('/admin/inventory', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'hospital_admin') {
        return res.redirect('/login');
    }

    try {
        const hospitalQuery = `SELECT hospital_id FROM Hospitals WHERE hospital_admin_id = $1`;
        const hospitalResult = await pool.query(hospitalQuery, [req.session.user.user_id]);
        const hospitalId = hospitalResult.rows[0].hospital_id;

        const inventoryQuery = `
            SELECT V.vaccine_name, VI.stock_quantity, VI.expiry_date, VI.inventory_id 
            FROM Vaccine_Inventory VI 
            JOIN Vaccines V ON VI.vaccine_id = V.vaccine_id 
            WHERE VI.hospital_id = $1
        `;
        const inventoryResult = await pool.query(inventoryQuery, [hospitalId]);

        res.render('inventory_admin', { inventory: inventoryResult.rows });
    } catch (error) {
        console.error(error);
        res.send('Error fetching inventory');
    }
});

// Update Stock Quantity
app.post('/admin/inventory/update', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'hospital_admin') {
        return res.status(403).send('Unauthorized');
    }

    const { inventory_id, quantity } = req.body;

    try {
        const checkQuery = `
            SELECT VI.inventory_id 
            FROM Vaccine_Inventory VI
            JOIN Hospitals H ON VI.hospital_id = H.hospital_id
            WHERE VI.inventory_id = $1 AND H.hospital_admin_id = $2
        `;
        const checkResult = await pool.query(checkQuery, [inventory_id, req.session.user.user_id]);

        if (checkResult.rows.length === 0) {
            return res.status(403).send('You do not have permission to modify this inventory item.');
        }

        const updateQuery = `
            UPDATE Vaccine_Inventory 
            SET stock_quantity = $1, last_updated = NOW() 
            WHERE inventory_id = $2
        `;
        await pool.query(updateQuery, [quantity, inventory_id]);

        res.json({ success: true });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error updating inventory');
    }
});

// Add New Vaccine to Inventory
app.post('/admin/inventory/add', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'hospital_admin') {
        return res.redirect('/login');
    }

    const { vaccine_name, stock_quantity, expiry_date, notes } = req.body;

    try {
        const hospitalQuery = `SELECT hospital_id FROM Hospitals WHERE hospital_admin_id = $1`;
        const hospitalResult = await pool.query(hospitalQuery, [req.session.user.user_id]);
        const hospitalId = hospitalResult.rows[0].hospital_id;

        const insertQuery = `
            INSERT INTO Vaccine_Inventory (vaccine_id, hospital_id, stock_quantity, expiry_date, notes)
            VALUES ((SELECT vaccine_id FROM Vaccines WHERE vaccine_name = $1), $2, $3, $4, $5)
        `;
        await pool.query(insertQuery, [vaccine_name, hospitalId, stock_quantity, expiry_date, notes]);

        res.redirect('/admin/inventory');
    } catch (error) {
        console.error(error);
        res.send('Error adding new vaccine');
    }
});

// Remove Vaccine from Inventory
app.post('/admin/inventory/remove', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'hospital_admin') {
        return res.status(403).send('Unauthorized');
    }

    const { inventory_id } = req.body;

    try {
        const checkQuery = `
            SELECT VI.inventory_id 
            FROM Vaccine_Inventory VI
            JOIN Hospitals H ON VI.hospital_id = H.hospital_id
            WHERE VI.inventory_id = $1 AND H.hospital_admin_id = $2
        `;
        const checkResult = await pool.query(checkQuery, [inventory_id, req.session.user.user_id]);

        if (checkResult.rows.length === 0) {
            return res.status(403).send('You do not have permission to remove this inventory item.');
        }

        const deleteQuery = `DELETE FROM Vaccine_Inventory WHERE inventory_id = $1`;
        await pool.query(deleteQuery, [inventory_id]);

        res.json({ success: true });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error removing vaccine');
    }
});

// View Expired Vaccines
app.get('/admin/inventory/expired', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'hospital_admin') {
        return res.redirect('/login');
    }

    try {
        const hospitalQuery = `SELECT hospital_id FROM Hospitals WHERE hospital_admin_id = $1`;
        const hospitalResult = await pool.query(hospitalQuery, [req.session.user.user_id]);
        const hospitalId = hospitalResult.rows[0].hospital_id;

        const expiredQuery = `
            SELECT V.vaccine_name, VI.stock_quantity, VI.expiry_date 
            FROM Vaccine_Inventory VI 
            JOIN Vaccines V ON VI.vaccine_id = V.vaccine_id 
            WHERE VI.hospital_id = $1 AND VI.expiry_date < NOW()
        `;
        const expiredResult = await pool.query(expiredQuery, [hospitalId]);

        res.render('expired_vaccines', { expiredVaccines: expiredResult.rows });
    } catch (error) {
        console.error(error);
        res.send('Error fetching expired vaccines');
    }
});

// Get Reviews for Hospital
app.get('/admin/reviews', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'hospital_admin') {
        return res.status(403).send('Unauthorized');
    }

    try {
        const reviewsQuery = `
            SELECT R.review_id, U.username, R.rating, R.review_text, R.created_at 
            FROM Reviews R
            JOIN Users U ON R.user_id = U.user_id
            WHERE R.hospital_id = (SELECT hospital_id FROM Hospitals WHERE hospital_admin_id = $1)
            ORDER BY R.created_at DESC
        `;
        const reviewsResult = await pool.query(reviewsQuery, [req.session.user.user_id]);

        res.render('reviews_admin', { reviews: reviewsResult.rows });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error retrieving reviews');
    }
});


app.get('/profile', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }
    
    // Fetch the user's current profile data
    const userId = req.session.user.user_id;
    
    const query = 'SELECT * FROM Users WHERE user_id = $1';
    
    pool.query(query, [userId], (err, result) => {
        if (err) {
            return res.status(500).send('Error fetching profile');
        }
        
        const user = result.rows[0];
        res.render('profile', { user });
    });
});

app.post('/update-profile', async (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }
    
    const { phone, address, emergency_contact } = req.body;
    const userId = req.session.user.user_id;

    const updateQuery = `
        UPDATE Users 
        SET phone = $1, address = $2, emergency_contact = $3, updated_at = NOW()
        WHERE user_id = $4
    `;

    try {
        await pool.query(updateQuery, [phone, address, emergency_contact, userId]);
        res.send('Profile updated successfully!');
    } catch (err) {
        console.error(err);
        res.status(500).send('Error updating profile');
    }
});

// Vaccine Awareness Information Page
app.get('/vaccine-info', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT v.*, vi.how_it_works, vi.side_effects, vi.precautions, vi.effectiveness 
            FROM Vaccines v
            JOIN vaccine_information vi ON v.vaccine_id = vi.vaccine_id
        `);
        const vaccines = result.rows;
        res.render('vaccine-info', { vaccines });
    } catch (error) {
        console.error(error);
        res.send('Error fetching vaccine information');
    }
});

// Get insurance details
// Route to add insurance details
app.post('/add-insurance', async (req, res) => {
    const { insurance_provider, policy_number, coverage_amount, expiry_date } = req.body;
    const userId = req.session.user.user_id;

    const insertQuery = `
        INSERT INTO Insurance_Details (user_id, insurance_provider, policy_number, coverage_amount, expiry_date)
        VALUES ($1, $2, $3, $4, $5)
    `;

    try {
        await pool.query(insertQuery, [userId, insurance_provider, policy_number, coverage_amount, expiry_date]);
        res.redirect('/insurance');
    } catch (error) {
        console.error(error);
        res.send('Error adding insurance details');
    }
});

// Route to get user's insurance details
app.get('/insurance', async (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }

    const userId = req.session.user.user_id;
    const selectQuery = `SELECT * FROM Insurance_Details WHERE user_id = $1`;

    try {
        const result = await pool.query(selectQuery, [userId]);
        res.render('insurance', { insuranceDetails: result.rows }); // Ensure this is correct
    } catch (error) {
        console.error(error);
        res.send('Error fetching insurance details');
    }
});

// Get the insurance edit form
app.get('/insurance/edit/:id', async (req, res) => {
    const insuranceId = req.params.id;

    const selectQuery = `SELECT * FROM Insurance_Details WHERE insurance_id = $1`;
    try {
        const result = await pool.query(selectQuery, [insuranceId]);
        res.render('edit-insurance', { insurance: result.rows[0] });
    } catch (error) {
        console.error(error);
        res.send('Error fetching insurance details');
    }
});

// Handle the edit form submission
app.post('/insurance/edit/:id', async (req, res) => {
    const insuranceId = req.params.id;
    const { insurance_provider, policy_number, coverage_amount, expiry_date } = req.body;

    const updateQuery = `
        UPDATE Insurance_Details 
        SET insurance_provider = $1, policy_number = $2, coverage_amount = $3, expiry_date = $4 
        WHERE insurance_id = $5
    `;
    try {
        await pool.query(updateQuery, [insurance_provider, policy_number, coverage_amount, expiry_date, insuranceId]);
        res.redirect('/insurance');
    } catch (error) {
        console.error(error);
        res.send('Error updating insurance details');
    }
});

// Handle insurance deletion
app.get('/insurance/delete/:id', async (req, res) => {
    const insuranceId = req.params.id;
    
    const deleteQuery = `DELETE FROM Insurance_Details WHERE insurance_id = $1`;
    try {
        await pool.query(deleteQuery, [insuranceId]);
        res.redirect('/insurance');
    } catch (error) {
        console.error(error);
        res.send('Error deleting insurance details');
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});