// server.js
const express = require("express");
const cors = require("cors");
const path = require("path");
require("dotenv").config();

const app = express();
// [CHANGED] Same open CORS policy as before, but we now also expose the custom "X-Match-Level"
// response header so the browser (which loads the page from a different origin than this API)
// is allowed to read it from fetch() responses. See /api/anime for what the header means.
// [CHANGED] Also expose "X-Profile-Strength" (none / weak / good) = how much the recommender knows about the user.
app.use(cors({ exposedHeaders: ["X-Match-Level", "X-Profile-Strength"] }));

const PORT = process.env.PORT || 5000;

/* =========================================================
   SMALL IN-MEMORY CACHE & RATE LIMIT HANDLING
========================================================= */
const cache = new Map();

// [ADDED] Upper bound for the cache so it can't grow forever on a long-running server.
const CACHE_MAX_ENTRIES = 500;

// [CHANGED] The cache now stores the *promise* of a value instead of only the finished value.
// Why: (1) two simultaneous requests for the same key share ONE AniList call instead of firing two,
//      (2) if the producer throws, the failed entry is removed so errors are never cached.
// The function signature and return value are unchanged, so every existing caller works as before.
async function cached(key, ttlMs, producer) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.time < ttlMs) return hit.value;

    const promise = producer();
    cache.set(key, { value: promise, time: Date.now(), ttlMs });
    pruneCache();

    try {
        return await promise;
    } catch (err) {
        // Don't keep a failed lookup around - the next request should try again
        if (cache.get(key)?.value === promise) cache.delete(key);
        throw err;
    }
}

// [ADDED] Drops expired entries first, then the oldest ones, when the cache gets too big.
function pruneCache() {
    if (cache.size <= CACHE_MAX_ENTRIES) return;

    const now = Date.now();
    for (const [key, entry] of cache) {
        if (now - entry.time >= entry.ttlMs) cache.delete(key);
    }
    while (cache.size > CACHE_MAX_ENTRIES) {
        cache.delete(cache.keys().next().value); // Map keeps insertion order -> first key is the oldest
    }
}

// Unified AniList request helper with 429 Rate Limit retry handling
async function anilistRequest(query, variables) {
    const maxRetries = 3;
    let delay = 2000;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const response = await fetch("https://graphql.anilist.co", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Accept": "application/json" },
            body: JSON.stringify({ query, variables })
        });

        if (response.status === 429) {
            console.warn(`AniList rate limit (429) hit. Attempt ${attempt}/${maxRetries}. Retrying in ${delay}ms...`);
            if (attempt < maxRetries) {
                // [ADDED] Respect AniList's Retry-After header when it sends one (capped at 10s)
                const retryAfterSeconds = Number(response.headers.get("retry-after"));
                const waitMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
                    ? Math.min(retryAfterSeconds * 1000, 10000)
                    : delay;
                await new Promise(resolve => setTimeout(resolve, waitMs));
                delay *= 2;
                continue;
            }
        }

        // [CHANGED] .catch() so a non-JSON error body can't crash us before we report the real status
        const data = await response.json().catch(() => null);
        if (!response.ok || (data?.errors && data.errors.length > 0)) {
            const error = new Error(JSON.stringify(data?.errors || data));
            // [ADDED] Keep the HTTP status + GraphQL errors on the Error so routes can answer
            // with a proper 404 / 429 instead of a generic 500 (see sendApiError below)
            error.status = response.status;
            error.graphQLErrors = data?.errors;
            throw error;
        }
        return data.data;
    }
    throw new Error("AniList rate limit (429) exceeded after maximum retries.");
}

// [ADDED] One place that turns an error from anilistRequest() into the right HTTP response.
//  - 429 -> tell the client AniList is busy (the UI shows this message)
//  - 404 -> "not found" message supplied by the route (e.g. unknown AniList user / anime id)
//  - anything else -> the route's generic 500 message
function sendApiError(res, error, fallbackMessage, notFoundMessage) {
    if (error?.status === 429) {
        return res.status(429).json({ error: "AniList is rate-limiting requests right now. Please try again in a moment." });
    }
    if (error?.status === 404 && notFoundMessage) {
        return res.status(404).json({ error: notFoundMessage });
    }
    return res.status(500).json({ error: fallbackMessage });
}

/* =========================================================
   [ADDED] SMALL INPUT HELPERS
========================================================= */

// Makes sure a query/param value is always an array (Express gives a string or an array)
function toArray(value) {
    if (value === undefined || value === null || value === "") return [];
    return Array.isArray(value) ? value : [value];
}

// Cleans a username coming from the URL / query string. Returns null if it is unusable.
function normalizeUsername(raw) {
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value !== "string") return null;

    const trimmed = value.trim();
    if (!trimmed || trimmed === "null" || trimmed === "undefined" || trimmed.length > 50) return null;
    return trimmed;
}

// Parses "?exclude=1,2,3" (ids the user skipped/disliked) into a clean array of positive integers
function parseIdList(raw, max = 300) {
    const value = Array.isArray(raw) ? raw.join(",") : raw;
    if (typeof value !== "string") return [];

    const ids = value.split(",").map(Number).filter(n => Number.isInteger(n) && n > 0);
    return [...new Set(ids)].slice(0, max);
}

function mergeIds(...lists) {
    return [...new Set(lists.flat())];
}

// Helper function to fetch all watched/watching IDs for a given AniList username (Cached by username)
async function getUserWatchedIds(username) {
    // [CHANGED] Uses normalizeUsername (handles duplicated query params + junk values like "null")
    const cleanUsername = normalizeUsername(username);
    if (!cleanUsername) return [];

    const cacheKey = `watched:${cleanUsername.toLowerCase()}`;

    // [CHANGED] try/catch now wraps cached() instead of living inside the producer.
    // Before, a failed AniList call returned [] *inside* the producer, so the empty list
    // got cached for 5 minutes. Now the producer throws on failure, nothing is cached,
    // and we still return [] here so recommendations keep working.
    try {
        return await cached(cacheKey, 5 * 60 * 1000, async () => {
            const userListQuery = `
                query ($username: String) {
                    MediaListCollection(userName: $username, type: ANIME) {
                        lists {
                            entries {
                                mediaId
                            }
                        }
                    }
                }
            `;

            const data = await anilistRequest(userListQuery, { username: cleanUsername });
            if (!data?.MediaListCollection) return [];

            const ids = [];
            data.MediaListCollection.lists.forEach(list => {
                list.entries.forEach(entry => {
                    if (entry.mediaId) ids.push(entry.mediaId);
                });
            });

            return ids;
        });
    } catch (err) {
        console.error("Error fetching user list:", err);
        return [];
    }
}

/* =========================================================
   [ADDED] TASTE PROFILE (powers personalised ranking)
   Builds a weighted "what does this user like" profile from their
   AniList list: genres + tags weighted by status and by the score they gave.
========================================================= */

// How much each list status says about taste (dropped = negative signal, planning = no signal)
const TASTE_STATUS_WEIGHT = {
    COMPLETED: 1,
    REPEATING: 1.2,
    CURRENT: 0.8,
    PAUSED: 0.3,
    DROPPED: -0.6,
    PLANNING: 0
};

// Scales raw weights so the strongest one becomes 1 (or -1); keeps everything comparable
function normalizeWeights(raw) {
    const values = Object.values(raw);
    const max = values.length ? Math.max(0.0001, ...values.map(Math.abs)) : 1;
    const out = {};
    Object.keys(raw).forEach(key => { out[key] = raw[key] / max; });
    return out;
}

async function getUserTaste(username) {
    const cleanUsername = normalizeUsername(username);
    if (!cleanUsername) return null;

    return cached(`taste:${cleanUsername.toLowerCase()}`, 10 * 60 * 1000, async () => {
        const query = `
            query ($username: String) {
                MediaListCollection(userName: $username, type: ANIME) {
                    lists {
                        entries {
                            mediaId
                            status
                            score(format: POINT_100)
                            media {
                                id
                                title {
                                    romaji
                                    english
                                }
                                genres
                                tags {
                                    name
                                    rank
                                }
                            }
                        }
                    }
                }
            }
        `;

        const data = await anilistRequest(query, { username: cleanUsername });
        const lists = data?.MediaListCollection?.lists || [];

        const genreRaw = {};
        const tagRaw = {};
        const seenIds = new Set(); // custom lists repeat entries from status lists -> count each show once
        const finished = [];       // candidates for "Because you liked X"

        lists.forEach(list => {
            (list.entries || []).forEach(entry => {
                if (!entry?.mediaId || !entry.media || seenIds.has(entry.mediaId)) return;
                seenIds.add(entry.mediaId);

                const base = TASTE_STATUS_WEIGHT[entry.status] ?? 0;
                if (base === 0) return;

                // Score of 60 is neutral, 80 = x1, 100 = x2, 40 = x-1 (only for non-dropped entries)
                let weight = base;
                if (entry.score > 0 && base > 0) {
                    weight = base * Math.max(-1, Math.min(2, (entry.score - 60) / 20));
                }

                (entry.media.genres || []).forEach(genre => {
                    genreRaw[genre] = (genreRaw[genre] || 0) + weight;
                });
                (entry.media.tags || []).forEach(tag => {
                    if (tag.rank >= 50) {
                        tagRaw[tag.name] = (tagRaw[tag.name] || 0) + weight * (tag.rank / 100) * 0.6;
                    }
                });

                if (["COMPLETED", "REPEATING", "CURRENT"].includes(entry.status)) {
                    finished.push({
                        id: entry.mediaId,
                        title: entry.media.title?.english || entry.media.title?.romaji || "this anime",
                        score: entry.score || 0
                    });
                }
            });
        });

        const genres = normalizeWeights(genreRaw);
        const tags = normalizeWeights(tagRaw);

        const topGenres = Object.keys(genres)
            .filter(name => genres[name] > 0.15)
            .sort((a, b) => genres[b] - genres[a])
            .slice(0, 6);

        // Seeds = shows the user clearly loved (score 80+). If they don't score their list, use finished shows.
        finished.sort((a, b) => b.score - a.score);
        const loved = finished.filter(item => item.score >= 80);
        const seeds = (loved.length >= 2 ? loved : finished).slice(0, 8);

        return {
            genres,
            tags,
            topGenres,
            seeds,
            entryCount: seenIds.size,
            hasSignal: topGenres.length > 0
        };
    });
}

