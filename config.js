// Where the archive lives. Debug mode commits straight to this branch, which
// GitHub Pages serves, so every save goes live automatically.
export const REPO = {
  owner: 'trentic',
  repo: 'scarif',
  branch: 'gh-pages',
  // Folder the site lives in on that branch ('' = the root).
  siteDir: '',
};

// Who Would Win? vote backend. Leave `endpoint` empty to show fan estimates
// (worked out from each character's fan power). To use real votes, point it
// at a service that implements (see js/votes.js):
//   GET  {endpoint}/split?a=<id>&b=<id>  → { a: 63, b: 37, total: 1204 }
//   POST {endpoint}/vote   { a, b, winner }
export const VOTES = {
  endpoint: '',
  // Show real percentages only once a matchup has this many votes.
  minVotes: 20,
};
