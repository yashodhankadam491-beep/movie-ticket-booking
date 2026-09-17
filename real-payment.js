"use strict";

let razorpayOrder = null;
let realPaymentBusy = false;

function realPaymentMessage(message, success = false) {
    const el = document.getElementById("payment-message");
    if (!el) return;
    el.textContent = message || "";
    el.style.color = success ? "#7dff9d" : "#ffb3b3";
}

function setRealPaymentModal() {
    const title = document.getElementById("payment-title");
    const headerText = document.querySelector("#payment-modal .payment-header p");
    const total = document.getElementById("payment-total");
    const symbol = document.getElementById("payment-currency-symbol");
    const code = document.getElementById("payment-currency-code");
    const qrPanel = document.getElementById("qr-payment-panel");
    const upiPanel = document.getElementById("upi-payment-panel");
    const methods = document.querySelector(".payment-methods");
    const check = document.querySelector(".payment-check");
    const fakeScan = document.getElementById("fake-scan-btn");
    const upiCopy = document.getElementById("copy-upi-btn");
    const confirm = document.getElementById("confirm-payment-btn");

    if (title) title.textContent = "Secure Razorpay Checkout";
    if (headerText) headerText.textContent = "Real payment gateway. Your payment is processed securely by Razorpay.";
    if (methods) methods.style.display = "none";
    if (qrPanel) qrPanel.style.display = "none";
    if (upiPanel) upiPanel.style.display = "none";
    if (check) check.style.display = "none";
    if (fakeScan) fakeScan.style.display = "none";
    if (upiCopy) upiCopy.style.display = "none";
    if (confirm) confirm.textContent = "💳 Pay securely with Razorpay";
    if (symbol) symbol.textContent = "₹";
    if (code) code.textContent = "INR";
    if (total) total.dataset.gatewayCurrency = "INR";
}

async function createRealPaymentOrder() {
    if (!selectedMovie || !selectedSeats.length) throw new Error("Please select at least one seat.");
    const data = await api("/api/payment/order", {
        method: "POST",
        body: JSON.stringify({ movieId: selectedMovie.id, seats: selectedSeats })
    });
    razorpayOrder = data;
    const total = document.getElementById("payment-total");
    if (total) total.textContent = Number(data.amountInr).toFixed(2);
    setRealPaymentModal();
    return data;
}

async function completeRealBooking(response) {
    const data = await api("/api/bookings", {
        method: "POST",
        body: JSON.stringify({
            movieId: selectedMovie.id,
            seats: selectedSeats,
            paymentStatus: "PAID (RAZORPAY)",
            paymentMethod: "Razorpay",
            razorpayOrderId: response.razorpay_order_id,
            razorpayPaymentId: response.razorpay_payment_id,
            razorpaySignature: response.razorpay_signature
        })
    });

    const booking = data.booking || {};
    const details = document.getElementById("summary-details");
    if (details) {
        details.innerHTML = `
          <div class="summary-row"><span>Booking ID</span><strong>${escapeHTML(booking.id || "-")}</strong></div>
          <div class="summary-row"><span>Movie</span><strong>${escapeHTML(booking.movie || selectedMovie.title)}</strong></div>
          <div class="summary-row"><span>Seats</span><strong>${escapeHTML((booking.seats || selectedSeats).join(", "))}</strong></div>
          <div class="summary-row"><span>Amount Paid</span><strong>₹${Number(booking.totalInr || 0).toFixed(2)} INR</strong></div>
          <div class="summary-row"><span>Payment</span><strong>Razorpay · PAID</strong></div>
          <div class="summary-row"><span>Transaction ID</span><strong>${escapeHTML(booking.transactionId || response.razorpay_payment_id)}</strong></div>
        `;
    }

    const modal = document.getElementById("payment-modal");
    if (modal) {
        modal.classList.remove("active");
        modal.setAttribute("aria-hidden", "true");
    }
    if (typeof showSection === "function") showSection("summary-section");
    if (typeof generateSeats === "function") generateSeats();
    razorpayOrder = null;
    selectedSeats = [];
    realPaymentBusy = false;
}

async function openRealPayment() {
    if (realPaymentBusy) return;
    if (!selectedMovie || !selectedSeats.length) return;
    realPaymentBusy = true;
    try {
        setRealPaymentModal();
        const modal = document.getElementById("payment-modal");
        if (modal) {
            modal.classList.add("active");
            modal.setAttribute("aria-hidden", "false");
        }
        realPaymentMessage("Creating secure payment order…", true);
        await createRealPaymentOrder();
        realPaymentMessage("");
        realPaymentBusy = false;
    } catch (error) {
        realPaymentBusy = false;
        realPaymentMessage(error.message || "Unable to start payment.");
    }
}

function launchRazorpay() {
    if (realPaymentBusy) return;
    if (!razorpayOrder) return openRealPayment();
    if (!window.Razorpay) {
        realPaymentMessage("Razorpay Checkout could not be loaded. Check your internet connection.");
        return;
    }

    realPaymentBusy = true;
    const options = {
        key: razorpayOrder.keyId,
        amount: razorpayOrder.amount,
        currency: razorpayOrder.currency,
        name: "IBOX x CVR's",
        description: `Movie ticket — ${selectedMovie.title}`,
        order_id: razorpayOrder.orderId,
        prefill: {
            name: currentUser?.name || "",
            email: currentUser?.email || ""
        },
        notes: { movie_id: String(selectedMovie.id), seats: selectedSeats.join(",") },
        theme: { color: "#39e879" },
        handler: async function (response) {
            try {
                realPaymentMessage("Payment received. Verifying securely…", true);
                await completeRealBooking(response);
            } catch (error) {
                realPaymentBusy = false;
                realPaymentMessage(error.message || "Payment verification failed. If your bank was charged, keep the Razorpay payment ID and contact support.");
            }
        },
        modal: {
            ondismiss: function () {
                realPaymentBusy = false;
                realPaymentMessage("Payment window closed. No booking was confirmed.");
            }
        }
    };

    const checkout = new window.Razorpay(options);
    checkout.on("payment.failed", function (response) {
        realPaymentBusy = false;
        realPaymentMessage(response?.error?.description || "Payment failed. No booking was confirmed.");
    });
    checkout.open();
}

function installRealPaymentGateway() {
    const bookButton = document.getElementById("book-btn");
    const confirmButton = document.getElementById("confirm-payment-btn");
    if (bookButton) {
        bookButton.addEventListener("click", event => {
            event.preventDefault();
            event.stopImmediatePropagation();
            openRealPayment();
        }, true);
    }
    if (confirmButton) {
        confirmButton.addEventListener("click", event => {
            event.preventDefault();
            event.stopImmediatePropagation();
            launchRazorpay();
        }, true);
    }
    setRealPaymentModal();
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", installRealPaymentGateway, { once: true });
} else {
    installRealPaymentGateway();
}
