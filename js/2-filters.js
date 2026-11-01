/* =========================================================
   app part 2 of 5: FILTERS
   Everything in the Home filter bar and the search.
   Dropdowns, year list, filter labels, the searchable Tag filter, the phone Filters sheet, Reset, and fetching recommendations.
   Load order matters: index.html must load the 5 js files in number order
   (1 -> 5). They share one global scope, exactly like the old single app.js.
========================================================= */

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

    // The Tag menu also shows chips for the selected tags and locks extra tags at the limit
    if (typeof refreshTagUI === "function") refreshTagUI();

    // Phones: the "Filters (3)" count and the removable chips under the search box
    if (typeof refreshFilterSummary === "function") refreshFilterSummary();
}

// Watch changes on the filter section container
const filterSection = document.querySelector('.filter-sec');
if (filterSection) {
    filterSection.addEventListener('change', updateFilterActiveStates);
}

/* =========================================================
   4b. TAG FILTER (searchable)
   The list of tags comes from AniList through the server (/api/tags) and is cached there for a day.
   - Typing in the box hides every tag that does not match.
   - Picked tags show as chips at the top of the menu (click a chip to remove it).
   - AniList only returns shows that have EVERY picked tag, so the number of tags is limited.
========================================================= */

const MAX_TAGS_SELECTED = 5;
const tagFilter = document.querySelector(".filter-tag");
const tagListEl = document.getElementById("tagList");
const tagSearchInput = document.getElementById("tagSearchInput");
const tagSearchClear = document.getElementById("tagSearchClear");
const tagSelectedEl = document.getElementById("tagSelected");
let allTags = [];
let tagsFailed = false;

function getCheckedTags() {
    return Array.from(document.querySelectorAll('input[name="tags"]:checked')).map(input => input.value);
}

// "Theme-Sci-Fi" -> "Theme · Sci-Fi"
function formatTagCategory(category) {
    return String(category || "Other").replace("-", " · ");
}

function tagCategoryRank(category) {
    const top = String(category || "").split("-")[0];
    const order = { Theme: 0, Setting: 1, Cast: 2, Demographic: 3, Technical: 5 };
    return order[top] ?? 4;
}

function showTagStatus(message) {
    if (!tagListEl) return;
    tagListEl.textContent = "";
    const note = document.createElement("p");
    note.className = "tag-status";
    note.textContent = message;
    tagListEl.appendChild(note);
}

function renderTagList() {
    if (!tagListEl) return;
    const alreadyChecked = new Set(getCheckedTags());
    tagListEl.textContent = "";

    if (allTags.length === 0) {
        showTagStatus("No tags available right now.");
        return;
    }

    const groups = new Map();
    allTags.forEach(tag => {
        const category = tag.category || "Other";
        if (!groups.has(category)) groups.set(category, []);
        groups.get(category).push(tag);
    });

    const categories = Array.from(groups.keys()).sort((a, b) =>
        tagCategoryRank(a) - tagCategoryRank(b) || a.localeCompare(b));

    categories.forEach(category => {
        const group = document.createElement("div");
        group.className = "tag-group";

        const title = document.createElement("div");
        title.className = "tag-group-title";
        title.textContent = formatTagCategory(category);
        group.appendChild(title);

        groups.get(category)
            .sort((a, b) => a.name.localeCompare(b.name))
            .forEach(tag => {
                const label = document.createElement("label");
                label.className = "tag-option";
                label.dataset.search = tag.name.toLowerCase();
                if (tag.description) label.title = tag.description;

                const input = document.createElement("input");
                input.type = "checkbox";
                input.name = "tags";
                input.value = tag.name;
                input.checked = alreadyChecked.has(tag.name);

                label.append(input, document.createTextNode(tag.name));
                group.appendChild(label);
            });

        tagListEl.appendChild(group);
    });

    const empty = document.createElement("p");
    empty.className = "tag-status hidden";
    empty.id = "tagEmpty";
    empty.textContent = "No tags match your search.";
    tagListEl.appendChild(empty);

    filterTagList();
    refreshTagUI();
}

