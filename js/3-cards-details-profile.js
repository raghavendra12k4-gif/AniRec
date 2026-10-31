/* =========================================================
   app part 3 of 5: CARDS, DETAILS WINDOW, PROFILE
   Cards, the details pop-up and the profile pop-up.
   Drawing result cards, the anime details window, user profile, AniList connection and the watchlist.
   Load order matters: index.html must load the 5 js files in number order
   (1 -> 5). They share one global scope, exactly like the old single app.js.
========================================================= */

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

    // [CHANGED] Every card now comes from the shared buildAnimeCard() so the whole site has the same card.
    // showReason keeps the optional "Matches your taste for ..." line these results always had.
    list.forEach(anime => container.appendChild(buildAnimeCard(anime, { showReason: true })));
    refreshCardButtons();
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

// [ADDED] True only for real http(s) links with a host (used to keep broken / unsafe streaming links out of the modal)
function isValidWebUrl(value) {
    try {
        const u = new URL(String(value));
        return (u.protocol === "https:" || u.protocol === "http:") && Boolean(u.hostname) && u.hostname.includes(".");
    } catch (err) {
        return false;
    }
}

// [ADDED] Consistent provider icons (used when AniList has no logo for a site, or the logo fails to load)
const AM_ICON_PROVIDER = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><rect x="3" y="5" width="18" height="14" rx="3.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M10.2 9.2v5.6l4.8-2.8z" fill="currentColor"/></svg>';
const AM_ICON_SEARCH = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="M15.2 15.2L20 20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>';

// [ADDED] Full-size banner viewer: opens the banner at its full width and quality on top of the details window.
let amLightbox = null;
let amLightboxOpener = null;

function closeBannerLightbox() {
    if (!amLightbox || amLightbox.classList.contains("hidden")) return;
    amLightbox.classList.add("hidden");
    const img = amLightbox.querySelector("img");
    if (img) img.removeAttribute("src");
    if (amLightboxOpener && document.contains(amLightboxOpener)) amLightboxOpener.focus();
    amLightboxOpener = null;
}

function openBannerLightbox(src, title, opener) {
    if (!isValidWebUrl(src)) return;

    if (!amLightbox) {
        amLightbox = document.createElement("div");
        amLightbox.className = "am-lightbox hidden";
        amLightbox.setAttribute("role", "dialog");
        amLightbox.setAttribute("aria-modal", "true");
        amLightbox.setAttribute("aria-label", "Banner image");
        amLightbox.innerHTML = `
            <div class="am-lightbox-bar">
                <span class="am-lightbox-title"></span>
                <a class="am-lightbox-orig" target="_blank" rel="noopener noreferrer">Open original ↗</a>
                <button type="button" class="am-lightbox-close" aria-label="Close banner">&times;</button>
            </div>
            <div class="am-lightbox-stage"><img alt="" /></div>
        `;
        document.body.appendChild(amLightbox);

        // Click on the dark area (not on the picture or the bar buttons) closes it
        amLightbox.addEventListener("click", (e) => {
            if (e.target.closest(".am-lightbox-stage img, .am-lightbox-orig, .am-lightbox-close")) return;
            if (e.target.closest(".am-lightbox-bar") && !e.target.classList.contains("am-lightbox-bar")) return;
            closeBannerLightbox();
        });
        amLightbox.querySelector(".am-lightbox-close").addEventListener("click", closeBannerLightbox);

        // Escape closes only the banner viewer (capture phase, so the details window stays open underneath)
        window.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && amLightbox && !amLightbox.classList.contains("hidden")) {
                e.stopImmediatePropagation();
                e.preventDefault();
                closeBannerLightbox();
            }
        }, true);
    }

    amLightboxOpener = opener || null;
    amLightbox.querySelector(".am-lightbox-title").textContent = title || "";
    amLightbox.querySelector(".am-lightbox-orig").href = src;
    const img = amLightbox.querySelector("img");
    img.alt = title ? `${title} banner` : "Banner image";
    img.src = src;
    amLightbox.classList.remove("hidden");
    amLightbox.querySelector(".am-lightbox-close").focus();
}

