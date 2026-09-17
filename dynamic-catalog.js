"use strict";

(() => {
    let currentShows = [];
    let selectedShow = null;
    let lastSelectionKey = "";

    const dateSelect = document.getElementById("show-date-select");
    const timeSelect = document.getElementById("show-time-select");
    const movieList = document.getElementById("movie-list");
    const status = document.getElementById("directory-status");
    const search = document.getElementById("search-bar");
    const category = document.getElementById("category-filter");
    const seatMap = document.getElementById("seat-map");

    function selection() { return typeof window.getCinemaSelection === "function" ? window.getCinemaSelection() : { district:"", city:"", theatre:"" }; }
    function esc(value){if(typeof escapeHTML==="function")return escapeHTML(value);const d=document.createElement("div");d.textContent=value==null?"":String(value);return d.innerHTML;}
    function attr(value){if(typeof escapeAttribute==="function")return escapeAttribute(value);return String(value==null?"":value).replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}
    function localMoney(inr){return `₹${Number(inr).toFixed(2)} INR`;}

    async function loadCatalog(){
        const s=selection();
        const key=`${s.district}|${s.city}|${s.theatre}|${dateSelect?.value||""}`;
        if(!s.district||!s.city||!s.theatre){currentShows=[];if(dateSelect)dateSelect.innerHTML='<option value="">Select Date</option>';if(timeSelect)timeSelect.innerHTML='<option value="">Select Show Time</option>';if(movieList)movieList.innerHTML='<p class="no-movies">📍 Select a cinema hall to load available movies.</p>';return;}
        if(key===lastSelectionKey&&currentShows.length)return;
        lastSelectionKey=key;
        try{
            const params=new URLSearchParams({district:s.district,city:s.city,theatre:s.theatre});if(dateSelect?.value)params.set("date",dateSelect.value);
            const response=await fetch(`/api/catalog?${params.toString()}`,{cache:"no-store"});const data=await response.json();if(!response.ok)throw new Error(data.message||"Movie catalog could not be loaded.");
            currentShows=Array.isArray(data.shows)?data.shows:[];populateDates(data.dates||[],data.selectedDate||"");populateTimes();renderCatalog();
            if(status)status.textContent=currentShows.length?`✓ ${s.theatre} · ${data.selectedDate||""} · ${currentShows.length} show(s) available.`:`No shows are scheduled at ${s.theatre} for this date.`;
        }catch(error){currentShows=[];if(movieList)movieList.innerHTML=`<p class="no-movies">${esc(error.message)}</p>`;if(status)status.textContent=error.message;}
    }
    function populateDates(dates,selected){if(!dateSelect)return;dateSelect.innerHTML='<option value="">Select Date</option>'+dates.map(date=>`<option value="${attr(date)}">${esc(new Date(`${date}T00:00:00`).toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"}))}</option>`).join("");if(selected)dateSelect.value=selected;}
    function populateTimes(){if(!timeSelect)return;const times=[...new Set(currentShows.map(show=>show.show_time))].sort();timeSelect.innerHTML='<option value="">All Show Times</option>'+times.map(time=>`<option value="${attr(time)}">${esc(time)}</option>`).join("");}
    function renderCatalog(){
        if(!movieList)return;const term=(search?.value||"").trim().toLowerCase(),selectedTime=timeSelect?.value||"",selectedCategory=category?.value||"All";
        const filtered=currentShows.filter(show=>(!term||show.title.toLowerCase().includes(term))&&(selectedCategory==="All"||show.category===selectedCategory)&&(!selectedTime||show.show_time===selectedTime));
        movieList.innerHTML="";if(!filtered.length){movieList.innerHTML='<p class="no-movies">🎬 No movies/shows match your selection.</p>';return;}
        filtered.forEach(show=>{
            const card=document.createElement("div");card.className="movie-card";
            const imageMap={"Avengers: Endgame":"https://image.tmdb.org/t/p/w500/or06FN3Dka5tukK1e9sl16pB3iy.jpg","Dune: Part Two":"https://image.tmdb.org/t/p/w500/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg","The Hangover":"https://image.tmdb.org/t/p/w500/uluhlXubGu1VxU63X9VHCLWDAYP.jpg","Interstellar":"https://image.tmdb.org/t/p/w500/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg","The Dark Knight":"https://image.tmdb.org/t/p/w500/qJ2tW6WMUDux911r6m7haRef0WH.jpg","Free Guy":"https://image.tmdb.org/t/p/w500/xmbU4JTUm8rsdtn7Y3Fcm30GpeT.jpg"};
            const screenText=show.screen_name?` · ${show.screen_name}`:"";
            card.innerHTML=`<img class="movie-poster" src="${attr(imageMap[show.title]||"https://placehold.co/500x750/222222/ffffff?text=Movie+Poster")}" alt="${attr(show.title)} poster" loading="lazy"><div class="movie-content"><span class="movie-category">${esc(show.category)}</span><h3>${esc(show.title)}</h3><div class="movie-info"><span>🕐 ${esc(show.show_time)}</span><span class="movie-price">${localMoney(show.price_inr)}</span></div><small>📍 ${esc(show.theatre)}${esc(screenText)}</small></div>`;
            const poster=card.querySelector(".movie-poster");poster.addEventListener("error",()=>{poster.src="https://placehold.co/500x750/222222/ffffff?text=Movie+Poster";},{once:true});card.addEventListener("click",()=>selectShow(show));movieList.appendChild(card);
        });
    }

    async function selectShow(show){
        selectedShow=show;window.selectedCinemaShow=show;selectedMovie={id:Number(show.movie_id),title:show.title,category:show.category,time:show.show_time,price:Number(show.price_inr)/Number(window.PAYMENT_USD_TO_INR||83.5)};selectedSeats=[];
        document.getElementById("selected-movie-title").textContent=show.title;
        document.getElementById("selected-movie-time").textContent=`${show.show_date} · ${show.show_time}`;
        document.getElementById("selected-movie-price").textContent=Number(show.price_inr).toFixed(2);
        document.getElementById("currency-symbol-seat").textContent="₹";
        const venue=document.getElementById("seat-venue");if(venue)venue.textContent=`${show.theatre||"Cinema"}${show.screen_name?` · ${show.screen_name}`:""}`;
        await loadShowSeats();if(typeof updateCalculation==="function")updateCalculation();if(typeof showSection==="function")showSection("seat-section");
    }

    async function loadShowSeats(){
        if(!selectedShow||!seatMap)return;seatMap.innerHTML="";
        try{
            const data=await api(`/api/shows/${selectedShow.show_id}/seats`);const occupied=new Set(data.occupiedSeats||[]),locked=new Set(data.lockedSeats||[]);
            const capacity=Math.max(1,Number(data.seatCapacity||data.capacity||selectedShow.seat_capacity||32));
            for(let seatNumber=1;seatNumber<=capacity;seatNumber++){
                const seat=document.createElement("div");seat.className="seat";seat.textContent=seatNumber;seat.dataset.seat=seatNumber;
                if(occupied.has(seatNumber)||locked.has(seatNumber)){seat.classList.add("occupied");seat.title=occupied.has(seatNumber)?"Booked":"Temporarily locked";}
                else seat.addEventListener("click",()=>{if(seat.classList.contains("occupied"))return;seat.classList.toggle("selected");updateCalculation();});
                seatMap.appendChild(seat);
            }
        }catch(error){seatMap.innerHTML=`<p class="no-movies">${esc(error.message||"Unable to load seats.")}</p>`;}
    }

    window.loadDynamicSeats=loadShowSeats;window.getSelectedCinemaShow=()=>selectedShow;
    window.addEventListener("ibox:cinema-change",()=>{lastSelectionKey="";if(dateSelect)dateSelect.value="";loadCatalog();});
    dateSelect?.addEventListener("change",()=>{lastSelectionKey="";loadCatalog();});timeSelect?.addEventListener("change",renderCatalog);search?.addEventListener("input",renderCatalog);category?.addEventListener("change",renderCatalog);document.addEventListener("DOMContentLoaded",()=>setTimeout(loadCatalog,300));
})();
