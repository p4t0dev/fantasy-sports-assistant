import json
from sleeper_api import get_user, get_drafts_for_user

user = get_user("p4t0b4ll3rs")
user_id = user["user_id"]
drafts = get_drafts_for_user(user_id)
print(json.dumps(drafts, indent=2))