// Hides the tags (and whole groups) that do not match what was typed
function filterTagList() {
    if (!tagListEl) return;
    const query = (tagSearchInput ? tagSearchInput.value : "").trim().toLowerCase();
    let visibleTotal = 0;

    tagListEl.querySelectorAll(".tag-group").forEach(group => {
        let visibleInGroup = 0;
        group.querySelectorAll(".tag-option").forEach(option => {
            const matches = !query || option.dataset.search.includes(query);
            option.classList.toggle("hidden", !matches);
            if (matches) visibleInGroup++;
        });
        group.classList.toggle("hidden", visibleInGroup === 0);
        visibleTotal += visibleInGroup;
    });

    const empty = document.getElementById("tagEmpty");
    if (empty) empty.classList.toggle("hidden", visibleTotal > 0);
    if (tagSearchClear) tagSearchClear.classList.toggle("hidden", !query);
}

// Chips for the picked tags + lock the unpicked ones once the limit is reached
function refreshTagUI() {
    if (!tagListEl || !tagSelectedEl) return;
    const selected = getCheckedTags();
    const atLimit = selected.length >= MAX_TAGS_SELECTED;

    tagListEl.querySelectorAll(".tag-option").forEach(option => {
        const input = option.querySelector("input");
        const locked = atLimit && !input.checked;
        input.disabled = locked;
        option.classList.toggle("is-locked", locked);
    });

    tagSelectedEl.textContent = "";
    tagSelectedEl.classList.toggle("hidden", selected.length === 0);
    selected.forEach(name => {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "tag-chip";
        chip.dataset.tag = name;
        chip.setAttribute("aria-label", `Remove tag ${name}`);
        chip.append(document.createTextNode(name));
        const cross = document.createElement("span");
        cross.className = "tag-chip-x";
        cross.setAttribute("aria-hidden", "true");
        cross.textContent = "×";
        chip.appendChild(cross);
        tagSelectedEl.appendChild(chip);
    });
    if (atLimit) {
        const note = document.createElement("span");
        note.className = "tag-limit-note";
        note.textContent = `Limit of ${MAX_TAGS_SELECTED} reached`;
        tagSelectedEl.appendChild(note);
    }
}

function resetTagSearch() {
    if (tagSearchInput) tagSearchInput.value = "";
    filterTagList();
}

function loadTags() {
    tagsFailed = false;
    return fetch(`${API_BASE_URL}/api/tags`)
        .then(response => {
            if (!response.ok) throw new Error("Tag request failed");
            return response.json();
        })
        .then(list => {
            allTags = Array.isArray(list) ? list.filter(tag => tag && typeof tag.name === "string") : [];
            renderTagList();
        })
        .catch(error => {
            console.error("Tag list error:", error);
            tagsFailed = true;
            allTags = [];
            showTagStatus("Couldn't load tags. Check that the server is running, then close and reopen this menu to retry.");
        });
}

// Resolves when the list is on the page (also when loading failed), so restoring a shared link can wait for it
let tagsReady = tagFilter ? loadTags() : Promise.resolve();

if (tagFilter) {
    const tagButton = tagFilter.querySelector(".filter-btn");
    const tagMenu = tagFilter.querySelector(".filter-menu");

    // Runs right after the dropdown toggle above: keep the wide menu on screen, retry a failed load, focus the box
    tagButton.addEventListener("click", () => {
        if (!tagFilter.classList.contains("open")) return;

        tagMenu.style.left = "0px";
        tagMenu.style.right = "auto";
        const margin = 12;
        const rect = tagFilter.getBoundingClientRect();
        const menuWidth = tagMenu.offsetWidth;
        let shift = 0;
        if (rect.left + menuWidth > window.innerWidth - margin) {
            shift = (window.innerWidth - margin) - (rect.left + menuWidth);
        }
        if (rect.left + shift < margin) shift = margin - rect.left;
        tagMenu.style.left = `${shift}px`;

        if (tagsFailed) {
            showTagStatus("Loading tags…");
            tagsReady = loadTags();
        }
        // Only focus the box where there is a real pointer; on phones it would pop the keyboard up unasked
        if (window.matchMedia("(hover: hover)").matches && tagSearchInput) {
            setTimeout(() => tagSearchInput.focus({ preventScroll: true }), 60);
        }
    });

    if (tagSearchInput) {
        tagSearchInput.addEventListener("input", filterTagList);
        tagSearchInput.addEventListener("keydown", event => {
            if (event.key === "Escape") {
                tagFilter.classList.remove("open");
                tagButton.focus();
            } else if (event.key === "Enter") {
                event.preventDefault();
                // Enter toggles the first tag that is still visible
                const firstMatch = Array.from(tagListEl.querySelectorAll(".tag-option:not(.hidden) input:not(:disabled)"))[0];
                if (firstMatch) firstMatch.click();
            }
        });
    }

    if (tagSearchClear) {
        tagSearchClear.addEventListener("click", () => {
            resetTagSearch();
            if (tagSearchInput) tagSearchInput.focus();
        });
    }

    if (tagSelectedEl) {
        tagSelectedEl.addEventListener("click", event => {
            const chip = event.target.closest(".tag-chip");
            if (!chip) return;
            const input = Array.from(document.querySelectorAll('input[name="tags"]'))
                .find(candidate => candidate.value === chip.dataset.tag);
            if (input) {
                input.checked = false;
                input.dispatchEvent(new Event("change", { bubbles: true }));
            }
        });
    }
}

