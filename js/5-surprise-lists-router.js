/* =========================================================
   app part 5 of 5: SURPRISE, LISTS, ROUTER
   Surprise page, Lists page and the page router.
   Sidebar search button, Surprise Me, Your Lists, and the router that switches pages and starts the app (must load LAST).
   Load order matters: index.html must load the 5 js files in number order
   (1 -> 5). They share one global scope, exactly like the old single app.js.
========================================================= */

/* =========================================================
   SIDEBAR SEARCH BUTTON: opens the Search page (#/search) and puts the cursor in the search bar
   (not on phones, where that would pop the keyboard up before you asked for it)
========================================================= */
var pendingSearchFocus = false;
var canHoverDevice = window.matchMedia("(hover: hover)").matches;

function focusHomeSearch() {
    if (!homeSearchInput) return;
    homeSearchInput.focus({ preventScroll: true });
}

document.getElementById("navSearchBtn")?.addEventListener("click", (e) => {
    if (getRoute() === "search") {
        e.preventDefault();   // already here: just go back to the top of the page
        window.scrollTo({ top: 0, behavior: "smooth" });
        if (canHoverDevice) focusHomeSearch();
    } else if (canHoverDevice) {
        pendingSearchFocus = true;   // handleRoute() focuses the bar once the Search page is showing
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
    card.innerHTML = `<div class="stage-loading"><span class="dice" aria-hidden="true">${UI_ICONS.dice}</span><p>Rolling a ${escapeHtml(SURPRISE_MODES[mode] || "surprise")} pick…</p></div>`;

    try {
        const params = new URLSearchParams({ mode });
        const username = localStorage.getItem("anilist_username");
        const skipped = getDislikedIds();
        const liked = getLikedIds();
        if (username) params.set("username", username);
        if (skipped.length > 0) params.set("exclude", skipped.join(","));
        if (liked.length > 0) params.set("liked", liked.join(","));

        const pick = await fetchJson(`${API_BASE_URL}/api/surprise?${params.toString()}`);
        const anime = await fetchJson(`${API_BASE_URL}/api/anime/${encodeURIComponent(pick.id)}`);
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
        anime.averageScore ? `★ ${anime.averageScore}%` : null,
        anime.format ? String(anime.format).replace("_", " ") : null,
        anime.seasonYear || null,
        anime.episodes ? `${anime.episodes} eps` : null,
        studioName || null
    ].filter(Boolean);

    const plain = String(anime.description || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    const short = plain.length > 360 ? plain.slice(0, 360).replace(/\s+\S*$/, "") + "…" : (plain || "No description available.");

    card.style.setProperty("--stage-accent", anime.coverImage?.color || "#e16e2c");
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
                    <button type="button" class="stage-btn like" data-act="like">${isSaved(anime.id) ? `${UI_ICONS.check}Saved` : `${UI_ICONS.thumbUp}I'm interested`}</button>
                    <button type="button" class="stage-btn skip" data-act="skip">${UI_ICONS.thumbDown}Skip</button>
                    <button type="button" class="stage-btn roll" data-act="roll">${UI_ICONS.dice}Roll again</button>
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
        btn.innerHTML = `${UI_ICONS.check}Saved`;
        showToast("Saved for later");
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
    { key: "saved", group: "On this device", name: "Saved For Later", icon: UI_ICONS.bookmark,
      sub: "Shows you bookmarked to get to later.",
      empty: "Nothing saved yet. Use “Save” in a details window, or “I'm interested” on the Surprise page.",
      itemAction: { act: "remove-saved", label: "Remove", danger: true }, bulk: "Clear all" },
    { key: "favourites", group: "On this device", name: "Favourites", icon: UI_ICONS.heart,
      sub: "Shows you told the recommender you love (Profile → Teach me your taste).",
      empty: "No favourites yet. Add some in Profile → Teach me your taste.",
      itemAction: { act: "remove-favourite", label: "Remove", danger: true } },
    { key: "skipped", group: "On this device", name: "Skipped", icon: UI_ICONS.ban,
      sub: "Hidden from every suggestion. Restore any you changed your mind about.",
      empty: "You haven't skipped anything.",
      itemAction: { act: "restore", label: "Restore" }, bulk: "Restore all" },
    { key: "CURRENT", group: "AniList", anilist: true, name: "Watching", icon: UI_ICONS.play, sub: "What you're watching right now.", empty: "Nothing in this list." },
    { key: "PLANNING", group: "AniList", anilist: true, name: "Plan to Watch", icon: UI_ICONS.calendar, sub: "Your AniList planning list.", empty: "Nothing in this list." },
    { key: "COMPLETED", group: "AniList", anilist: true, name: "Completed", icon: UI_ICONS.check, sub: "Finished shows.", empty: "Nothing in this list." },
    { key: "DROPPED", group: "AniList", anilist: true, name: "Dropped", icon: UI_ICONS.stop, sub: "Shows you stopped watching.", empty: "Nothing in this list." }
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
        const cards = await fetchJson(`${API_BASE_URL}/api/anime-cards?ids=${missing.slice(i, i + 50).join(",")}`);
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
        meta: [anime.averageScore ? `★ ${anime.averageScore}%` : null, (anime.genres || []).slice(0, 3).join(", ") || null, format || null].filter(Boolean).join(" · "),
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
   ANI-REC: PAGE ROUTER (#/ = Home, #/search = Search, #/discover = Discover)
========================================================= */

const homeView = document.getElementById("homeView");
const discoverView = document.getElementById("discoverView");
const surpriseView = document.getElementById("surpriseView");
const listsView = document.getElementById("listsView");
const searchView = document.getElementById("searchView");
const routeLinks = document.querySelectorAll(".nav-links a[data-route]");
const appHeader = document.querySelector("header");

function updateHeaderOnScroll() {
    appHeader?.classList.toggle("is-scrolled", window.scrollY > 24);
}

window.addEventListener("scroll", updateHeaderOnScroll, { passive: true });

function getRoute() {
    // Ignore anything after "?" so "#/search?genre=Action" (shareable filters) still counts as the Search page
    const path = location.hash.split("?")[0];
    if (path === "#/search") return "search";
    if (path === "#/discover") return "discover";
    if (path === "#/surprise") return "surprise";
    if (path === "#/lists") return "lists";
    return "home";
}

function handleRoute() {
    const route = getRoute();
    homeView.classList.toggle("hidden", route !== "home");
    searchView.classList.toggle("hidden", route !== "search");
    discoverView.classList.toggle("hidden", route !== "discover");
    surpriseView.classList.toggle("hidden", route !== "surprise");
    listsView.classList.toggle("hidden", route !== "lists");
    routeLinks.forEach(a => a.classList.toggle("active", a.dataset.route === route));
    window.scrollTo(0, 0);
    updateHeaderOnScroll();
    if (route === "home") loadHome();
    setHeroActive(route === "home");
    if (route === "search") ensureSearchStarted();
    if (route === "discover") loadDiscover();
    if (route === "lists") renderListsPage();
    refreshCardButtons(); // [ADDED] cards on the page we return to may be out of date (saved / favourites changed on the Lists page)
    if (route === "search" && pendingSearchFocus) {
        pendingSearchFocus = false;
        requestAnimationFrame(focusHomeSearch);
    }
}

window.addEventListener("hashchange", handleRoute);

// Old shared links looked like "#/?genre=Action"; filters now live on the Search page, so send them there
if (location.hash.startsWith("#/?")) {
    history.replaceState(null, "", "#/search" + location.hash.slice(2));
}

// Initial render
handleRoute();
renderContinueWatching();
renderSavedRow();          // [ADDED] show the Saved For Later section if anything is saved
restoreFiltersFromHash();  // if the URL contains filters (#/search?genre=...), apply them and search
