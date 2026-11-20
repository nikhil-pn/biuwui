# How AI was used

Biu Wui is built by Nikhil (product, decisions, testing on real wallets) with an AI coding agent (Claude Code).
- **Research:** the agent read the challenge page, QDay's wiki and starter kit, counted visible competing repos per
  track and checked past hackathon winners; Nikhil chose the idea, track and name.
- **Code:** the agent wrote most contracts, tests, scripts and the web app from Nikhil's direction, all inside
  this build window. Every change is reviewed and tested; the
  test suite includes fuzz/invariant tests and a fork test against the real tUSD8.
- **Docs and video:** drafted by the agent, checked and voiced by the team.
- **In the product:** the circle secretary bot does not give an AI any power over money. It can only call the
  contract's fixed paths (collect one share, close, release to the locked payee, withdraw to the payee).
