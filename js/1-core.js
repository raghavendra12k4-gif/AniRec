/* =========================================================
   app part 1 of 5: CORE
   Settings, shared helpers and card markup.
   API address, mood map, saved/skipped lists in the browser, toast messages, and the shared look of every anime card.
   Load order matters: index.html must load the 5 js files in number order
   (1 -> 5). They share one global scope, exactly like the old single app.js.
========================================================= */

// [CHANGED] Same behaviour as before for localhost and the hosted site. New: when the page is opened from a phone
// on the same Wi-Fi through the laptop's address (e.g. http://192.168.1.20:5500), the API is on that SAME machine
// (port 5000) - before, only "localhost" counted as local, so the phone fell through to the hosted server.
const API_BASE_URL = (() => {
    const host = window.location.hostname;
    if (host === "localhost" || host === "127.0.0.1") return "http://localhost:5000";

    const isHomeNetwork =
        /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) || host.endsWith(".local");
    if (isHomeNetwork) return `http://${host}:5000`;

    return "https://anirec-api.onrender.com";
})();


/* Map human-readable moods to query parameters */
const MOOD_MAP = {
  relaxing: { genres: ["Slice of Life"], tags: ["Iyashikei", "Relaxing"] },
  intense: { genres: ["Action" , "Thriller"], minScore: 7 },
  emotional: { genres: ["Drama", "Romance"] },
  "thought-provoking": { genres: ["Psychological", "Mystery", "Sci-Fi"] },
  funny: { genres: ["Comedy"] },
  disturbing: { genres: ["Psychological", "Horror"] },
  romance: { genres: ["Romance"] }
};

/* =========================================================
   [ADDED] LOCAL STORAGE HELPERS + TOAST
   - skipped (disliked) shows: never shown again in Surprise Me / recommendations / trending
   - saved shows: the "Saved For Later" list on the home page
   Everything is stored in this browser only (localStorage).
========================================================= */
const DISLIKED_KEY = "anirec_disliked_ids";
const SAVED_KEY = "anirec_saved_list";

// Reads JSON from localStorage and never throws (private mode / corrupted value -> fallback)
function readStorageJSON(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch (err) {
        console.warn(`Could not read ${key} from localStorage:`, err);
        return fallback;
    }
}

function writeStorageJSON(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
        console.warn(`Could not write ${key} to localStorage:`, err);
    }
}

function getDislikedIds() {
    const ids = readStorageJSON(DISLIKED_KEY, []);
    return Array.isArray(ids) ? ids.filter(Number.isInteger) : [];
}

function addDislikedId(id) {
    const numericId = Number(id);
    if (!Number.isInteger(numericId)) return;

    const ids = getDislikedIds().filter(existing => existing !== numericId);
    ids.push(numericId);
    writeStorageJSON(DISLIKED_KEY, ids.slice(-200)); // keep the most recent 200 so the URL stays short
}

function clearDislikedIds() {
    try {
        localStorage.removeItem(DISLIKED_KEY);
    } catch (err) {
        console.warn("Could not clear skipped shows:", err);
    }
}

// Removes skipped shows from a list of anime objects (used for the Trending row)
function filterDisliked(list) {
    const skipped = new Set(getDislikedIds());
    return (list || []).filter(anime => !skipped.has(anime.id));
}

function getSavedList() {
    const list = readStorageJSON(SAVED_KEY, []);
    return Array.isArray(list) ? list.filter(item => item && Number.isInteger(item.id)) : [];
}

function isSaved(id) {
    return getSavedList().some(item => item.id === Number(id));
}