// Scores one candidate show against a taste profile and explains why it matched
function scoreCandidate(media, taste) {
    let score = 0;
    const hits = [];

    (media.genres || []).forEach(genre => {
        const weight = taste.genres[genre];
        if (weight) {
            score += weight;
            if (weight > 0.15) hits.push({ name: genre, weight });
        }
    });

    (media.tags || []).forEach(tag => {
        if (tag.rank >= 50 && taste.tags[tag.name]) {
            const weight = taste.tags[tag.name] * (tag.rank / 100) * 0.5;
            score += weight;
            if (weight > 0.1) hits.push({ name: tag.name, weight });
        }
    });

    // Small bonus for well-rated shows so quality breaks ties
    if (media.averageScore) score += (media.averageScore - 70) / 100;

    hits.sort((a, b) => b.weight - a.weight);
    const names = hits.slice(0, 2).map(hit => hit.name);

    return {
        score,
        reason: names.length ? `Matches your taste for ${names.join(" & ")}` : null
    };
}

// Keeps only the fields the frontend cards need (drops the heavy "tags" array) + adds the reason
function toCardMedia(media, reason) {
    return {
        id: media.id,
        title: media.title,
        averageScore: media.averageScore,
        genres: media.genres,
        coverImage: media.coverImage,
        reason: reason || null
    };
}

// Sorts a list of media by how well it matches the user's taste.
// "jitter" adds a little randomness so pressing Roll Again doesn't always give the exact same order.
function rankByTaste(list, taste, jitter = 0) {
    return list
        .map(media => {
            const { score, reason } = scoreCandidate(media, taste);
            return { media, reason, rank: score + Math.random() * jitter };
        })
        .sort((a, b) => b.rank - a.rank)
        .map(item => toCardMedia(item.media, item.reason));
}

/* =========================================================
   [ADDED] AFFINITY MODEL - "what you truly like", not "what you watch most"

   The old TASTE PROFILE above simply adds up genres, so whatever you watch most always wins.
   That model is still used for ONE thing only: the "Based on Your Taste" row on the Discover page.

   This model is used everywhere else (home page ranking, "Because you liked X", Surprise Me).
   How it works, in short:
     1. Every show on your list becomes a preference value "p" that is RELATIVE TO YOU:
        p = (your score - your average score) / your score spread. A 9 means a lot if you usually
        give 6s, and little if you usually give 9s. Unscored shows are estimated from status
        (dropped early = negative, rewatched / favourited = strongly positive).
     2. Each feature (genre, tag, studio, source, format, decade, length, popularity) gets an
        AFFINITY = a shrunk AVERAGE of p over the shows that have it (not a sum). 120 average-rated
        Action shows -> ~0. 8 Psychological shows rated far above your average -> strongly positive.
     3. A candidate show is scored by: its features' affinities + how similar it is to the shows you
        loved (nearest neighbours, so several different tastes stay separate) + the AniList community
        ("fans of X also like Y") - similarity to shows you disliked + a small quality bonus.
     4. The final list is diversified (MMR) so you don't get 20 near-clones.
   Everything is tunable through AFFINITY_DEFAULTS and testable with /api/debug/evaluate/:username.
========================================================= */

// Every weight / threshold in one place so it can be tuned (and overridden per request for experiments)
const AFFINITY_DEFAULTS = {
    kGenre: 3,          // shrinkage: higher = needs more shows before a genre's affinity is trusted
    kTag: 4,
    kStudio: 2.5,
    kOther: 3,
    wFeature: 0.9,      // weight of the feature-affinity score
    wKnn: 1.0,          // weight of "similar to shows you loved"
    wCommunity: 0.5,    // weight of AniList community recommendations
    wQuality: 0.3,      // weight of the show's average score (tie-breaker)
    wNegative: 0.8,     // penalty for being similar to shows you disliked
    lovedThreshold: 0.9,   // p at/above this = a "loved" show
    hatedThreshold: -0.6,  // p at/below this = a "disliked" show (tier scale: scores under 77 are -0.7 or lower)
    minTagRank: 40,        // ignore tags AniList is less than 40% sure about
    mmrLambda: 0.75        // 1 = pure relevance, lower = more variety in the final list
};

// Which settings may be overridden from the URL on the debug endpoints, and their allowed ranges
const AFFINITY_OVERRIDE_LIMITS = {
    kGenre: [0, 50], kTag: [0, 50], kStudio: [0, 50], kOther: [0, 50],
    wFeature: [0, 5], wKnn: [0, 5], wCommunity: [0, 5], wQuality: [0, 5], wNegative: [0, 5],
    lovedThreshold: [0, 3], hatedThreshold: [-3, 0], minTagRank: [0, 100], mmrLambda: [0, 1]
};

function parseAffinityOverrides(query) {
    const overrides = {};
    Object.keys(AFFINITY_OVERRIDE_LIMITS).forEach(key => {
        if (query[key] === undefined) return;
        const value = Number(query[key]);
        const [min, max] = AFFINITY_OVERRIDE_LIMITS[key];
        if (Number.isFinite(value) && value >= min && value <= max) overrides[key] = value;
    });
    return overrides;
}

// Fields requested for every show the recommender has to "understand"
const MEDIA_FEATURE_CORE = `
    id
    title {
        romaji
        english
    }
    averageScore
    popularity
    genres
    tags {
        name
        rank
    }
    studios(isMain: true) {
        nodes {
            name
        }
    }
    source
    format
    episodes
    seasonYear
    startDate {
        year
    }
`;
// Same + the cover (for anything that is shown as a card)
const MEDIA_FEATURE_FIELDS = `
    ${MEDIA_FEATURE_CORE}
    coverImage {
        extraLarge
        color
    }
`;

/* ---------- 1. Turning a show into features ---------- */

// Returns a Map of  featureKey -> weight  for one show.
// Keys look like "g:Action", "t:Mind Games", "s:MAPPA", "src:MANGA", "f:TV", "d:2010s", "len:short", "pop:niche".
function extractFeatures(media, cfg = AFFINITY_DEFAULTS) {
    const features = new Map();
    const add = (key, weight) => {
        if (weight > 0) features.set(key, Math.max(features.get(key) || 0, weight));
    };

    (media.genres || []).forEach(genre => add(`g:${genre}`, 1));
    (media.tags || []).forEach(tag => {
        if (tag.rank >= cfg.minTagRank) add(`t:${tag.name}`, tag.rank / 100);
    });
    (media.studios?.nodes || []).forEach(studio => {
        if (studio?.name) add(`s:${studio.name}`, 0.8);
    });
    if (media.source) add(`src:${media.source}`, 0.5);
    if (media.format) add(`f:${media.format}`, 0.4);

    const year = media.startDate?.year || media.seasonYear;
    if (year) add(`d:${Math.floor(year / 10) * 10}s`, 0.4);

    if (media.episodes) {
        add(`len:${media.episodes <= 13 ? "short" : media.episodes <= 30 ? "medium" : "long"}`, 0.3);
    }
    if (media.popularity != null) {
        add(`pop:${media.popularity < 15000 ? "niche" : media.popularity < 80000 ? "mid" : "mainstream"}`, 0.4);
    }
    return features;
}

// "t:Mind Games" -> { kind: "tag", name: "Mind Games" }  (used for reasons and the insights panel)
function describeFeature(key) {
    const separator = key.indexOf(":");
    const prefix = key.slice(0, separator);
    const name = key.slice(separator + 1);
    const kinds = { g: "genre", t: "tag", s: "studio", src: "source", f: "format", d: "decade", len: "length", pop: "popularity" };
    return { kind: kinds[prefix] || prefix, name };
}

/* ---------- 2. Reading the user's list ---------- */

const affinityListQuery = `
    query ($username: String) {
        MediaListCollection(userName: $username, type: ANIME) {
            lists {
                entries {
                    mediaId
                    status
                    score(format: POINT_100)
                    progress
                    repeat
                    media {
                        ${MEDIA_FEATURE_CORE}
                    }
                }
            }
        }
    }
`;

// The shows a user marked as favourites on AniList (a very strong "I love this" signal)
async function fetchFavouriteIds(username) {
    const query = `
        query ($name: String) {
            User(name: $name) {
                favourites {
                    anime(perPage: 50) {
                        nodes {
                            id
                        }
                    }
                }
            }
        }
    `;
    const data = await anilistRequest(query, { name: username });
    return (data?.User?.favourites?.anime?.nodes || []).map(node => node.id);
}

// Raw material for the profile: the user's list entries + favourites (cached for 10 minutes).
// Failures are NOT cached (see cached()).
async function getAffinityBase(username) {
    const cleanUsername = normalizeUsername(username);
    if (!cleanUsername) return { entries: [], favouriteIds: [] };

    return cached(`affbase:${cleanUsername.toLowerCase()}`, 10 * 60 * 1000, async () => {
        const [listData, favouriteIds] = await Promise.all([
            anilistRequest(affinityListQuery, { username: cleanUsername }),
            // Favourites are a bonus: if only this part fails we still build the profile without them
            fetchFavouriteIds(cleanUsername).catch(err => {
                console.warn("Could not load favourites:", err.message);
                return [];
            })
        ]);

        const entries = [];
        const seen = new Set(); // custom lists repeat entries from the status lists -> keep each show once
        (listData?.MediaListCollection?.lists || []).forEach(list => {
            (list.entries || []).forEach(entry => {
                if (!entry?.mediaId || !entry.media || seen.has(entry.mediaId)) return;
                seen.add(entry.mediaId);
                entries.push(entry);
            });
        });

        return { entries, favouriteIds };
    });
}

