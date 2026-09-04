Original prompt: 어차피 네명이서만 놀꺼니깐 외부에 배포하지도 않을꺼라서 웹으로 즐길수있게 만들어줘

- Created a private local hotseat web prototype for Splendor Pokémon.
- Verified in Chromium: token acquisition, reservation with wild token, turn rotation, and a successful card purchase (score/bonus update).
- Added a WebSocket room server with five-character room codes and per-player turn locking.
- Verified two browser clients: player 1 took tokens, and the identical state plus player 2's enabled turn appeared in player 2's browser.
- TODO: Add player-display-name input and persistent rooms if needed.
- Deployment blocker: the supplied Vercel deployment is not linked to this local repository, and Vercel cannot host this persistent WebSocket server directly. A linked Vercel project plus a separate realtime host (or Redis-backed redesign) is required before a production deployment can be verified.
- Vercel project `tema-ra/splendorpokemononline` is now CLI-linked and deployed. The production alias is `https://splendorpokemononline-vert.vercel.app`.
- Verified the deployed site with two independent Chromium clients: host token selection changed the guest's state, advanced the turn to player 2, and enabled only player 2's controls.
- Reworked entry flow: solo practice is explicit; online hosts wait in a room lobby until the selected player count joins, then the game starts automatically.
- Added premium generated tabletop and gem-token-tray assets, persistent in-game tutorial, interaction animations, and private non-commercial fan-project notices in-game and in README.
- Expanded the always-available tutorial into a first-purchase guide: the lowest-cost starter Pokémon, its required Poké Ball resources, and the matching supply buttons are highlighted until the first purchase.
- Replaced the external-IP presentation with neutral text-and-CSS cards and resources, removed the generated bitmap assets from the project, and added a state-preserving in-browser TUI mode.
- Verified 100 board↔TUI round trips followed by a resource action: the TUI remained mounted, the action advanced turn 1 to 2, red bank changed 7 to 6, and no browser errors were recorded.
- Rebuilt the active game client around `rules.js`: 2/3/4-player base supply, 90-card tier structure, nobles, legal token choices, reservation, gold, forced token returns, final-round scoring, and fewer-development-card tie-break.
- Verified the rule module with five Node tests; locally verified a same-color double draw, 100 board↔TUI switches, and a two-browser room snapshot after a three-color draw without browser errors.
- Corrected the ruleset to the supplied Splendor: Pokémon setup: removed base-Splendor nobles, added 35/30/15 stage decks plus 5 rare and 5 legendary/mythical cards, 18-point final round, master-ball special captures, and a post-turn evolution choice.
- Added solo CPU AI mode with 2-4 player support and Beginner to Advanced difficulties (Brock/Blue/Oak/Cynthia) driven by multi-turn value analysis, evolution chain tracking, master-ball rush, and tactical hate-drafting/denial; verified with Node and Playwright tests.
- Deployed the updated solo CPU build to Vercel production at https://splendorpokemononline-vert.vercel.app with ai.js included in vercel.json.
