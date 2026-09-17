"use strict";

(() => {
    const stateSelect = document.getElementById("state-select");
    const districtSelect = document.getElementById("district-select");
    const citySelect = document.getElementById("city-select");
    const theatreSelect = document.getElementById("theatre-select");
    const directoryStatus = document.getElementById("directory-status");
    const movieList = document.getElementById("movie-list");
    const selectedVenue = document.getElementById("selected-venue");
    const seatVenue = document.getElementById("seat-venue");
    const summaryVenue = document.getElementById("summary-venue");

    let directory = null;
    let selection = { state: "Maharashtra", district: "", city: "", theatre: "" };

    function option(label, value = "") {
        const el = document.createElement("option");
        el.value = value;
        el.textContent = label;
        return el;
    }

    function setOptions(select, items, placeholder) {
        select.replaceChildren(option(placeholder));
        items.forEach(item => select.appendChild(option(item, item)));
        select.disabled = items.length === 0;
    }

    function getDistrict() { return directory?.districts?.find(item => item.district === selection.district) || null; }
    function getCity() { return getDistrict()?.cities?.find(item => item.city === selection.city) || null; }
    function persist() { localStorage.setItem("iboxCinemaSelection", JSON.stringify(selection)); }

    function restore() {
        try {
            const saved = JSON.parse(localStorage.getItem("iboxCinemaSelection") || "null");
            if (saved?.state === "Maharashtra") selection = { ...selection, ...saved };
        } catch { localStorage.removeItem("iboxCinemaSelection"); }
    }

    function notifyChange() {
        window.dispatchEvent(new CustomEvent("ibox:cinema-change", { detail: { ...selection } }));
    }

    function updateVenueText() {
        const text = selection.theatre ? `${selection.theatre} · ${selection.city}, ${selection.district}, Maharashtra` : "Select a cinema hall to continue";
        if (selectedVenue) selectedVenue.textContent = text;
        if (seatVenue) seatVenue.textContent = selection.theatre ? text : "Cinema hall not selected";
        if (summaryVenue) summaryVenue.textContent = selection.theatre ? text : "Cinema hall not selected";
    }

    function updateMovieAvailabilityState() {
        const ready = Boolean(selection.district && selection.city && selection.theatre);
        if (movieList) movieList.setAttribute("aria-disabled", String(!ready));
        if (directoryStatus) {
            directoryStatus.className = ready ? "directory-status ready" : "directory-status";
            directoryStatus.textContent = ready ? `✓ ${selection.theatre} selected. Choose a movie below.` : "Select District → City → Cinema Hall before choosing a movie.";
        }
        notifyChange();
    }

    function populateDistricts() {
        const districts = (directory?.districts || []).map(item => item.district);
        setOptions(districtSelect, districts, "Select District");
        if (districts.includes(selection.district)) districtSelect.value = selection.district; else selection.district = "";
        populateCities();
    }

    function populateCities() {
        const cities = (getDistrict()?.cities || []).map(item => item.city);
        setOptions(citySelect, cities, "Select City");
        if (cities.includes(selection.city)) citySelect.value = selection.city; else selection.city = "";
        populateTheatres();
    }

    function populateTheatres() {
        const theatres = getCity()?.theatres || [];
        setOptions(theatreSelect, theatres, "Select Cinema Hall");
        if (theatres.includes(selection.theatre)) theatreSelect.value = selection.theatre; else selection.theatre = "";
        updateVenueText();
        updateMovieAvailabilityState();
    }

    function attachMovieGate() {
        if (!movieList) return;
        movieList.addEventListener("click", event => {
            if (!selection.theatre) {
                event.preventDefault();
                event.stopImmediatePropagation();
                directoryStatus?.scrollIntoView({ behavior: "smooth", block: "center" });
                if (directoryStatus) directoryStatus.textContent = "Please select a cinema hall first.";
            }
        }, true);
    }

    async function loadDirectory() {
        try {
            const response = await fetch("/MAHARASHTRA_CINEMAS.json", { cache: "no-store" });
            if (!response.ok) throw new Error("Directory could not be loaded.");
            directory = await response.json();
            restore();
            stateSelect.value = "Maharashtra";
            populateDistricts();
            updateVenueText();
        } catch (error) {
            console.error(error);
            directoryStatus.textContent = "Cinema directory unavailable. Please refresh the page.";
            directoryStatus.className = "directory-status error";
        }
    }

    window.getCinemaSelection = () => ({ ...selection });

    document.addEventListener("DOMContentLoaded", () => {
        if (!stateSelect || !districtSelect || !citySelect || !theatreSelect) return;
        stateSelect.value = "Maharashtra";
        districtSelect.addEventListener("change", () => {
            selection.district = districtSelect.value;
            selection.city = "";
            selection.theatre = "";
            persist();
            populateCities();
        });
        citySelect.addEventListener("change", () => {
            selection.city = citySelect.value;
            selection.theatre = "";
            persist();
            populateTheatres();
        });
        theatreSelect.addEventListener("change", () => {
            selection.theatre = theatreSelect.value;
            persist();
            updateVenueText();
            updateMovieAvailabilityState();
        });
        attachMovieGate();
        loadDirectory();
    });
})();
