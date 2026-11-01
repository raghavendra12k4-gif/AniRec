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

    const section = document.getElementById("continueSection");
    if (section) section.classList.toggle("is-guest", !username);

    // 1. Not connected -> a calm banner that says what connecting does (and that no password is involved)
    if (!username) {
        row.innerHTML = `
            <div class="connect-banner">
                <div class="connect-banner-text">
                    <strong>Connect your AniList</strong>
                    <p>See where you left off and get picks that match your taste. Only your public username is used. No password, ever.</p>
                </div>
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
        showRowSkeleton("continueRow", 4);
        return;
    }

    // 3. Connected and loaded
    const currentList = cachedWatchlist.find(l => l.status === "CURRENT");
    const entries = (currentList?.entries || [])
        .slice()
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    if (entries.length === 0) {
        row.innerHTML = `<p class="continue-empty">Nothing in progress yet. <a href="#/search">Browse everything</a> or try <a href="#/surprise">Surprise Me</a>.</p>`;
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
        card.style.setProperty("--card-accent", media.coverImage?.color || "#e16e2c");

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
    homeLoadedFor = undefined;
    if (getRoute() === "home") loadHome();
    if (getRoute() === "discover") loadDiscover();
    // The popularity list on the Search page hides what is on your list, so it has to restart
    if (resultsMode === "browse") {
        searchStarted = false;
        if (getRoute() === "search") ensureSearchStarted();
    }
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
    card.style.setProperty("--card-accent", anime.coverImage?.color || "#e16e2c");

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
   ANI-REC: DISCOVER PAGE (Airing This Season row)
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

async function loadAiringRow(username) {
    const token = discoverToken;
    showRowSkeleton("airingRow");

    try {
        const params = new URLSearchParams();
        if (username) params.append("username", username);

        const list = await fetchJson(`${API_BASE_URL}/api/airing?${params.toString()}`);
        if (token !== discoverToken) return;

        // Shows the user skipped with the thumbs-down button are filtered out
        renderRow("airingRow", filterDisliked(list), "Nothing is airing right now.");
    } catch (err) {
        if (token !== discoverToken) return;
        console.error("Airing error:", err);
        document.getElementById("airingRow").innerHTML =
            `<p class="row-empty">Couldn't load this season. Check if the server is running.</p>`;
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
            <div class="connect-banner">
                <div class="connect-banner-text">
                    <strong>Get picks ranked by your taste</strong>
                    <p>Connect your AniList and these rows are built from the shows you rate highly. Only your public username is used.</p>
                </div>
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
                    <h2>${UI_ICONS.target}Because you liked ${escapeHtml(row.seed.title)}</h2>
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
    await Promise.all([loadAiringRow(username), loadPersonalRows(username)]);
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

// ---- Results: note, end-of-list message and "Roll again" ----
// The note can hold two kinds of messages: the "loosened the mood" one and a "profile is light" hint.
// It remembers them, so adding the next 10 results (which calls this with no arguments) does not wipe them.
let resultsNoteState = { relaxed: false, profile: "" };

function updateResultsActions(showRelaxedNote, profileNote) {
    if (arguments.length > 0) resultsNoteState = { relaxed: Boolean(showRelaxedNote), profile: profileNote || "" };

    const note = document.getElementById("resultsNote");
    const rerollTop = document.getElementById("rerollBtn");
    const rerollEnd = document.getElementById("rerollEndBtn");
    const end = document.getElementById("resultsEnd");
    const endText = document.getElementById("resultsEndText");

    const hasPicks = resultsMode === "picks" && currentResults.length > 0;
    const canReroll = hasPicks && !currentSearchQuery;   // a title search always gives the same results, so no re-roll

    const messages = [];
    if (resultsNoteState.relaxed) messages.push("No show matched every mood and genre at once, so we loosened the mood a little to find these.");
    if (resultsNoteState.profile) messages.push(resultsNoteState.profile);
    if (note) {
        note.textContent = messages.join(" ");
        note.classList.toggle("hidden", !(hasPicks && messages.length > 0));
    }

    if (rerollTop) rerollTop.classList.toggle("hidden", !canReroll);
    if (rerollEnd) rerollEnd.classList.toggle("hidden", !canReroll);

    let endMessage = "";
    if (resultsMode === "picks") {
        if (hasPicks && shownCount >= currentResults.length) {
            endMessage = canReroll
                ? `That's all ${currentResults.length} picks. Not feeling them?`
                : `That's everything we found for \u201c${currentSearchQuery}\u201d.`;
        }
    } else if (!browseHasMore && browsePage > 0 && !browseLoading && !browseFailed) {
        endMessage = "You've reached the end of the list.";
    }
    if (end) end.classList.toggle("hidden", !endMessage);
    if (endText) endText.textContent = endMessage;
}

// Same filters, new random page -> a fresh set. The top button keeps your place; the one at the end of the list
// scrolls back up to the new picks.
document.getElementById("rerollBtn")?.addEventListener("click", () => fetchRecommendations({ scroll: false }));
document.getElementById("rerollEndBtn")?.addEventListener("click", () => fetchRecommendations({ scroll: true }));

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

// ---- FILTERS IN THE URL (shareable searches): #/search?q=Frieren&mood=funny&genre=Action&rating=7 ----
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
    history.replaceState(null, "", queryString ? `#/search?${queryString}` : "#/search");
}