// Saves just the fields a card needs, in the same shape the API returns, so buildAnimeCard() can render it
function saveAnime(anime) {
    if (!anime || isSaved(anime.id)) return;

    const list = getSavedList();
    list.unshift({
        id: anime.id,
        title: { english: anime.title?.english || null, romaji: anime.title?.romaji || null },
        averageScore: anime.averageScore ?? null,
        genres: (anime.genres || []).slice(0, 3),
        // [ADDED] status / format / episodes / year, so a saved show can still show its status and meta line
        status: anime.status ?? null,
        format: anime.format ?? null,
        episodes: anime.episodes ?? null,
        seasonYear: anime.seasonYear ?? anime.startDate?.year ?? null,
        // [CHANGED] also keep the poster colour so saved cards get the same coloured glow as every other card
        coverImage: { extraLarge: anime.coverImage?.extraLarge || anime.coverImage?.large || "", color: anime.coverImage?.color || null }
    });
    writeStorageJSON(SAVED_KEY, list.slice(0, 100));
}

function removeSaved(id) {
    const numericId = Number(id);
    writeStorageJSON(SAVED_KEY, getSavedList().filter(item => item.id !== numericId));
}

/* ---------- [ADDED] "Teach me your taste" favourites + feedback sent to the recommender ---------- */
const SEEDS_KEY = "anirec_seed_picks";

function getSeedPicks() {
    const picks = readStorageJSON(SEEDS_KEY, []);
    return Array.isArray(picks) ? picks.filter(pick => pick && Number.isInteger(pick.id)) : [];
}

function addSeedPick(pick) {
    if (!pick || !Number.isInteger(pick.id)) return;
    const picks = getSeedPicks().filter(existing => existing.id !== pick.id);
    picks.unshift({ id: pick.id, title: String(pick.title || "").slice(0, 120) });
    writeStorageJSON(SEEDS_KEY, picks.slice(0, 25));
}

function removeSeedPick(id) {
    writeStorageJSON(SEEDS_KEY, getSeedPicks().filter(pick => pick.id !== Number(id)));
}

// Every show the user has told us they like inside the app (favourite picks + saved shows).
// Sent to the server as "liked=" so the recommender learns from it - this even works without an AniList account.
function getLikedIds() {
    const ids = [...getSeedPicks().map(pick => pick.id), ...getSavedList().map(item => item.id)];
    return [...new Set(ids)].slice(0, 40);
}

// Small confirmation popup ("Saved for later", ...)
let toastTimer = null;
function showToast(message) {
    let toast = document.getElementById("toast");
    if (!toast) {
        toast = document.createElement("div");
        toast.id = "toast";
        toast.className = "toast";
        toast.setAttribute("role", "status");
        toast.setAttribute("aria-live", "polite");
        document.body.appendChild(toast);
    }

    toast.textContent = message;
    void toast.offsetWidth; // restart the CSS transition if a toast is already showing
    toast.classList.add("show");

    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2200);
}

/* =========================================================
   [ADDED] ANIME CARD: one shared look for every card on the site
   Poster with a STATUS badge (Airing / Finished / Upcoming ...) and a score badge, then the title,
   "year • format • episodes", up to 3 genre chips, a short synopsis and the action row
   (Watch Trailer, "+" Save for later, heart = Favourite).
========================================================= */

// AniList "status" values -> label + colour class (the colour lives in style.css as .status-<cls>)
const CARD_STATUS = {
    RELEASING:        { label: "Airing",    cls: "airing" },
    FINISHED:         { label: "Finished",  cls: "finished" },
    NOT_YET_RELEASED: { label: "Upcoming",  cls: "upcoming" },
    CANCELLED:        { label: "Cancelled", cls: "cancelled" },
    HIATUS:           { label: "On Hiatus", cls: "hiatus" }
};

const CARD_FORMAT = { TV: "TV", TV_SHORT: "TV Short", MOVIE: "Movie", SPECIAL: "Special", OVA: "OVA", ONA: "ONA", MUSIC: "Music" };
const CARD_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const CARD_ICONS = {
    play: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path d="M8 5.5v13l11-6.5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
    plus: '<svg class="icon-plus" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    check: '<svg class="icon-check" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    heart: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="M12 21s-7-4.35-9.5-9.2C.9 8.6 2.9 5 6.3 5c2 0 3.6 1 5.7 3.3C14.1 6 15.7 5 17.7 5c3.4 0 5.4 3.6 3.8 6.8C19 16.65 12 21 12 21z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>'
};

