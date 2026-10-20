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
   1. DROPDOWN TOGGLES & EXTERNAL CLICK CLOSING
========================================================= */

const filters = document.querySelectorAll(".filter");

filters.forEach(filter => {
    const button = filter.querySelector(".filter-btn");

    button.addEventListener("click", (e) => {
        e.stopPropagation();
        // Close other dropdown menus
        filters.forEach(otherFilter => {
            if (otherFilter !== filter) {
                otherFilter.classList.remove("open");
            }
        });

        // Toggle current dropdown
        filter.classList.toggle("open");
    });
});

// Close all dropdown menus if user clicks outside
document.addEventListener("click", (event) => {
    if (!event.target.closest(".filter")) {
        filters.forEach(filter => filter.classList.remove("open"));
    }
});

/* =========================================================
   2. DYNAMIC YEAR POPULATION (Current Year down to 1990)
========================================================= */

function populateYearFilter() {
    const yearContainer = document.getElementById("yearFilterMenu");
    if (!yearContainer) return;

    const startYear = new Date().getFullYear();
    const endYear = 1990;

    let html = "";
    for (let yr = startYear; yr >= endYear; yr--) {
        html += `
            <label>
                <input type="radio" name="year" value="${yr}">
                ${yr}
            </label>
        `;
    }

    yearContainer.innerHTML = html;
}

populateYearFilter();

/* =========================================================
   3. DESELECTABLE RADIO BUTTONS LOGIC
========================================================= */

// Track checked state of radio buttons so they can be toggled off (deselected)
document.addEventListener("click", (e) => {
    if (e.target && e.target.type === "radio") {
        const radio = e.target;
        if (radio.dataset.wasChecked === "true") {
            radio.checked = false;
            radio.dataset.wasChecked = "false";
            // Trigger change event to update state and labels
            radio.dispatchEvent(new Event("change", { bubbles: true }));
        } else {
            // Clear wasChecked on all radio buttons in the same group
            document.querySelectorAll(`input[type="radio"][name="${radio.name}"]`).forEach(r => {
                r.dataset.wasChecked = "false";
            });
            radio.dataset.wasChecked = "true";
        }
    }
});

/* =========================================================
   4. UPDATE FILTER BUTTON LABELS & ACTIVE DOT BADGES
========================================================= */

function updateFilterActiveStates() {
    filters.forEach(container => {
        const button = container.querySelector('.filter-btn');
        const txtSpan = button ? button.querySelector('.btn-txt') : null;
        if (!button || !txtSpan) return;

        const defaultTitle = container.dataset.filterName || "Select";
        const checkedInputs = Array.from(container.querySelectorAll('input:checked'));

        let dot = txtSpan.querySelector('.active-dot');

        if (checkedInputs.length > 0) {
            button.classList.add('active');

            // Format dynamic label
            let selectedText = "";
            if (checkedInputs.length === 1) {
                const rawVal = checkedInputs[0].dataset.label || checkedInputs[0].value;
                selectedText = (container.dataset.filterName === "Rating") ? `${rawVal}+` : rawVal;
            } else {
                selectedText = `${checkedInputs.length} Selected`;
            }

            txtSpan.textContent = selectedText;

            // Ensure active dot is present
            if (!dot) {
                dot = document.createElement('span');
                dot.className = 'active-dot';
            }
            txtSpan.prepend(dot);
        } else {
            button.classList.remove('active');
            txtSpan.textContent = defaultTitle;
            if (dot) dot.remove();
        }
    });
}

// Watch changes on the filter section container
const filterSection = document.querySelector('.filter-sec');
if (filterSection) {
    filterSection.addEventListener('change', updateFilterActiveStates);
}

/* =========================================================
   5. RESET FILTERS FUNCTIONALITY
========================================================= */

const homeSearchInput = document.getElementById("homeSearchInput");
const homeSearchClear = document.getElementById("homeSearchClear");
const homeSearchSuggest = document.getElementById("homeSearchSuggest");
let homeSearchSuggestTimer = null;
let homeSearchSuggestToken = 0;
homeSearchInput?.setAttribute("aria-expanded", "false");

function updateHomeSearchClear() {
    if (homeSearchClear && homeSearchInput) {
        homeSearchClear.classList.toggle("hidden", homeSearchInput.value.length === 0);
    }
}

function hideHomeSearchSuggest() {
    homeSearchSuggestToken++;
    homeSearchSuggest?.classList.add("hidden");
    homeSearchInput?.setAttribute("aria-expanded", "false");
    if (homeSearchSuggest) homeSearchSuggest.innerHTML = "";
}

async function showHomeSearchSuggestions(query) {
    const token = ++homeSearchSuggestToken;
    try {
        const list = await fetchJson(`http://localhost:5000/api/search?q=${encodeURIComponent(query)}`);
        if (token !== homeSearchSuggestToken || !homeSearchSuggest) return;

        homeSearchSuggest.innerHTML = "";
        if (list.length === 0) {
            homeSearchSuggest.innerHTML = `<p class="suggest-empty">No matches</p>`;
        }
        list.forEach(anime => {
            const title = anime.title.english || anime.title.romaji;
            const meta = [anime.format, anime.seasonYear].filter(Boolean).join(" · ");
            const option = document.createElement("button");
            option.type = "button";
            option.className = "suggest-item";
            option.setAttribute("role", "option");
            option.innerHTML = `<span>${escapeHtml(title)}</span><small>${escapeHtml(meta)}</small>`;
            option.addEventListener("click", () => {
                homeSearchInput.value = title;
                updateHomeSearchClear();
                hideHomeSearchSuggest();
                fetchRecommendations();   // picking a suggestion shows its results straight away
            });
            homeSearchSuggest.appendChild(option);
        });
        homeSearchSuggest.classList.remove("hidden");
        homeSearchInput?.setAttribute("aria-expanded", "true");
    } catch (error) {
        if (token !== homeSearchSuggestToken || !homeSearchSuggest) return;
        console.error("Home search suggestions failed:", error);
        homeSearchSuggest.innerHTML = `<p class="suggest-empty">Suggestions unavailable. Check that the server is running.</p>`;
        homeSearchSuggest.classList.remove("hidden");
        homeSearchInput?.setAttribute("aria-expanded", "true");
    }
}

const resetBtn = document.getElementById("resetBtn");
if (resetBtn) {
    resetBtn.addEventListener("click", () => {
        // Clear all checkboxes & radios
        document.querySelectorAll('.filter-sec input[type="checkbox"], .filter-sec input[type="radio"]').forEach(input => {
            input.checked = false;
            if (input.type === "radio") input.dataset.wasChecked = "false";
        });


        // Reset filter button labels & UI states
        updateFilterActiveStates();

        // Close any open filter dropdowns
        filters.forEach(filter => filter.classList.remove("open"));

        if (homeSearchInput) homeSearchInput.value = "";
        updateHomeSearchClear();
        clearTimeout(homeSearchSuggestTimer);
        hideHomeSearchSuggest();

        // Hide the results section again (back to the clean home state)
        document.getElementById("resultSection").classList.add("hidden");

        // [ADDED] Forget the fetched results and remove the filters from the URL (see "FILTERS IN THE URL" below)
        recommendationRequestId++;
        currentResults = [];
        currentSearchQuery = "";
        clearFiltersFromHash();
    });
}


/* =========================================================
   6. GET USER PREFERENCES & FETCH RECOMMENDATIONS
========================================================= */

function getPreferences() {
  // Grab selected mood inputs
  const selectedMoods = [
    ...document.querySelectorAll('input[name="mood"]:checked')
  ].map(input => input.value);

  // Collect checked genre checkboxes
  const selectedGenres = [
    ...document.querySelectorAll('input[name="genre"]:checked')
  ].map(input => input.value);

  // Grab radio inputs
  const ratingInput = document.querySelector('input[name="rating"]:checked');
  const yearInput = document.querySelector('input[name="year"]:checked');
  const formatInput = document.querySelector('input[name="format"]:checked');
  const languageInput = document.querySelector('input[name="language"]:checked'); // Added

  // Grab username directly from localStorage
  const savedUsername = localStorage.getItem("anilist_username");

  return {
    moods: selectedMoods,
    genres: selectedGenres,
    rating: ratingInput ? ratingInput.value : null,
    year: yearInput ? yearInput.value : null,
    format: formatInput ? formatInput.value : null,
    language: languageInput ? languageInput.value : null, // Added
    search: homeSearchInput ? homeSearchInput.value.trim().slice(0, 80) : "",
    username: savedUsername || null
  };
}

// [ADDED] State for the results area:
//  - recommendationRequestId: lets us ignore a slow response if the user pressed Apply again meanwhile
//  - currentResults / shownCount: the server returns up to 20 shows; we reveal 10 at a time ("Show more")
let recommendationRequestId = 0;
let currentResults = [];
let currentSearchQuery = "";
let shownCount = 0;
const RESULTS_PAGE_SIZE = 10;

