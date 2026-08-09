from math import floor
import field_map as f
import quest_builder as qb

def convert_story_event_single_quest(obj):
    return qb.convert_3level_with_story(obj, f.TYPE_MAP['story_event_single_quest']['layout'])



def convert_challenge_dungeon_event_quest(obj):
    return qb.convert_3level(obj, f.TYPE_MAP['challenge_dungeon_event_quest']['layout'])



def convert_expert_single_event_quest(obj):
    return qb.convert_3level_with_event(obj, f.TYPE_MAP['expert_single_event_quest']['layout'], event_field_name='eventId')



def convert_score_attack_event_quest(obj):
    converted = {}
    for event_id, folders in obj.items():
        for folder_id, wrapper in folders.items():
            if isinstance(wrapper, list):
                for quest in wrapper:
                    if not isinstance(quest, list) or len(quest) < 90:
                        continue
                    qid = quest[0]
                    # Boss-only quests (10xx) have no rank times
                    if len(quest) <= 85 or quest[85] == '' or quest[85] == '(None)':
                        converted[qid] = {
                            "name": "",
                            "clearRewardId": 1
                        }
                    else:
                        converted[qid] = {
                            "name": "",
                            "clearRewardId": 1,
                            "sPlusRewardId": 1,
                            "bRankTime": floor(float(quest[85]) * 1000),
                            "aRankTime": floor(float(quest[86]) * 1000),
                            "sRankTime": floor(float(quest[87]) * 1000),
                            "sPlusRankTime": floor(float(quest[88]) * 1000),
                            "rankPointReward": int(float(quest[92])) if len(quest) > 92 and quest[92] != '' else 0,
                            "characterExpReward": int(float(quest[93])) if len(quest) > 93 and quest[93] != '' else 0,
                            "manaReward": int(float(quest[94])) if len(quest) > 94 and quest[94] != '' else 0,
                            "poolExpReward": int(float(quest[95])) if len(quest) > 95 and quest[95] != '' else 0
                        }
                        if len(quest) > 70 and quest[70] != '' and quest[70] != '(None)':
                            converted[qid]["scoreRewardGroupId"] = int(quest[70])
                        converted[qid]["folderId"] = int(folder_id)
                        converted[qid]["eventId"] = int(event_id)
    return converted