function clearFiltersFromHash() {
    if (location.hash.includes("?")) history.replaceState(null, "", "#/search");
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
    if (getRoute() === "search" && location.hash.includes("?")) {
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

document.querySelectorAll("#discoverView .row-scroller, #homeView .row-scroller").forEach(enhanceScroller);

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


/* =========================================================
   HOME PAGE: hero banner, editorial collection, top rated
   - Hero: the 10 fastest-rising shows (that are not on your list), one at a time, changes every 8 seconds
   - Editorial pick: one hand-made collection, swapped by the server every 3 days
   - Top Rated: highly rated shows people actually watch
   (var instead of let on purpose: these are read by code in earlier files, so they must exist before this line runs)
========================================================= */

var homeLoadedFor = undefined;   // undefined = Home not loaded yet; otherwise the username (or null) it was loaded for
var homeToken = 0;               // a slow response for an old load can never overwrite a newer one
var heroItems = [];
var heroIndex = 0;
var heroTimer = null;
var heroPaused = false;
var HERO_INTERVAL_MS = 8000;
var heroReduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function heroBackgroundUrl(url) {
    return `url("${String(url).replace(/"/g, "%22")}")`;
}

function stopHeroTimer() {
    clearInterval(heroTimer);
    heroTimer = null;
}

function startHeroTimer() {
    stopHeroTimer();
    if (heroItems.length < 2 || heroReduceMotion || heroPaused || document.hidden || getRoute() !== "home") return;
    heroTimer = setInterval(() => goToHero(heroIndex + 1), HERO_INTERVAL_MS);
}

// The router calls this so the banner does not keep rotating while you are on another page
function setHeroActive(isHome) {
    if (isHome) startHeroTimer(); else stopHeroTimer();
}

function goToHero(index) {
    if (heroItems.length === 0) return;
    heroIndex = (index + heroItems.length) % heroItems.length;
    document.querySelectorAll("#heroTrack .hero-slide").forEach((slide, i) => {
        const active = i === heroIndex;
        slide.classList.toggle("is-active", active);
        slide.setAttribute("aria-hidden", active ? "false" : "true");
    });
    document.querySelectorAll("#heroDots .hero-dot").forEach((dot, i) => dot.classList.toggle("is-active", i === heroIndex));
}

function updateHeroSaveLabels() {
    document.querySelectorAll("#heroTrack .hero-slide").forEach((slide, i) => {
        const anime = heroItems[i];
        const button = slide.querySelector(".hero-save");
        if (!anime || !button) return;
        const saved = isSaved(anime.id);
        button.classList.toggle("is-saved", saved);
        button.querySelector(".hero-save-label").textContent = saved ? "Saved" : "Save";
    });
}

// Shown when the featured list cannot be loaded: a calm static banner instead of an empty hole
function renderHeroFallback() {
    const hero = document.getElementById("hero");
    const track = document.getElementById("heroTrack");
    if (!hero || !track) return;
    stopHeroTimer();
    heroItems = [];
    hero.classList.remove("is-loading");
    hero.classList.add("is-fallback");
    document.getElementById("heroUi")?.classList.add("hidden");
    track.innerHTML = `
        <article class="hero-slide is-active">
            <div class="hero-shade"></div>
            <div class="hero-content">
                <p class="hero-eyebrow">AniRec</p>
                <h2 class="hero-title">Find your next favourite anime</h2>
                <p class="hero-desc">Browse everything on AniList by popularity, filter by mood, genre and tag, or let Surprise Me pick for you.</p>
                <div class="hero-actions">
                    <a class="hero-btn hero-btn-primary" href="#/search"><span>Browse everything</span></a>
                    <a class="hero-btn hero-btn-ghost" href="#/surprise"><span>Surprise me</span></a>
                </div>
            </div>
        </article>`;
}

function renderHero() {
    const hero = document.getElementById("hero");
    const track = document.getElementById("heroTrack");
    const dots = document.getElementById("heroDots");
    if (!hero || !track || !dots) return;

    hero.classList.remove("is-loading", "is-fallback");
    track.innerHTML = "";
    dots.innerHTML = "";

    heroItems.forEach((anime, index) => {
        const title = anime.title?.english || anime.title?.romaji || "Untitled";
        const cover = anime.coverImage?.extraLarge || anime.coverImage?.large || "";
        const backdrop = anime.bannerImage || cover;
        const score = anime.averageScore ? `<span class="hero-score">★ ${(anime.averageScore / 10).toFixed(1)}</span>` : "";
        const meta = getCardMeta(anime);
        const trailerLabel = hasRealTrailer(anime) ? "Watch Trailer" : "Find Trailer";

        const slide = document.createElement("article");
        slide.className = "hero-slide" + (index === 0 ? " is-active" : "");
        slide.setAttribute("aria-hidden", index === 0 ? "false" : "true");
        slide.innerHTML = `
            <div class="hero-bg${anime.bannerImage ? "" : " is-cover"}"></div>
            <div class="hero-shade"></div>
            <div class="hero-content">
                <p class="hero-eyebrow"><span class="hero-rank">#${index + 1}</span>Rising fast right now</p>
                <h2 class="hero-title">${escapeHtml(title)}</h2>
                <p class="hero-meta">${score}${meta ? `<span>${escapeHtml(meta)}</span>` : ""}</p>
                <div class="hero-genres">${(anime.genres || []).slice(0, 3).map(genre => `<span>${escapeHtml(genre)}</span>`).join("")}</div>
                <p class="hero-desc">${sanitizeDescription(anime.description)}</p>
                <div class="hero-actions">
                    <a class="hero-btn hero-btn-primary" href="${escapeHtml(getTrailerUrl(anime, title))}" target="_blank" rel="noopener noreferrer">${CARD_ICONS.play}<span>${trailerLabel}</span></a>
                    <button type="button" class="hero-btn hero-btn-ghost hero-save" data-hero-action="save"><span class="hero-save-label">Save</span></button>
                    <button type="button" class="hero-btn hero-btn-ghost" data-hero-action="details"><span>Details</span></button>
                </div>
            </div>
            ${cover ? `<div class="hero-poster"><img alt="" loading="${index === 0 ? "eager" : "lazy"}" referrerpolicy="no-referrer"></div>` : ""}`;
        slide.querySelector(".hero-bg").style.backgroundImage = heroBackgroundUrl(backdrop);
        const posterImage = slide.querySelector(".hero-poster img");
        if (posterImage) posterImage.src = cover;
        track.appendChild(slide);

        const dot = document.createElement("button");
        dot.type = "button";
        dot.className = "hero-dot" + (index === 0 ? " is-active" : "");
        dot.dataset.index = String(index);
        dot.setAttribute("aria-label", `Show ${title}`);
        dots.appendChild(dot);
    });

    document.getElementById("heroUi")?.classList.toggle("hidden", heroItems.length < 2);
    heroIndex = 0;
    updateHeroSaveLabels();
    startHeroTimer();
}

async function loadHero(username) {
    const token = homeToken;
    document.getElementById("hero")?.classList.add("is-loading");
    try {
        const params = new URLSearchParams();
        if (username) params.append("username", username);
        const list = filterDisliked(await fetchJson(`${API_BASE_URL}/api/hero?${params.toString()}`));
        if (token !== homeToken) return;
        if (list.length === 0) throw new Error("No featured anime");
        heroItems = list.slice(0, 10);
        renderHero();
    } catch (error) {
        if (token !== homeToken) return;
        console.error("Hero error:", error);
        renderHeroFallback();
        homeLoadedFor = undefined;   // try again next time Home is opened
    }
}

// Hero controls: dots, arrows, Save / Details buttons, pause while the pointer or focus is on it, swipe on phones
(function wireHero() {
    const hero = document.getElementById("hero");
    if (!hero) return;

    hero.addEventListener("click", event => {
        const dot = event.target.closest(".hero-dot");
        if (dot) { goToHero(Number(dot.dataset.index)); startHeroTimer(); return; }

        const action = event.target.closest("[data-hero-action]");
        const anime = heroItems[heroIndex];
        if (!action || !anime) return;
        const title = anime.title?.english || anime.title?.romaji || "Untitled";
        if (action.dataset.heroAction === "details") openAnimeModal(anime.id);
        if (action.dataset.heroAction === "save") { handleCardAction("save", anime, title); updateHeroSaveLabels(); }
    });

    document.getElementById("heroPrev")?.addEventListener("click", () => { goToHero(heroIndex - 1); startHeroTimer(); });
    document.getElementById("heroNext")?.addEventListener("click", () => { goToHero(heroIndex + 1); startHeroTimer(); });

    const pause = () => { heroPaused = true; stopHeroTimer(); };
    const resume = () => { heroPaused = false; startHeroTimer(); };
    hero.addEventListener("mouseenter", pause);
    hero.addEventListener("mouseleave", resume);
    hero.addEventListener("focusin", pause);
    hero.addEventListener("focusout", resume);
    document.addEventListener("visibilitychange", () => { if (document.hidden) stopHeroTimer(); else startHeroTimer(); });

    let touchStartX = 0;
    let touchStartY = 0;
    hero.addEventListener("touchstart", event => {
        touchStartX = event.touches[0].clientX;
        touchStartY = event.touches[0].clientY;
    }, { passive: true });
    hero.addEventListener("touchend", event => {
        const dx = event.changedTouches[0].clientX - touchStartX;
        const dy = event.changedTouches[0].clientY - touchStartY;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
            goToHero(dx < 0 ? heroIndex + 1 : heroIndex - 1);
            startHeroTimer();
        }
    }, { passive: true });
})();

async function loadCollection(username) {
    const token = homeToken;
    const section = document.getElementById("collectionSection");
    if (!section) return;
    section.classList.remove("hidden");
    showRowSkeleton("collectionRow");

    try {
        const params = new URLSearchParams();
        if (username) params.append("username", username);
        const data = await fetchJson(`${API_BASE_URL}/api/collections/current?${params.toString()}`);
        if (token !== homeToken) return;

        document.getElementById("collectionTitle").textContent = data.title;
        document.getElementById("collectionBlurb").textContent = data.blurb;
        document.getElementById("collectionTimer").textContent =
            data.daysLeft <= 1 ? "New pick tomorrow" : `New pick in ${data.daysLeft} days`;
        renderRow("collectionRow", filterDisliked(data.items), "Nothing to show right now.");
    } catch (error) {
        if (token !== homeToken) return;
        console.error("Collection error:", error);
        section.classList.add("hidden");   // a missing editorial row is better than a broken one
    }
}

async function loadTopRated(username) {
    const token = homeToken;
    showRowSkeleton("topRatedRow");
    try {
        const params = new URLSearchParams();
        if (username) params.append("username", username);
        const list = await fetchJson(`${API_BASE_URL}/api/top-rated?${params.toString()}`);
        if (token !== homeToken) return;
        renderRow("topRatedRow", filterDisliked(list), "Nothing to show right now.");
    } catch (error) {
        if (token !== homeToken) return;
        console.error("Top rated error:", error);
        document.getElementById("topRatedRow").innerHTML =
            `<p class="row-empty">Couldn't load this row. Check if the server is running.</p>`;
        homeLoadedFor = undefined;
    }
}

async function loadHome() {
    const username = localStorage.getItem("anilist_username") || null;
    if (homeLoadedFor === username) { startHeroTimer(); return; }   // already loaded for this user
    homeLoadedFor = username;
    homeToken++;
    await Promise.all([loadHero(username), loadCollection(username), loadTopRated(username)]);
}