// [CHANGED] Accepts an optional { scroll } flag (Roll Again passes scroll:false so the page doesn't jump)
async function fetchRecommendations(options = {}) {
    const { scroll = true } = options;
    const prefs = getPreferences();
    const resultsContainer = document.getElementById("animeResults");
    currentSearchQuery = prefs.search;

    // [ADDED] Every call gets a new id; only the newest call is allowed to draw results
    const requestId = ++recommendationRequestId;

    // Reveal the results section and bring it into view
    const resultSection = document.getElementById("resultSection");
    resultSection.classList.remove("hidden");
    document.getElementById("resultsTitle").textContent = prefs.search
        ? `Results for “${prefs.search}”`
        : "Your Recommendations";
    document.getElementById("resultsSubtitle").textContent = prefs.search
        ? "Matched to your search and selected filters"
        : "Matched to your filters and the shows you rate highly";
    if (scroll) {
        resultSection.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    // [ADDED] Hide the old "Show more / Roll again" buttons and note while loading
    currentResults = [];
    updateResultsActions(false);

    resultsContainer.innerHTML = Array(5).fill(0).map(() => `
        <div class="skeleton-card">
            <div class="skeleton-img"></div>
            <div class="skeleton-info">
                <div class="skeleton-text skeleton-title"></div>
                <div class="skeleton-text skeleton-score"></div>
                <div class="skeleton-text skeleton-genres"></div>
            </div>
        </div>
    `).join('');

    const params = new URLSearchParams();

   // 1. Resolve Moods -> Genres & Tags
    const resolvedGenres = new Set(prefs.genres);
    // [ADDED] Genres that come from moods are sent separately ("moodGenre") from the genres the user ticked,
    // so the server can loosen the mood part (and only the mood part) if the combination finds nothing.
    const resolvedMoodGenres = new Set();
    const resolvedTags = new Set(); // Added to track tags from MOOD_MAP
    let computedMinScore = prefs.rating ? parseInt(prefs.rating, 10) : null;

    prefs.moods.forEach(moodKey => {
        const mapped = MOOD_MAP[moodKey];
        if (mapped) {
            if (mapped.genres) {
                mapped.genres.forEach(g => resolvedMoodGenres.add(g)); // [CHANGED] was resolvedGenres.add(g)
            }
            if (mapped.tags) { // Capture tags (like Iyashikei for relaxing)
                mapped.tags.forEach(t => resolvedTags.add(t));
            }
            if (mapped.minScore && (!computedMinScore || mapped.minScore > computedMinScore)) {
                computedMinScore = mapped.minScore;
            }
        }
    });

    // 2. Append parameters cleanly
    resolvedGenres.forEach(g => params.append("genre", g));
    resolvedMoodGenres.forEach(g => params.append("moodGenre", g)); // [ADDED]
    resolvedTags.forEach(t => params.append("tag", t)); // Pass tags to server
    if (computedMinScore) params.append("rating", computedMinScore);
    if (prefs.year) params.append("year", prefs.year);
    if (prefs.format) params.append("format", prefs.format);
    if (prefs.language) params.append("language", prefs.language); // Added
    if (prefs.search) params.append("search", prefs.search);
    if (prefs.username) params.append("username", prefs.username);

    // [ADDED] Never recommend shows the user skipped with the 👎 button in Surprise Me
    const skippedIds = getDislikedIds();
    if (skippedIds.length > 0) params.append("exclude", skippedIds.join(","));

    // [ADDED] Shows the user saved / picked as favourites teach the recommender what they truly like
    const likedIds = getLikedIds();
    if (likedIds.length > 0) params.append("liked", likedIds.join(","));

    // [ADDED] Put the chosen filters in the address bar so this search can be bookmarked / shared
    writeFiltersToHash(prefs);

    try {
        const response = await fetch(`http://localhost:5000/api/anime?${params.toString()}`);
        const payload = await response.json();

        if (requestId !== recommendationRequestId) return; // a newer search replaced this one

        // [CHANGED] Show the server's own message (e.g. "AniList is rate-limiting...") instead of crashing on .slice()
        if (!response.ok) {
            const serverError = new Error(payload?.error || "Request failed");
            serverError.fromServer = true;
            throw serverError;
        }

        currentResults = Array.isArray(payload) ? payload : [];
        shownCount = RESULTS_PAGE_SIZE;
        renderAnimeCards(currentResults.slice(0, shownCount));

        // The server sets X-Match-Level: relaxed when it had to loosen the mood/genre combo to find matches
        // [CHANGED] Also reads X-Profile-Strength: if the recommender knows little about the user, say how to fix that
        const strength = response.headers.get("X-Profile-Strength");
        const hasPersonalSource = Boolean(prefs.username) || getSeedPicks().length > 0;
        const profileNote = hasPersonalSource && strength !== "good"
            ? "Your taste profile is still light, so these picks are only loosely personalised. Rate more shows on AniList, or add favourites under Profile → Teach me your taste."
            : "";
        updateResultsActions(response.headers.get("X-Match-Level") === "relaxed", profileNote);
    } catch (error) {
        if (requestId !== recommendationRequestId) return;

        console.error("Fetch error:", error);
        currentResults = [];
        updateResultsActions(false);
        resultsContainer.innerHTML = `<p class="error-msg">${
            error.fromServer ? escapeHtml(error.message) : "Failed to load anime results. Check if server is running."
        }</p>`;
    }
}

/* =========================================================
   7. RENDER ANIME CARDS
========================================================= */

function renderAnimeCards(list) {
    const container = document.getElementById("animeResults");
    container.innerHTML = "";

    if (!list || list.length === 0) {
        const message = currentSearchQuery
            ? "No anime matched your search and filters. Try a different title or fewer options."
            : "No anime matched those filters. Try selecting fewer options.";
        container.innerHTML = `<p class="no-results">${message}</p>`;
        return;
    }

    list.forEach(anime => {
        const title = anime.title.english || anime.title.romaji;
        const score = anime.averageScore ? `${anime.averageScore}%` : "N/A";
        const genres = anime.genres ? anime.genres.slice(0, 3).join(", ") : "N/A";
        // [CHANGED] Everything coming from the API is escaped before going into innerHTML
        const cover = escapeHtml(anime.coverImage?.extraLarge || anime.coverImage?.large || "");
        
        // [ADDED] Grab dominant color from AniList, fallback to default primary color
        const accentColor = anime.coverImage?.color || "#8b56b7";

        const card = document.createElement("div");
        card.className = "anime-card";

        // [ADDED] Set CSS variable directly on the card element inline style
        card.style.setProperty("--card-accent", accentColor);
        
        // [CHANGED] Added the optional "reason" line (e.g. "Matches your taste for Action & Drama")
        card.innerHTML = `
            <img src="${cover}" alt="${escapeHtml(title)}" loading="lazy" />
            <div class="anime-info">
                <h3>${escapeHtml(title)}</h3>
                <p class="score">⭐ ${score}</p>
                <p class="genres">${escapeHtml(genres)}</p>
                ${anime.reason ? `<p class="reason-text">${escapeHtml(anime.reason)}</p>` : ""}
            </div>
        `;

        // Keep modal open event on card click (ignoring clicks on the watch link itself)
        card.addEventListener("click", (e) => {
            if (!e.target.classList.contains("watch-btn")) {
                openAnimeModal(anime.id);
            }
        });

        // [ADDED] Cards can now be focused with Tab and opened with Enter / Space
        makeCardAccessible(card, `View details: ${title}`, () => openAnimeModal(anime.id));

        container.appendChild(card);
    });
}

const generateBtn = document.getElementById("generateBtn");
if (generateBtn) {
    // [CHANGED] Wrapped in an arrow function: fetchRecommendations now takes an options object, and addEventListener
    // would otherwise pass the click Event as that first argument.
    generateBtn.addEventListener("click", () => fetchRecommendations());
}

if (homeSearchInput) {
    homeSearchInput.addEventListener("input", () => {
        updateHomeSearchClear();
        clearTimeout(homeSearchSuggestTimer);
        hideHomeSearchSuggest();
        const query = homeSearchInput.value.trim();
        if (query.length < 2) {
            return;
        }
        homeSearchSuggestTimer = setTimeout(() => showHomeSearchSuggestions(query), 300);
    });
    homeSearchInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            clearTimeout(homeSearchSuggestTimer);
            hideHomeSearchSuggest();
            fetchRecommendations();
        } else if (event.key === "Escape") {
            hideHomeSearchSuggest();
        }
    });
}

if (homeSearchClear) {
    homeSearchClear.addEventListener("click", () => {
        if (!homeSearchInput) return;
        clearTimeout(homeSearchSuggestTimer);
        homeSearchInput.value = "";
        updateHomeSearchClear();
        hideHomeSearchSuggest();
        fetchRecommendations();
        homeSearchInput.focus();
    });
}

document.addEventListener("click", (event) => {
    if (!event.target.closest(".home-search")) hideHomeSearchSuggest();
});

/* =========================================================
   8. ANIME DETAILS MODAL LOGIC
========================================================= */

const modal = document.getElementById("animeModal");
const closeModalBtn = document.getElementById("closeModal");
const modalBody = document.getElementById("modalBody");

// Modal closing event handlers
if (closeModalBtn) {
    closeModalBtn.addEventListener("click", () => modal.classList.add("hidden"));
}

if (modal) {
    modal.addEventListener("click", (e) => {
        if (e.target === modal) modal.classList.add("hidden");
    });
}

// [ADDED] Modal state:
//  - modalRequestId: if the user clicks another card before the first one finished loading, only the newest
//    request may fill the modal (stops old responses overwriting new ones)
//  - currentModalAnime: the anime currently shown (used by the Save / Like buttons)
let modalRequestId = 0;
let currentModalAnime = null;