const clampNumber = (value, min, max) => Math.max(min, Math.min(max, value));

// [CHANGED] Personal score tiers instead of z-scores. This user picks shows carefully, so their scores sit in a
// narrow band but each band has a fixed meaning (77-80 one-time watch, 81-84 really liked, 85-89 rewatch-worthy,
// 90+ memorable). The scores are on a 0-100 scale (POINT_100).
function scoreToPreference(score) {
    if (score < 70) return -1.5;   // clearly below their bar
    if (score < 77) return -0.7;   // under the 7.7 bar
    if (score <= 80) return 0;     // one-time watch: fine, but says little about taste
    if (score < 85) return 0.6;    // really liked
    if (score < 90) return 1.2;    // would rewatch
    return 2.0;                    // memorable
}

// Turns every list entry into a preference value p (relative to the user), with a confidence "conf".
//   conf 1   = the user gave a score (or favourited it)
//   conf 0.5 = estimated from status only
function computePreferences(entries, favouriteIds, cfg = AFFINITY_DEFAULTS) {
    const favourites = new Set(favouriteIds || []);

    const scores = entries.filter(entry => entry.score > 0).map(entry => entry.score);
    const scoredCount = scores.length;

    let mean = 70;
    let sd = 12;
    if (scoredCount >= 5) {
        mean = scores.reduce((sum, value) => sum + value, 0) / scoredCount;
        const variance = scores.reduce((sum, value) => sum + (value - mean) ** 2, 0) / scoredCount;
        // Floor of 8 points: someone who gives everything an 8 shouldn't get huge z-scores from a 9
        sd = Math.max(8, Math.sqrt(variance));
    }

    const items = [];
    entries.forEach(entry => {
        const episodes = entry.media.episodes;
        let p = null;
        let conf = 1;

        if (entry.score > 0 && scoredCount >= 5) {
            p = scoreToPreference(entry.score);
            if (entry.status === "DROPPED") p = Math.min(p, 0);
        } else if (entry.score > 0) {
            // Too few scores to know this user's scale -> fall back to an absolute scale
            p = clampNumber((entry.score - 70) / 15, -2, 2);
        } else {
            conf = 0.5;
            switch (entry.status) {
                case "COMPLETED": p = 0.25; break;
                case "REPEATING": p = 0.8; break;
                case "CURRENT": p = 0.15; break;
                case "PAUSED": p = -0.1; break;
                case "DROPPED": {
                    // Dropped at episode 2 says much more than dropped at episode 20
                    const fraction = episodes ? clampNumber((entry.progress || 0) / episodes, 0, 1) : 0.2;
                    p = -(1.2 - 0.9 * fraction);
                    break;
                }
                default: p = null; // PLANNING says nothing about taste
            }
        }
        if (p === null) return;

        if (entry.repeat > 0 && p > -0.5) p += 0.3 * Math.min(entry.repeat, 2); // rewatching = love
        const isFavourite = favourites.has(entry.mediaId);
        if (isFavourite) {
            p += 1.0;
            conf = 1;
        }

        items.push({
            id: entry.mediaId,
            title: entry.media.title?.english || entry.media.title?.romaji || "this anime",
            p: clampNumber(p, -2.5, 2.5),
            conf,
            status: entry.status,
            score: entry.score || 0,
            scored: entry.score > 0,
            favourite: isFavourite,
            media: entry.media,
            features: extractFeatures(entry.media, cfg)
        });
    });

    return { items, mean, sd, scoredCount };
}

/* ---------- 3. Feedback from inside the app (saved / favourite picks = liked, skipped = disliked) ---------- */

const mediaByIdQuery = `
    query ($ids: [Int]) {
        Page(perPage: 50) {
            media(id_in: $ids, type: ANIME) {
                ${MEDIA_FEATURE_FIELDS}
            }
        }
    }
`;

async function getMediaFeatureMap(ids) {
    const sorted = [...ids].sort((a, b) => a - b);
    const list = await cached(`feat:${sorted.join(",")}`, 6 * 60 * 60 * 1000, async () => {
        const data = await anilistRequest(mediaByIdQuery, { ids: sorted });
        return data?.Page?.media || [];
    });
    return new Map(list.map(media => [media.id, media]));
}

async function buildFeedbackItems(liked, disliked, knownIds, cfg) {
    const dislikedSet = new Set(disliked);
    const wanted = [...new Set([...liked, ...disliked])]
        .filter(id => !knownIds.has(id))
        .slice(0, 50);
    if (wanted.length === 0) return [];

    let mediaMap;
    try {
        mediaMap = await getMediaFeatureMap(wanted);
    } catch (err) {
        console.warn("Could not load feedback shows:", err.message);
        return [];
    }

    const items = [];
    wanted.forEach(id => {
        const media = mediaMap.get(id);
        if (!media) return;
        const isDisliked = dislikedSet.has(id); // a skip beats an old like
        items.push({
            id,
            title: media.title?.english || media.title?.romaji || "this anime",
            p: isDisliked ? -1.2 : 1.1,
            conf: 1,
            status: isDisliked ? "DROPPED" : "COMPLETED",
            score: 0,
            scored: false,
            favourite: false,
            media,
            features: extractFeatures(media, cfg)
        });
    });
    return items;
}

/* ---------- 4. Building the profile ---------- */

function kForFeature(key, cfg) {
    if (key.startsWith("g:")) return cfg.kGenre;
    if (key.startsWith("t:")) return cfg.kTag;
    if (key.startsWith("s:")) return cfg.kStudio;
    return cfg.kOther;
}

function cosineSimilarity(a, b) {
    const [small, large] = a.v.size <= b.v.size ? [a, b] : [b, a];
    let dot = 0;
    small.v.forEach((value, key) => {
        const other = large.v.get(key);
        if (other) dot += value * other;
    });
    return dot / (a.norm * b.norm);
}

// items -> the full profile used for scoring
function assembleProfile(items, prefs, cfg) {
    const sums = new Map();           // feature -> { num, den }
    const documentFrequency = new Map();

    items.forEach(item => {
        item.features.forEach((weight, key) => {
            const w = weight * item.conf;
            const entry = sums.get(key) || { num: 0, den: 0 };
            entry.num += w * item.p;
            entry.den += w;
            sums.set(key, entry);
            documentFrequency.set(key, (documentFrequency.get(key) || 0) + 1);
        });
    });

    // Shrunk average: value = Σ(w·p) / (Σw + K). Few shows -> pulled toward 0; many shows -> the true average.
    const affinity = new Map();
    sums.forEach((entry, key) => {
        affinity.set(key, { value: entry.num / (entry.den + kForFeature(key, cfg)), support: entry.den });
    });

    // Features that are rare on the user's list say more about similarity than ones every show has
    const N = items.length;
    const idf = key => Math.log((N + 1) / ((documentFrequency.get(key) || 0) + 1)) + 1;
    const vectorOf = features => {
        const v = new Map();
        let sumSquares = 0;
        features.forEach((weight, key) => {
            const value = weight * idf(key);
            v.set(key, value);
            sumSquares += value * value;
        });
        return { v, norm: Math.sqrt(sumSquares) || 1 };
    };

    const loved = items
        .filter(item => item.p >= cfg.lovedThreshold)
        .sort((a, b) => b.p - a.p)
        .slice(0, 20)
        .map(item => ({ ...item, vec: vectorOf(item.features) }));

    const hated = items
        .filter(item => item.p <= cfg.hatedThreshold)
        .sort((a, b) => a.p - b.p)
        .slice(0, 20)
        .map(item => ({ ...item, vec: vectorOf(item.features) }));

    const informative = items.filter(item => item.conf >= 1).length;

    return {
        cfg,
        items,
        affinity,
        vectorOf,
        loved,
        hated,
        mean: prefs.mean,
        sd: prefs.sd,
        scoredCount: prefs.scoredCount,
        informative,
        strength: informative >= 10 ? "good" : informative >= 3 ? "weak" : "none",
        hasSignal: informative >= 3
    };
}

// The one function routes call: list data (cached) + in-app feedback -> profile.
// If the user has no AniList (or it fails) the profile can still be built from feedback alone.
async function getAffinityProfile(username, feedback = {}, overrides = {}) {
    const cfg = { ...AFFINITY_DEFAULTS, ...overrides };

    let base = { entries: [], favouriteIds: [] };
    const cleanUsername = normalizeUsername(username);
    if (cleanUsername) {
        try {
            base = await getAffinityBase(cleanUsername);
        } catch (err) {
            console.warn("Affinity base unavailable:", err.message);
        }
    }

    const prefs = computePreferences(base.entries, base.favouriteIds, cfg);
    const knownIds = new Set(base.entries.map(entry => entry.mediaId));
    const disliked = feedback.disliked || [];
    const liked = (feedback.liked || []).filter(id => !disliked.includes(id));
    const feedbackItems = await buildFeedbackItems(liked, disliked, knownIds, cfg);

    return assembleProfile([...prefs.items, ...feedbackItems], prefs, cfg);
}

/* ---------- 5. Scoring & ranking candidates ---------- */

const communityQuery = `
    query ($id: Int) {
        Media(id: $id, type: ANIME) {
            recommendations(sort: RATING_DESC, perPage: 25) {
                nodes {
                    rating
                    mediaRecommendation {
                        id
                    }
                }
            }
        }
    }
`;

// "Fans of the shows you loved also recommend ..." -> Map(showId -> community rating)
async function getCommunityMap(profile) {
    const seeds = profile.loved.slice(0, 4);
    if (seeds.length === 0) return new Map();

    return cached(`comm:${seeds.map(seed => seed.id).join(",")}`, 30 * 60 * 1000, async () => {
        const settled = await Promise.allSettled(seeds.map(seed => anilistRequest(communityQuery, { id: seed.id })));
        // If everything failed, throw so this empty result is not cached
        if (settled.every(result => result.status === "rejected")) throw new Error("Community recommendations unavailable");

        const map = new Map();
        settled.forEach(result => {
            if (result.status !== "fulfilled") return;
            (result.value?.Media?.recommendations?.nodes || []).forEach(node => {
                const id = node?.mediaRecommendation?.id;
                if (id && node.rating > 0) map.set(id, Math.max(map.get(id) || 0, node.rating));
            });
        });
        return map;
    });
}

