"use strict";

/* =========================================
   APPLICATION STATE
========================================= */

let currentUser = null;
let selectedMovie = null;
let selectedSeats = [];
let currency = {
    code: "USD",
    symbol: "$",
    name: "US Dollar",
    rate: 1
};

/* =========================================
   MOVIE DATABASE
========================================= */

const movies = [
    {
        id: 1,
        title: "Avengers: Endgame",
        category: "Action",
        time: "18:00",
        price: 15,
        image: "https://image.tmdb.org/t/p/w500/or06FN3Dka5tukK1e9sl16pB3iy.jpg"
    },
    {
        id: 2,
        title: "Dune: Part Two",
        category: "Sci-Fi",
        time: "20:30",
        price: 18,
        image: "https://image.tmdb.org/t/p/w500/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg"
    },
    {
        id: 3,
        title: "The Hangover",
        category: "Comedy",
        time: "15:00",
        price: 10,
        image: "https://image.tmdb.org/t/p/w500/uluhlXubGu1VxU63X9VHCLWDAYP.jpg"
    },
    {
        id: 4,
        title: "Interstellar",
        category: "Sci-Fi",
        time: "21:00",
        price: 16,
        image: "https://image.tmdb.org/t/p/w500/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg"
    },
    {
        id: 5,
        title: "The Dark Knight",
        category: "Action",
        time: "19:30",
        price: 14,
        image: "https://image.tmdb.org/t/p/w500/qJ2tW6WMUDux911r6m7haRef0WH.jpg"
    },
    {
        id: 6,
        title: "Free Guy",
        category: "Comedy",
        time: "17:00",
        price: 12,
        image: "https://image.tmdb.org/t/p/w500/xmbU4JTUm8rsdtn7Y3Fcm30GpeT.jpg"
    }
];

/* =========================================
   GET HTML ELEMENTS
========================================= */

const userDisplay = document.getElementById("user-display");
const userCurrency = document.getElementById("user-currency");

const loginForm = document.getElementById("login-form");
const registerForm = document.getElementById("register-form");
const loginTab = document.getElementById("login-tab");
const registerTab = document.getElementById("register-tab");
const authMessage = document.getElementById("auth-message");

const loginEmail = document.getElementById("login-email");
const loginPassword = document.getElementById("login-password");

const registerName = document.getElementById("register-name");
const registerEmail = document.getElementById("register-email");
const registerPassword = document.getElementById("register-password");
const countrySelect = document.getElementById("country-select");
const currencyDisplay = document.getElementById("currency-display");

const searchBar = document.getElementById("search-bar");
const categoryFilter = document.getElementById("category-filter");
const movieList = document.getElementById("movie-list");

const selectedMovieTitle = document.getElementById("selected-movie-title");
const selectedMovieTime = document.getElementById("selected-movie-time");
const selectedMoviePrice = document.getElementById("selected-movie-price");

const currencySymbolSeat = document.getElementById("currency-symbol-seat");
const currencySymbolTotal = document.getElementById("currency-symbol-total");

const seatMap = document.getElementById("seat-map");
const countDisplay = document.getElementById("count");
const totalDisplay = document.getElementById("total");
const summaryDetails = document.getElementById("summary-details");

const paymentModal = document.getElementById("payment-modal");
const paymentQr = document.getElementById("payment-qr");
const paymentTotal = document.getElementById("payment-total");
const paymentCurrencySymbol = document.getElementById("payment-currency-symbol");
const paymentCurrencyCode = document.getElementById("payment-currency-code");
const demoPaymentCheck = document.getElementById("demo-payment-check");
const paymentMessage = document.getElementById("payment-message");
const scanStatus = document.getElementById("scan-status");
const demoUpiId = document.getElementById("demo-upi-id");
let paymentMethod = "qr";
let paymentBookingInProgress = false;


/* =========================================
   API HELPERS
========================================= */

async function api(url, options = {}) {
    const response = await fetch(url, {
        headers: {
            "Content-Type": "application/json",
            ...(options.headers || {})
        },
        ...options
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.message || "Something went wrong.");
    }

    return data;
}

function showAuthMessage(message, success = false) {
    authMessage.textContent = message || "";
    authMessage.style.color = success ? "#7dff9d" : "#ffb3b3";
}

