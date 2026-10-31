/* =========================================================
   app part 4 of 5: HOME + DISCOVER
   Continue Watching, card rows and the Discover page.
   Helpers, Continue Watching, scrolling rows, Discover, Saved For Later, shareable filter links, taste insights.
   Load order matters: index.html must load the 5 js files in number order
   (1 -> 5). They share one global scope, exactly like the old single app.js.
========================================================= */

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
        const meta = getCardMeta(media);
        const watchUrl = `${API_BASE_URL}/api/watch?title=${encodeURIComponent(title)}`;

        const card = document.createElement("div");
        card.className = "anime-card";
        card.dataset.animeId = media.id;
        card.style.setProperty("--card-accent", media.coverImage?.color || "#8b56b7");

        // [CHANGED] Same card as everywhere else; the action row is the "Next episode" link and a progress bar shows where you are
        card.innerHTML = `
            ${cardPosterHTML(media, title)}
            <div class="anime-info">
                <h3 title="${escapeHtml(title)}">${escapeHtml(title)}</h3>
                ${meta ? `<p class="card-meta">${escapeHtml(meta)}</p>` : ""}
                ${cardGenresHTML(media)}
                <div class="continue-progress">
                    <p class="continue-progress-text">Ep ${progress}${total ? ` / ${total}` : ""}</p>
                    <div class="continue-bar"><div class="continue-bar-fill" style="width: ${pct}%;"></div></div>
                </div>
                <div class="card-actions">
                    <a class="card-main-btn continue-watch" href="${escapeHtml(watchUrl)}" target="_blank" rel="noopener noreferrer">
                        ${CARD_ICONS.play}<span>${nextEp ? `Next: Ep ${nextEp}` : "Rewatch"}</span>
                    </a>
                </div>
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

// Shared card builder: used by the home results, every Discover row and anywhere else a show is shown as a card.
// options.showReason -> also show the "Matches your taste for ..." line (only some rows ask for it)
// options.removable  -> adds a small remove (x) button for saved shows
function buildAnimeCard(anime, options = {}) {
    const title = anime.title?.english || anime.title?.romaji || "Untitled";
    const meta = getCardMeta(anime);
    const trailerLabel = hasRealTrailer(anime) ? "Watch Trailer" : "Find Trailer";

    const card = document.createElement("div");
    card.className = "anime-card";
    card.dataset.animeId = anime.id;
    if (anime.reason) modalReasonHints.set(Number(anime.id), String(anime.reason));

    // Poster colour from AniList (falls back to the site's purple) -> used for the hover glow
    card.style.setProperty("--card-accent", anime.coverImage?.color || "#8b56b7");

    card.innerHTML = `
        ${cardPosterHTML(anime, title)}
        <div class="anime-info">
            <h3 title="${escapeHtml(title)}">${escapeHtml(title)}</h3>
            ${meta ? `<p class="card-meta">${escapeHtml(meta)}</p>` : ""}
            ${cardGenresHTML(anime)}
            <p class="card-synopsis">${getCardSynopsis(anime)}</p>
            ${options.showReason && anime.reason ? `<p class="reason-text">${escapeHtml(anime.reason)}</p>` : ""}
            <div class="card-actions">
                <a class="card-main-btn trailer-btn" href="${escapeHtml(getTrailerUrl(anime, title))}" target="_blank" rel="noopener noreferrer">
                    ${CARD_ICONS.play}<span>${trailerLabel}</span>
                </a>
                <span class="card-icon-group">
                    <button type="button" class="card-icon-btn card-save-btn" data-action="save">${CARD_ICONS.plus}${CARD_ICONS.check}</button>
                    <button type="button" class="card-icon-btn card-fav-btn" data-action="favourite">${CARD_ICONS.heart}</button>
                </span>
            </div>
        </div>
    `;

    card.addEventListener("click", (e) => {
        const actionBtn = e.target.closest("[data-action]");
        if (actionBtn && card.contains(actionBtn)) {
            e.stopPropagation(); // buttons never open the details window
            handleCardAction(actionBtn.dataset.action, anime, title);
            return;
        }
        if (e.target.closest(".card-actions")) return; // the trailer link opens in a new tab instead
        openAnimeModal(anime.id);
    });
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
    row.innerHTML = Array(count).fill(0).map(() => skeletonCardHTML()).join("");
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

        const res = await fetch(`${API_BASE_URL}/api/trending?${params.toString()}`);
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
        fetchJson(`${API_BASE_URL}/api/because/${encoded}${becauseSuffix}`)
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

// Phones: the details and profile windows are bottom sheets, so they can be dragged down to close
{
    const detailsSheet = modal ? modal.querySelector(".modal-content") : null;
    if (detailsSheet) enableSwipeToClose(detailsSheet, detailsSheet, () => { if (closeModalBtn) closeModalBtn.click(); }, { requireScrollTop: true });

    const profileSheet = profileModal ? profileModal.querySelector(".modal-content") : null;
    if (profileSheet) enableSwipeToClose(profileSheet, profileSheet, () => { if (closeProfileModal) closeProfileModal.click(); }, { requireScrollTop: true });
}

// ---- FILTERS IN THE URL (shareable searches): #/?q=Frieren&mood=funny&genre=Action&rating=7 ----
function writeFiltersToHash(prefs) {
    const params = new URLSearchParams();
    if (prefs.search) params.set("q", prefs.search);
    prefs.moods.forEach(m => params.append("mood", m));
    prefs.genres.forEach(g => params.append("genre", g));
    prefs.tags.forEach(t => params.append("tag", t));
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
    const wantedTags = params.getAll("tag").slice(0, MAX_TAGS_SELECTED);
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

    if (wantedTags.length > 0) {
        // The tag list loads from the server, so wait for it before ticking tags and searching
        tagsReady.then(() => {
            wantedTags.forEach(value => tick("tags", value));
            updateFilterActiveStates();
            fetchRecommendations({ scroll: false });
        });
        updateFilterActiveStates();
        return true;
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
        resetTagSearch();
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
            `${API_BASE_URL}/api/affinity/${encodeURIComponent(username)}${liked.length > 0 ? `?liked=${liked.join(",")}` : ""}`
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
    refreshCardButtons(); // [ADDED] hearts on the cards follow
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
        const list = await fetchJson(`${API_BASE_URL}/api/search?q=${encodeURIComponent(query)}`);
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
    return fetchJson(`${API_BASE_URL}/api/recommendations/${encodeURIComponent(username)}${qs ? `?${qs}` : ""}`);
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
        const list = await fetchJson(`${API_BASE_URL}/api/search?q=${encodeURIComponent(q)}`);
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

        const data = await fetchJson(`${API_BASE_URL}/api/because-show/${encodeURIComponent(id)}?${params.toString()}`);
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
