// Where Biu Wui lives on the QDay Aevum testnet (from deployments/aevum.json).
export const CONFIG = {
  rpc: "https://rpc-test.qday.info",
  explorer: "https://explorer-test.qday.info",
  chainId: 44005,
  /** The current factory (gasless open). New circles open here. */
  factory: "0xDD39a0B8020C8C18480a068D15Bf18B3e9Ef39EA",
  /** The first factory. Its circles stay on chain, so the site reads both. */
  factoryV1: "0xAEcA0Beb9eCEDBe45dBB2fe74524dE31dDf0aa89",
  implementation: "0x1F8E90464604e4fEC47D915525B0e9E61dD6bBDf",
  /** The first block either factory could have logs in. */
  firstBlock: 3737723,
  /** tUSD8, QDay's test dollar (6 decimals). */
  token: "0x456569838f1d43009A91ebA4263147Afd7233483",
  decimals: 6,
  app: "https://app.biuwui.exprmnts.fun",
  site: "https://biuwui.exprmnts.fun",
  github: "https://github.com/nikhil-pn/biuwui",
};

// The friendly members the secretary bot plays, and our service accounts. Throwaway testnet accounts.
export const PEOPLE = {
  "0x54466718580ddd61f4f5192b2ea5365f2a8cdd7f": "Ah Ming",
  "0xcd9d57216f22202ba3bbf6efe74c03cf91bc100a": "Kitty",
  "0x9e628f1e80fee6d168de1c7e7521731e909eac1f": "Wing",
  "0x9bdf58bd6a8afdf4f73c26bd45937db028e8b63d": "Siu Mei",
  "0x1b062f21511ba1807e9053a57b40c32fb4c31f8b": "The organiser",
  "0x3a09d54eab3f2235bc75f5f1f7c7593951d0533c": "The secretary",
  "0x7acbff7b1691f869bfdc13266c729c69da27ddea": "The relayer",
};
/** The two bots that join every practice circle. */
export const BOTS = ["0x54466718580ddd61f4f5192b2ea5365f2a8cdd7f", "0xcd9d57216f22202ba3bbf6efe74c03cf91bc100a"];

/** Payee names members chose when they joined, learned from the chain as the pages read it. */
const LEARNED = {};
export const learn = (a, name) => {
  if (a && name && !PEOPLE[a.toLowerCase()]) LEARNED[a.toLowerCase()] = name;
};
export const who = (a) => PEOPLE[a.toLowerCase()] ?? LEARNED[a.toLowerCase()] ?? `${a.slice(0, 6)}…${a.slice(-4)}`;
