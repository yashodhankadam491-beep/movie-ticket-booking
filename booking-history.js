"use strict";

(() => {
    const button = document.getElementById("history-btn");
    const back = document.getElementById("history-back-btn");
    const list = document.getElementById("history-list");

    function esc(value) {
        if (typeof escapeHTML === "function") return escapeHTML(value);
        const div = document.createElement("div"); div.textContent = value == null ? "" : String(value); return div.innerHTML;
    }

    async function loadHistory() {
        if (!list) return;
        list.innerHTML = '<p class="no-movies">Loading booking history...</p>';
        try {
            const data = await api("/api/bookings/history");
            if (!data.bookings?.length) { list.innerHTML = '<p class="no-movies">No bookings yet.</p>'; return; }
            list.innerHTML = data.bookings.map(booking => `
                <article class="history-item">
                    <strong>${esc(booking.movie)}</strong>
                    <div class="muted">Booking ID: ${esc(booking.id)}</div>
                    <div class="muted">📍 ${esc(booking.theatre_name || "Cinema hall")}</div>
                    <div class="muted">📅 ${esc(booking.show_date || "-")} · 🕐 ${esc(booking.show_time || "-")}</div>
                    <div class="muted">💺 Seats: ${esc((booking.seats || []).join(", "))}</div>
                    <div class="muted">💳 ${esc(booking.payment_status)} · ₹${Number(booking.total_local || 0).toFixed(2)} ${esc(booking.currency_code || "INR")}</div>
                    <div class="muted">Transaction: ${esc(booking.transaction_id || "-")}</div>
                </article>
            `).join("");
        } catch (error) {
            list.innerHTML = `<p class="no-movies">${esc(error.message || "Unable to load booking history.")}</p>`;
        }
    }

    button?.addEventListener("click", async () => {
        if (!currentUser) { showSection("login-section"); showAuthMessage("Please login first."); return; }
        showSection("history-section");
        await loadHistory();
    });
    back?.addEventListener("click", () => showSection("movie-section"));
    window.refreshBookingHistory = loadHistory;
})();