function setAuthMode(mode) {
    const loginMode = mode === "login";
    loginForm.classList.toggle("hidden", !loginMode);
    registerForm.classList.toggle("hidden", loginMode);
    loginTab.classList.toggle("active", loginMode);
    registerTab.classList.toggle("active", !loginMode);
    showAuthMessage("");
}

/* =========================================
   COUNTRY + CURRENCY
========================================= */

async function loadCountries() {
    try {
        const data = await api("/api/countries");

        countrySelect.innerHTML =
            '<option value="">Select your country</option>' +
            data.countries.map(country =>
                `<option value="${escapeAttribute(country.code)}">
                    ${escapeHTML(country.name)}
                </option>`
            ).join("");
    } catch (error) {
        countrySelect.innerHTML = '<option value="">Unable to load countries</option>';
        showAuthMessage("Backend is not running. Start the Node.js server.");
    }
}

async function updateCurrencyPreview() {
    const countryCode = countrySelect.value;

    if (!countryCode) {
        currencyDisplay.textContent = "Select a country";
        return;
    }

    try {
        const data = await api(`/api/country/${encodeURIComponent(countryCode)}/currency`);
        currencyDisplay.textContent =
            `${data.currency.symbol} ${data.currency.code} — ${data.currency.name}`;
    } catch (error) {
        currencyDisplay.textContent = "Currency unavailable";
    }
}

async function loadCurrentCurrency() {
    if (!currentUser || !currentUser.country) return;

    try {
        const data = await api(`/api/country/${encodeURIComponent(currentUser.country)}/currency`);
        currency = {
            code: data.currency.code,
            symbol: data.currency.symbol,
            name: data.currency.name,
            rate: data.currency.rate
        };

        currencySymbolSeat.textContent = currency.symbol;
        currencySymbolTotal.textContent = currency.symbol;

        userCurrency.textContent =
            `🌍 ${currentUser.countryName} · ${currency.code} (${currency.symbol})`;

        updateCalculation();
    } catch (error) {
        console.error(error);
    }
}

/* =========================================
   AUTHENTICATION
========================================= */

async function login(event) {
    if (event) event.preventDefault();

    const email = loginEmail.value.trim();
    const password = loginPassword.value;

    if (!email || !password) {
        showAuthMessage("Please enter your email and password.");
        return;
    }

    try {
        const data = await api("/api/auth/login", {
            method: "POST",
            body: JSON.stringify({ email, password })
        });

        currentUser = data.user;
        await loadCurrentCurrency();

        userDisplay.textContent = currentUser.name;
        renderMovies(movies);
        showSection("movie-section");

        loginForm.reset();
        showAuthMessage("");
    } catch (error) {
        showAuthMessage(error.message);
    }
}

async function register(event) {
    if (event) event.preventDefault();

    const name = registerName.value.trim();
    const email = registerEmail.value.trim();
    const password = registerPassword.value;
    const country = countrySelect.value;

    if (name.length < 2) {
        showAuthMessage("Name must contain at least 2 characters.");
        return;
    }

    if (password.length < 6) {
        showAuthMessage("Password must contain at least 6 characters.");
        return;
    }

    if (!country) {
        showAuthMessage("Please select your country.");
        return;
    }

    try {
        const data = await api("/api/auth/register", {
            method: "POST",
            body: JSON.stringify({ name, email, password, country })
        });

        currentUser = data.user;
        await loadCurrentCurrency();

        userDisplay.textContent = currentUser.name;
        renderMovies(movies);
        showSection("movie-section");

        registerForm.reset();
        showAuthMessage("");
    } catch (error) {
        showAuthMessage(error.message);
    }
}

async function logout() {
    try {
        await api("/api/auth/logout", { method: "POST" });
    } catch (error) {
        console.warn(error);
    }

    currentUser = null;
    selectedMovie = null;
    selectedSeats = [];
    currency = { code: "USD", symbol: "$", name: "US Dollar", rate: 1 };

    userDisplay.textContent = "";
    userCurrency.textContent = "";
    showSection("login-section");
    setAuthMode("login");
}

/* =========================================
   SECTION NAVIGATION
========================================= */

function showSection(sectionId) {
    const sections = document.querySelectorAll(".section");

    sections.forEach(section => section.classList.remove("active"));

    const target = document.getElementById(sectionId);

    if (target) {
        target.classList.add("active");
        window.scrollTo({ top: 0, behavior: "smooth" });
    }
}

