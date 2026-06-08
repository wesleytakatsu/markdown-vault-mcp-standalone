import assert from "node:assert/strict";
import {
  clampMaxFuzzyDistance,
  defaultMaxEditDistance,
  editDistance,
  isFuzzyEligible,
  withinFuzzyDistance,
} from "../dist/utils/fuzzy-match.utils.js";
import {
  expandWithSynonyms,
  mergeSynonymDicts,
  parseSynonymDict,
} from "../dist/domain/note/synonym.service.js";

// editDistance / withinFuzzyDistance / defaultMaxEditDistance
assert.equal(editDistance("backend", "backend"), 0);
assert.equal(editDistance("backend", "backnd"), 1);
assert.equal(editDistance("backend", "bakend"), 1);
assert.equal(editDistance("backend", "frontend"), 5);

assert.equal(defaultMaxEditDistance("id"), 0);
assert.equal(defaultMaxEditDistance("login"), 1);
assert.equal(defaultMaxEditDistance("backend"), 1);
assert.equal(defaultMaxEditDistance("typescript"), 2);

assert.equal(withinFuzzyDistance("backend", "backend"), true);
assert.equal(withinFuzzyDistance("backend", "backnd"), true);
assert.equal(withinFuzzyDistance("backend", "frontend"), false);
assert.equal(withinFuzzyDistance("api", "apt"), false, "short tokens get distance 0 by default");
assert.equal(withinFuzzyDistance("backend", "backnd", 0), false, "explicit distance 0 disables fuzzy");

assert.equal(clampMaxFuzzyDistance("backend"), 1);
assert.equal(clampMaxFuzzyDistance("backend", 10), 3, "user input is clamped to at most 3");
assert.equal(clampMaxFuzzyDistance("backend", -5), 0, "user input is clamped to at least 0");

assert.equal(isFuzzyEligible("backend"), true);
assert.equal(isFuzzyEligible("id"), false, "short tokens are not fuzzy eligible");
assert.equal(isFuzzyEligible("jwt"), false, "protected tokens are not fuzzy eligible");

// expandWithSynonyms — bidirectional group expansion, including the group name as a term
const offExpansion = expandWithSynonyms(["login"], "off");
assert.deepEqual(offExpansion, [{ token: "login", source: "direct" }]);

const basicExpansion = expandWithSynonyms(["login"], "basic");
const synonymTokens = basicExpansion.filter((entry) => entry.source === "synonym");
assert.ok(synonymTokens.some((entry) => entry.token === "autenticacao" && entry.group === "auth"));
assert.ok(synonymTokens.some((entry) => entry.token === "jwt" && entry.group === "auth"));
assert.ok(
  synonymTokens.some((entry) => entry.token === "auth"),
  "the group name itself should be reachable as a synonym term",
);
assert.ok(
  !synonymTokens.some((entry) => entry.token === "login"),
  "the original query token should not be duplicated as a synonym",
);

// querying by the group name should expand bidirectionally to its terms
const groupNameExpansion = expandWithSynonyms(["auth"], "basic");
assert.ok(
  groupNameExpansion.some((entry) => entry.source === "synonym" && entry.token === "login"),
);

// mergeSynonymDicts — merges term lists per group instead of replacing them
const merged = mergeSynonymDicts({ auth: ["login"] }, { auth: ["sso"], docker: ["container"] });
assert.deepEqual(merged.auth.sort(), ["login", "sso"]);
assert.deepEqual(merged.docker, ["container"]);
assert.deepEqual(mergeSynonymDicts({ auth: ["login"] }, null), { auth: ["login"] });

// parseSynonymDict — sanity limits and normalization
assert.deepEqual(parseSynonymDict('{"Auth": ["Login", "JWT"]}'), { auth: ["login", "jwt"] });
assert.equal(parseSynonymDict("{ not valid json"), null);
assert.equal(parseSynonymDict("[]"), null, "must be an object, not an array");
assert.equal(parseSynonymDict("{}"), null, "must have at least one group");
assert.equal(parseSynonymDict('{"auth": []}'), null, "groups must have at least one term");
assert.equal(
  parseSynonymDict(JSON.stringify({ auth: Array.from({ length: 51 }, (_, i) => `term${i}`) })),
  null,
  "more than 50 terms per group is invalid",
);
assert.equal(
  parseSynonymDict(JSON.stringify(Object.fromEntries(
    Array.from({ length: 201 }, (_, i) => [`group${i}`, ["term"]]),
  ))),
  null,
  "more than 200 groups is invalid",
);

console.log("note-ranking unit test passed");
