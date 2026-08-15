# Fantasy Sports Assistant Rules

## Rookie Drafts
- **Always check real-life Draft Capital:** When the user asks for advice during a Dynasty Rookie Draft (NFL or NBA), you MUST use the `search_web` tool to verify the actual real-life draft position (round and pick number) of the top available rookies before making any recommendations.
- **Never rely solely on Sleeper data:** Sleeper's internal `search_rank` or player data often lacks immediate post-draft capital information. Do not blindly recommend players based on their API data without verifying their real-world draft status.