// Scores ONE candidate show for ONE user profile. Higher = better fit.
function scoreAffinity(media, profile, communityMap = null) {
    const cfg = profile.cfg;
    const features = extractFeatures(media, cfg);

    // (a) feature affinity: Σ(weight × affinity) normalised by how many features the show has
    let sumContribution = 0;
    let sumWeightSquares = 0;
    const contributions = [];
    features.forEach((weight, key) => {
        sumWeightSquares += weight * weight;
        const entry = profile.affinity.get(key);
        if (!entry) return;
        const contribution = weight * entry.value;
        sumContribution += contribution;
        contributions.push({ key, contribution });
    });
    const featureScore = sumWeightSquares > 0 ? sumContribution / Math.sqrt(sumWeightSquares) : 0;

    // (b) nearest loved shows: weighted average of p over the 3 most similar loved shows
    const vec = profile.vectorOf(features);
    const neighbours = profile.loved
        .map(item => ({ item, similarity: cosineSimilarity(vec, item.vec) }))
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, 3);
    let numerator = 0;
    let denominator = 0;
    neighbours.forEach(neighbour => {
        numerator += neighbour.similarity * neighbour.item.p;
        denominator += neighbour.similarity;
    });
    const knnScore = numerator / (denominator + 0.2); // +0.2 pulls toward 0 when nothing is really similar

    // (c) similarity to shows the user disliked -> penalty
    let negative = 0;
    profile.hated.forEach(item => {
        const similarity = cosineSimilarity(vec, item.vec);
        if (similarity > 0.35) negative = Math.max(negative, similarity * Math.abs(item.p));
    });

    // (d) small quality tie-breaker and community boost
    const quality = clampNumber(((media.averageScore || 70) - 70) / 30, -1, 1);
    const communityRating = communityMap?.get(media.id) || 0;
    const community = Math.min(1, communityRating / 30);

    const score =
        cfg.wFeature * featureScore +
        cfg.wKnn * knnScore +
        cfg.wCommunity * community +
        cfg.wQuality * quality -
        cfg.wNegative * negative;

    // Human readable reason
    let reason = null;
    const best = neighbours[0];
    if (best && best.similarity >= 0.4 && best.item.p >= 1 && best.item.title) {
        reason = `Similar to ${best.item.title}, which you loved`;
    } else {
        const topFeatures = contributions
            .filter(entry => entry.contribution > 0.12 && /^(g|t):/.test(entry.key))
            .sort((a, b) => b.contribution - a.contribution)
            .slice(0, 2)
            .map(entry => describeFeature(entry.key).name);
        if (topFeatures.length > 0) reason = `Fits what you rate highly: ${topFeatures.join(" & ")}`;
    }

    return { score, reason, vec, contributions };
}

// Maximal Marginal Relevance: pick the best show, then keep picking shows that are good BUT not too
// similar to what is already picked, so the list has variety.
function diversifyMMR(sorted, limit, lambda) {
    if (sorted.length <= 1) return sorted.slice(0, limit);

    const maxRank = sorted[0].rank;
    const minRank = sorted[sorted.length - 1].rank;
    const span = maxRank - minRank || 1;
    const normalise = candidate => (candidate.rank - minRank) / span;

    const selected = [sorted[0]];
    const pool = sorted.slice(1);

    while (selected.length < limit && pool.length > 0) {
        let bestIndex = 0;
        let bestValue = -Infinity;

        pool.forEach((candidate, index) => {
            let maxSimilarity = 0;
            selected.forEach(chosen => {
                maxSimilarity = Math.max(maxSimilarity, cosineSimilarity(candidate.vec, chosen.vec));
            });
            const value = lambda * normalise(candidate) - (1 - lambda) * maxSimilarity;
            if (value > bestValue) {
                bestValue = value;
                bestIndex = index;
            }
        });

        selected.push(pool.splice(bestIndex, 1)[0]);
    }
    return selected;
}

// Ranks a list of media for a user. jitter adds a little randomness so "Roll again" gives a fresh order.
function rankByAffinity(list, profile, options = {}) {
    const { jitter = 0, limit = list.length, diversify = false, community = null } = options;

    const scored = list.map(media => {
        const result = scoreAffinity(media, profile, community);
        return { media, ...result, rank: result.score + Math.random() * jitter };
    });
    scored.sort((a, b) => b.rank - a.rank);

    const picked = diversify ? diversifyMMR(scored, limit, profile.cfg.mmrLambda) : scored.slice(0, limit);
    return picked.map(item => toCardMedia(item.media, item.reason));
}

// Used by Surprise Me: still random, but shows that fit the user's taste are more likely to be picked
// (softmax sampling), so it stays a surprise without ignoring what the user likes.
function pickWeightedByAffinity(mediaList, profile) {
    const scores = mediaList.map(media => scoreAffinity(media, profile, null).score);
    const top = Math.max(...scores);
    const temperature = 1.2;
    const weights = scores.map(score => Math.exp((score - top) / temperature));
    const total = weights.reduce((sum, weight) => sum + weight, 0);

    let threshold = Math.random() * total;
    for (let i = 0; i < mediaList.length; i++) {
        threshold -= weights[i];
        if (threshold <= 0) return mediaList[i];
    }
    return mediaList[mediaList.length - 1];
}

/* ---------- 6. Insights + evaluation endpoints ---------- */

// "What does the recommender think of me?" - used by the Profile window and handy for debugging
app.get("/api/affinity/:username", async (req, res) => {
    try {
        const username = normalizeUsername(req.params.username);
        if (!username) return res.status(400).json({ error: "A valid username is required" });

        const profile = await getAffinityProfile(username, { liked: parseIdList(req.query.liked, 40), disliked: [] });

        // For the "you watch X but rate Y" comparison: how many list entries contain each genre
        const base = await getAffinityBase(username).catch(() => ({ entries: [] }));
        const genreCounts = {};
        base.entries.forEach(entry => {
            if (entry.status === "PLANNING") return;
            (entry.media.genres || []).forEach(genre => { genreCounts[genre] = (genreCounts[genre] || 0) + 1; });
        });
        const watchedMost = Object.keys(genreCounts)
            .sort((a, b) => genreCounts[b] - genreCounts[a])
            .slice(0, 5)
            .map(genre => ({
                name: genre,
                count: genreCounts[genre],
                affinity: Number((profile.affinity.get(`g:${genre}`)?.value || 0).toFixed(2))
            }));

        const labelled = [];
        profile.affinity.forEach((entry, key) => {
            if (!/^(g|t|s):/.test(key) || entry.support < 2) return;
            const { kind, name } = describeFeature(key);
            labelled.push({ kind, name, affinity: Number(entry.value.toFixed(2)), support: Number(entry.support.toFixed(1)) });
        });

        res.json({
            strength: profile.strength,
            ratedShows: profile.scoredCount,
            consideredShows: profile.items.length,
            meanScore: Number(profile.mean.toFixed(1)),
            scoreSpread: Number(profile.sd.toFixed(1)),
            topLikes: labelled.filter(item => item.affinity >= 0.1).sort((a, b) => b.affinity - a.affinity).slice(0, 12),
            topDislikes: labelled.filter(item => item.affinity <= -0.1).sort((a, b) => a.affinity - b.affinity).slice(0, 8),
            lovedShows: profile.loved.slice(0, 8).map(item => ({ id: item.id, title: item.title, p: Number(item.p.toFixed(2)) })),
            watchedMost
        });
    } catch (error) {
        console.error("Affinity insights error:", error);
        sendApiError(res, error, "Failed to build taste insights.", "AniList user not found");
    }
});

// Objective test of the recommender ("leave-one-out"): hide the user's best-rated shows, build the profile
// from everything else, then see where each model ranks the hidden shows among ~200 other shows.
// Compares: random, plain popularity, the OLD frequency model and the new affinity model.
//   /api/debug/evaluate/YourName            -> default settings
//   /api/debug/evaluate/YourName?kTag=6&wKnn=1.4  -> try different settings (see AFFINITY_OVERRIDE_LIMITS)
const evalPoolQuery = `
    query ($page: Int, $excludedIds: [Int]) {
        Page(page: $page, perPage: 50) {
            media(
                type: ANIME,
                isAdult: false,
                format_in: [TV, TV_SHORT, MOVIE, ONA, OVA],
                id_not_in: $excludedIds,
                sort: POPULARITY_DESC
            ) {
                ${MEDIA_FEATURE_CORE}
            }
        }
    }
`;

// Same maths as the old getUserTaste(), but from already-loaded items (so hidden shows can be left out)
function frequencyTasteFromItems(items) {
    const genreRaw = {};
    const tagRaw = {};
    items.forEach(item => {
        const base = TASTE_STATUS_WEIGHT[item.status] ?? 0;
        if (base === 0) return;
        let weight = base;
        if (item.score > 0 && base > 0) weight = base * Math.max(-1, Math.min(2, (item.score - 60) / 20));
        (item.media.genres || []).forEach(genre => { genreRaw[genre] = (genreRaw[genre] || 0) + weight; });
        (item.media.tags || []).forEach(tag => {
            if (tag.rank >= 50) tagRaw[tag.name] = (tagRaw[tag.name] || 0) + weight * (tag.rank / 100) * 0.6;
        });
    });
    return { genres: normalizeWeights(genreRaw), tags: normalizeWeights(tagRaw) };
}

function evaluateRanking(rankedIds, hiddenIds) {
    const n = rankedIds.length;
    let hitsTop20 = 0;
    let hitsTop50 = 0;
    let percentileSum = 0;
    rankedIds.forEach((id, index) => {
        if (!hiddenIds.has(id)) return;
        if (index < 20) hitsTop20++;
        if (index < 50) hitsTop50++;
        percentileSum += 1 - index / Math.max(1, n - 1); // 1.0 = ranked first, 0.0 = ranked last
    });
    return {
        hitsInTop20: hitsTop20,
        hitsInTop50: hitsTop50,
        meanPercentile: Number((percentileSum / hiddenIds.size).toFixed(3)) // random ~ 0.5, perfect = ~1.0
    };
}