/* =========================================================
   4c. PHONE FILTERS
   On phones the filter menus live in a bottom sheet that opens from the "Filters" button, and the filters that are
   switched on show as removable chips under the search box. On desktop none of this is visible.
========================================================= */

const filterSec = document.getElementById("filterSec");
const filterSheet = document.getElementById("filterSheet");
const filterSheetHead = document.getElementById("filterSheetHead");
const filterSheetBackdrop = document.getElementById("filterSheetBackdrop");
const filterSheetClose = document.getElementById("filterSheetClose");
const filtersToggle = document.getElementById("filtersToggle");
const activeFiltersBar = document.getElementById("activeFilters");
const filtersCountEl = document.getElementById("filtersCount");
const phoneQuery = window.matchMedia("(max-width: 760px)");
let filterSheetLastFocus = null;

function isFilterSheetOpen() {
    return Boolean(filterSec && filterSec.classList.contains("sheet-open"));
}

function openFilterSheet() {
    if (!filterSheet || !phoneQuery.matches) return;
    filterSheetLastFocus = document.activeElement;
    filterSec.classList.add("sheet-open");
    document.body.classList.add("sheet-lock");
    filterSheet.setAttribute("role", "dialog");
    filterSheet.setAttribute("aria-modal", "true");
    if (filtersToggle) filtersToggle.setAttribute("aria-expanded", "true");
    setTimeout(() => { if (filterSheetClose) filterSheetClose.focus({ preventScroll: true }); }, 60);
}

function closeFilterSheet() {
    if (!isFilterSheetOpen()) return;
    filterSec.classList.remove("sheet-open");
    document.body.classList.remove("sheet-lock");
    filterSheet.removeAttribute("role");
    filterSheet.removeAttribute("aria-modal");
    filterSheet.style.transform = "";
    filterSheet.style.transition = "";
    if (filtersToggle) filtersToggle.setAttribute("aria-expanded", "false");
    filters.forEach(filter => filter.classList.remove("open"));
    if (filterSheetLastFocus && typeof filterSheetLastFocus.focus === "function" && document.contains(filterSheetLastFocus)) {
        filterSheetLastFocus.focus({ preventScroll: true });
    }
    filterSheetLastFocus = null;
}

// "Filters (3)" count + one chip per switched-on filter (tap a chip to switch it off)
function refreshFilterSummary() {
    const checked = Array.from(document.querySelectorAll(".filter-sec .filter input:checked"));

    if (filtersCountEl) {
        filtersCountEl.textContent = String(checked.length);
        filtersCountEl.hidden = checked.length === 0;
    }
    if (filtersToggle) filtersToggle.classList.toggle("has-filters", checked.length > 0);
    if (!activeFiltersBar) return;

    activeFiltersBar.textContent = "";
    activeFiltersBar.classList.toggle("hidden", checked.length === 0);

    checked.forEach(input => {
        const label = (input.dataset.label || (input.parentElement ? input.parentElement.textContent : input.value) || input.value).trim();
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "filter-chip";
        chip.setAttribute("aria-label", `Remove filter ${label}`);
        chip.append(document.createTextNode(label));
        const cross = document.createElement("span");
        cross.className = "filter-chip-x";
        cross.setAttribute("aria-hidden", "true");
        cross.textContent = "×";
        chip.appendChild(cross);

        chip.addEventListener("click", () => {
            input.checked = false;
            if (input.type === "radio") input.dataset.wasChecked = "false";
            input.dispatchEvent(new Event("change", { bubbles: true }));
            // If results are already on screen, refresh them so the page matches the chips
            const resultsBox = document.getElementById("resultSection");
            if (resultsBox && !resultsBox.classList.contains("hidden")) fetchRecommendations({ scroll: false });
        });
        activeFiltersBar.appendChild(chip);
    });
}