/* =========================================
   RENDER MOVIES
========================================= */

function renderMovies(movieData) {
    movieList.innerHTML = "";

    if (!movieData || movieData.length === 0) {
        movieList.innerHTML = '<p class="no-movies">🎬 No movies found.</p>';
        return;
    }

    movieData.forEach(movie => {
        const card = document.createElement("div");
        card.className = "movie-card";

        const localPrice = convertPrice(movie.price);

        card.innerHTML = `
            <img class="movie-poster"
                 src="${escapeAttribute(movie.image)}"
                 alt="${escapeAttribute(movie.title)} poster"
                 loading="lazy">

            <div class="movie-content">
                <span class="movie-category">${escapeHTML(movie.category)}</span>

                <h3>${escapeHTML(movie.title)}</h3>

                <div class="movie-info">
                    <span>🕐 ${escapeHTML(movie.time)}</span>
                    <span class="movie-price">
                        ${escapeHTML(currency.symbol)}${localPrice.toFixed(2)}
                    </span>
                </div>
            </div>
        `;

        const poster = card.querySelector(".movie-poster");
        poster.addEventListener("error", () => {
            poster.src = "https://placehold.co/500x750/222222/ffffff?text=Movie+Poster";
        });

        card.addEventListener("click", () => selectMovie(movie));
        movieList.appendChild(card);
    });
}

function convertPrice(usdPrice) {
    return Number(usdPrice) * Number(currency.rate || 1);
}

function formatMoney(usdPrice) {
    return `${currency.symbol}${convertPrice(usdPrice).toFixed(2)} ${currency.code}`;
}

/* =========================================
   SEARCH AND FILTER
========================================= */

function filterMovies() {
    const search = searchBar.value.trim().toLowerCase();
    const category = categoryFilter.value;

    const filtered = movies.filter(movie => {
        const searchMatch = movie.title.toLowerCase().includes(search);
        const categoryMatch =
            category === "All" || movie.category === category;

        return searchMatch && categoryMatch;
    });

    renderMovies(filtered);
}

/* =========================================
   SELECT MOVIE
========================================= */

function selectMovie(movie) {
    selectedMovie = movie;
    selectedSeats = [];

    selectedMovieTitle.textContent = movie.title;
    selectedMovieTime.textContent = movie.time;
    selectedMoviePrice.textContent = convertPrice(movie.price).toFixed(2);

    currencySymbolSeat.textContent = currency.symbol;

    generateSeats();
    updateCalculation();
    showSection("seat-section");
}

/* =========================================
   SEATS
========================================= */

async function generateSeats() {
    seatMap.innerHTML = "";

    if (!selectedMovie) return;

    try {
        const data = await api(`/api/movies/${selectedMovie.id}/seats`);
        const occupiedSeats = data.occupiedSeats || [];

        for (let seatNumber = 1; seatNumber <= 32; seatNumber++) {
            const seat = document.createElement("div");
            seat.className = "seat";
            seat.textContent = seatNumber;
            seat.dataset.seat = seatNumber;

            if (occupiedSeats.includes(seatNumber)) {
                seat.classList.add("occupied");
            } else {
                seat.addEventListener("click", () => toggleSeat(seat));
            }

            seatMap.appendChild(seat);
        }
    } catch (error) {
        console.error(error);
        alert("Could not load seats from the server.");
    }
}

function toggleSeat(seat) {
    if (seat.classList.contains("occupied")) return;

    seat.classList.toggle("selected");
    updateCalculation();
}

function updateCalculation() {
    const selected = document.querySelectorAll("#seat-map .seat.selected");

    selectedSeats = Array.from(selected).map(seat => Number(seat.dataset.seat));

    const count = selectedSeats.length;
    const total = selectedMovie ? count * selectedMovie.price : 0;

    countDisplay.textContent = count;
    totalDisplay.textContent = convertPrice(total).toFixed(2);

    currencySymbolTotal.textContent = currency.symbol;
}

/* =========================================
   BOOK TICKETS
========================================= */

function getSelectedLocalTotal() {
    const totalUsd = selectedMovie ? selectedMovie.price * selectedSeats.length : 0;
    return convertPrice(totalUsd);
}