app.get("/api/debug/evaluate/:username", async (req, res) => {
    try {
        const username = normalizeUsername(req.params.username);
        if (!username) return res.status(400).json({ error: "A valid username is required" });

        const overrides = parseAffinityOverrides(req.query);
        const cfg = { ...AFFINITY_DEFAULTS, ...overrides };

        const base = await getAffinityBase(username);
        const prefs = computePreferences(base.entries, base.favouriteIds, cfg);

        const scoredItems = prefs.items.filter(item => item.scored).sort((a, b) => b.p - a.p);
        if (scoredItems.length < 20) {
            return res.status(400).json({ error: "Need at least 20 scored shows on the list to run an evaluation." });
        }

        // Hide the user's top ~20% (at least 5, at most 40), only shows they genuinely rated above their average
        const hiddenCount = Math.min(40, Math.max(5, Math.round(scoredItems.length * 0.2)));
        const hidden = scoredItems.slice(0, hiddenCount).filter(item => item.p > 0);
        if (hidden.length < 5) {
            return res.status(400).json({ error: "Not enough clearly-liked shows to hide for a fair test." });
        }
        const hiddenIds = new Set(hidden.map(item => item.id));
        const trainItems = prefs.items.filter(item => !hiddenIds.has(item.id));

        // "Other shows" the user has not touched: random pages of the popularity ranking
        const knownIds = base.entries.map(entry => entry.mediaId);
        const pages = shuffle(Array.from({ length: 16 }, (_, i) => i + 1)).slice(0, 6);
        const settled = await Promise.allSettled(
            pages.map(page => anilistRequest(evalPoolQuery, { page, excludedIds: knownIds }))
        );
        const pool = new Map();
        hidden.forEach(item => pool.set(item.id, item.media));
        settled.forEach(result => {
            if (result.status !== "fulfilled") return;
            (result.value?.Page?.media || []).forEach(media => { if (!pool.has(media.id)) pool.set(media.id, media); });
        });
        // Fairness: people mostly list popular shows, so without this a plain "most popular first" ranking would
        // win by default. We keep the comparison shows in the SAME popularity brackets as the hidden favourites
        // (up to 3 comparison shows per hidden favourite in each bracket), so popularity alone can't help.
        const bracket = media => ((media.popularity || 0) < 15000 ? 0 : (media.popularity || 0) < 80000 ? 1 : 2);
        const hiddenPerBracket = [0, 0, 0];
        hidden.forEach(item => { hiddenPerBracket[bracket(item.media)]++; });
        const strangers = [...pool.values()].filter(media => !hiddenIds.has(media.id));
        const matchedStrangers = [];
        [0, 1, 2].forEach(b => {
            const inBracket = shuffle(strangers.filter(media => bracket(media) === b));
            matchedStrangers.push(...inBracket.slice(0, hiddenPerBracket[b] * 3));
        });
        const poolList = [...hidden.map(item => item.media), ...matchedStrangers];
        if (poolList.length < 40) {
            return res.status(502).json({ error: "Could not load enough comparison shows from AniList." });
        }

        // The four contestants
        const randomOrder = shuffle(poolList).map(media => media.id);
        const popularityOrder = [...poolList].sort((a, b) => (b.popularity || 0) - (a.popularity || 0)).map(media => media.id);

        const frequencyTaste = frequencyTasteFromItems(trainItems);
        const frequencyOrder = [...poolList]
            .map(media => ({ id: media.id, score: scoreCandidate(media, frequencyTaste).score }))
            .sort((a, b) => b.score - a.score)
            .map(item => item.id);

        const trainProfile = assembleProfile(trainItems, prefs, cfg);
        const affinityOrder = [...poolList]
            .map(media => ({ id: media.id, score: scoreAffinity(media, trainProfile, null).score }))
            .sort((a, b) => b.score - a.score)
            .map(item => item.id);

        res.json({
            note: "Higher is better. meanPercentile: random ~0.5, perfect ~1.0. 'hitsInTop20' = how many of the hidden favourites made the top 20.",
            hiddenFavourites: hidden.length,
            comparisonPoolSize: poolList.length,
            popularityMatched: true,
            settings: cfg,
            results: {
                random: evaluateRanking(randomOrder, hiddenIds),
                popularity: evaluateRanking(popularityOrder, hiddenIds),
                oldFrequencyModel: evaluateRanking(frequencyOrder, hiddenIds),
                newAffinityModel: evaluateRanking(affinityOrder, hiddenIds)
            }
        });
    } catch (error) {
        console.error("Evaluation error:", error);
        sendApiError(res, error, "Failed to run the evaluation.", "AniList user not found");
    }
});

// Search used by the "Teach me your taste" box in the Profile window
app.get("/api/search", async (req, res) => {
    try {
        const raw = Array.isArray(req.query.q) ? req.query.q[0] : req.query.q;
        const q = typeof raw === "string" ? raw.trim().slice(0, 80) : "";
        if (q.length < 2) return res.json([]);

        const results = await cached(`search:${q.toLowerCase()}`, 10 * 60 * 1000, async () => {
            const query = `
                query ($q: String) {
                    Page(perPage: 8) {
                        media(search: $q, type: ANIME, isAdult: false, sort: SEARCH_MATCH) {
                            id
                            title {
                                romaji
                                english
                            }
                            format
                            seasonYear
                        }
                    }
                }
            `;
            const data = await anilistRequest(query, { q });
            return data?.Page?.media || [];
        });

        res.json(results);
    } catch (error) {
        console.error("Search error:", error);
        sendApiError(res, error, "Search failed.");
    }
});

/* =========================================================
   GET USER PROFILE & ANIME STATS BY ANILIST USERNAME
========================================================= */
app.get("/api/user/:username", async (req, res) => {
    try {
        // [CHANGED] Validate the username before calling AniList
        const username = normalizeUsername(req.params.username);
        if (!username) return res.status(400).json({ error: "A valid username is required" });

        const query = `
            query ($name: String) {
                User(name: $name) {
                    id
                    name
                    avatar {
                        large
                    }
                    statistics {
                        anime {
                            count
                            episodesWatched
                            meanScore
                            genres(limit: 5, sort: COUNT_DESC) {
                                genre
                                count
                            }
                        }
                    }
                }
            }
        `;

        const data = await anilistRequest(query, { name: username });

        if (!data || !data.User) {
            return res.status(404).json({ error: "AniList user not found" });
        }

        res.json(data.User);
    } catch (error) {
        console.error("Error fetching user profile:", error);
        // [CHANGED] AniList answers 404 for unknown users and 429 when busy -> pass those through properly
        sendApiError(res, error, "Failed to fetch user profile", "AniList user not found");
    }
});

/* =========================================================
   GET ANIME RECOMMENDATIONS
========================================================= */

// [CHANGED] The query now lives at module level (it is reused for every "attempt" below)
// and also requests "tags" so results can be ranked against the user's taste profile.
const animeQuery = `
    query ($page: Int, $search: String, $genre: [String],$tag: [String], $score: Int, $year: Int, $format: MediaFormat, $countryOfOrigin: CountryCode, $isAdult: Boolean, $excludedIds: [Int], $sort: [MediaSort]) {
        Page(page: $page, perPage: 20) {
            pageInfo {
                lastPage
                total
                hasNextPage
            }
            media(
                type: ANIME,
                search: $search,
                isAdult: $isAdult,
                genre_in: $genre,
                tag_in: $tag,
                averageScore_greater: $score,
                seasonYear: $year,
                format: $format,
                countryOfOrigin: $countryOfOrigin,
                id_not_in: $excludedIds,
                sort: $sort
            ) {
                ${MEDIA_FEATURE_FIELDS}
            }
        }
    }
`;
// [CHANGED] The media fields now come from MEDIA_FEATURE_FIELDS (genres, tags, studio, source, format, episodes,
// year, popularity + cover colour) so the affinity model can understand every result. "sort" became a variable
// so the personalised search can also pull a page sorted by score (see fetchRandomAnimePage).

// [ADDED] Runs the query above for ONE set of filters: reads page 1 (which also tells us how many
// pages exist), then jumps to a random page so repeated searches give variety.
// Returns [] when nothing matches those filters.
// [CHANGED] extraPages > 0 (used for personalised users) widens the candidate pool: instead of ranking only ONE
// random page of 20, we also read extra random popular pages plus one top-rated page and merge them all, so the
// ranking has many more shows to choose from (the best match is no longer limited to a random 20).
async function fetchRandomAnimePage(variables, isFilteringUserList, extraPages = 0) {
    const baseVariables = {
        ...variables,
        sort: variables.search ? ["SEARCH_MATCH"] : ["POPULARITY_DESC"]
    };
    const initialData = await anilistRequest(animeQuery, { ...baseVariables, page: 1 });

    const pageInfo = initialData?.Page?.pageInfo;
    const totalPages = pageInfo?.lastPage || 1;
    const totalResults = pageInfo?.total || 0;

    if (totalResults === 0) {
        return [];
    }

    const maxPageLimit = isFilteringUserList ? Math.min(totalPages, 3) : Math.min(totalPages, 10);
    const randomPage = Math.floor(Math.random() * maxPageLimit) + 1;

    if (extraPages > 0) {
        const pickPage = limit => Math.floor(Math.random() * limit) + 1;
        const requests = [];
        for (let i = 0; i < extraPages; i++) {
            requests.push(anilistRequest(animeQuery, { ...baseVariables, page: pickPage(maxPageLimit) }));
        }
        // One page from the top-rated ordering, so well-rated but less popular shows get a chance too
        requests.push(anilistRequest(animeQuery, {
            ...baseVariables,
            sort: ["SCORE_DESC"],
            page: pickPage(Math.min(totalPages, 5))
        }));

        const settled = await Promise.allSettled(requests);
        const byId = new Map();
        [initialData, ...settled.filter(r => r.status === "fulfilled").map(r => r.value)].forEach(data => {
            (data?.Page?.media || []).forEach(media => byId.set(media.id, media));
        });
        return [...byId.values()];
    }

    if (randomPage === 1) {
        return initialData?.Page?.media || [];
    }

    const randomData = await anilistRequest(animeQuery, { ...baseVariables, page: randomPage });
    const results = randomData?.Page?.media || [];

    // Fall back to page 1 if the random page came back empty
    return results.length > 0 ? results : (initialData?.Page?.media || []);
}