// Line icons for buttons and headings (they replace the old emoji and take the text colour)
const UI_ICONS = {
    dice: '<svg class="btn-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="0.9"/><circle cx="15" cy="9" r="0.9"/><circle cx="12" cy="12" r="0.9"/><circle cx="9" cy="15" r="0.9"/><circle cx="15" cy="15" r="0.9"/></svg>',
    bookmark: '<svg class="btn-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 3h12v18l-6-4-6 4z"/></svg>',
    heart: '<svg class="btn-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 21s-7-4.35-9.5-9.2C.9 8.6 2.9 5 6.3 5c2 0 3.6 1 5.7 3.3C14.1 6 15.7 5 17.7 5c3.4 0 5.4 3.6 3.8 6.8C19 16.65 12 21 12 21z"/></svg>',
    ban: '<svg class="btn-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/></svg>',
    play: '<svg class="btn-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 5.5v13l11-6.5z"/></svg>',
    calendar: '<svg class="btn-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
    check: '<svg class="btn-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
    stop: '<svg class="btn-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
    thumbUp: '<svg class="btn-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 11v9H4v-9zM7 11l4-8c1.7 0 3 1.3 3 3v3h5.2a2 2 0 0 1 2 2.3l-1.2 7a2 2 0 0 1-2 1.7H7"/></svg>',
    thumbDown: '<svg class="btn-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M17 13V4h3v9zM17 13l-4 8c-1.7 0-3-1.3-3-3v-3H4.8a2 2 0 0 1-2-2.3l1.2-7A2 2 0 0 1 6 4h11"/></svg>',
    target: '<svg class="h-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="0.8"/></svg>'
};

// [ADDED] Remembers the recommender's "why" line for each show that was shown on a card with one,
// so the details window's "Why this anime?" tab can reuse it.
const modalReasonHints = new Map();

// The badge shown at the top-left of the poster: the show's current status.
// Airing shows also say how many episodes are out; upcoming shows say when they start (when AniList knows).
function getCardStatusBadge(anime) {
    const info = CARD_STATUS[anime.status];
    if (!info) return { label: "Status unknown", cls: "unknown" };

    let label = info.label;
    if (anime.status === "RELEASING") {
        const nextEp = anime.nextAiringEpisode?.episode;
        if (Number.isInteger(nextEp) && nextEp > 1) label += ` · Ep ${nextEp - 1}`;
    } else if (anime.status === "NOT_YET_RELEASED") {
        const start = anime.startDate;
        if (start?.year) label += ` · ${start.month ? CARD_MONTHS[start.month - 1] + " " : ""}${start.year}`;
    }
    return { label, cls: info.cls };
}

// "2013 • TV • 25 eps"
function getCardMeta(anime) {
    const parts = [];
    const year = anime.seasonYear || anime.startDate?.year;
    if (year) parts.push(year);
    if (anime.format) parts.push(CARD_FORMAT[anime.format] || String(anime.format).replace(/_/g, " "));
    if (anime.format !== "MOVIE") {
        if (anime.episodes) parts.push(`${anime.episodes} ${anime.episodes === 1 ? "ep" : "eps"}`);
        else if (anime.status === "RELEASING") parts.push("Ongoing");
    }
    return parts.join(" • ");
}

// Plain-text synopsis (AniList can still send <br> and <i> tags). The CSS cuts it to 3 lines.
function getCardSynopsis(anime) {
    const plain = String(anime.description || "")
        .replace(/<br\s*\/?>/gi, " ")
        .replace(/<[^>]*>/g, "")
        .replace(/\s+/g, " ")
        .trim();
    if (!plain) return "No synopsis available yet.";
    return escapeHtml(plain.length > 320 ? plain.slice(0, 320).trimEnd() + "…" : plain);
}

function hasRealTrailer(anime) {
    return Boolean(anime.trailer?.id) && (anime.trailer.site === "youtube" || anime.trailer.site === "dailymotion");
}