function openPaymentModal() {
    const total = getSelectedLocalTotal();
    paymentTotal.textContent = Number(total).toFixed(2);
    paymentCurrencySymbol.textContent = currency.symbol;
    paymentCurrencyCode.textContent = currency.code;
    demoPaymentCheck.checked = false;
    paymentMessage.textContent = "";
    scanStatus.textContent = "Waiting for demo scan...";
    scanStatus.style.color = "#999";
    paymentMethod = "qr";
    setPaymentMethod("qr");

    const upiPayload = `upi://pay?pa=${encodeURIComponent(demoUpiId.value)}&pn=${encodeURIComponent("IBOX x CVR's Demo")}&am=${Number(total).toFixed(2)}&cu=${encodeURIComponent(currency.code)}`;
    paymentQr.innerHTML = "";

    if (window.QRCode) {
        new QRCode(paymentQr, {
            text: upiPayload,
            width: 190,
            height: 190,
            correctLevel: QRCode.CorrectLevel.M
        });
    } else {
        paymentQr.innerHTML = `<div style="color:#111;text-align:center;font-weight:700;padding:20px">Demo QR<br>IBOX x CVR's<br>${escapeHTML(demoUpiId.value)}</div>`;
    }

    paymentModal.classList.add("active");
    paymentModal.setAttribute("aria-hidden", "false");
}

function closePaymentModal() {
    if (paymentBookingInProgress) return;
    paymentModal.classList.remove("active");
    paymentModal.setAttribute("aria-hidden", "true");
}

function setPaymentMethod(method) {
    paymentMethod = method;
    document.querySelectorAll(".payment-method").forEach(button => {
        button.classList.toggle("active", button.dataset.method === method);
    });

    document.getElementById("qr-payment-panel").classList.toggle("hidden", method !== "qr");
    document.getElementById("upi-payment-panel").classList.toggle("hidden", method !== "upi");
}

function simulateQrScan() {
    scanStatus.textContent = "✓ QR scanned successfully (demo).";
    scanStatus.style.color = "#7dff9d";
}

async function confirmDemoPayment() {
    if (paymentBookingInProgress) return;

    if (!demoPaymentCheck.checked) {
        paymentMessage.textContent = "Please confirm the demo payment checkbox.";
        paymentMessage.style.color = "#ffb3b3";
        return;
    }

    if (paymentMethod === "qr" && !scanStatus.textContent.includes("successfully")) {
        paymentMessage.textContent = "Please simulate the QR scan first.";
        paymentMessage.style.color = "#ffb3b3";
        return;
    }

    paymentBookingInProgress = true;
    const button = document.getElementById("confirm-payment-btn");
    button.disabled = true;
    button.textContent = "Processing Demo Payment...";
    paymentMessage.textContent = "Demo payment approved. Creating your booking...";
    paymentMessage.style.color = "#7dff9d";

    try {
        const data = await api("/api/bookings", {
            method: "POST",
            body: JSON.stringify({
                movieId: selectedMovie.id,
                seats: selectedSeats,
                paymentMethod: paymentMethod === "qr" ? "UPI QR (Demo)" : "UPI ID (Demo)",
                paymentStatus: "PAID (DEMO)"
            })
        });

        const booking = data.booking;

        summaryDetails.innerHTML = `
            <div class="summary-row">
                <span>Booking ID</span>
                <strong>${escapeHTML(booking.id)}</strong>
            </div>

            <div class="summary-row">
                <span>Payment Status</span>
                <strong>✓ ${escapeHTML(booking.paymentStatus || "PAID (DEMO)")}</strong>
            </div>

            <div class="summary-row">
                <span>Payment Method</span>
                <strong>${escapeHTML(booking.paymentMethod || (paymentMethod === "qr" ? "UPI QR (Demo)" : "UPI ID (Demo)"))}</strong>
            </div>

            <div class="summary-row">
                <span>Demo Transaction ID</span>
                <strong>${escapeHTML(booking.transactionId || ("DEMO-" + booking.id.replace("IBOX-", "")))}</strong>
            </div>

            <div class="summary-row">
                <span>Customer</span>
                <strong>${escapeHTML(booking.user)}</strong>
            </div>

            <div class="summary-row">
                <span>Movie</span>
                <strong>${escapeHTML(booking.movie)}</strong>
            </div>

            <div class="summary-row">
                <span>Category</span>
                <strong>${escapeHTML(booking.category)}</strong>
            </div>

            <div class="summary-row">
                <span>Showtime</span>
                <strong>${escapeHTML(booking.time)}</strong>
            </div>

            <div class="summary-row">
                <span>Seats</span>
                <strong>${booking.seats.join(", ")}</strong>
            </div>

            <div class="summary-row">
                <span>Total Seats</span>
                <strong>${booking.seats.length}</strong>
            </div>

            <div class="summary-row summary-total">
                <span>Total Paid</span>
                <strong>${escapeHTML(booking.currencySymbol)}${Number(booking.totalPaid).toFixed(2)} ${escapeHTML(booking.currencyCode)}</strong>
            </div>

            <div class="summary-row">
                <span>Booking Date</span>
                <strong>${escapeHTML(booking.date)}</strong>
            </div>
        `;

        paymentModal.classList.remove("active");
        paymentModal.setAttribute("aria-hidden", "true");
        showSection("summary-section");
    } catch (error) {
        paymentMessage.textContent = error.message;
        paymentMessage.style.color = "#ffb3b3";
        await generateSeats();
        updateCalculation();
    } finally {
        paymentBookingInProgress = false;
        button.disabled = false;
        button.textContent = "✓ Complete Demo Payment";
    }
}