// [CHANGED] Now returns the anime object when it rendered, or null when the request failed / was replaced.
async function openAnimeModal(animeId) {
    if (!modal) return null;

    const requestId = ++modalRequestId;
    currentModalAnime = null;

    modal.classList.remove("hidden");
    modalBody.innerHTML = `<p class="loading-msg">Loading details...</p>`;

    try {
        const res = await fetch(`http://localhost:5000/api/anime/${encodeURIComponent(animeId)}`);
        const anime = await res.json();

        // Inside openAnimeModal(animeId), right after fetching `anime`:
        const accentColor = anime.coverImage?.color || "#8b56b7";
        modalBody.style.setProperty("--modal-accent", accentColor);

        if (requestId !== modalRequestId) return null; // a newer modal request took over

        if (!res.ok) throw new Error(anime.error);

        currentModalAnime = anime;

        // [CHANGED] rawTitle = untouched title (used for the watch URL); title = HTML-escaped version for display.
        // Before, the escaped title was also put into the watch URL, so titles with ' or & were searched as "&#39;".
        const rawTitle = anime.title.english || anime.title.romaji;
        const title = escapeHtml(rawTitle);
        const nativeTitle = escapeHtml(anime.title.native || '');
        const studio = escapeHtml(anime.studios?.nodes?.[0]?.name || "N/A");
        const seasonText = escapeHtml(anime.season && anime.seasonYear ? `${anime.season} ${anime.seasonYear}` : "N/A");
        const format = escapeHtml(anime.format || 'N/A');
        const status = escapeHtml(anime.status || 'N/A');
        const score = anime.averageScore ? `${anime.averageScore}%` : 'N/A';
        const description = sanitizeDescription(anime.description);
        

        // Construct backend watch URL
        // [CHANGED] Uses rawTitle, and the unused anilistId parameter (the server ignored it) was removed
        const watchUrl = `http://localhost:5000/api/watch?title=${encodeURIComponent(rawTitle)}`;

        // [ADDED] Official streaming platforms from AniList (Crunchyroll, Netflix, ...), one button per site.
        // Only http(s) links are accepted. The Miruro search button below stays as an extra option.
        const seenSites = new Set();
        const officialLinks = (anime.externalLinks || []).filter(link => {
            if (link?.type !== "STREAMING" || !link.url || !/^https?:\/\//i.test(link.url)) return false;
            if (seenSites.has(link.site)) return false;
            seenSites.add(link.site);
            return true;
        }).slice(0, 6);

        const officialLinksHTML = officialLinks.map(link => `
            <a href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer" class="modal-watch-btn official-watch-btn">
                ▶ ${escapeHtml(link.site)} ↗
            </a>
        `).join("");
        
        const trailerEmbed = anime.trailer?.site === "youtube" 
            ? `<div class="trailer-container">
                 <iframe src="https://www.youtube.com/embed/${escapeHtml(anime.trailer.id)}" frameborder="0" allowfullscreen></iframe>
               </div>` 
            : '';


        const animeRelations = anime.relations?.edges?.filter(edge => edge.node.type === "ANIME") || [];
        
        let relatedHTML = "";
        if (animeRelations.length > 0) {
            relatedHTML = `
                <div class="related-section">
                    <h3>Related Anime</h3>
                    <div class="related-grid">
                        ${animeRelations.slice(0, 6).map(edge => {
                            // [CHANGED] Titles / relation types / ids / image URLs are escaped here too
                            const relTitle = escapeHtml(edge.node.title.english || edge.node.title.romaji);
                            const relType = escapeHtml(edge.relationType.replace(/_/g, " "));
                            return `
                                <div class="related-card" data-id="${escapeHtml(edge.node.id)}">
                                    <img src="${escapeHtml(edge.node.coverImage?.large || "")}" alt="${relTitle}" />
                                    <div class="related-info">
                                        <p class="related-title">${relTitle}</p>
                                        <span class="related-type">${relType}</span>
                                    </div>
                                </div>
                            `;
                        }).join("")}
                    </div>
                </div>
            `;
        }

        modalBody.innerHTML = `
            <div class="modal-header-banner">
                ${anime.bannerImage ? `<img src="${escapeHtml(anime.bannerImage)}" class="banner-img" />` : ''}
            </div>
            <div class="modal-details-grid">
                <img src="${escapeHtml(anime.coverImage.extraLarge)}" class="modal-poster" alt="${title}" />
                <div class="modal-info">
                    <h2>${title}</h2>
                    <p class="native-title">${nativeTitle}</p>
                    
                    <div class="meta-badges">
                        <span class="badge score">⭐ ${score}</span>
                        <span class="badge">${format}</span>
                        <span class="badge">${status}</span>
                    </div>

                    <div class="detail-row">
                        <p><strong>Episodes:</strong> ${escapeHtml(anime.episodes || 'N/A')}</p>
                        <p><strong>Season:</strong> ${seasonText}</p>
                        <p><strong>Studio:</strong> ${studio}</p>
                    </div>

                    <div class="genres-list">
                        ${anime.genres ? anime.genres.map(g => `<span class="genre-tag">${escapeHtml(g)}</span>`).join('') : ''}
                    </div>

                    <!-- [CHANGED] Official streaming links first, then the Miruro search link, then a Save button -->
                    <div class="modal-watch-section">
                        <h3>Where to Watch</h3>
                        <div class="modal-watch-links">
                            ${officialLinksHTML}
                            <a href="${escapeHtml(watchUrl)}" target="_blank" rel="noopener noreferrer" class="modal-watch-btn">
                                Watch on Miruro ↗
                            </a>
                        </div>
                        <div class="modal-action-row">
                            <button type="button" id="modalSaveBtn" class="modal-save-btn"></button>
                            <button type="button" id="modalDislikeBtn" class="modal-dislike-btn">👎 Not interested</button>
                        </div>
                    </div>

                    <h3>Synopsis</h3>
                    <p class="synopsis">${description}</p>

                    ${trailerEmbed}
                    ${relatedHTML}
                </div>
            </div>
        `;

        modalBody.querySelectorAll(".related-card").forEach(card => {
            card.addEventListener("click", () => openAnimeModal(card.getAttribute("data-id")));
            // [ADDED] keyboard access for related cards
            makeCardAccessible(card, `View details: ${card.querySelector(".related-title")?.textContent || "related anime"}`,
                () => openAnimeModal(card.getAttribute("data-id")));
        });

        // [ADDED] "Save for later" toggle (saved shows appear in the "Saved For Later" section on the home page)
        const saveBtn = document.getElementById("modalSaveBtn");
        if (saveBtn) {
            const refreshSaveBtn = () => {
                const saved = isSaved(anime.id);
                saveBtn.classList.toggle("saved", saved);
                saveBtn.textContent = saved ? "✓ Saved for later" : "♡ Save for later";
            };
            refreshSaveBtn();

            saveBtn.addEventListener("click", () => {
                if (isSaved(anime.id)) {
                    removeSaved(anime.id);
                    showToast("Removed from saved");
                } else {
                    saveAnime(anime);
                    showToast("Saved for later");
                }
                refreshSaveBtn();
                renderSavedRow();
            });
        }

        // [ADDED] "Not interested": hides this show from every future suggestion (same list as the Surprise Me skip)
        const dislikeBtn = document.getElementById("modalDislikeBtn");
        if (dislikeBtn) {
            dislikeBtn.addEventListener("click", () => {
                addDislikedId(anime.id);
                removeSaved(anime.id);
                renderSavedRow();
                document.querySelectorAll(`.anime-card[data-anime-id="${anime.id}"]`).forEach(el => el.remove());
                discoverLoadedFor = undefined; // Discover rows reload next visit without it
                modal.classList.add("hidden");
                showToast("Got it. You won't see this one again");
            });
        }

        return anime;

    } catch (err) {
        if (requestId !== modalRequestId) return null;
        console.error("Modal fetch error:", err);
        modalBody.innerHTML = `<p class="error-msg">Failed to load details for this anime.</p>`;
        return null;
    }
}



/* =========================================================
   USER PROFILE & LOCALSTORAGE PERSISTENCE LOGIC
========================================================= */

// DOM Elements
const profileModal = document.getElementById("profileModal");
const openProfileBtn = document.getElementById("openProfileBtn");
const closeProfileModal = document.getElementById("closeProfileModal");
const navUsername = document.getElementById("navUsername");

const profileConnectState = document.getElementById("profileConnectState");
const profileConnectedState = document.getElementById("profileConnectedState");
const anilistUsernameInput = document.getElementById("anilistUsernameInput");
const saveUsernameBtn = document.getElementById("saveUsernameBtn");
const disconnectProfileBtn = document.getElementById("disconnectProfileBtn");

const userAvatar = document.getElementById("userAvatar");
const userDisplayName = document.getElementById("userDisplayName");

// Toggle Profile Modal Visibility
if (openProfileBtn) {
    openProfileBtn.addEventListener("click", () => {
        profileModal.classList.remove("hidden");
    });
}

if (closeProfileModal) {
    closeProfileModal.addEventListener("click", () => {
        profileModal.classList.add("hidden");
    });
}

// Check local storage on page load and fetch user data if remembered
document.addEventListener("DOMContentLoaded", () => {
    const savedUsername = localStorage.getItem("anilist_username");
    if (savedUsername) {
        loadUserProfile(savedUsername);
    }
});

// Connect button click event
if (saveUsernameBtn) {
    saveUsernameBtn.addEventListener("click", () => {
        const username = anilistUsernameInput.value.trim();
        if (username) {
            loadUserProfile(username);
        }
    });
}

// [ADDED] Pressing Enter in the username box connects too
if (anilistUsernameInput && saveUsernameBtn) {
    anilistUsernameInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") saveUsernameBtn.click();
    });
}

// Disconnect button click event
if (disconnectProfileBtn) {
    disconnectProfileBtn.addEventListener("click", () => {
        localStorage.removeItem("anilist_username");
        updateProfileUI(null);
    });
}

// Fetch user data from backend and store in localStorage
// [ADDED] Inline error message under the username box (replaces the old alert() popup)
const profileConnectError = document.getElementById("profileConnectError");

function setProfileConnectError(message) {
    if (!profileConnectError) return;
    profileConnectError.textContent = message || "";
    profileConnectError.classList.toggle("hidden", !message);
}

async function loadUserProfile(username) {
    // [ADDED] Loading state: disable the button so a double click can't send two requests
    setProfileConnectError("");
    if (saveUsernameBtn) {
        saveUsernameBtn.disabled = true;
        saveUsernameBtn.textContent = "Connecting...";
    }

    try {
        const encodedUsername = encodeURIComponent(username);
        // [CHANGED] Now actually uses the encoded username (it was created before but never used)
        const response = await fetch(`http://localhost:5000/api/user/${encodedUsername}`);
        if (!response.ok) {
            // [CHANGED] Inline message instead of alert("User not found on AniList!")
            const errorBody = await response.json().catch(() => ({}));
            setProfileConnectError(
                response.status === 404
                    ? "User not found on AniList."
                    : (errorBody.error || "Could not load that profile. Please try again.")
            );
            return;
        }

        const userData = await response.json();
        
        // Save to browser memory so site remembers user
        localStorage.setItem("anilist_username", userData.name);
        
        // Update UI
        updateProfileUI(userData);

    } catch (error) {
        console.error("Error loading user profile:", error);
        setProfileConnectError("Could not reach the server. Is it running?");
    } finally {
        if (saveUsernameBtn) {
            saveUsernameBtn.disabled = false;
            saveUsernameBtn.textContent = "Connect";
        }
    }
}

// Render dynamic genre progress bars
function renderGenreBars(genres, totalAnime) {
    const container = document.getElementById("genreBarsContainer");
    if (!container) return;

    let html = "";
    genres.slice(0, 5).forEach(item => {
        // Calculate percentage from total count
        const percentage = totalAnime > 0 ? Math.round((item.count / totalAnime) * 100) : 0;

        html += `
            <div class="genre-row">
                <span class="genre-name">${escapeHtml(item.genre)}</span>
                <div class="bar-track">
                    <div class="bar-fill" style="width: ${percentage}%;"></div>
                </div>
                <span class="genre-percent">${percentage}%</span>
            </div>
        `;
    });

    container.innerHTML = html;
}

// Genre Icon Mapping
const genreIcons = {
    "Action": "🔥",
    "Psychological": "🧠",
    "Fantasy": "⚔️",
    "Romance": "❤️",
    "Comedy": "😂",
    "Drama": "🎭",
    "Slice of Life": "🍃",
    "Sci-Fi": "🚀",
    "Horror": "💀",
    "Mystery": "🔍",
    "Mahou Shoujo": "✨",
    "Sports": "⚽",
    "Thriller": "🔪",
    "Supernatural": "👻",
    "Adventure": "🗺️"
};

// Generate dynamic narrative quote based on top genres
function generateTasteNarrative(topGenres) {
    if (!topGenres || topGenres.length === 0) {
        return "Not enough watch data to generate a taste profile yet.";
    }

    const primary = topGenres[0]?.genre;
    const secondary = topGenres[1]?.genre;

    // Custom narrative rules based on combinations
    if (primary === "Action" || secondary === "Action") {
        if (primary === "Psychological" || secondary === "Psychological" || primary === "Thriller") {
            return '"You seem to prefer high-stakes stories with strong character development and darker, intense themes."';
        }
        if (primary === "Fantasy" || secondary === "Fantasy") {
            return '"You love epic world-building, high-octane battles, and larger-than-life heroic journeys."';
        }
        return '"You thrive on fast-paced action, intense combat scenes, and adrenaline-fueled narratives."';
    }

    if (primary === "Slice of Life" || primary === "Comedy") {
        return '"You favor relaxed, comforting stories with wholesome humor, warm characters, and casual everyday charm."';
    }

    if (primary === "Romance") {
        return '"You are drawn to emotional character connections, heart-warming relationships, and compelling personal drama."';
    }

    if (primary === "Psychological" || primary === "Mystery" || primary === "Thriller") {
        return '"You enjoy complex mind games, unexpected plot twists, and dark, thought-provoking stories that keep you guessing."';
    }

    if (primary === "Fantasy" || primary === "Sci-Fi") {
        return '"You are a dreamer who loves exploring imaginative new worlds, complex lore, and futuristic concepts."';
    }

    return `"Your taste leans heavily toward ${primary} and ${secondary || "story-driven"} anime with rich narratives."`;
}

// Render Taste Profile Badges and Narrative Box
function renderTasteProfile(genres, totalCount) {
    const tasteContainer = document.getElementById("tasteList");
    const summaryText = document.getElementById("tasteSummaryText");

    if (!tasteContainer || !summaryText) return;

    if (!genres || genres.length === 0) {
        tasteContainer.innerHTML = "<p style='font-size:12px; color:#666;'>No taste data available.</p>";
        summaryText.textContent = "Connect your AniList profile with watched entries to generate your taste profile.";
        return;
    }

    let badgeHtml = "";
    genres.slice(0, 5).forEach(item => {
        const percentage = totalCount > 0 ? Math.round((item.count / totalCount) * 100) : 0;
        const icon = genreIcons[item.genre] || "🎬";

        badgeHtml += `
            <div class="taste-badge" title="${percentage}% of your list includes ${escapeHtml(item.genre)}">
                <span>${icon} ${escapeHtml(item.genre)}</span>
                <strong>${percentage}%</strong>
            </div>
        `;
    });

    tasteContainer.innerHTML = badgeHtml;
    summaryText.textContent = generateTasteNarrative(genres);
}