// Direct trailer link when AniList has one, otherwise a YouTube search for it
function getTrailerUrl(anime, title) {
    if (hasRealTrailer(anime)) {
        const id = encodeURIComponent(anime.trailer.id);
        return anime.trailer.site === "youtube"
            ? `https://www.youtube.com/watch?v=${id}`
            : `https://www.dailymotion.com/video/${id}`;
    }
    return `https://www.youtube.com/results?search_query=${encodeURIComponent(`${title} anime trailer`)}`;
}

function cardPosterHTML(anime, title) {
    const cover = escapeHtml(anime.coverImage?.extraLarge || anime.coverImage?.large || anime.coverImage?.medium || "");
    const status = getCardStatusBadge(anime);
    const score = anime.averageScore ? (anime.averageScore / 10).toFixed(1) : "N/A";
    return `
        <div class="card-poster">
            <img src="${cover}" alt="${escapeHtml(title)}" loading="lazy" />
            <span class="status-badge status-${status.cls}"><span class="status-dot" aria-hidden="true"></span><span class="status-text">${escapeHtml(status.label)}</span></span>
            <span class="score-badge" title="AniList average score"><span class="score-star" aria-hidden="true">★</span>${score}</span>
        </div>`;
}

function cardGenresHTML(anime) {
    const chips = (anime.genres || []).slice(0, 3)
        .map(genre => `<span class="genre-chip">${escapeHtml(genre)}</span>`)
        .join("");
    return chips ? `<div class="card-genres">${chips}</div>` : "";
}

// Skeleton shown while cards load (same proportions as a real card)
function skeletonCardHTML() {
    return `
        <div class="skeleton-card">
            <div class="skeleton-img"></div>
            <div class="skeleton-info">
                <div class="skeleton-text skeleton-title"></div>
                <div class="skeleton-text skeleton-meta"></div>
                <div class="skeleton-text skeleton-chips"></div>
                <div class="skeleton-text skeleton-synopsis"></div>
                <div class="skeleton-text skeleton-synopsis short"></div>
            </div>
        </div>`;
}

// Keeps the "+" (saved) and heart (favourite) buttons of every card on the page in sync with the stored lists
function refreshCardButtons() {
    const saved = new Set(getSavedList().map(item => item.id));
    const favourites = new Set(getSeedPicks().map(pick => pick.id));

    document.querySelectorAll(".anime-card[data-anime-id]").forEach(card => {
        const id = Number(card.dataset.animeId);

        const saveBtn = card.querySelector(".card-save-btn");
        if (saveBtn) {
            const on = saved.has(id);
            saveBtn.classList.toggle("is-active", on);
            saveBtn.setAttribute("aria-pressed", String(on));
            saveBtn.setAttribute("aria-label", on ? "Remove from saved" : "Save for later");
            saveBtn.title = on ? "Saved for later (click to remove)" : "Save for later";
        }

        const favBtn = card.querySelector(".card-fav-btn");
        if (favBtn) {
            const on = favourites.has(id);
            favBtn.classList.toggle("is-active", on);
            favBtn.setAttribute("aria-pressed", String(on));
            favBtn.setAttribute("aria-label", on ? "Remove from favourites" : "Add to favourites");
            favBtn.title = on ? "In your favourites (click to remove)" : "Add to favourites";
        }
    });
}

function handleCardAction(action, anime, title) {
    if (action === "save") {
        if (isSaved(anime.id)) {
            removeSaved(anime.id);
            showToast("Removed from saved");
        } else {
            saveAnime(anime);
            showToast("Saved for later");
        }
        renderSavedRow();
    } else if (action === "favourite") {
        const isFavourite = getSeedPicks().some(pick => pick.id === Number(anime.id));
        if (isFavourite) {
            removeSeedPick(anime.id);
            showToast("Removed from favourites");
        } else {
            addSeedPick({ id: anime.id, title });
            showToast("Added to your favourites");
        }
        onSeedsChanged(); // refreshes the favourites list + the taste profile (and the card buttons)
    }
    refreshCardButtons();
}
