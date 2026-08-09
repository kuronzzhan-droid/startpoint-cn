def convert_score_attack_border_reward(obj):
    """Maps (event_id, folder_id) to score borders and their first item reward."""
    lookup = {}
    for reward_id, entries in obj.items():
        if not isinstance(entries, list) or not entries:
            continue
        row = entries[0]
        event_id = row[1]
        folder_id = row[2]
        try:
            score = int(float(str(row[4])))
        except:
            score = 0
        # row[5] is reason_id, not an item ID. The first reward tuple is
        # (kind, kind_id, number) at rows 6..8.
        reward_kind = row[6] if len(row) > 6 else '(None)'
        coin_item_id = int(row[7]) if reward_kind == '0' and row[7] not in ('', '(None)') else 0
        coin_count = int(row[8]) if reward_kind == '0' and row[8] not in ('', '(None)') else 0
        tier = {
            'rewardId': int(reward_id),
            'score': score,
            'coinItemId': coin_item_id,
            'coinCount': coin_count
        }
        key = f'{event_id}_{folder_id}'
        if key not in lookup:
            lookup[key] = []
        lookup[key].append(tier)
    # Sort each key's tiers by score ascending (lowest score threshold first)
    for key in lookup:
        lookup[key].sort(key=lambda t: t['score'])
    return lookup