// Update DOM elements depending on login state & render stats
function updateProfileUI(userData) {
    if (userData) {
        // Connected State
        navUsername.textContent = userData.name;
        userDisplayName.textContent = userData.name;
        userAvatar.src = userData.avatar?.large || "https://s4.anilist.co/file/anilistcdn/user/avatar/large/default.png";
        const navAvatar = document.getElementById("navAvatar");   // top-bar avatar
        if (navAvatar) {
            navAvatar.src = userAvatar.src;
            navAvatar.classList.remove("hidden");
            document.getElementById("navAvatarIcon")?.classList.add("hidden");
        }

        // Render Stats directly from userData.statistics
        const animeStats = userData.statistics?.anime;
        if (animeStats) {
            const totalCount = animeStats.count || 0;
            document.getElementById("statAnimeWatched").textContent = totalCount;
            document.getElementById("statEpsWatched").textContent = (animeStats.episodesWatched || 0).toLocaleString();
            
            // AniList average rating is out of 100 (e.g. 81% -> 8.1)
            const avgRating = animeStats.meanScore ? (animeStats.meanScore / 10).toFixed(1) : "N/A";
            document.getElementById("statAvgRating").textContent = avgRating;

            // Render Top Genres
            const genres = animeStats.genres || [];
            if (genres.length > 0) {
                document.getElementById("statTopGenre").textContent = genres[0].genre;
                renderGenreBars(genres, totalCount);
                renderTasteProfile(genres, totalCount); // <--- STEP 3 TASTE CALL
            } else {
                document.getElementById("statTopGenre").textContent = "N/A";
                const genreContainer = document.getElementById("genreBarsContainer");
                if (genreContainer) {
                    genreContainer.innerHTML = "<p style='font-size:12px; color:#666;'>No genre statistics available.</p>";
                }
                renderTasteProfile([], 0);
            }
        }

        profileConnectState.classList.add("hidden");
        profileConnectedState.classList.remove("hidden");

        onUserChanged();
        loadUserWatchlist(userData.name);
        loadAffinityInsights(userData.name); // [ADDED] "What your ratings say" panel
        
    } else {
        // Disconnected State
        navUsername.textContent = "Profile";
        document.getElementById("navAvatar")?.classList.add("hidden");
        document.getElementById("navAvatarIcon")?.classList.remove("hidden");
        anilistUsernameInput.value = "";
        setProfileConnectError(""); // [ADDED] clear any old error message

        cachedWatchlist = [];
        const insightsBox = document.getElementById("affinityInsights");
        if (insightsBox) insightsBox.innerHTML = ""; // [ADDED] forget the previous user's insights
        onUserChanged();

        profileConnectedState.classList.add("hidden");
        profileConnectState.classList.remove("hidden");
    }
}

// Watchlist Global Store
let cachedWatchlist = [];
let currentWatchlistStatus = "CURRENT";

// Setup Tab Buttons
document.querySelectorAll(".watchlist-tabs .tab-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
        document.querySelectorAll(".watchlist-tabs .tab-btn").forEach(b => b.classList.remove("active"));
        e.target.classList.add("active");
        
        currentWatchlistStatus = e.target.getAttribute("data-status");
        renderWatchlistByStatus(currentWatchlistStatus);
    });
});

// Fetch Watchlist from Backend
async function loadUserWatchlist(username) {
    const container = document.getElementById("watchlistContent");
    if (container) {
        container.innerHTML = `<p class="watchlist-loading">Loading watchlist...</p>`;
    }

    try {
        const encodedUsername = encodeURIComponent(username);
        const response = await fetch(`http://localhost:5000/api/watchlist/${encodedUsername}`);
        if (!response.ok) {
            if (container) container.innerHTML = `<p class="watchlist-empty">Could not load watchlist.</p>`;
            cachedWatchlist = [];
        } else {
            cachedWatchlist = await response.json();
            renderWatchlistByStatus(currentWatchlistStatus);
        }
    } catch (error) {
        console.error("Error loading watchlist:", error);
        cachedWatchlist = [];
        if (container) {
            container.innerHTML = `<p class="watchlist-empty">Error fetching watchlist data.</p>`;
        }
    }

    watchlistLoaded = true;
    renderContinueWatching();
    refreshListsPage();
}

/* =========================================================
   RENDER WATCHLIST BY STATUS (Escaped)
========================================================= */

function renderWatchlistByStatus(status) {
    const container = document.getElementById("watchlistContent");
    if (!container) return;

    // Find entries matching selected status
    const targetList = cachedWatchlist.find(l => l.status === status);
    const entries = targetList ? targetList.entries : [];

    if (entries.length === 0) {
        container.innerHTML = `<p class="watchlist-empty">No anime in this list.</p>`;
        return;
    }

    let html = "";
    entries.forEach(entry => {
        const media = entry.media;
        const title = escapeHtml(media.title.english || media.title.romaji);
        const progress = escapeHtml(entry.progress || 0);
        const totalEps = escapeHtml(media.episodes ? media.episodes : "?");
        const cover = escapeHtml(media.coverImage?.medium || "");
        const entryScore = escapeHtml(entry.score);

        html += `
            <div class="watchlist-item">
                <img src="${cover}" alt="${title}" />
                <div class="watchlist-item-info">
                    <h5 class="watchlist-item-title">${title}</h5>
                    <div class="watchlist-item-meta">
                        <span>Ep: ${progress} / ${totalEps}</span>
                        ${entry.score ? `<span>★ ${entryScore}</span>` : ""}
                    </div>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}

/* =========================================================
   ANI-REC: HELPERS
========================================================= */

function escapeHtml(str) {
    return String(str ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function sanitizeDescription(rawDescription) {
    if (!rawDescription) return 'No description available.';
    
    // Convert break tags to spaces/newlines and strip other HTML tags safely
    let cleaned = rawDescription
        .replace(/<br\s*[\/]?>/gi, ' ')
        .replace(/<\/?i>/gi, '')
        .replace(/<\/?b>/gi, '')
        .replace(/<[^>]*>/g, ''); // Strip any remaining unexpected tags

    return escapeHtml(cleaned);
}



/* =========================================================
   ANI-REC: CONTINUE WATCHING (Home)
========================================================= */

let watchlistLoaded = false;

function renderContinueWatching() {
    const row = document.getElementById("continueRow");
    if (!row) return;

    const username = localStorage.getItem("anilist_username");

    // 1. Not connected -> prompt
    if (!username) {
        row.innerHTML = `
            <div class="continue-empty">
                <p>Connect your AniList to see where you left off.</p>
                <button type="button" id="continueConnectBtn" class="continue-cta">Connect AniList</button>
            </div>
        `;
        document.getElementById("continueConnectBtn").addEventListener("click", () => {
            profileModal.classList.remove("hidden");
        });
        return;
    }

    // 2. Connected, list still loading
    if (!watchlistLoaded) {
        row.innerHTML = `<p class="continue-empty">Loading your list...</p>`;
        return;
    }

    // 3. Connected and loaded
    const currentList = cachedWatchlist.find(l => l.status === "CURRENT");
    const entries = (currentList?.entries || [])
        .slice()
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    if (entries.length === 0) {
        row.innerHTML = `<p class="continue-empty">Nothing in progress. Hit Apply or try Surprise Me!</p>`;
        return;
    }

        row.innerHTML = "";
    entries.slice(0, 10).forEach(entry => {
        const media = entry.media;
        const title = media.title.english || media.title.romaji;
        const progress = entry.progress || 0;
        const total = media.episodes || null;
        const pct = total ? Math.min(100, Math.round((progress / total) * 100)) : 0;
        const nextEp = total && progress >= total ? null : progress + 1;
        const cover = escapeHtml(media.coverImage?.large || media.coverImage?.medium || ""); // [CHANGED] escaped
        const watchUrl = `http://localhost:5000/api/watch?title=${encodeURIComponent(title)}`;

        const card = document.createElement("div");
        card.className = "anime-card";
        card.innerHTML = `
            <img src="${cover}" alt="${escapeHtml(title)}" loading="lazy" />
            <div class="anime-info">
                <h3>${escapeHtml(title)}</h3>
                <p class="continue-progress-text">Ep ${progress}${total ? ` / ${total}` : ""}</p>
                <div class="continue-bar"><div class="continue-bar-fill" style="width: ${pct}%;"></div></div>
                <a class="continue-watch" href="${escapeHtml(watchUrl)}" target="_blank" rel="noopener noreferrer">
                    ▶ ${nextEp ? `Next: Ep ${nextEp}` : "Rewatch"} ↗
                </a>
            </div>
        `;

        card.addEventListener("click", (e) => {
            if (!e.target.closest(".continue-watch")) openAnimeModal(media.id);
        });
        // [ADDED] keyboard access (Tab + Enter / Space)
        makeCardAccessible(card, `View details: ${title}`, () => openAnimeModal(media.id));

        row.appendChild(card);
    });
}

// Called whenever the connected user changes (connect / disconnect / page load)
function onUserChanged() {
    watchlistLoaded = false;
    renderContinueWatching();
    if (getRoute() === "discover") loadDiscover();
    refreshListsPage();
}

/* =========================================================
   ANI-REC: SHARED CARD ROW HELPERS (used by Discover)
========================================================= */

// Shared card helper for discover/saved rows. Keeps card actions and keyboard access,
// but intentionally omits the per-card "matches your taste" line.
function buildAnimeCard(anime, options = {}) {
    const title = anime.title.english || anime.title.romaji;
    const score = anime.averageScore ? `${anime.averageScore}%` : "N/A";
    const genres = anime.genres ? anime.genres.slice(0, 3).join(", ") : "N/A";
    const cover = escapeHtml(anime.coverImage?.extraLarge || anime.coverImage?.large || ""); // [CHANGED] escaped
    
    // [ADDED] Grab dominant color from AniList, fallback to default primary color
    const accentColor = anime.coverImage?.color || "#8b56b7";

    const card = document.createElement("div");
    card.className = "anime-card";
    card.dataset.animeId = anime.id;

    // [ADDED] Set CSS variable directly on the card element inline style
    card.style.setProperty("--card-accent", accentColor);

    card.innerHTML = `
        <img src="${cover}" alt="${escapeHtml(title)}" loading="lazy" />
        <div class="anime-info">
            <h3>${escapeHtml(title)}</h3>
            <p class="score">⭐ ${score}</p>
            <p class="genres">${escapeHtml(genres)}</p>
            ${options.showReason && anime.reason ? `<p class="reason-text">${escapeHtml(anime.reason)}</p>` : ""}
        </div>
    `;
    // [CHANGED] The reason line is now opt-in (options.showReason) so shared rows stay clean, as the comment above says.
    // Only the Discover "Based on Your Taste" row asks for it.
    card.addEventListener("click", () => openAnimeModal(anime.id));
    makeCardAccessible(card, `View details: ${title}`, () => openAnimeModal(anime.id));

    if (options.removable) {
        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "card-remove-btn";
        removeBtn.setAttribute("aria-label", `Remove ${title} from saved`);
        removeBtn.textContent = "✕";
        removeBtn.addEventListener("click", (e) => {
            e.stopPropagation(); // don't open the modal
            removeSaved(anime.id);
            renderSavedRow();
            showToast("Removed from saved");
        });
        card.appendChild(removeBtn);
    }

    return card;
}

function showRowSkeleton(rowId, count = 6) {
    const row = document.getElementById(rowId);
    if (!row) return;
    row.innerHTML = Array(count).fill(0).map(() => `
        <div class="skeleton-card">
            <div class="skeleton-img"></div>
            <div class="skeleton-info">
                <div class="skeleton-text skeleton-title"></div>
                <div class="skeleton-text skeleton-score"></div>
                <div class="skeleton-text skeleton-genres"></div>
            </div>
        </div>
    `).join("");
}