// Lets a bottom sheet / pop-up be dragged down to close it (phones only).
//  dragEl: where the finger must start, moveEl: what slides down, onClose: what to call when released far enough
function enableSwipeToClose(dragEl, moveEl, onClose, options = {}) {
    if (!dragEl || !moveEl) return;
    let tracking = false;
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let offset = 0;

    // A scrolled-down inner box (like the synopsis) should scroll, not drag the whole sheet
    const insideScrolledBox = target => {
        for (let node = target; node && node !== dragEl; node = node.parentElement) {
            if (node.scrollTop > 0) return true;
        }
        return false;
    };

    dragEl.addEventListener("touchstart", event => {
        if (!phoneQuery.matches || event.touches.length !== 1) return;
        if (options.requireScrollTop && (moveEl.scrollTop > 0 || insideScrolledBox(event.target))) return;
        tracking = true;
        dragging = false;
        offset = 0;
        startX = event.touches[0].clientX;
        startY = event.touches[0].clientY;
    }, { passive: true });

    dragEl.addEventListener("touchmove", event => {
        if (!tracking) return;
        const deltaX = event.touches[0].clientX - startX;
        const deltaY = event.touches[0].clientY - startY;

        if (!dragging) {
            if (deltaY > 10 && deltaY > Math.abs(deltaX) * 1.5) {
                dragging = true;
                moveEl.style.transition = "none";
            } else if (Math.abs(deltaX) > 12 || deltaY < -6) {
                tracking = false;   // a sideways scroll or an upward scroll: not a swipe-to-close
                return;
            } else {
                return;
            }
        }

        offset = Math.max(0, deltaY);
        moveEl.style.transform = `translateY(${offset}px)`;
        if (event.cancelable) event.preventDefault();
    }, { passive: false });

    const finish = () => {
        if (!tracking) return;
        tracking = false;
        if (!dragging) return;
        dragging = false;
        moveEl.style.transition = "transform 0.22s ease";
        if (offset > 110) {
            moveEl.style.transform = "translateY(100%)";
            setTimeout(() => {
                onClose();
                moveEl.style.transform = "";
                moveEl.style.transition = "";
            }, 200);
        } else {
            moveEl.style.transform = "";
            setTimeout(() => { moveEl.style.transition = ""; }, 230);
        }
    };
    dragEl.addEventListener("touchend", finish);
    dragEl.addEventListener("touchcancel", finish);
}

if (filterSheet && filtersToggle) {
    filtersToggle.addEventListener("click", openFilterSheet);
    if (filterSheetClose) filterSheetClose.addEventListener("click", closeFilterSheet);
    if (filterSheetBackdrop) filterSheetBackdrop.addEventListener("click", closeFilterSheet);

    // "Show results" closes the sheet first (capture phase = before the search starts and scrolls to the results)
    const applyButton = document.getElementById("generateBtn");
    if (applyButton) applyButton.addEventListener("click", closeFilterSheet, true);

    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && isFilterSheetOpen()) closeFilterSheet();
    });

    // Rotating a tablet / resizing to desktop width: never leave the page locked
    phoneQuery.addEventListener("change", event => { if (!event.matches) closeFilterSheet(); });

    // An opened menu inside the sheet expands in place; make sure it is fully on screen
    document.querySelectorAll(".filter-sheet .filter-btn").forEach(button => {
        button.addEventListener("click", () => {
            if (!phoneQuery.matches) return;
            const filter = button.closest(".filter");
            if (filter && filter.classList.contains("open")) {
                setTimeout(() => filter.scrollIntoView({ block: "nearest", behavior: "smooth" }), 80);
            }
        });
    });

    enableSwipeToClose(filterSheetHead, filterSheet, closeFilterSheet);
}

// Phones: the long search hint would be cut off, so use a short one there
{
    const homeSearchField = document.getElementById("homeSearchInput");
    if (homeSearchField) {
        const longHint = homeSearchField.getAttribute("placeholder");
        const applyHint = () => homeSearchField.setAttribute("placeholder", phoneQuery.matches ? "Search anime…" : longHint);
        applyHint();
        phoneQuery.addEventListener("change", applyHint);
    }
}