app.get("/api/anime", async (req, res) => {
    try {
        // [CHANGED] New optional params:
        //   moodGenre - genres that come from the selected MOODS (kept separate from genres the user ticked)
        //   exclude   - comma separated ids the user skipped/disliked on the frontend
        const { search, genre, moodGenre, tag, rating, year, format, language, username, exclude, liked } = req.query;
        // [ADDED] "liked" = ids the user saved / picked as favourites in the app (positive feedback for the recommender)

        const watchedIds = await getUserWatchedIds(username);
        const excludedIds = mergeIds(watchedIds, parseIdList(exclude));

        const filterVariables = {
            excludedIds: excludedIds.length > 0 ? excludedIds : undefined,
            isAdult: false
        };
        const rawSearch = Array.isArray(search) ? search[0] : search;
        const searchQuery = typeof rawSearch === "string" ? rawSearch.trim().slice(0, 80) : "";
        if (searchQuery) filterVariables.search = searchQuery;

        // [CHANGED] genres/tags are no longer put straight on filterVariables - they are built per attempt below
        const explicitGenres = toArray(genre);
        const moodGenres = toArray(moodGenre);
        const tags = toArray(tag);

        // [CHANGED] Ignore garbage numbers instead of sending NaN to AniList
        const ratingNumber = Number(rating);
        if (rating && Number.isFinite(ratingNumber)) filterVariables.score = ratingNumber * 10;

        // [CHANGED] The old code sent (year - 1), so picking 2020 actually searched 2019 shows.
        // seasonYear should be exactly the year the user selected.
        const yearNumber = Number(year);
        if (year && Number.isInteger(yearNumber)) filterVariables.year = yearNumber;

        // [CHANGED] Only accept real AniList formats (a bad value used to make AniList reject the whole query)
        const allowedFormats = ["TV", "TV_SHORT", "MOVIE", "OVA", "ONA", "SPECIAL", "MUSIC"];
        if (format && allowedFormats.includes(String(format).toUpperCase())) {
            filterVariables.format = String(format).toUpperCase();
        }

        if (language) {
            const countryMap = { Japanese: "JP", Chinese: "CN", English: "US" };
            if (countryMap[language]) {
                filterVariables.countryOfOrigin = countryMap[language];
            }
        }

        // [ADDED] Mood handling with graceful fallback.
        // A mood like "Thought-Provoking" maps to several genres + tags and AniList can be very strict about
        // multi-genre / multi-tag filters, which used to produce empty results. So we try, in order:
        //   1. explicit genres + ALL mood genres + mood tags   (best match)
        //   2. explicit genres + ALL mood genres, no tags
        //   3. explicit genres + ONE mood genre at a time (max 2 random ones)
        // and report which level we ended up at in the X-Match-Level header ("exact" or "relaxed").
        const unique = list => [...new Set(list)];
        const attempts = [];

        if (moodGenres.length === 0 && tags.length === 0) {
            attempts.push({ genres: explicitGenres, tags: [], level: "exact" });
        } else {
            if (tags.length > 0) {
                attempts.push({ genres: unique([...explicitGenres, ...moodGenres]), tags, level: "exact" });
            }
            attempts.push({
                genres: unique([...explicitGenres, ...moodGenres]),
                tags: [],
                level: tags.length > 0 ? "relaxed" : "exact"
            });
            if (moodGenres.length > 1) {
                shuffle(moodGenres).slice(0, 2).forEach(singleGenre => {
                    attempts.push({ genres: unique([...explicitGenres, singleGenre]), tags: [], level: "relaxed" });
                });
            }
        }

        const isFilteringUserList = excludedIds.length > 0;

        // [ADDED] Build the user's AFFINITY profile (what they truly like - see the AFFINITY MODEL section).
        // Inputs: their AniList list (if connected), shows they saved/picked (liked) and shows they skipped.
        // If this fails for any reason we simply fall back to the old random order.
        const likedIds = parseIdList(liked, 40);
        const dislikedFeedback = parseIdList(exclude, 300).slice(-40); // the 40 most recent skips
        const cleanUsername = normalizeUsername(username);
        let profile = null;
        if (cleanUsername || likedIds.length > 0) {
            try {
                profile = await getAffinityProfile(cleanUsername, { liked: likedIds, disliked: dislikedFeedback });
            } catch (profileError) {
                console.warn("Affinity profile unavailable, using random order:", profileError.message);
            }
        }
        const personalise = Boolean(profile?.hasSignal);

        let results = [];
        let matchLevel = "exact";

        for (const attempt of attempts) {
            const variables = {
                ...filterVariables,
                genre: attempt.genres.length > 0 ? attempt.genres : undefined,
                tag: attempt.tags.length > 0 ? attempt.tags : undefined
            };

            results = await fetchRandomAnimePage(variables, isFilteringUserList, personalise ? 2 : 0); // [CHANGED] wider pool when personalised
            if (results.length > 0) {
                matchLevel = attempt.level;
                break;
            }
        }

        // [ADDED] Personalised ranking: if a user is connected, sort the results by how well they match
        // their taste profile (and attach a "reason"). If anything goes wrong we silently fall back to the
        // old behaviour (random shuffle) so recommendations never break because of this feature.
        // [CHANGED] This used the old "most watched genres" profile; it now uses the affinity profile (what the user
        // rates highly relative to their own average): the (wider) result pool is ranked by how well each show fits
        // what they truly like, then the top 20 are diversified.
        if (personalise && results.length > 0) {
            let community = null;
            try {
                community = await getCommunityMap(profile); // AniList "fans of X also like Y" boost (cached)
            } catch (communityError) {
                console.warn("Community recommendations unavailable:", communityError.message);
            }
            results = rankByAffinity(results, profile, { jitter: 0.3, limit: 20, diversify: true, community });
        } else {
            results = shuffle(results).map(media => toCardMedia(media, null));
        }

        res.set("X-Match-Level", matchLevel);
        res.set("X-Profile-Strength", profile ? profile.strength : "none"); // [ADDED] lets the page show a "rate more shows" hint
        res.json(results);

    } catch (error) {
        console.error("Server error:", error);
        sendApiError(res, error, "Failed to fetch anime recommendations");
    }
});

/* =========================================================
   [ADDED] GET PERSONALISED PICKS ("Based on your taste" row)
   Pulls well-rated popular shows from the user's favourite genres,
   removes anything they've already got on their list, then ranks the
   pool against their taste profile.
========================================================= */
const candidateQuery = `
    query ($page: Int, $genre: [String], $excludedIds: [Int]) {
        Page(page: $page, perPage: 30) {
            media(
                type: ANIME,
                isAdult: false,
                genre_in: $genre,
                averageScore_greater: 70,
                format_in: [TV, TV_SHORT, MOVIE, ONA, OVA],
                id_not_in: $excludedIds,
                sort: POPULARITY_DESC
            ) {
                id
                title {
                    romaji
                    english
                }
                averageScore
                genres
                tags {
                    name
                    rank
                }
                coverImage {
                    extraLarge
                    color
                }
            }
        }
    }
`;

app.get("/api/recommendations/:username", async (req, res) => {
    try {
        const username = normalizeUsername(req.params.username);
        if (!username) return res.status(400).json({ error: "A valid username is required" });

        const skipped = new Set(parseIdList(req.query.exclude));

        // The expensive part (taste + candidate search) is cached per user for 10 minutes
        const pool = await cached(`taste-pool:${username.toLowerCase()}`, 10 * 60 * 1000, async () => {
            const taste = await getUserTaste(username);
            if (!taste?.hasSignal) return [];

            const watchedIds = await getUserWatchedIds(username);
            const watched = new Set(watchedIds);

            // Top 3 genres on their own + the top pair together
            const top = taste.topGenres.slice(0, 3);
            const combos = top.map(genre => [genre]);
            if (top.length >= 2) combos.push([top[0], top[1]]);

            const settled = await Promise.allSettled(combos.map(genres =>
                anilistRequest(candidateQuery, {
                    genre: genres,
                    page: Math.floor(Math.random() * 4) + 1,
                    excludedIds: watchedIds.length > 0 ? watchedIds : undefined
                })
            ));

            const byId = new Map();
            settled.forEach(result => {
                if (result.status !== "fulfilled") return;
                (result.value?.Page?.media || []).forEach(media => {
                    if (!watched.has(media.id)) byId.set(media.id, media);
                });
            });

            return rankByTaste([...byId.values()], taste, 0.15).slice(0, 60);
        });

        // Best matches still lean to the front, but with some jitter so the order changes between visits,
        // and shows the client says it already displayed (?seen=) are pushed to the back.
        const seen = new Set(parseIdList(req.query.seen, 80));
        const jittered = pool
            .filter(media => !skipped.has(media.id))
            .map((media, i) => ({ media, key: i + Math.random() * 14 }))
            .sort((a, b) => a.key - b.key)
            .map(item => item.media);
        const fresh = jittered.filter(media => !seen.has(media.id));
        const repeats = jittered.filter(media => seen.has(media.id));
        res.json([...fresh, ...repeats].slice(0, 20));
    } catch (error) {
        console.error("Recommendations API error:", error);
        sendApiError(res, error, "Failed to build personalised recommendations.", "AniList user not found");
    }
});