// [CHANGED] 4th argument = options passed to buildAnimeCard (e.g. { showReason: true })
function renderRow(rowId, list, emptyMessage, cardOptions = {}) {
    const row = document.getElementById(rowId);
    if (!row) return;
    row.innerHTML = "";

    if (!list || list.length === 0) {
        row.innerHTML = `<p class="row-empty">${emptyMessage}</p>`;
        return;
    }
    list.forEach(anime => row.appendChild(buildAnimeCard(anime, cardOptions)));
}

/* =========================================================
   ANI-REC: DISCOVER PAGE (Trending row)
========================================================= */

// undefined = nothing loaded yet; otherwise the username (or null) the rows were loaded for
let discoverLoadedFor = undefined;

// [ADDED] Incremented every time Discover (re)loads; async loaders compare it so a slow response for a
// previous user / previous load can never overwrite newer rows.
let discoverToken = 0;

// [ADDED] fetch + parse JSON, throwing an Error with the server's message when the response isn't OK
async function fetchJson(url) {
    const res = await fetch(url);
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(body?.error || "Request failed");
    return body;
}

async function loadTrendingRow(username) {
    const token = discoverToken;
    showRowSkeleton("trendingRow");

    try {
        const params = new URLSearchParams();
        if (username) params.append("username", username);

        const res = await fetch(`http://localhost:5000/api/trending?${params.toString()}`);
        if (!res.ok) throw new Error("Trending request failed");

        const list = await res.json();
        if (token !== discoverToken) return;

        // [CHANGED] Shows the user skipped with 👎 are filtered out
        renderRow("trendingRow", filterDisliked(list), "Nothing trending right now.");
    } catch (err) {
        if (token !== discoverToken) return;
        console.error("Trending error:", err);
        document.getElementById("trendingRow").innerHTML =
            `<p class="row-empty">Couldn't load trending. Check if the server is running.</p>`;
        discoverLoadedFor = undefined; // allow a retry next visit
    }
}

// [ADDED] Personalised rows: "Based on Your Taste" + one "Because you liked X" row per seed show
async function loadPersonalRows(username) {
    const token = discoverToken;
    const tasteRow = document.getElementById("tasteRow");
    const becauseContainer = document.getElementById("becauseContainer");
    if (!tasteRow || !becauseContainer) return;

    becauseContainer.innerHTML = "";

    // Not connected -> invite the user to connect
    if (!username) {
        tasteRow.innerHTML = `
            <div class="row-empty">
                <p>Connect your AniList to get picks ranked by your taste.</p>
                <button type="button" id="discoverConnectBtn" class="continue-cta">Connect AniList</button>
            </div>
        `;
        document.getElementById("discoverConnectBtn").addEventListener("click", () => {
            profileModal.classList.remove("hidden");
        });
        return;
    }

    showRowSkeleton("tasteRow");

    const skippedIds = getDislikedIds();
    const suffix = skippedIds.length > 0 ? `?exclude=${skippedIds.join(",")}` : "";
    const encoded = encodeURIComponent(username);

    // [ADDED] The "Because you liked" rows use the affinity model, so they also get the user's liked ids.
    // (The "Based on Your Taste" row deliberately does NOT: it is the old "what you watch most" view.)
    const likedForBecause = getLikedIds();
    const becauseSuffix = suffix + (likedForBecause.length > 0 ? `${suffix ? "&" : "?"}liked=${likedForBecause.join(",")}` : "");

    // Both requests run at the same time; one failing doesn't affect the other
    const [tasteResult, becauseResult] = await Promise.allSettled([
        fetchTasteRow(username),
        fetchJson(`http://localhost:5000/api/because/${encoded}${becauseSuffix}`)
    ]);

    if (token !== discoverToken) return;

    if (tasteResult.status === "fulfilled") {
        // [CHANGED] showReason: this row keeps its "Matches your taste for ..." line (it is the frequency-based view)
        renderRow("tasteRow", tasteResult.value, "Rate a few shows on AniList and we'll start matching your taste.", { showReason: true });
        rememberTasteSeen(tasteResult.value);
    } else {
        console.error("Taste row error:", tasteResult.reason);
        const message = tasteResult.reason instanceof TypeError
            ? "Couldn't reach the server."
            : tasteResult.reason?.message || "Couldn't load your personalised picks.";
        tasteRow.innerHTML = `<p class="row-empty">${escapeHtml(message)}</p>`;
    }

    if (becauseResult.status === "fulfilled") {
        becauseResult.value.forEach(row => {
            const section = document.createElement("section");
            section.className = "discover-row";
            section.innerHTML = `
                <div class="row-header">
                    <h2>🎯 Because you liked ${escapeHtml(row.seed.title)}</h2>
                    <span class="row-sub">Recommended by fans of the same show</span>
                </div>
                <div class="row-scroller"></div>
            `;
            const scroller = section.querySelector(".row-scroller");
            enhanceScroller(scroller);
            row.results.forEach(anime => scroller.appendChild(buildAnimeCard(anime)));
            becauseContainer.appendChild(section);
        });
    } else {
        console.error("Because-you-liked error:", becauseResult.reason);
    }
}

async function loadDiscover() {
    const username = localStorage.getItem("anilist_username") || null;
    if (discoverLoadedFor === username) return; // already loaded for this user
    discoverLoadedFor = username;
    discoverToken++; // [ADDED] invalidates any loaders still running from a previous load

    // [CHANGED] Trending and the personalised rows load in parallel
    await Promise.all([loadTrendingRow(username), loadPersonalRows(username)]);
    // Next rows ("Because you liked X", "Based on your profile") get added here.
    // [DONE] Both are implemented in loadPersonalRows() above.
}

/* =========================================================
   [ADDED] SAVED FOR LATER, RESULT BUTTONS, KEYBOARD & ACCESSIBILITY, FILTERS IN THE URL
========================================================= */

// Makes a clickable <div> behave like a button for keyboard / screen-reader users
function makeCardAccessible(card, label, activate) {
    card.setAttribute("tabindex", "0");
    card.setAttribute("role", "button");
    if (label) card.setAttribute("aria-label", label);

    card.addEventListener("keydown", (e) => {
        if (e.target !== card) return; // ignore keys pressed on links/buttons inside the card
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            activate();
        }
    });
}

// ---- Saved For Later (home page) ----
// Saved shows now live on the Lists page; this keeps every existing call working
function renderSavedRow() {
    refreshListsPage();
}

// ---- Results: note + "Show more" / "Roll again" ----
// [CHANGED] The note can now hold two kinds of messages: the "loosened the mood" one and a "profile is light" hint
function updateResultsActions(showRelaxedNote = false, profileNote = "") {
    const note = document.getElementById("resultsNote");
    const actions = document.getElementById("resultsActions");
    const showMore = document.getElementById("showMoreBtn");
    const hasResults = currentResults.length > 0;

    const messages = [];
    if (showRelaxedNote) messages.push("No show matched every mood and genre at once, so we loosened the mood a little to find these.");
    if (profileNote) messages.push(profileNote);

    if (note) {
        note.textContent = messages.join(" ");
        note.classList.toggle("hidden", !(hasResults && messages.length > 0));
    }
    if (actions) actions.classList.toggle("hidden", !hasResults);
    if (showMore) showMore.classList.toggle("hidden", shownCount >= currentResults.length);
}

const showMoreBtn = document.getElementById("showMoreBtn");
if (showMoreBtn) {
    showMoreBtn.addEventListener("click", () => {
        shownCount += RESULTS_PAGE_SIZE;
        renderAnimeCards(currentResults.slice(0, shownCount));
        showMoreBtn.classList.toggle("hidden", shownCount >= currentResults.length);
    });
}

const rerollBtn = document.getElementById("rerollBtn");
if (rerollBtn) {
    // Same filters, new random page -> a fresh set (no scroll jump)
    rerollBtn.addEventListener("click", () => fetchRecommendations({ scroll: false }));
}

// ---- Escape key closes whatever is open ----
document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;

    filters.forEach(filter => filter.classList.remove("open"));

    // Clicking the existing close buttons runs their original handlers (incl. removing the Surprise indicator)
    if (modal && !modal.classList.contains("hidden")) {
        if (closeModalBtn) closeModalBtn.click();
    } else if (profileModal && !profileModal.classList.contains("hidden")) {
        if (closeProfileModal) closeProfileModal.click();
    }
});

// ---- Focus management: move focus into a modal when it opens, give it back to the opener when it closes ----
function watchModalFocus(overlay, closeBtn) {
    if (!overlay) return;

    let lastFocused = null;
    let wasHidden = overlay.classList.contains("hidden");

    new MutationObserver(() => {
        const isHidden = overlay.classList.contains("hidden");

        if (wasHidden && !isHidden) {
            lastFocused = document.activeElement;
            if (closeBtn) closeBtn.focus();
        } else if (!wasHidden && isHidden) {
            if (lastFocused && typeof lastFocused.focus === "function" && document.contains(lastFocused)) {
                lastFocused.focus();
            }
            lastFocused = null;
        }
        wasHidden = isHidden;
    }).observe(overlay, { attributes: true, attributeFilter: ["class"] });
}

watchModalFocus(modal, closeModalBtn);
watchModalFocus(profileModal, closeProfileModal);

// ---- FILTERS IN THE URL (shareable searches): #/?q=Frieren&mood=funny&genre=Action&rating=7 ----
function writeFiltersToHash(prefs) {
    const params = new URLSearchParams();
    if (prefs.search) params.set("q", prefs.search);
    prefs.moods.forEach(m => params.append("mood", m));
    prefs.genres.forEach(g => params.append("genre", g));
    if (prefs.rating) params.append("rating", prefs.rating);
    if (prefs.year) params.append("year", prefs.year);
    if (prefs.format) params.append("format", prefs.format);
    if (prefs.language) params.append("language", prefs.language);

    const queryString = params.toString();
    // replaceState does not fire "hashchange", so the page doesn't re-route or jump
    history.replaceState(null, "", queryString ? `#/?${queryString}` : "#/");
}

function clearFiltersFromHash() {
    if (location.hash.includes("?")) history.replaceState(null, "", "#/");
}

// Reads the filters from the URL, ticks the matching inputs and runs the search. Returns true if it did.
function restoreFiltersFromHash() {
    const queryIndex = location.hash.indexOf("?");
    if (queryIndex === -1) return false;

    const params = new URLSearchParams(location.hash.slice(queryIndex + 1));
    let applied = false;

    const tick = (name, value) => {
        const input = Array.from(document.querySelectorAll(`.filter-sec input[name="${name}"]`))
            .find(candidate => candidate.value === value);
        if (input) {
            input.checked = true;
            if (input.type === "radio") input.dataset.wasChecked = "true";
            applied = true;
        }
    };

    params.getAll("mood").forEach(value => tick("mood", value));
    params.getAll("genre").forEach(value => tick("genre", value));
    ["rating", "year", "format", "language"].forEach(name => {
        const value = params.get(name);
        if (value) tick(name, value);
    });

    const search = params.get("q");
    if (search && homeSearchInput) {
        homeSearchInput.value = search.slice(0, 80);
        updateHomeSearchClear();
        applied = true;
    }

    if (applied) {
        updateFilterActiveStates();
        fetchRecommendations({ scroll: false });
    }
    return applied;
}

// If someone edits / pastes a hash with filters while the page is open, apply it fresh
window.addEventListener("hashchange", () => {
    if (getRoute() === "home" && location.hash.includes("?")) {
        document.querySelectorAll('.filter-sec input[type="checkbox"], .filter-sec input[type="radio"]').forEach(input => {
            input.checked = false;
            if (input.type === "radio") input.dataset.wasChecked = "false";
        });
        if (homeSearchInput) homeSearchInput.value = "";
        updateHomeSearchClear();
        clearTimeout(homeSearchSuggestTimer);
        hideHomeSearchSuggest();
        restoreFiltersFromHash();
    }
});