refreshFilterSummary();

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
        const list = await fetchJson(`${API_BASE_URL}/api/search?q=${encodeURIComponent(query)}`);
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
        resetTagSearch();
        updateFilterActiveStates();

        // Close any open filter dropdowns
        filters.forEach(filter => filter.classList.remove("open"));

        if (homeSearchInput) homeSearchInput.value = "";
        updateHomeSearchClear();
        clearTimeout(homeSearchSuggestTimer);
        hideHomeSearchSuggest();

        // Back to the Search page's starting state: the plain popularity list (remove the filters from the URL too)
        clearFiltersFromHash();
        startBrowse();
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

  // Tags picked in the (searchable) Tag filter
  const selectedTags = getCheckedTags();

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
    tags: selectedTags,
    rating: ratingInput ? ratingInput.value : null,
    year: yearInput ? yearInput.value : null,
    format: formatInput ? formatInput.value : null,
    language: languageInput ? languageInput.value : null, // Added
    search: homeSearchInput ? homeSearchInput.value.trim().slice(0, 80) : "",
    username: savedUsername || null
  };
}

// =========================================================
// RESULTS (Search page): two modes, both load 10 at a time while you scroll
//  - "browse": every anime on AniList, most popular first, minus what is already on your AniList
//              (the page's starting state, and what Reset goes back to)
//  - "picks":  up to 20 personal recommendations after Apply or a title search
// =========================================================
let recommendationRequestId = 0;     // lets us ignore a slow response when a newer search has started
let currentResults = [];             // the (up to 20) picks the server sent
let currentSearchQuery = "";
let shownCount = 0;                  // how many of currentResults are on screen
const RESULTS_PAGE_SIZE = 10;

let resultsMode = "browse";
let browsePage = 0;                  // last popularity page that was loaded
let browseHasMore = true;
let browseLoading = false;
let browseFailed = false;            // stops auto-loading after an error until "Try again" is pressed
let browseToken = 0;                 // changes whenever the list restarts, so a slow old response is ignored
let searchStarted = false;

function hasActiveFilters(prefs = getPreferences()) {
    return Boolean(prefs.moods.length || prefs.genres.length || prefs.tags.length || prefs.rating ||
        prefs.year || prefs.format || prefs.language || prefs.search);
}

function setResultsStatus(html) {
    const status = document.getElementById("resultsStatus");
    if (status) status.innerHTML = html;
}

function browseSubtitle() {
    return localStorage.getItem("anilist_username")
        ? "Most popular first. Shows already on your AniList are left out."
        : "Most popular first. Connect AniList to leave out what you have already watched.";
}

// Search page starting state (also what Reset returns to)
function startBrowse() {
    resultsMode = "browse";
    searchStarted = true;
    recommendationRequestId++;       // cancels a slow "picks" request
    browseToken++;                   // cancels a slow browse request from before
    currentResults = [];
    shownCount = 0;
    currentSearchQuery = "";
    browsePage = 0;
    browseHasMore = true;
    browseLoading = false;
    browseFailed = false;

    document.getElementById("resultsTitle").textContent = "Popular on AniList";
    document.getElementById("resultsSubtitle").textContent = browseSubtitle();
    setResultsStatus("");
    updateResultsActions(false);
    loadMoreBrowse();
}

// Called when the Search page is shown: start the list once (not again every time you come back)
function ensureSearchStarted() {
    if (searchStarted) return;
    if (location.hash.includes("?")) return;   // a shared link with filters: restoreFiltersFromHash() runs the search instead
    startBrowse();
}

async function loadMoreBrowse() {
    if (resultsMode !== "browse" || browseLoading || !browseHasMore || browseFailed) return;
    browseLoading = true;
    const token = browseToken;
    const container = document.getElementById("animeResults");
    const isFirstPage = browsePage === 0;

    if (isFirstPage) {
        container.innerHTML = Array(6).fill(0).map(() => skeletonCardHTML()).join("");
    } else {
        setResultsStatus('<span class="loading-more">Loading more</span>');
    }

    try {
        const params = new URLSearchParams({ page: String(browsePage + 1), perPage: String(RESULTS_PAGE_SIZE) });
        const username = localStorage.getItem("anilist_username");
        if (username) params.append("username", username);
        const skipped = getDislikedIds();
        if (skipped.length > 0) params.append("exclude", skipped.join(","));

        const data = await fetchJson(`${API_BASE_URL}/api/browse?${params.toString()}`);
        if (token !== browseToken) return;

        if (isFirstPage) container.innerHTML = "";
        const items = filterDisliked(data.items || []);
        appendAnimeCards(items);
        browsePage += 1;
        browseHasMore = Boolean(data.hasNextPage);
        setResultsStatus("");
        if (isFirstPage && items.length === 0 && !browseHasMore) {
            container.innerHTML = '<p class="no-results">Nothing to show right now.</p>';
        }
    } catch (error) {
        if (token !== browseToken) return;
        console.error("Browse error:", error);
        browseFailed = true;
        if (isFirstPage) container.innerHTML = "";
        const message = isFirstPage ? "Couldn't load anime. Check that the server is running." : "Couldn't load more.";
        setResultsStatus(`<p class="error-msg">${escapeHtml(message)} <button type="button" class="results-retry" id="resultsRetryBtn">Try again</button></p>`);
        const retry = document.getElementById("resultsRetryBtn");
        if (retry) retry.addEventListener("click", () => { browseFailed = false; setResultsStatus(""); loadMoreBrowse(); });
    } finally {
        if (token === browseToken) {
            browseLoading = false;
            updateResultsActions();
            if (!browseFailed) checkResultsSentinel();
        }
    }
}