// [ADDED] Builds the lines for the "Why this anime?" tab from what this browser knows:
// the recommender's own reason (when the card had one), your AniList ratings, your favourites and the community score.
function buildWhyReasons(anime) {
    const reasons = [];
    const animeId = Number(anime.id);
    const genres = Array.isArray(anime.genres) ? anime.genres : [];

    // 1) The recommender's own explanation, if this show came from a card that had one
    const hint = modalReasonHints.get(animeId);
    if (hint) reasons.push(hint);

    // 2) Your AniList ratings (AniList may send a 10-point or a 100-point score, so both are handled)
    const entries = [];
    (Array.isArray(cachedWatchlist) ? cachedWatchlist : []).forEach(list => {
        (list?.entries || []).forEach(entry => {
            if (entry?.media && entry.media.id !== animeId) entries.push({ ...entry, listStatus: list.status });
        });
    });
    const tenPoint = (s) => (s > 10 ? s / 10 : s);
    const liked = entries.filter(entry => entry.score > 0 && tenPoint(entry.score) >= 7.7);

    if (liked.length > 0 && genres.length > 0) {
        const tally = {};
        liked.forEach(entry => (entry.media.genres || []).forEach(g => { tally[g] = (tally[g] || 0) + 1; }));
        const matchingGenres = genres
            .filter(g => (tally[g] || 0) >= 2)
            .sort((a, b) => tally[b] - tally[a])
            .slice(0, 3);
        if (matchingGenres.length > 0) {
            reasons.push(`Matches the genres you rate highly: ${matchingGenres.join(", ")}`);
        }

        const similar = liked
            .map(entry => ({ entry, shared: (entry.media.genres || []).filter(g => genres.includes(g)).length }))
            .filter(item => item.shared >= 2)
            .sort((a, b) => b.shared - a.shared || tenPoint(b.entry.score) - tenPoint(a.entry.score))
            .slice(0, 2)
            .map(item => item.entry.media.title?.english || item.entry.media.title?.romaji)
            .filter(Boolean);
        if (similar.length > 0) reasons.push(`Similar to shows you rated highly: ${similar.join(", ")}`);
    }

    // 3) Part of a franchise you already watched or favourited
    const known = new Map();
    entries.forEach(entry => {
        if (entry.listStatus !== "PLANNING") known.set(entry.media.id, entry.media.title?.english || entry.media.title?.romaji);
    });
    getSeedPicks().forEach(pick => known.set(pick.id, pick.title));
    const franchise = (anime.relations?.edges || [])
        .filter(edge => edge?.node?.type === "ANIME" && known.has(edge.node.id))
        .map(edge => known.get(edge.node.id))
        .filter(Boolean);
    if (franchise.length > 0) reasons.push(`Connected to ${franchise.slice(0, 2).join(" and ")}, which you already know`);

    // 4) Community rating
    if (anime.averageScore >= 81) {
        reasons.push(`Highly rated by the community (${(anime.averageScore / 10).toFixed(1)}/10 on AniList)`);
    }

    return reasons.slice(0, 5);
}