/* =========================================================
   [ADDED] TASTE INSIGHTS + "TEACH ME YOUR TASTE" (Profile window)
   - Insights: shows what the recommender learned from your RATINGS (not from how much you watch).
   - Teach me: search shows you love; they count as favourites for the recommender, even without AniList.
========================================================= */
function getStoredUsername() {
    return localStorage.getItem("anilist_username") || null;
}

function affinityChips(items, className) {
    return items.map(item =>
        `<span class="affinity-chip ${className}" title="${escapeHtml(item.kind)} · affinity ${item.affinity}">${escapeHtml(item.name)}</span>`
    ).join("");
}

function renderAffinityInsights(box, data) {
    const parts = [];

    // The "you watch X but rate Y" comparison is the whole point of the new model, so say it plainly
    const watched = data.watchedMost?.[0];
    const bestGenre = data.topLikes?.find(item => item.kind === "genre");
    if (watched && bestGenre && watched.name !== bestGenre.name && watched.affinity < 0.3) {
        parts.push(`<p class="affinity-note">You watch the most <strong>${escapeHtml(watched.name)}</strong>, but you rate <strong>${escapeHtml(bestGenre.name)}</strong> far higher. Recommendations follow what you rate highly, not what you watch most.</p>`);
    }

    if (data.topLikes?.length > 0) {
        parts.push(`<p class="affinity-label">You rate these highly</p><div class="affinity-chips">${affinityChips(data.topLikes, "like")}</div>`);
    }
    if (data.topDislikes?.length > 0) {
        parts.push(`<p class="affinity-label">You rate these lower</p><div class="affinity-chips">${affinityChips(data.topDislikes, "dislike")}</div>`);
    }

    if (data.strength !== "good") {
        parts.push(`<p class="affinity-note">Only ${escapeHtml(data.ratedShows)} rated show${data.ratedShows === 1 ? "" : "s"} found, so the picture is still blurry. Rating more shows on AniList or adding favourites below sharpens it.</p>`);
    }

    box.innerHTML = parts.length > 0 ? parts.join("") : `<p class="affinity-note">Nothing to show yet.</p>`;
}

async function loadAffinityInsights(username) {
    const box = document.getElementById("affinityInsights");
    if (!box) return;

    box.innerHTML = `<p class="watchlist-loading">Reading your ratings...</p>`;

    try {
        const liked = getLikedIds();
        const data = await fetchJson(
            `http://localhost:5000/api/affinity/${encodeURIComponent(username)}${liked.length > 0 ? `?liked=${liked.join(",")}` : ""}`
        );
        if (getStoredUsername() !== username) return; // the user disconnected / switched while this was loading
        renderAffinityInsights(box, data);
    } catch (err) {
        console.error("Affinity insights error:", err);
        if (getStoredUsername() !== username) return;
        box.innerHTML = `<p class="affinity-note">Couldn't load your taste insights right now.</p>`;
    }
}

const seedSearchInput = document.getElementById("seedSearchInput");
const seedSearchResults = document.getElementById("seedSearchResults");
const seedPicksEl = document.getElementById("seedPicks");
let seedSearchToken = 0;
let seedSearchTimer = null;

function renderSeedPicks() {
    if (!seedPicksEl) return;
    const picks = getSeedPicks();

    seedPicksEl.innerHTML = "";
    if (picks.length === 0) {
        seedPicksEl.innerHTML = `<p class="affinity-note">No favourites added yet.</p>`;
        return;
    }

    picks.forEach(pick => {
        const chip = document.createElement("span");
        chip.className = "seed-chip";
        chip.innerHTML = `<span>${escapeHtml(pick.title)}</span>`;

        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.setAttribute("aria-label", `Remove ${pick.title}`);
        removeBtn.textContent = "✕";
        removeBtn.addEventListener("click", () => {
            removeSeedPick(pick.id);
            onSeedsChanged();
        });
        chip.appendChild(removeBtn);
        seedPicksEl.appendChild(chip);
    });
}

// Favourites changed -> refresh the list, make Discover reload its personalised rows, refresh the insights
function onSeedsChanged() {
    discoverLoadedFor = undefined;
    renderSeedPicks();
    const username = getStoredUsername();
    if (username) loadAffinityInsights(username);
}

async function runSeedSearch(query) {
    if (!seedSearchResults) return;
    const token = ++seedSearchToken; // ignore answers that arrive after a newer keystroke

    if (query.length < 2) {
        seedSearchResults.innerHTML = "";
        return;
    }

    seedSearchResults.innerHTML = `<p class="affinity-note">Searching...</p>`;

    try {
        const list = await fetchJson(`http://localhost:5000/api/search?q=${encodeURIComponent(query)}`);
        if (token !== seedSearchToken) return;

        seedSearchResults.innerHTML = "";
        if (list.length === 0) {
            seedSearchResults.innerHTML = `<p class="affinity-note">No matches.</p>`;
            return;
        }

        const alreadyPicked = new Set(getSeedPicks().map(pick => pick.id));
        list.forEach(anime => {
            const title = anime.title.english || anime.title.romaji;
            const meta = [anime.format, anime.seasonYear].filter(Boolean).join(" · ");

            const button = document.createElement("button");
            button.type = "button";
            button.className = "seed-result";
            button.disabled = alreadyPicked.has(anime.id);
            button.innerHTML = `
                <span class="seed-result-title">${escapeHtml(title)}</span>
                <span class="seed-result-meta">${escapeHtml(meta)}</span>
                <span class="seed-result-add">${button.disabled ? "✓ Added" : "+ Add"}</span>
            `;
            button.addEventListener("click", () => {
                addSeedPick({ id: anime.id, title });
                showToast("Added to your favourites");
                button.disabled = true;
                button.querySelector(".seed-result-add").textContent = "✓ Added";
                onSeedsChanged();
            });
            seedSearchResults.appendChild(button);
        });
    } catch (err) {
        if (token !== seedSearchToken) return;
        console.error("Seed search error:", err);
        seedSearchResults.innerHTML = `<p class="affinity-note">Search failed. Is the server running?</p>`;
    }
}

if (seedSearchInput) {
    seedSearchInput.addEventListener("input", () => {
        clearTimeout(seedSearchTimer);
        const query = seedSearchInput.value.trim();
        seedSearchTimer = setTimeout(() => runSeedSearch(query), 350); // wait for the user to stop typing
    });
}

renderSeedPicks();

/* =========================================================
   [ADDED] DISCOVER EXTRAS
   - rows: arrow buttons + click-and-drag so a mouse can move them
   - "Because I liked..." typed search, "Based on your taste" shuffle
========================================================= */

function enhanceScroller(scroller) {
    if (!scroller || scroller.dataset.enhanced) return;
    scroller.dataset.enhanced = "1";

    const wrap = document.createElement("div");
    wrap.className = "row-wrap";
    scroller.parentNode.insertBefore(wrap, scroller);
    wrap.appendChild(scroller);

    const makeArrow = (dir) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = `row-arrow ${dir < 0 ? "row-arrow-prev" : "row-arrow-next"}`;
        btn.setAttribute("aria-label", dir < 0 ? "Scroll left" : "Scroll right");
        btn.textContent = dir < 0 ? "‹" : "›";
        btn.addEventListener("click", () => scroller.scrollBy({ left: dir * scroller.clientWidth * 0.85, behavior: "smooth" }));
        wrap.appendChild(btn);
        return btn;
    };
    const prev = makeArrow(-1);
    const next = makeArrow(1);

    const update = () => {
        prev.classList.toggle("is-hidden", scroller.scrollLeft <= 4);
        next.classList.toggle("is-hidden", scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 4);
    };
    scroller.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    new MutationObserver(() => requestAnimationFrame(update)).observe(scroller, { childList: true });
    requestAnimationFrame(update);

    // Click-and-drag with the mouse (touch already scrolls natively)
    let down = false, moved = false, startX = 0, startLeft = 0;
    scroller.addEventListener("pointerdown", (e) => {
        if (e.pointerType !== "mouse" || e.button !== 0) return;
        down = true; moved = false; startX = e.clientX; startLeft = scroller.scrollLeft;
    });
    window.addEventListener("pointermove", (e) => {
        if (!down) return;
        const dx = e.clientX - startX;
        if (!moved && Math.abs(dx) > 5) { moved = true; scroller.classList.add("is-dragging"); }
        if (moved) scroller.scrollLeft = startLeft - dx;
    });
    window.addEventListener("pointerup", () => {
        if (!down) return;
        down = false;
        scroller.classList.remove("is-dragging");
    });
    scroller.addEventListener("dragstart", (e) => e.preventDefault());
    // a drag must not count as a click on the card underneath
    scroller.addEventListener("click", (e) => {
        if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; }
    }, true);
}

document.querySelectorAll("#discoverView .row-scroller").forEach(enhanceScroller);

// ---- "Based on Your Taste": remember what was shown so a new visit / Shuffle brings different shows first ----
const TASTE_SEEN_KEY = "anirec_taste_seen";

function getTasteSeen() {
    const ids = readStorageJSON(TASTE_SEEN_KEY, []);
    return Array.isArray(ids) ? ids.filter(Number.isInteger) : [];
}

function rememberTasteSeen(list) {
    const ids = (list || []).map(anime => anime.id).filter(Number.isInteger);
    const merged = [...getTasteSeen().filter(id => !ids.includes(id)), ...ids];
    writeStorageJSON(TASTE_SEEN_KEY, merged.slice(-60));
}

function fetchTasteRow(username) {
    const params = new URLSearchParams();
    const skipped = getDislikedIds();
    const seen = getTasteSeen();
    if (skipped.length > 0) params.set("exclude", skipped.join(","));
    if (seen.length > 0) params.set("seen", seen.join(","));
    const qs = params.toString();
    return fetchJson(`http://localhost:5000/api/recommendations/${encodeURIComponent(username)}${qs ? `?${qs}` : ""}`);
}

const tasteShuffleBtn = document.getElementById("tasteShuffleBtn");
if (tasteShuffleBtn) {
    tasteShuffleBtn.addEventListener("click", async () => {
        const username = localStorage.getItem("anilist_username");
        if (!username) { showToast("Connect AniList to personalise this row"); return; }

        const token = discoverToken;
        showRowSkeleton("tasteRow");
        try {
            const list = await fetchTasteRow(username);
            if (token !== discoverToken) return;
            renderRow("tasteRow", list, "Rate a few shows on AniList and we'll start matching your taste.", { showReason: true });
            rememberTasteSeen(list);
            document.getElementById("tasteRow").scrollLeft = 0;
        } catch (err) {
            console.error("Taste shuffle error:", err);
            document.getElementById("tasteRow").innerHTML = `<p class="row-empty">Couldn't refresh your picks.</p>`;
        }
    });
}

// ---- "Because I liked...": type a show -> similar shows re-ranked by your profile ----
const becauseInput = document.getElementById("becauseInput");
const becauseSuggest = document.getElementById("becauseSuggest");
let becauseSuggestTimer = null;
let becauseSuggestToken = 0;
let becauseShowToken = 0;

function hideBecauseSuggest() {
    becauseSuggest.classList.add("hidden");
    becauseSuggest.innerHTML = "";
}