// Shows the next 10 of the (up to 20) personal picks
function revealMorePicks() {
    if (resultsMode !== "picks" || shownCount >= currentResults.length) return;
    const next = currentResults.slice(shownCount, shownCount + RESULTS_PAGE_SIZE);
    shownCount += next.length;
    appendAnimeCards(next, { showReason: true });
    updateResultsActions();
    checkResultsSentinel();
}

// ---- Infinite scroll: an invisible marker under the list; when it gets within about a quarter of a screen, the next 10 load ----
function searchPageVisible() {
    const view = document.getElementById("searchView");
    return Boolean(view) && !view.classList.contains("hidden");
}

function loadMoreResults() {
    if (!searchPageVisible()) return;
    if (resultsMode === "browse") loadMoreBrowse();
    else revealMorePicks();
}

// The observer only fires when the marker *changes* position, so after every batch we check by hand too
function checkResultsSentinel() {
    requestAnimationFrame(() => {
        const sentinel = document.getElementById("resultsSentinel");
        if (!sentinel || !searchPageVisible()) return;
        if (sentinel.getBoundingClientRect().top < window.innerHeight + 250) loadMoreResults();
    });
}

{
    const sentinel = document.getElementById("resultsSentinel");
    if (sentinel && "IntersectionObserver" in window) {
        new IntersectionObserver(entries => {
            if (entries.some(entry => entry.isIntersecting)) loadMoreResults();
        }, { rootMargin: "250px 0px" }).observe(sentinel);
    }
}

// Accepts an optional { scroll } flag (Roll Again passes scroll:false so the page doesn't jump)
async function fetchRecommendations(options = {}) {
    const { scroll = true } = options;
    const prefs = getPreferences();
    const resultsContainer = document.getElementById("animeResults");
    currentSearchQuery = prefs.search;

    // Switch to "picks" mode and stop any popularity request that is still on its way
    resultsMode = "picks";
    searchStarted = true;
    browseToken++;
    browseLoading = false;
    browseFailed = false;

    // Every call gets a new id; only the newest call is allowed to draw results
    const requestId = ++recommendationRequestId;

    document.getElementById("resultsTitle").textContent = prefs.search
        ? `Results for “${prefs.search}”`
        : "Your Recommendations";
    document.getElementById("resultsSubtitle").textContent = prefs.search
        ? "Matched to your search and selected filters"
        : "Up to 20 picks matched to your filters and the shows you rate highly";
    if (scroll) {
        document.getElementById("resultSection").scrollIntoView({ behavior: "smooth", block: "start" });
    }

    currentResults = [];
    shownCount = 0;
    setResultsStatus("");
    updateResultsActions(false);

    resultsContainer.innerHTML = Array(5).fill(0).map(() => skeletonCardHTML()).join('');

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
    prefs.tags.forEach(t => params.append("userTag", t)); // tags the user picked in the Tag filter
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
        const response = await fetch(`${API_BASE_URL}/api/anime?${params.toString()}`);
        const payload = await response.json();

        if (requestId !== recommendationRequestId) return; // a newer search replaced this one

        // Show the server's own message (e.g. "AniList is rate-limiting...") instead of crashing on .slice()
        if (!response.ok) {
            const serverError = new Error(payload?.error || "Request failed");
            serverError.fromServer = true;
            throw serverError;
        }

        currentResults = Array.isArray(payload) ? payload.slice(0, 20) : [];   // never more than 20 picks
        resultsContainer.innerHTML = "";
        if (currentResults.length === 0) {
            renderAnimeCards([]);   // draws the "nothing matched" message
        } else {
            revealMorePicks();      // the first 10; scrolling reveals the rest
        }

        // The server sets X-Match-Level: relaxed when it had to loosen the mood/genre combo to find matches.
        // X-Profile-Strength: if the recommender knows little about the user, say how to fix that.
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