async function bookTickets() {
    if (!selectedMovie) {
        alert("Please select a movie.");
        return;
    }

    if (selectedSeats.length === 0) {
        alert("Please select at least one seat.");
        return;
    }

    openPaymentModal();
}

/* =========================================
   RESET
========================================= */

function resetApp() {
    selectedMovie = null;
    selectedSeats = [];
    searchBar.value = "";
    categoryFilter.value = "All";

    renderMovies(movies);
    showSection("movie-section");
}

/* =========================================
   SECURITY HELPERS
========================================= */

function escapeHTML(text) {
    const div = document.createElement("div");
    div.textContent = text == null ? "" : String(text);
    return div.innerHTML;
}

function escapeAttribute(text) {
    return String(text == null ? "" : text)
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

/* =========================================
   INITIALIZE
========================================= */

async function initializeApp() {
    showSection("login-section");
    setAuthMode("login");
    await loadCountries();

    try {
        const data = await api("/api/auth/me");

        if (data.user) {
            currentUser = data.user;
            userDisplay.textContent = currentUser.name;
            await loadCurrentCurrency();
            renderMovies(movies);
            showSection("movie-section");
        }
    } catch (error) {
        // Not logged in; stay on login screen.
    }
}

/* =========================================
   EVENT LISTENERS
========================================= */

loginTab.addEventListener("click", () => setAuthMode("login"));
registerTab.addEventListener("click", () => setAuthMode("register"));

loginForm.addEventListener("submit", login);
registerForm.addEventListener("submit", register);
countrySelect.addEventListener("change", updateCurrencyPreview);

document.getElementById("book-btn").addEventListener("click", bookTickets);

document.querySelectorAll(".payment-method").forEach(button => {
    button.addEventListener("click", () => setPaymentMethod(button.dataset.method));
});

document.getElementById("fake-scan-btn").addEventListener("click", simulateQrScan);
document.getElementById("confirm-payment-btn").addEventListener("click", confirmDemoPayment);
document.getElementById("close-payment").addEventListener("click", closePaymentModal);
document.getElementById("payment-backdrop").addEventListener("click", closePaymentModal);

document.getElementById("copy-upi-btn").addEventListener("click", async () => {
    try {
        await navigator.clipboard.writeText(demoUpiId.value);
        document.getElementById("upi-copy-status").textContent = "✓ Demo UPI ID copied.";
    } catch {
        demoUpiId.select();
        document.execCommand("copy");
        document.getElementById("upi-copy-status").textContent = "✓ Demo UPI ID copied.";
    }
});

document.getElementById("print-receipt-btn").addEventListener("click", () => window.print());

document.getElementById("back-btn").addEventListener("click", () => {
    selectedMovie = null;
    selectedSeats = [];
    showSection("movie-section");
});

document.getElementById("another-ticket-btn").addEventListener("click", resetApp);
document.getElementById("logout-btn").addEventListener("click", logout);
document.getElementById("summary-logout-btn").addEventListener("click", logout);

searchBar.addEventListener("input", filterMovies);
categoryFilter.addEventListener("change", filterMovies);

document.addEventListener("DOMContentLoaded", initializeApp);
