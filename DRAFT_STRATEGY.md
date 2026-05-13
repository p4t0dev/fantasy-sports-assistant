# Dynasty Fantasy Sports: Comprehensive Draft & Waiver Strategy Guide

This document provides a detailed breakdown of core principles, scoring adaptations, and lessons learned for dominating rookie drafts and waiver wires in deep Dynasty Fantasy Football leagues, particularly those featuring Superflex and IDP formats.

## 0. Tool Execution & Sleeper Connection
To leverage these strategies, run the `assistant.py` script via the command line. It directly interfaces with the Sleeper API using your specific Sleeper username (`p4t0b4ll3rs`).
* **Draft Analysis Command:** Run `python3 assistant.py --username p4t0b4ll3rs --draft_id <DRAFT_ID>` to get a live, filtered breakdown of the current draft board, removing retired players and adjusting for rookies.
* **Waiver Assistant Command:** Run `python3 assistant.py --username p4t0b4ll3rs --waivers --league_id <LEAGUE_ID>` to calculate Dynasty Drop Scores and identify high-value UDFA targets.

## 1. League Scoring Defines the Board
*Always check the `league_info.get('scoring_settings')` before drafting. ADP assumes a standard format, which is a trap in customized leagues.*

* **Superflex (SF) Multiplier:** The ability to start two Quarterbacks means QBs hold the highest positional value. A 1st-round NFL Quarterback is almost always a top-3 rookie pick. **The Depth Chart Trap:** Never blindly follow Sleeper's raw ADP for late-round QBs. A highly ranked rookie buried behind a young franchise superstar (e.g., Patrick Mahomes) is a trap. Instead, specifically target lower-ranked rookie QBs sitting behind aging "bridge" veterans (e.g., Geno Smith, Gardner Minshew). The path to the field is everything in Superflex.
* **Analyze Starter Requirements:** The positional scarcity of a league is entirely dependent on the starting lineup requirements printed by the `assistant.py` script. For example, if a league only requires 1 starting RB but 2 starting WRs and 2 FLEX spots, Running Backs are drastically devalued while Wide Receivers become premium assets. Always let the starting lineup size dictate your draft priorities.
* **TE Premium (TEP):** In leagues with a TE Premium (e.g., `bonus_rec_te = 1.0` combined with base PPR `rec = 1.0`), Tight Ends receive **2.0 points per catch**. Pass-catching tight ends become literal "cheat codes." An athletic TE drafted in the 2nd round of the NFL draft instantly vaults into priority 1st-round rookie status.
* **IDP Scoring Optimization:** Defensive scoring dictates your targets. In tackle-heavy formats, Middle Linebackers and "Box Safeties" provide the highest, safest floor. Forced Fumbles (FF), Interceptions, and Sacks provide massive spike weeks. Prioritize linebackers over defensive linemen unless the DL is an elite edge rusher.

## 2. Best Player Available (BPA) vs. Roster Need
* **Draft Capital is King:** Never draft for positional need in the 1st round of a rookie draft if it means reaching for a player with poor NFL draft capital. A 1st-round NFL Wide Receiver holds his dynasty trade value for at least two years. A 4th-round NFL Running Back can lose his job in training camp and instantly become worthless.
* **The Trade Pivot:** If your roster desperately needs a Running Back (e.g., relying on aging veterans), but the best player on the board is a 1st-Round WR (e.g., Omar Cooper), draft the elite WR. Hold them to build value and trade them for a proven, established Running Back later.
* **Do Not Drop Draft Picks:** Never drop a rookie (e.g., Garrett Nussmeier) immediately after drafting them. If you spend a rookie pick on a player, they deserve a roster spot through training camp to protect your investment.