// [CHANGED] Now returns the anime object when it rendered, or null when the request failed / was replaced.
async function openAnimeModal(animeId) {
    if (!modal) return null;

    const requestId = ++modalRequestId;
    currentModalAnime = null;

    modal.classList.remove("hidden");
    modalBody.innerHTML = `<p class="loading-msg">Loading details...</p>`;

    try {
        const res = await fetch(`${API_BASE_URL}/api/anime/${encodeURIComponent(animeId)}`);
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
        const watchUrl = `${API_BASE_URL}/api/watch?title=${encodeURIComponent(rawTitle)}`;

        // [ADDED] Official streaming platforms from AniList (Crunchyroll, Netflix, ...), one button per site.
        // Only http(s) links are accepted. The Miruro search button below stays as an extra option.
        const seenSites = new Set();
        const officialLinks = (anime.externalLinks || []).filter(link => {
            if (link?.type !== "STREAMING" || !link.site || !isValidWebUrl(link.url)) return false;
            if (seenSites.has(link.site)) return false;
            seenSites.add(link.site);
            return true;
        }).slice(0, 6);

        // ---- Pieces of the new layout ----
        const trailerUrl = getTrailerUrl(anime, rawTitle);
        const trailerLabel = hasRealTrailer(anime) ? "Watch Trailer" : "Find Trailer";
        const statusBadge = getCardStatusBadge(anime);
        const scoreText = anime.averageScore ? (anime.averageScore / 10).toFixed(1) : null;
        const episodesText = anime.episodes ? `${anime.episodes} ${anime.episodes === 1 ? "Episode" : "Episodes"}` : (anime.status === "RELEASING" ? "Ongoing" : "");
        const durationText = anime.duration ? `${anime.duration} min${anime.format === "MOVIE" ? "" : "/ep"}` : "";
        const formatText = anime.format ? (CARD_FORMAT[anime.format] || String(anime.format).replace(/_/g, " ")) : "";
        const AM_ICON_EPS = '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true" focusable="false"><rect x="3" y="5" width="18" height="14" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M10 9.5v5l4.5-2.5z" fill="currentColor"/></svg>';
        const AM_ICON_CLOCK = '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7.5V12l3 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
        const metaItems = [
            formatText ? `<span class="am-format">${escapeHtml(formatText)}</span>` : "",
            episodesText ? `<span class="am-meta">${AM_ICON_EPS}${escapeHtml(episodesText)}</span>` : "",
            durationText ? `<span class="am-meta">${AM_ICON_CLOCK}${escapeHtml(durationText)}</span>` : "",
            anime.seasonYear ? `<span class="am-meta">${escapeHtml(anime.seasonYear)}</span>` : ""
        ].filter(Boolean);

        const bannerSrc = anime.bannerImage || anime.coverImage?.extraLarge || anime.coverImage?.large || "";

        // Where to Watch: official platforms get a logo (from AniList) or a consistent icon and open the real page;
        // the Miruro tile is a different look on purpose, because it only runs a search.
        const safeColor = (value) => (/^#[0-9a-f]{3,8}$/i.test(String(value || "")) ? value : "");
        const officialTiles = officialLinks.map(link => {
            const logoOk = isValidWebUrl(link.icon);
            const tint = safeColor(link.color);
            return `
            <a href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer" class="am-watch-tile" aria-label="Watch on ${escapeHtml(link.site)} (opens the official page)">
                <span class="am-watch-logo"${tint ? ` style="--logo-tint:${tint}"` : ""}>${logoOk ? `<img src="${escapeHtml(link.icon)}" alt="" loading="lazy" referrerpolicy="no-referrer" />` : AM_ICON_PROVIDER}</span>
                <span class="am-watch-name">${escapeHtml(link.site)}</span>
                <span class="am-watch-pill">Watch now <span aria-hidden="true">↗</span></span>
            </a>`;
        }).join("");

        const watchTiles = `
            ${officialLinks.length === 0 ? `<p class="am-watch-note">No official streaming links are listed for this anime.</p>` : ""}
            <div class="am-watch-grid">
                ${officialTiles}
                <a href="${escapeHtml(watchUrl)}" target="_blank" rel="noopener noreferrer" class="am-watch-tile am-watch-search" aria-label="Search for this anime on Miruro (not a direct link)">
                    <span class="am-watch-logo">${AM_ICON_SEARCH}</span>
                    <span class="am-watch-name">Miruro</span>
                    <span class="am-watch-pill am-watch-pill-search">Search only</span>
                </a>
            </div>
        `;

        // Related anime cards (click opens that show in this same window)
        const animeRelations = anime.relations?.edges?.filter(edge => edge?.node?.type === "ANIME") || [];
        const relatedHTML = animeRelations.length > 0
            ? `<div class="related-grid">
                ${animeRelations.slice(0, 12).map(edge => {
                    const relTitle = escapeHtml(edge.node.title.english || edge.node.title.romaji);
                    const relType = escapeHtml(String(edge.relationType || "").replace(/_/g, " "));
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
               </div>`
            : `<p class="am-empty">No related anime found for this one.</p>`;

        // Why this anime?
        const whyReasons = buildWhyReasons(anime);
        const whyHTML = whyReasons.length > 0
            ? `<ul class="am-why-list">${whyReasons.map(r => `<li><span class="am-why-star" aria-hidden="true">✦</span><span>${escapeHtml(r)}</span></li>`).join("")}</ul>`
            : `<p class="am-empty">Connect your AniList or favourite a few shows and we'll explain why this one fits you.</p>`;

        modalBody.innerHTML = `
            <div class="am-root">
                <div class="am-hero${anime.bannerImage ? " has-banner" : ""}">
                    ${anime.bannerImage ? `<button type="button" class="am-banner-btn" id="amBannerBtn" aria-label="View the full banner image"><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg><span>View banner</span></button>` : ""}
                    ${bannerSrc ? `<img src="${escapeHtml(bannerSrc)}" class="am-hero-bg${anime.bannerImage ? "" : " am-hero-bg-cover"}" alt="" aria-hidden="true" />` : ""}
                    <div class="am-hero-shade"></div>
                    <div class="am-top">
                        <img src="${escapeHtml(anime.coverImage?.extraLarge || anime.coverImage?.large || "")}" class="am-poster" alt="${title}" />
                        <div class="am-main">
                            <h2 class="am-title">${title}</h2>
                            ${nativeTitle ? `<p class="am-native">${nativeTitle}</p>` : ""}

                            <div class="am-badges">
                                <span class="am-status am-status-${statusBadge.cls}"><span class="am-status-dot" aria-hidden="true"></span>${escapeHtml(statusBadge.label)}</span>
                                ${scoreText ? `<span class="am-score" title="AniList average score">★ ${scoreText}/10</span>` : ""}
                                ${metaItems.join("")}
                            </div>

                            <div class="am-genres">
                                ${(anime.genres || []).map(g => `<span class="genre-tag">${escapeHtml(g)}</span>`).join("")}
                            </div>

                            <div class="am-synopsis-wrap">
                                <p class="am-synopsis" id="amSynopsis">${description}</p>
                                <button type="button" class="am-readmore hidden" id="amReadMore" aria-expanded="false" aria-controls="amSynopsis">Read more</button>
                            </div>

                            <div class="am-actions">
                                <a href="${escapeHtml(trailerUrl)}" target="_blank" rel="noopener noreferrer" class="am-btn am-btn-primary">${CARD_ICONS.play}<span>${trailerLabel}</span></a>
                                <button type="button" id="modalSaveBtn" class="am-btn"></button>
                                <button type="button" id="modalFavBtn" class="am-btn"></button>
                                <button type="button" id="modalDislikeBtn" class="am-btn am-btn-muted"><span aria-hidden="true">⊘</span><span>Not interested</span></button>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="am-lower">
                    <div class="am-tabs" role="tablist" aria-label="More about this anime">
                        <button type="button" role="tab" class="am-tab active" id="amTab-watch" data-tab="watch" aria-selected="true" aria-controls="amPanel-watch">Where to Watch</button>
                        <button type="button" role="tab" class="am-tab" id="amTab-why" data-tab="why" aria-selected="false" aria-controls="amPanel-why" tabindex="-1">Why this anime?</button>
                        <button type="button" role="tab" class="am-tab" id="amTab-related" data-tab="related" aria-selected="false" aria-controls="amPanel-related" tabindex="-1">Related Anime${animeRelations.length ? ` <span class="am-tab-count">${Math.min(animeRelations.length, 12)}</span>` : ""}</button>
                    </div>
                    <div class="am-panels">
                        <div class="am-panel" role="tabpanel" id="amPanel-watch" data-panel="watch" aria-labelledby="amTab-watch">
                            ${watchTiles}
                        </div>
                        <div class="am-panel hidden" role="tabpanel" id="amPanel-why" data-panel="why" aria-labelledby="amTab-why">${whyHTML}</div>
                        <div class="am-panel hidden" role="tabpanel" id="amPanel-related" data-panel="related" aria-labelledby="amTab-related">${relatedHTML}</div>
                    </div>
                </div>
            </div>
        `;

        // Also tint the window itself with the poster colour (border glow)
        const modalContentEl = modal.querySelector(".modal-content");
        if (modalContentEl) modalContentEl.style.setProperty("--modal-accent", accentColor);

        // ---- Banner viewer: the button, or a click on the artwork itself ----
        if (anime.bannerImage) {
            const heroEl = modalBody.querySelector(".am-hero");
            const bannerBtn = document.getElementById("amBannerBtn");
            if (bannerBtn) bannerBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                openBannerLightbox(anime.bannerImage, rawTitle, bannerBtn);
            });
            if (heroEl) heroEl.addEventListener("click", (e) => {
                // text, buttons and the poster keep their own behaviour; only the open artwork opens the viewer
                if (e.target.closest("a, button, .am-poster, .am-main > *")) return;
                openBannerLightbox(anime.bannerImage, rawTitle, bannerBtn);
            });
        }

        // ---- Synopsis: 3 lines, "Read more" only when the text is longer (the whole window scrolls, no inner scrollbar) ----
        const synopsisEl = document.getElementById("amSynopsis");
        const readMoreBtn = document.getElementById("amReadMore");
        const checkSynopsisOverflow = () => {
            if (!synopsisEl || !readMoreBtn || synopsisEl.classList.contains("expanded")) return;
            readMoreBtn.classList.toggle("hidden", synopsisEl.scrollHeight <= synopsisEl.clientHeight + 1);
        };
        checkSynopsisOverflow();
        requestAnimationFrame(checkSynopsisOverflow);
        if (readMoreBtn) {
            readMoreBtn.addEventListener("click", () => {
                const open = synopsisEl.classList.toggle("expanded");
                readMoreBtn.textContent = open ? "Show less" : "Read more";
                readMoreBtn.setAttribute("aria-expanded", String(open));
            });
        }

        // Provider logo failed to load -> fall back to the consistent icon
        modalBody.querySelectorAll(".am-watch-logo img").forEach(img => {
            img.addEventListener("error", () => { if (img.parentElement) img.parentElement.innerHTML = AM_ICON_PROVIDER; });
        });

        // ---- Tabs: Where to Watch / Why this anime? / Related Anime ----
        const tabButtons = Array.from(modalBody.querySelectorAll(".am-tab"));
        const selectTab = (name, moveFocus) => {
            tabButtons.forEach(btn => {
                const on = btn.dataset.tab === name;
                btn.classList.toggle("active", on);
                btn.setAttribute("aria-selected", String(on));
                btn.tabIndex = on ? 0 : -1;
                if (on && moveFocus) btn.focus();
            });
            modalBody.querySelectorAll(".am-panel").forEach(panel => {
                panel.classList.toggle("hidden", panel.dataset.panel !== name);
            });
        };
        tabButtons.forEach((btn, i) => {
            btn.addEventListener("click", () => selectTab(btn.dataset.tab, false));
            btn.addEventListener("keydown", (e) => {
                if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
                e.preventDefault();
                const next = tabButtons[(i + (e.key === "ArrowRight" ? 1 : tabButtons.length - 1)) % tabButtons.length];
                selectTab(next.dataset.tab, true);
            });
        });

        modalBody.querySelectorAll(".related-card").forEach(card => {
            card.addEventListener("click", () => openAnimeModal(card.getAttribute("data-id")));
            // keyboard access for related cards
            makeCardAccessible(card, `View details: ${card.querySelector(".related-title")?.textContent || "related anime"}`,
                () => openAnimeModal(card.getAttribute("data-id")));
        });

        // ---- "Save for later" and "Favourite" buttons (same lists as the cards' + and heart) ----
        const saveBtn = document.getElementById("modalSaveBtn");
        const favBtn = document.getElementById("modalFavBtn");
        const refreshActionBtns = () => {
            if (saveBtn) {
                const saved = isSaved(anime.id);
                saveBtn.classList.toggle("is-active", saved);
                saveBtn.setAttribute("aria-pressed", String(saved));
                saveBtn.innerHTML = `${CARD_ICONS.plus}${CARD_ICONS.check}<span>${saved ? "Saved" : "Save for later"}</span>`;
            }
            if (favBtn) {
                const fav = getSeedPicks().some(pick => pick.id === Number(anime.id));
                favBtn.classList.toggle("is-active", fav);
                favBtn.setAttribute("aria-pressed", String(fav));
                favBtn.innerHTML = `${CARD_ICONS.heart}<span>${fav ? "Favourited" : "Favourite"}</span>`;
            }
        };
        refreshActionBtns();

        if (saveBtn) {
            saveBtn.addEventListener("click", () => {
                handleCardAction("save", anime, rawTitle); // toggles + toast + refreshes the cards behind the window
                refreshActionBtns();
            });
        }
        if (favBtn) {
            favBtn.addEventListener("click", () => {
                handleCardAction("favourite", anime, rawTitle);
                refreshActionBtns();
            });
        }

        // "Not interested": hides this show from every future suggestion (same list as the Surprise Me skip)
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
        const response = await fetch(`${API_BASE_URL}/api/user/${encodedUsername}`);
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
        const response = await fetch(`${API_BASE_URL}/api/watchlist/${encodedUsername}`);
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