async function showBecauseSuggestions(q) {
    const myToken = ++becauseSuggestToken;
    try {
        const list = await fetchJson(`http://localhost:5000/api/search?q=${encodeURIComponent(q)}`);
        if (myToken !== becauseSuggestToken) return;

        becauseSuggest.innerHTML = "";
        if (list.length === 0) {
            becauseSuggest.innerHTML = `<p class="suggest-empty">No matches</p>`;
        }
        list.forEach(anime => {
            const title = anime.title.english || anime.title.romaji;
            const meta = [anime.format, anime.seasonYear].filter(Boolean).join(" · ");
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "suggest-item";
            btn.innerHTML = `<span>${escapeHtml(title)}</span><small>${escapeHtml(meta)}</small>`;
            btn.addEventListener("click", () => {
                becauseInput.value = title;
                hideBecauseSuggest();
                loadBecauseShow(anime.id, title);
            });
            becauseSuggest.appendChild(btn);
        });
        becauseSuggest.classList.remove("hidden");
    } catch (err) {
        console.error("Suggestion error:", err);
        hideBecauseSuggest();
    }
}

var becauseCurrent = { id: null, title: "", seen: [] };

// Pure "shows like X" list (no taste tuning). Reshuffle asks for the same show again, pushing already-shown picks back.
async function loadBecauseShow(id, title, options = {}) {
    const box = document.getElementById("becauseSearchResult");
    const heading = document.getElementById("becauseSearchTitle");
    const myToken = ++becauseShowToken;

    if (!options.reshuffle || becauseCurrent.id !== id) becauseCurrent = { id, title, seen: [] };

    box.classList.remove("hidden");
    heading.textContent = `Because you liked ${title}…`;
    showRowSkeleton("becauseSearchRow");

    try {
        const params = new URLSearchParams();
        const username = localStorage.getItem("anilist_username");
        const skipped = getDislikedIds();
        if (username) params.set("username", username);
        if (skipped.length > 0) params.set("exclude", skipped.join(","));
        if (becauseCurrent.seen.length > 0) params.set("seen", becauseCurrent.seen.join(","));

        const data = await fetchJson(`http://localhost:5000/api/because-show/${encodeURIComponent(id)}?${params.toString()}`);
        if (myToken !== becauseShowToken) return;

        becauseCurrent.title = data.seed.title;
        heading.textContent = `Because you liked ${data.seed.title}…`;
        renderRow("becauseSearchRow", data.results, "No similar shows found for this one yet. Try another title.", { showReason: true });
        becauseCurrent.seen = [...becauseCurrent.seen, ...data.results.map(anime => anime.id)].slice(-80);
        document.getElementById("becauseSearchRow").scrollLeft = 0;
    } catch (err) {
        if (myToken !== becauseShowToken) return;
        console.error("Because-show error:", err);
        document.getElementById("becauseSearchRow").innerHTML = `<p class="row-empty">${escapeHtml(err.message || "Couldn't load recommendations.")}</p>`;
    }
}

document.getElementById("becauseShuffleBtn")?.addEventListener("click", () => {
    if (becauseCurrent.id) loadBecauseShow(becauseCurrent.id, becauseCurrent.title, { reshuffle: true });
});

if (becauseInput && becauseSuggest) {
    becauseInput.addEventListener("input", () => {
        clearTimeout(becauseSuggestTimer);
        const q = becauseInput.value.trim();
        if (q.length < 2) { becauseSuggestToken++; hideBecauseSuggest(); return; }
        becauseSuggestTimer = setTimeout(() => showBecauseSuggestions(q), 300);
    });
    becauseInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); becauseSuggest.querySelector(".suggest-item")?.click(); }
        else if (e.key === "Escape") hideBecauseSuggest();
    });
    document.addEventListener("click", (e) => {
        if (!e.target.closest("#becauseSearchSection .search-field")) hideBecauseSuggest();
    });
}

/* =========================================================
   [ADDED] SIDEBAR SEARCH BUTTON: jump to the search bar in the Home filter section
========================================================= */
var pendingSearchFocus = false;

function focusHomeSearch() {
    if (!homeSearchInput) return;
    homeSearchInput.scrollIntoView({ behavior: "smooth", block: "center" });
    homeSearchInput.focus({ preventScroll: true });
}

document.getElementById("navSearchBtn")?.addEventListener("click", (e) => {
    e.preventDefault();
    if (getRoute() === "home") {
        focusHomeSearch();
    } else {
        pendingSearchFocus = true;   // handleRoute() focuses the bar once Home is showing
        location.hash = "#/";
    }
});

/* =========================================================
   [ADDED] SURPRISE PAGE (#/surprise)
   Pick a mode -> one big featured pick with Interested / Skip / Roll again / Details,
   plus a strip of recent rolls. (var + getElementById inside functions: safe to call early.)
========================================================= */
var SURPRISE_MODES = {
    "wildcard": "Wildcard",
    "hidden-gem": "Hidden Gems",
    "time-capsule": "Time Capsule",
    "studio-spotlight": "Studio Spotlight"
};
var surpriseMode = null;
var surpriseToken = 0;
var surpriseHistory = [];   // newest first: { anime, studioName, mode }
var surpriseCurrent = null;

function setSurpriseMode(mode) {
    document.querySelectorAll(".surprise-mode").forEach(btn => {
        const active = btn.dataset.mode === mode;
        btn.classList.toggle("is-active", active);
        btn.setAttribute("aria-checked", String(active));
    });
}

async function rollSurprise(mode) {
    const card = document.getElementById("surpriseCard");
    const empty = document.getElementById("surpriseEmpty");
    if (!card || !empty) return;

    surpriseMode = mode;
    setSurpriseMode(mode);
    const myToken = ++surpriseToken;

    empty.classList.add("hidden");
    card.classList.remove("hidden");
    card.style.removeProperty("--stage-accent");
    card.innerHTML = `<div class="stage-loading"><span class="dice" aria-hidden="true">🎲</span><p>Rolling a ${escapeHtml(SURPRISE_MODES[mode] || "surprise")} pick…</p></div>`;

    try {
        const params = new URLSearchParams({ mode });
        const username = localStorage.getItem("anilist_username");
        const skipped = getDislikedIds();
        const liked = getLikedIds();
        if (username) params.set("username", username);
        if (skipped.length > 0) params.set("exclude", skipped.join(","));
        if (liked.length > 0) params.set("liked", liked.join(","));

        const pick = await fetchJson(`http://localhost:5000/api/surprise?${params.toString()}`);
        const anime = await fetchJson(`http://localhost:5000/api/anime/${encodeURIComponent(pick.id)}`);
        if (myToken !== surpriseToken) return;

        showSurpriseAnime(anime, pick.studio?.name || anime.studios?.nodes?.[0]?.name || "", mode, true);
    } catch (err) {
        if (myToken !== surpriseToken) return;
        console.error("Surprise roll error:", err);
        card.innerHTML = `<div class="stage-loading"><p>Couldn't roll a pick right now. Try another mode, or roll again.</p></div>`;
    }
}

function showSurpriseAnime(anime, studioName, mode, remember) {
    const card = document.getElementById("surpriseCard");
    if (!card) return;
    surpriseCurrent = anime;

    const title = anime.title?.english || anime.title?.romaji || "Untitled";
    const cover = anime.coverImage?.extraLarge || anime.coverImage?.large || "";
    const meta = [
        anime.averageScore ? `⭐ ${anime.averageScore}%` : null,
        anime.format ? String(anime.format).replace("_", " ") : null,
        anime.seasonYear || null,
        anime.episodes ? `${anime.episodes} eps` : null,
        studioName || null
    ].filter(Boolean);

    const plain = String(anime.description || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    const short = plain.length > 360 ? plain.slice(0, 360).replace(/\s+\S*$/, "") + "…" : (plain || "No description available.");

    card.style.setProperty("--stage-accent", anime.coverImage?.color || "#8b56b7");
    card.innerHTML = `
        <div class="stage-bg"></div>
        <div class="stage-body">
            <img class="stage-poster" src="${escapeHtml(cover)}" alt="${escapeHtml(title)}">
            <div class="stage-info">
                <span class="stage-mode">${escapeHtml(SURPRISE_MODES[mode] || "Surprise")}</span>
                <h2>${escapeHtml(title)}</h2>
                <p class="stage-meta">${meta.map(item => escapeHtml(item)).join(" · ")}</p>
                <div class="stage-genres">${(anime.genres || []).slice(0, 4).map(g => `<span>${escapeHtml(g)}</span>`).join("")}</div>
                <p class="stage-desc">${escapeHtml(short)}</p>
                <div class="stage-actions">
                    <button type="button" class="stage-btn like" data-act="like">${isSaved(anime.id) ? "✓ Saved" : "👍 I'm interested"}</button>
                    <button type="button" class="stage-btn skip" data-act="skip">👎 Skip</button>
                    <button type="button" class="stage-btn roll" data-act="roll">🎲 Roll again</button>
                    <button type="button" class="stage-btn ghost" data-act="details">Details</button>
                </div>
            </div>
        </div>
    `;

    const bgUrl = anime.bannerImage || cover;
    if (bgUrl) card.querySelector(".stage-bg").style.backgroundImage = `url(${JSON.stringify(bgUrl)})`;

    if (remember) {
        surpriseHistory = [{ anime, studioName, mode }, ...surpriseHistory.filter(entry => entry.anime.id !== anime.id)].slice(0, 12);
    }
    renderSurpriseHistory();
}

function renderSurpriseHistory() {
    const section = document.getElementById("surpriseHistorySection");
    const row = document.getElementById("surpriseHistoryRow");
    if (!section || !row) return;

    section.classList.toggle("hidden", surpriseHistory.length < 2);
    row.innerHTML = "";
    surpriseHistory.forEach(entry => {
        const title = entry.anime.title?.english || entry.anime.title?.romaji || "Untitled";
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "history-thumb" + (surpriseCurrent && surpriseCurrent.id === entry.anime.id ? " is-current" : "");
        btn.innerHTML = `<img src="${escapeHtml(entry.anime.coverImage?.large || entry.anime.coverImage?.extraLarge || "")}" alt=""><span>${escapeHtml(title)}</span>`;
        btn.addEventListener("click", () => {
            surpriseMode = entry.mode;
            setSurpriseMode(entry.mode);
            showSurpriseAnime(entry.anime, entry.studioName, entry.mode, false);
            document.getElementById("surpriseCard")?.scrollIntoView({ behavior: "smooth", block: "center" });
        });
        row.appendChild(btn);
    });
}

document.querySelectorAll(".surprise-mode").forEach(btn => {
    btn.addEventListener("click", () => rollSurprise(btn.dataset.mode));
});
enhanceScroller(document.getElementById("surpriseHistoryRow"));

document.getElementById("surpriseCard")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-act]");
    if (!btn || !surpriseCurrent) return;
    const anime = surpriseCurrent;

    if (btn.dataset.act === "like") {
        if (isSaved(anime.id)) { showToast("Already in Saved For Later"); return; }
        saveAnime(anime);
        renderSavedRow();
        btn.textContent = "✓ Saved";
        showToast("Saved for later ♥");
    } else if (btn.dataset.act === "skip") {
        addDislikedId(anime.id);                // never suggested again anywhere
        removeSaved(anime.id);
        surpriseHistory = surpriseHistory.filter(entry => entry.anime.id !== anime.id);
        renderSavedRow();
        discoverLoadedFor = undefined;
        rollSurprise(surpriseMode || "wildcard");
    } else if (btn.dataset.act === "roll") {
        rollSurprise(surpriseMode || "wildcard");
    } else if (btn.dataset.act === "details") {
        openAnimeModal(anime.id);
    }
});