/* =========================================================
   [ADDED] GET "BECAUSE YOU LIKED X" ROWS
   Picks a couple of shows the user loved and returns what the AniList
   community recommends to people who liked them.
========================================================= */
const becauseQuery = `
    query ($id: Int) {
        Media(id: $id, type: ANIME) {
            recommendations(sort: RATING_DESC, perPage: 25) {
                nodes {
                    rating
                    mediaRecommendation {
                        type
                        ${MEDIA_FEATURE_FIELDS}
                    }
                }
            }
        }
    }
`;
// [CHANGED] mediaRecommendation now includes the full feature fields so each recommendation can be scored
// against the user's affinity profile. Seeds are now the shows the user LOVED relative to their own average
// (affinity model) instead of simply their highest raw scores. Falls back to the old seeds if the profile is empty.

app.get("/api/because/:username", async (req, res) => {
    try {
        const username = normalizeUsername(req.params.username);
        if (!username) return res.status(400).json({ error: "A valid username is required" });

        const skipped = new Set(parseIdList(req.query.exclude));
        const likedIds = parseIdList(req.query.liked, 40);
        const dislikedFeedback = parseIdList(req.query.exclude, 300).slice(-40);

        const profile = await getAffinityProfile(username, { liked: likedIds, disliked: dislikedFeedback });

        let seeds = [];
        if (profile.hasSignal && profile.loved.length > 0) {
            seeds = profile.loved.slice(0, 6).map(item => ({ id: item.id, title: item.title }));
        } else {
            const taste = await getUserTaste(username); // old frequency seeds as a fallback
            seeds = taste?.seeds?.slice(0, 6) || [];
        }
        if (seeds.length === 0) return res.json([]);

        const cacheKey = `because:${username.toLowerCase()}:${seeds.map(seed => seed.id).join(",")}:${likedIds.join(",")}`;

        const rows = await cached(cacheKey, 10 * 60 * 1000, async () => {
            const watched = new Set(await getUserWatchedIds(username));
            const chosen = shuffle(seeds).slice(0, 2);
            const out = [];

            for (const seed of chosen) {
                try {
                    const data = await anilistRequest(becauseQuery, { id: seed.id });
                    const nodes = data?.Media?.recommendations?.nodes || [];

                    const candidates = nodes
                        .filter(node =>
                            node?.rating > 0 &&
                            node.mediaRecommendation &&
                            node.mediaRecommendation.type === "ANIME" &&
                            !watched.has(node.mediaRecommendation.id)
                        )
                        .map(node => {
                            const media = node.mediaRecommendation;
                            // Fans' votes + how well it fits this user; strongly mismatched ones are dropped
                            const fit = profile.hasSignal ? scoreAffinity(media, profile, null).score : 0;
                            return { media, fit, order: node.rating / 30 + fit };
                        })
                        .filter(item => item.fit > -0.4)
                        .sort((a, b) => b.order - a.order);

                    const results = candidates.map(item => toCardMedia(item.media, `Because you liked ${seed.title}`));

                    if (results.length > 0) {
                        out.push({ seed: { id: seed.id, title: seed.title }, results: results.slice(0, 15) });
                    }
                } catch (seedError) {
                    // One seed failing shouldn't kill the whole row
                    console.warn(`Because-you-liked lookup failed for ${seed.id}:`, seedError.message);
                }
            }

            return out;
        });

        // Remove anything the user skipped (done after caching so it takes effect immediately)
        res.json(
            rows
                .map(row => ({ ...row, results: row.results.filter(media => !skipped.has(media.id)) }))
                .filter(row => row.results.length > 0)
        );
    } catch (error) {
        console.error("Because-you-liked API error:", error);
        sendApiError(res, error, "Failed to build 'because you liked' recommendations.", "AniList user not found");
    }
});

/* =========================================================
   [ADDED] SEARCH WITH COVERS (Discover search bar)
========================================================= */
app.get("/api/search/cards", async (req, res) => {
    try {
        const raw = Array.isArray(req.query.q) ? req.query.q[0] : req.query.q;
        const q = typeof raw === "string" ? raw.trim().slice(0, 80) : "";
        if (q.length < 2) return res.json([]);

        const results = await cached(`search-cards:${q.toLowerCase()}`, 10 * 60 * 1000, async () => {
            const query = `
                query ($q: String) {
                    Page(perPage: 24) {
                        media(search: $q, type: ANIME, isAdult: false, sort: SEARCH_MATCH) {
                            id
                            title { romaji english }
                            coverImage { extraLarge large color }
                            averageScore
                            genres
                            format
                            seasonYear
                        }
                    }
                }
            `;
            const data = await anilistRequest(query, { q });
            return data?.Page?.media || [];
        });

        res.json(results);
    } catch (error) {
        console.error("Search cards error:", error);
        sendApiError(res, error, "Search failed.");
    }
});

/* =========================================================
   [ADDED] "BECAUSE I LIKED <typed show>"
   Takes what AniList fans recommend for the chosen show (best rated first, with a little shuffling).
   It is deliberately NOT re-ranked by the user's taste profile, so it stays "shows like X" and doesn't
   converge on the same few picks as everything else. Shows already on the user's list / skipped are removed,
   and ?seen= (ids already displayed) are pushed to the back so "Reshuffle" brings new ones forward.
========================================================= */
const becauseShowQuery = `
    query ($id: Int) {
        Media(id: $id, type: ANIME) {
            id
            title { romaji english }
            recommendations(sort: RATING_DESC, perPage: 50) {
                nodes {
                    rating
                    mediaRecommendation {
                        type
                        ${MEDIA_FEATURE_FIELDS}
                    }
                }
            }
        }
    }
`;

app.get("/api/because-show/:id", async (req, res) => {
    try {
        const id = Number.parseInt(req.params.id, 10);
        if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "A valid anime id is required" });

        const username = normalizeUsername(req.query.username);
        const skipped = new Set(parseIdList(req.query.exclude));
        const seen = new Set(parseIdList(req.query.seen, 80));

        const data = await cached(`because-show:${id}`, 30 * 60 * 1000, () => anilistRequest(becauseShowQuery, { id }));
        const media = data?.Media;
        if (!media) return res.status(404).json({ error: "Anime not found" });

        const seedTitle = media.title?.english || media.title?.romaji || "this show";
        const watched = new Set(username ? await getUserWatchedIds(username) : []);

        // Best community-rated first, then a little jitter so every Reshuffle gives a different order
        const ranked = (media.recommendations?.nodes || [])
            .filter(node =>
                node?.rating > 0 &&
                node.mediaRecommendation?.type === "ANIME" &&
                node.mediaRecommendation.id !== id &&
                !watched.has(node.mediaRecommendation.id) &&
                !skipped.has(node.mediaRecommendation.id)
            )
            .sort((a, b) => b.rating - a.rating)
            .map((node, i) => ({ rec: node.mediaRecommendation, key: i + Math.random() * 10 }))
            .sort((a, b) => a.key - b.key)
            .map(item => item.rec);

        const fresh = ranked.filter(rec => !seen.has(rec.id));
        const repeats = ranked.filter(rec => seen.has(rec.id));
        const results = [...fresh, ...repeats].slice(0, 20).map(rec => toCardMedia(rec, `Because you liked ${seedTitle}`));

        res.json({ seed: { id, title: seedTitle }, results, total: ranked.length });
    } catch (error) {
        console.error("Because-show API error:", error);
        sendApiError(res, error, "Failed to build recommendations for that show.", "AniList user not found");
    }
});

/* =========================================================
   [ADDED] CARD INFO FOR A LIST OF IDS (Lists page: skipped + favourites only store ids)
========================================================= */
app.get("/api/anime-cards", async (req, res) => {
    try {
        const ids = parseIdList(req.query.ids, 50);
        if (ids.length === 0) return res.json([]);

        const key = `anime-cards:${[...ids].sort((a, b) => a - b).join(",")}`;
        const cards = await cached(key, 10 * 60 * 1000, async () => {
            const query = `
                query ($ids: [Int]) {
                    Page(perPage: 50) {
                        media(id_in: $ids, type: ANIME) {
                            id
                            title { romaji english }
                            coverImage { extraLarge large color }
                            averageScore
                            genres
                            format
                            seasonYear
                        }
                    }
                }
            `;
            const data = await anilistRequest(query, { ids });
            return data?.Page?.media || [];
        });

        res.json(cards);
    } catch (error) {
        console.error("Anime cards error:", error);
        sendApiError(res, error, "Failed to load those shows.");
    }
});

/* =========================================================
   GET USER WATCHLIST BY ANILIST USERNAME (Cached)
========================================================= */
app.get("/api/watchlist/:username", async (req, res) => {
    try {
        // [CHANGED] Uses the shared username validation helper
        const cleanUsername = normalizeUsername(req.params.username);
        if (!cleanUsername) return res.status(400).json({ error: "Username required" });

        const cacheKey = `watchlist:${cleanUsername.toLowerCase()}`;

        const lists = await cached(cacheKey, 5 * 60 * 1000, async () => {
            const query = `
                query ($username: String) {
                    MediaListCollection(userName: $username, type: ANIME) {
                        lists {
                            name
                            status
                            entries {
                                id
                                progress
                                score
                                updatedAt
                                media {
                                    id
                                    title {
                                        romaji
                                        english
                                    }
                                    coverImage {
                                        medium
                                        large
                                        color
                                    }
                                    episodes
                                    averageScore
                                }
                            }
                        }
                    }
                }
            `;

            const data = await anilistRequest(query, { username: cleanUsername });
            if (!data || !data.MediaListCollection) {
                throw new Error("Watchlist not found");
            }
            return data.MediaListCollection.lists;
        });

        res.json(lists);
    } catch (error) {
        console.error("Error fetching watchlist:", error);
        sendApiError(res, error, "Failed to fetch watchlist", "Watchlist not found");
    }
});