## 3. IDP (Individual Defensive Player) Player Archetypes
* **Tackles > Coverage:** You want players involved in every play. Target Middle Linebackers and "Enforcer" Safeties who play close to the line of scrimmage. They rack up 100+ tackles a season.
* **Avoid Pure Cover Corners:** Elite real-life cornerbacks (like Sauce Gardner or Jermod McCoy) are often poor fantasy assets. Opposing quarterbacks actively refuse to throw the ball their way, leading to very few tackle or interception opportunities.
* **Turnover & Sack Upside:** Prioritize defensive players with a documented college history of Forced Fumbles (e.g., Emmanuel McNeil-Warren) or elite Sack production (e.g., David Bailey).

## 4. Waiver Wire, FAAB, & UDFA Philosophy
* **Protect Youth:** When calculating drops, explicitly protect young players (under 25 or `<= 2` years experience). Do not drop a highly drafted player just because of a volatile rookie year (e.g., Anthony Richardson).
* **Cut the Dead Weight:** Heavily penalize aging free agents (age 30+) who do not have a team (e.g., Russell Wilson). 
* **The UDFA Lottery:** Prioritize Undrafted Free Agent (UDFA) rookies who successfully landed on an active NFL roster over aging depth veterans. If comparing two UDFAs, always take the younger player (e.g., a 22-year-old TE over a 24-year-old TE) for the longer developmental window.
* **FAAB Bidding Rules:**
    * **10-15% FAAB:** Starting/Bridge QBs in Superflex on the waiver wire (e.g., Will Levis) if you *need* a starter.
    * **1-2% FAAB:** Starting/Bridge QBs in Superflex if your QB room is already deep. Stash them purely to trade later to a desperate team.
    * **0% FAAB:** Deep UDFA stashes (like Behren Morton or CJ Daniels). Let them sit at the end of your bench through camp for free.

## 5. College Production & Tool Integrations
* **Verify the Tape:** Always cross-reference Sleeper ADP with actual college stats and scouting reports.
* **Sports-Reference CFB Integration:** The `assistant.py` skill is hardcoded to generate a live, clickable URL for every rookie on the board to bypass anti-bot protections. 
    * **Format:** `https://www.sports-reference.com/cfb/search/search.fcgi?search={player_name}`
    * **Use Case:** Click this link during the draft to verify a player's exact college production (Yards, Touchdowns, Tackles, Forced Fumbles) before committing a pick.
* **Athletic Profile Checks:** Look for physical anomalies (e.g., a 4.33-second 40-yard dash, or a 45.5-inch vertical jump) that suggest high ceilings. Conversely, penalize players with major medical red flags (e.g., multiple ACL tears, failed physicals).

## 6. Opportunity vs. Talent (Live Depth Chart Analysis)
* **Never Assume the Depth Chart:** NFL rosters turnover drastically year-over-year. Assuming a player has an open path because of outdated knowledge (e.g., assuming Austin Ekeler is still starting) is a massive mistake. **Always pull the live depth chart data directly from Sleeper.**
* **The "Full Depth Chart" Feature:** The `assistant.py` tool has been updated to parse the live Sleeper database and print out the *entire positional depth chart* for the team drafting the rookie. It displays as `Full [TEAM] [POS] Depth Chart: 1: [Player A] | 2: [Player B] | UNK: [Rookie]`.
* **Assess the True Obstacles:** When you see the full depth chart, look at the players listed at String 1 and 2. Are they aging veterans on expiring contracts? Are they injury-prone? Or are they recently drafted superstars (like Ashton Jeanty)? If a rookie is blocked by a young superstar, they drop from a "target" to a "handcuff." 
* **The Taxi Squad Exception (WRs):** Do not overly penalize elite Wide Receiver talent just because they land in a crowded Year 1 depth chart. Wide Receivers are the ultimate "Taxi Squad Hold." You are drafting them for their Year 2 or Year 3 breakout. If you believe in the raw talent, draft them over low-ceiling depth pieces.
* **Rookie Anomalies:** Remember that rookies often show up as `String: UNK` before training camp. Focus entirely on the talent of the players sitting at strings 1, 2, and 3 ahead of them.