/* =========================================================
   [ADDED] LISTS PAGE (#/lists)
   Left: a rail of lists with counts. Right: the chosen list as compact rows.
   Lists: Saved / Favourites / Skipped (this browser) + Watching / Plan to Watch / Completed / Dropped (AniList).
========================================================= */
function removeDislikedId(id) {
    writeStorageJSON(DISLIKED_KEY, getDislikedIds().filter(existing => existing !== Number(id)));
}

var LIST_DEFS = [
    { key: "saved", group: "On this device", name: "Saved For Later", icon: "🔖",
      sub: "Shows you bookmarked to get to later.",
      empty: "Nothing saved yet. Use “Save” in a details window, or “I'm interested” on the Surprise page.",
      itemAction: { act: "remove-saved", label: "Remove", danger: true }, bulk: "Clear all" },
    { key: "favourites", group: "On this device", name: "Favourites", icon: "❤️",
      sub: "Shows you told the recommender you love (Profile → Teach me your taste).",
      empty: "No favourites yet. Add some in Profile → Teach me your taste.",
      itemAction: { act: "remove-favourite", label: "Remove", danger: true } },
    { key: "skipped", group: "On this device", name: "Skipped", icon: "🚫",
      sub: "Hidden from every suggestion. Restore any you changed your mind about.",
      empty: "You haven't skipped anything.",
      itemAction: { act: "restore", label: "Restore" }, bulk: "Restore all" },
    { key: "CURRENT", group: "AniList", anilist: true, name: "Watching", icon: "▶️", sub: "What you're watching right now.", empty: "Nothing in this list." },
    { key: "PLANNING", group: "AniList", anilist: true, name: "Plan to Watch", icon: "🗓️", sub: "Your AniList planning list.", empty: "Nothing in this list." },
    { key: "COMPLETED", group: "AniList", anilist: true, name: "Completed", icon: "✅", sub: "Finished shows.", empty: "Nothing in this list." },
    { key: "DROPPED", group: "AniList", anilist: true, name: "Dropped", icon: "⏹️", sub: "Shows you stopped watching.", empty: "Nothing in this list." }
];
var activeListKey = "saved";
var listFilterText = "";
var listsRenderToken = 0;
var listCardCache = new Map();

function refreshListsPage() {
    if (!LIST_DEFS) return;                       // called before this section ran
    if (getRoute() === "lists") renderListsPage();
}

function getListCount(key) {
    if (key === "saved") return getSavedList().length;
    if (key === "favourites") return getSeedPicks().length;
    if (key === "skipped") return getDislikedIds().length;
    const list = cachedWatchlist.find(entry => entry.status === key);
    return list ? list.entries.length : 0;
}

async function getListCards(ids) {
    const missing = ids.filter(id => !listCardCache.has(id));
    for (let i = 0; i < missing.length; i += 50) {
        const cards = await fetchJson(`http://localhost:5000/api/anime-cards?ids=${missing.slice(i, i + 50).join(",")}`);
        cards.forEach(card => listCardCache.set(card.id, card));
    }
    return ids.map(id => listCardCache.get(id)).filter(Boolean);
}

function cardToListItem(anime) {
    const format = [anime.format ? String(anime.format).replace("_", " ") : null, anime.seasonYear].filter(Boolean).join(" ");
    return {
        id: anime.id,
        title: anime.title?.english || anime.title?.romaji || "Untitled",
        cover: anime.coverImage?.extraLarge || anime.coverImage?.large || "",
        meta: [anime.averageScore ? `⭐ ${anime.averageScore}%` : null, (anime.genres || []).slice(0, 3).join(", ") || null, format || null].filter(Boolean).join(" · "),
        extra: ""
    };
}

async function renderListsPage() {
    const rail = document.getElementById("listsRail");
    const itemsBox = document.getElementById("listItems");
    if (!rail || !itemsBox || !LIST_DEFS) return;

    const username = localStorage.getItem("anilist_username");
    let def = LIST_DEFS.find(entry => entry.key === activeListKey);
    if (!def || (def.anilist && !username)) { activeListKey = "saved"; def = LIST_DEFS[0]; }

    // ---- rail ----
    let railHtml = "";
    let lastGroup = "";
    LIST_DEFS.forEach(entry => {
        if (entry.anilist && !username) return;
        if (entry.group !== lastGroup) { railHtml += `<p class="list-group-label">${escapeHtml(entry.group)}</p>`; lastGroup = entry.group; }
        railHtml += `<button type="button" class="list-tab${entry.key === activeListKey ? " active" : ""}" data-list="${entry.key}">
            <span class="list-tab-name"><span aria-hidden="true">${entry.icon}</span>${escapeHtml(entry.name)}</span>
            <span class="list-count">${getListCount(entry.key)}</span></button>`;
    });
    if (!username) railHtml += `<p class="list-rail-hint">Connect AniList from your profile to see your Watching, Plan to Watch, Completed and Dropped lists here.</p>`;
    rail.innerHTML = railHtml;

    // ---- panel header ----
    document.getElementById("listTitle").textContent = def.name;
    document.getElementById("listSub").textContent = def.sub;
    const bulk = document.getElementById("listBulkBtn");
    bulk.classList.toggle("hidden", !(def.bulk && getListCount(def.key) > 0));
    bulk.textContent = def.bulk || "";

    // ---- items ----
    const token = ++listsRenderToken;
    let items = [];

    if (def.key === "saved") {
        items = getSavedList().map(cardToListItem);
    } else if (def.key === "favourites" || def.key === "skipped") {
        const ids = def.key === "favourites" ? getSeedPicks().map(pick => pick.id) : getDislikedIds().slice().reverse();
        if (ids.some(id => !listCardCache.has(id))) {
            itemsBox.innerHTML = Array(Math.min(ids.length, 6)).fill('<div class="list-item list-item-skeleton"></div>').join("");
        }
        try {
            items = ids.length ? (await getListCards(ids)).map(cardToListItem) : [];
        } catch (err) {
            if (token !== listsRenderToken) return;
            console.error("Lists error:", err);
            itemsBox.innerHTML = `<div class="list-empty"><p>Couldn't load this list. Check that the server is running.</p></div>`;
            return;
        }
        if (token !== listsRenderToken) return;
    } else {
        if (!watchlistLoaded) {
            itemsBox.innerHTML = `<div class="list-empty"><p>Loading your AniList lists…</p></div>`;
            return;                                // loadUserWatchlist() refreshes this page when it finishes
        }
        const list = cachedWatchlist.find(entry => entry.status === def.key);
        items = (list ? list.entries : []).map(entry => {
            const media = entry.media;
            return {
                id: media.id,
                title: media.title?.english || media.title?.romaji || "Untitled",
                cover: media.coverImage?.medium || "",
                meta: media.episodes ? `${media.episodes} episodes` : "",
                extra: `Ep ${entry.progress || 0} / ${media.episodes || "?"}${entry.score ? ` · ★ ${entry.score}` : ""}`
            };
        });
    }

    const query = listFilterText.trim().toLowerCase();
    const shown = query ? items.filter(item => item.title.toLowerCase().includes(query)) : items;

    if (shown.length === 0) {
        itemsBox.innerHTML = `<div class="list-empty"><p>${query ? "Nothing in this list matches that filter." : escapeHtml(def.empty)}</p></div>`;
        return;
    }

    itemsBox.innerHTML = shown.map(item => `
        <article class="list-item">
            <button type="button" class="list-item-main" data-open="${item.id}" aria-label="View details: ${escapeHtml(item.title)}">
                <img class="list-item-poster" src="${escapeHtml(item.cover)}" alt="" loading="lazy">
                <span class="list-item-text">
                    <span class="list-item-title">${escapeHtml(item.title)}</span>
                    ${item.meta ? `<span class="list-item-meta">${escapeHtml(item.meta)}</span>` : ""}
                    ${item.extra ? `<span class="list-item-extra">${escapeHtml(item.extra)}</span>` : ""}
                </span>
            </button>
            ${def.itemAction ? `<button type="button" class="list-action-btn${def.itemAction.danger ? " danger" : ""}" data-act="${def.itemAction.act}" data-id="${item.id}">${def.itemAction.label}</button>` : ""}
        </article>
    `).join("");
}

document.getElementById("listsRail")?.addEventListener("click", (e) => {
    const tab = e.target.closest(".list-tab");
    if (!tab) return;
    activeListKey = tab.dataset.list;
    listFilterText = "";
    document.getElementById("listFilterInput").value = "";
    renderListsPage();
});

document.getElementById("listItems")?.addEventListener("click", (e) => {
    const open = e.target.closest("[data-open]");
    if (open) { openAnimeModal(Number(open.dataset.open)); return; }

    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const id = Number(btn.dataset.id);

    if (btn.dataset.act === "remove-saved") {
        removeSaved(id);
        showToast("Removed from saved");
    } else if (btn.dataset.act === "remove-favourite") {
        removeSeedPick(id);
        onSeedsChanged();
        showToast("Removed from favourites");
    } else if (btn.dataset.act === "restore") {
        removeDislikedId(id);
        discoverLoadedFor = undefined;
        showToast("Restored. It can show up in suggestions again");
    }
    renderListsPage();
});

document.getElementById("listBulkBtn")?.addEventListener("click", () => {
    if (activeListKey === "skipped") {
        clearDislikedIds();
        discoverLoadedFor = undefined;
        showToast("Skipped shows restored");
    } else if (activeListKey === "saved") {
        if (!confirm("Remove every show from Saved For Later?")) return;
        writeStorageJSON(SAVED_KEY, []);
        showToast("Saved list cleared");
    }
    renderListsPage();
});

document.getElementById("listFilterInput")?.addEventListener("input", (e) => {
    listFilterText = e.target.value;
    renderListsPage();
});

/* =========================================================
   ANI-REC: PAGE ROUTER (#/ = Home, #/discover = Discover)
========================================================= */

const homeView = document.getElementById("homeView");
const discoverView = document.getElementById("discoverView");
const surpriseView = document.getElementById("surpriseView");
const listsView = document.getElementById("listsView");
const routeLinks = document.querySelectorAll(".nav-links a[data-route]");
const appHeader = document.querySelector("header");

function updateHeaderOnScroll() {
    appHeader?.classList.toggle("is-scrolled", window.scrollY > 24);
}

window.addEventListener("scroll", updateHeaderOnScroll, { passive: true });

function getRoute() {
    // [CHANGED] Ignore anything after "?" so "#/?genre=Action" (shareable filters) still counts as the home route
    const path = location.hash.split("?")[0];
    if (path === "#/discover") return "discover";
    if (path === "#/surprise") return "surprise";
    if (path === "#/lists") return "lists";
    return "home";
}

function handleRoute() {
    const route = getRoute();
    homeView.classList.toggle("hidden", route !== "home");
    discoverView.classList.toggle("hidden", route !== "discover");
    surpriseView.classList.toggle("hidden", route !== "surprise");
    listsView.classList.toggle("hidden", route !== "lists");
    routeLinks.forEach(a => a.classList.toggle("active", a.dataset.route === route));
    window.scrollTo(0, 0);
    updateHeaderOnScroll();
    if (route === "discover") loadDiscover();
    if (route === "lists") renderListsPage();
    if (route === "home" && pendingSearchFocus) {
        pendingSearchFocus = false;
        requestAnimationFrame(focusHomeSearch);
    }
}

window.addEventListener("hashchange", handleRoute);

// Initial render
handleRoute();
renderContinueWatching();
renderSavedRow();          // [ADDED] show the Saved For Later section if anything is saved
restoreFiltersFromHash();  // [ADDED] if the URL contains filters (#/?genre=...), apply them and search