/* =========================================================
   GET DETAILED ANIME DATA BY ID
========================================================= */
app.get("/api/anime/:id", async (req, res) => {
    try {
        const animeId = Number(req.params.id);

        // [ADDED] Reject ids like "abc" or "-5" before spending an AniList request on them
        if (!Number.isInteger(animeId) || animeId <= 0) {
            return res.status(400).json({ error: "A valid anime id is required" });
        }

        const query = `
            query ($id: Int) {
                Media(id: $id, type: ANIME) {
                    id
                    title {
                        romaji
                        english
                        native
                    }
                    coverImage {
                        extraLarge
                        large
                        color
                    }
                    bannerImage
                    description(asHtml: false)
                    averageScore
                    episodes
                    status
                    season
                    seasonYear
                    format
                    genres
                    studios(isMain: true) {
                        nodes {
                            name
                        }
                    }
                    trailer {
                        id
                        site
                    }
                    externalLinks {
                        url
                        site
                        type
                    }
                    relations {
                        edges {
                            relationType
                            node {
                                id
                                title {
                                    english
                                    romaji
                                }
                                coverImage {
                                    large
                                }
                                type
                                format
                            }
                        }
                    }
                }
            }
        `;
        // [ADDED] externalLinks above gives us the official streaming platforms (Crunchyroll, Netflix...)
        // the modal can show instead of only a third-party search link.

        const data = await anilistRequest(query, { id: animeId });

        if (!data || !data.Media) {
            return res.status(404).json({ error: "Anime details not found" });
        }

        res.json(data.Media);
    } catch (error) {
        console.error("Error fetching anime details:", error);
        // [CHANGED] AniList answers 404 for unknown ids -> now we return 404 instead of 500
        sendApiError(res, error, "Failed to fetch anime details", "Anime details not found");
    }
});

/* =========================================================
   DIRECT NATIVE WATCH REDIRECT (Fast & Anti-Bot Proof)
========================================================= */

// [ADDED] The search site is now configurable. Set WATCH_SEARCH_URL in your .env to point somewhere else
// (the title is appended, URL-encoded, to the end). Defaults to the old Miruro search so nothing changes.
const WATCH_SEARCH_URL = process.env.WATCH_SEARCH_URL || "https://www.miruro.to/search?query=";

app.get("/api/watch", (req, res) => {
    try {
        // [CHANGED] Handles a duplicated ?title= param and caps the length
        const rawTitle = Array.isArray(req.query.title) ? req.query.title[0] : req.query.title;
        if (!rawTitle || typeof rawTitle !== "string") return res.status(400).send("Anime title is required.");

        const query = encodeURIComponent(rawTitle.slice(0, 200));
        const targetSearchUrl = `${WATCH_SEARCH_URL}${query}`;

        return res.redirect(targetSearchUrl);
    } catch (error) {
        console.error("Watch redirect error:", error);
        res.status(500).send("Failed to redirect to watch site.");
    }
});

/* =========================================================
   STUDIO SPOTLIGHT HELPERS
========================================================= */
function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

async function pickStudioSpotlight(excludedIds) {
    const excluded = new Set(excludedIds);

    const studioListQuery = `
        query ($page: Int) {
            Page(page: $page, perPage: 25) {
                studios(sort: FAVOURITES_DESC) {
                    id
                    name
                    isAnimationStudio
                }
            }
        }
    `;
    const page = Math.floor(Math.random() * 4) + 1;
    const listData = await anilistRequest(studioListQuery, { page });
    const studios = shuffle(
        (listData.Page?.studios || []).filter(s => s.isAnimationStudio)
    );

    const studioMediaQuery = `
        query ($id: Int) {
            Studio(id: $id) {
                id
                name
                media(sort: SCORE_DESC, isMain: true, perPage: 50) {
                    nodes {
                        id
                        type
                        format
                        averageScore
                    }
                }
            }
        }
    `;
    const allowedFormats = ["TV", "TV_SHORT", "MOVIE", "OVA", "ONA"];

    for (const candidate of studios.slice(0, 5)) {
        const data = await anilistRequest(studioMediaQuery, { id: candidate.id });
        const studio = data.Studio;
        const nodes = studio?.media?.nodes || [];

        const pool = nodes.filter(m =>
            m.type === "ANIME" &&
            allowedFormats.includes(m.format) &&
            m.averageScore >= 70 &&
            !excluded.has(m.id)
        );

        if (pool.length > 0) {
            const pick = pool[Math.floor(Math.random() * Math.min(pool.length, 15))];
            return { id: pick.id, studio: { id: studio.id, name: studio.name } };
        }
    }
    return null;
}

/* =========================================================
   GET SURPRISE ME ANIME RECOMMENDATION
========================================================= */
app.get("/api/surprise", async (req, res) => {
    try {
        // [CHANGED] Also reads "exclude" (ids the user disliked/skipped) so a skipped show never comes back
        const { mode, username, exclude, liked } = req.query; // [ADDED] "liked" feeds the recommender (see AFFINITY MODEL)
        const watchedIds = await getUserWatchedIds(username);
        const excludedIds = mergeIds(watchedIds, parseIdList(exclude));

        const variables = {
            excludedIds: excludedIds.length > 0 ? excludedIds : undefined,
            isAdult: false
        };

        let sortOption = "POPULARITY_DESC";
        const validModes = ["hidden-gem", "time-capsule", "studio-spotlight", "wildcard"];
        const selectedMode = validModes.includes(mode) ? mode : "wildcard";

        switch (selectedMode) {
            case "time-capsule":
                variables.yearLesser = 20071231;
                variables.yearGreater = 19910101;
                variables.score = 70;
                sortOption = "SCORE_DESC";
                break;
            case "hidden-gem":
                variables.score = 75;
                variables.popularityGreater = 3000;
                variables.popularityLesser = 40000;
                variables.formatIn = ["TV", "MOVIE", "ONA", "OVA"];
                sortOption = "SCORE_DESC";
                break;
            case "studio-spotlight":
                break;
            case "wildcard":
            default:
                sortOption = "POPULARITY_DESC";
                break;
        }

        if (selectedMode === "studio-spotlight") {
            const spotlight = await pickStudioSpotlight(excludedIds);
            if (!spotlight) {
                return res.status(404).json({ error: "No studio spotlight pick found." });
            }
            return res.json(spotlight);
        }

        const maxPage = selectedMode === "hidden-gem" ? 10 : 5;
        const randomPage = Math.floor(Math.random() * maxPage) + 1; 

        const query = `
            query ($score: Int, $popularityLesser: Int, $popularityGreater: Int, $yearLesser: FuzzyDateInt, $yearGreater: FuzzyDateInt, $excludedIds: [Int], $page: Int, $isAdult: Boolean, $formatIn: [MediaFormat]) {
                Page(page: $page, perPage: 50) {
                    pageInfo {
                        lastPage
                    }
                    media(
                        type: ANIME,
                        isAdult: $isAdult,
                        format_in: $formatIn,
                        averageScore_greater: $score,
                        popularity_lesser: $popularityLesser,
                        popularity_greater: $popularityGreater,
                        startDate_lesser: $yearLesser,
                        startDate_greater: $yearGreater,
                        id_not_in: $excludedIds,
                        sort: [${sortOption}]
                    ) {
                        ${MEDIA_FEATURE_FIELDS}
                    }
                }
            }
        `;

        let data = await anilistRequest(query, { ...variables, page: randomPage });
        let mediaList = data?.Page?.media || [];

        if (mediaList.length === 0 && randomPage !== 1) {
            const lastPage = Math.max(data?.Page?.pageInfo?.lastPage || 1, 1);
            const retryPage = Math.floor(Math.random() * lastPage) + 1;

            data = await anilistRequest(query, { ...variables, page: retryPage });
            mediaList = data?.Page?.media || [];
        }

        if (mediaList.length === 0) {
            return res.status(404).json({ error: "No surprise anime found matching criteria." });
        }

        // [CHANGED] Still random, but if the recommender knows the user, shows that fit their taste are more likely
        // to be picked (softmax sampling) so Surprise Me stays a surprise without ignoring what they like.
        let randomItem = mediaList[Math.floor(Math.random() * mediaList.length)];
        const surpriseUsername = normalizeUsername(username);
        const surpriseLiked = parseIdList(liked, 40);
        if (surpriseUsername || surpriseLiked.length > 0) {
            try {
                const surpriseProfile = await getAffinityProfile(surpriseUsername, {
                    liked: surpriseLiked,
                    disliked: parseIdList(exclude, 300).slice(-40)
                });
                if (surpriseProfile.hasSignal) randomItem = pickWeightedByAffinity(mediaList, surpriseProfile);
            } catch (profileError) {
                console.warn("Affinity profile unavailable for Surprise Me:", profileError.message);
            }
        }
        res.json({ id: randomItem.id });

    } catch (error) {
        console.error("Surprise API error:", error);
        sendApiError(res, error, "Failed to fetch surprise recommendation.");
    }
});

/* =========================================================
   GET TRENDING ANIME (Discover page)
========================================================= */
app.get("/api/trending", async (req, res) => {
    try {
        const username = Array.isArray(req.query.username) ? req.query.username[0] : req.query.username;
        const key = `trending:${(username || "anon").toLowerCase()}`;

        const results = await cached(key, 10 * 60 * 1000, async () => {
            const excludedIds = await getUserWatchedIds(username);

            const query = `
                query ($excludedIds: [Int], $isAdult: Boolean) {
                    Page(page: 1, perPage: 20) {
                        media(
                            type: ANIME,
                            isAdult: $isAdult,
                            format_in: [TV, TV_SHORT, MOVIE, ONA, OVA],
                            id_not_in: $excludedIds,
                            sort: TRENDING_DESC
                        ) {
                            id
                            title {
                                romaji
                                english
                            }
                            averageScore
                            genres
                            coverImage {
                                extraLarge
                                color
                            }
                        }
                    }
                }
            `;

            const data = await anilistRequest(query, {
                excludedIds: excludedIds.length > 0 ? excludedIds : undefined,
                isAdult: false
            });
            return data.Page?.media || [];
        });

        res.json(results);
    } catch (error) {
        console.error("Trending API error:", error);
        sendApiError(res, error, "Failed to fetch trending anime.");
    }
});

app.listen(PORT,"0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
});