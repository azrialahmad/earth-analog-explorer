// The ranking engine: pure functions, no network, no randomness except the seeded generator.
// Scores come only from here (and the Python pipeline). A language model never writes one.
export { defaultWeights, similarity, terrainMatch, scoreSite, rankSites, warningText } from './scoring'
export { rng, sampleWeights, stability } from './stability'
