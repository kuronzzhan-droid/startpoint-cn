#!/usr/bin/env python3
"""Patch the audited current client sources with the Rush leaderboard UI.

The patch is deliberately anchored to classes freshly exported from the
authoritative APK.  The global terms-of-service loader and remote are checked
but left byte-identical; the ranking uses a dedicated Rush-event endpoint.
"""
from __future__ import annotations

import argparse
import hashlib
import os
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Callable


class PatchError(RuntimeError):
    pass


@dataclass(frozen=True)
class Target:
    class_name: str
    relative: Path
    baseline_sha256: str
    patcher: Callable[[str], str] | None


def sha256_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise PatchError(f"{label}: expected one anchor, found {count}")
    return text.replace(old, new, 1)


def patch_event_rush_reward_remote(text: str) -> str:
    text = replace_once(
        text,
        '         startUserRequest("event/rush/reward",{"event_id":param3},successHandler);',
        '         startUserRequest(param3 < 0 ? "event/rush/leaderboard" : "event/rush/reward",{"event_id":param3 < 0 ? -param3 : param3},successHandler);',
        "Rush leaderboard endpoint isolation",
    )
    old = '''         _loc2_ = param1.rawData.data;
         var _loc3_:* = _loc2_.rank_number;'''
    new = '''         _loc2_ = param1.rawData.data;
         if(_loc2_.rows != null)
         {
            dispatcher.instant(EventRushRewardRemoteInput.Finished(_loc2_),{
               "fileName":"pinball/remote/event/rush/reward/EventRushRewardRealRemote.hx",
               "lineNumber":53,
               "className":"pinball.remote.event.rush.reward.EventRushRewardRealRemote",
               "methodName":"successHandler"
            });
            return;
         }
         var _loc3_:* = _loc2_.rank_number;'''
    return replace_once(text, old, new, "Rush reward remote ranking passthrough")


def patch_top_scene(text: str) -> str:
    text = replace_once(
        text,
        "   import pinball.scene.event.rush.RushEventSceneTools;\n",
        "   import pinball.scene.event.rush.RushEventSceneTools;\n"
        "   import pinball.scene.event.rush.ranking.party.RushEventRankingPartyMode;\n",
        "top scene import",
    )
    text = replace_once(
        text,
        "buttonGroup = new ButtonGroupLogic(buttonClicked,[0,1,2,3,4]);",
        "buttonGroup = new ButtonGroupLogic(buttonClicked,[0,1,2,3,4,5]);",
        "top scene button kinds",
    )
    text = replace_once(
        text,
        "         buttonGroup.get(3).set_enabled(2);\n",
        "         buttonGroup.get(3).set_enabled(2);\n"
        "         buttonGroup.get(5).set_enabled(1);\n",
        "top scene ranking enable",
    )
    old = '''               }
         }
      }
   }
}'''
    new = '''               }
               break;
            case 5:
               changeSceneFromLoadingTask(ChangeSceneNextKind.Scene(SceneKind.RushEventRankingParty(eventId,RushEventRankingPartyMode.RushBattle(-1),Option.None)));
               return;
         }
      }
   }
}'''
    return replace_once(text, old, new, "top scene ranking navigation")


def patch_top_view(text: str) -> str:
    old = '''         _loc4_.addWithConfig(4,_loc2_.getButtonLayer(4,2),_loc2_.buttonSize,ButtonConfigs.rushEventEndlessBattle);
'''
    new = old + '''         _loc4_.addWithConfig(5,_loc2_.getButtonLayer(3,1),_loc2_.buttonSize,ButtonConfigs.ranking);
'''
    return replace_once(text, old, new, "top view ranking button")


def patch_list_view(text: str) -> str:
    old = '''      override public function createListCell(param1:int, param2:Object) : VerticalListCellView
      {
         var _loc3_:* = param2;
         return new RushEventRankingPartyListCellView();
      }'''
    new = '''      override public function createListCell(param1:int, param2:Object) : VerticalListCellView
      {
         var _loc3_:* = param2;
         var _loc4_:RushEventRankingPartyListCellView = new RushEventRankingPartyListCellView();
         _loc4_.config.height = param2 != null && param2.rank != null ? 204 : 329;
         return _loc4_;
      }'''
    return replace_once(text, old, new, "ranking list cell height")


def patch_party_view(text: str) -> str:
    text = replace_once(
        text,
        "   import pinball.ui.component.button.ButtonGroupView;\n",
        "   import pinball.ui.component.button.ButtonGroupView;\n"
        "   import pinball.ui.component.button.config.ButtonConfigs;\n"
        "   import pinball.ui.component.list.core.VerticalListViewConfigPreset;\n",
        "party view button/list imports",
    )
    text = replace_once(
        text,
        "   import pinball.ui.component.template.MenuSceneTemplateView;\n",
        "   import pinball.ui.component.template.MenuSceneTemplateView;\n"
        "   import pinball.ui.display.UiDisplayObjectContainer;\n",
        "party view display import",
    )
    old = '''         partyListView = new RushEventRankingPartyListView(peek.getPartyList(),_loc1_.listLayer);
         gear.addChild(partyListView,{'''
    new = '''         partyListView = new RushEventRankingPartyListView(peek.getPartyList(),_loc1_.listLayer);
         if(peek.mode.index == 0 && int(peek.mode.params[0]) < 0)
         {
            partyListView.config = VerticalListViewConfigPreset.rushRanking();
            partyListView.pagerConfig = partyListView.config.pager.params[0];
         }
         gear.addChild(partyListView,{'''
    text = replace_once(text, old, new, "party view ranking list preset")
    old = '''         _loc1_.setupForListOnlyLayout(partyListView);
      }'''
    new = '''         _loc1_.setupForListOnlyLayout(partyListView);
         if(peek.mode.index == 0 && int(peek.mode.params[0]) < 0)
         {
            var _loc2_:UiDisplayObjectContainer = _loc1_.uiProvider.build({
               "assetPath":"scene/rush/rush_event_ranking",
               "name":"container/button"
            });
            _loc2_.x = safeArea.x + 94;
            _loc2_.y = safeArea.height - 237;
            _loc1_.passContentLayer.addChild(_loc2_);
            buttonGroupView.addWithConfig(1,_loc2_,_loc2_.getGuideRectangle("area"),ButtonConfigs.raidMyRanking);
            _loc2_ = _loc1_.uiProvider.build({
               "assetPath":"scene/rush/rush_event_ranking",
               "name":"container/button"
            });
            _loc2_.x = safeArea.x + safeArea.width - 97;
            _loc2_.y = safeArea.height - 237;
            _loc1_.passContentLayer.addChild(_loc2_);
            buttonGroupView.addWithConfig(2,_loc2_,_loc2_.getGuideRectangle("area"),ButtonConfigs.rushReward);
            partyListView.config.listPadding.top = 204;
            var _loc3_:UiDisplayObjectContainer = _loc1_.uiProvider.build({
               "assetPath":"scene/rush/rush_event_ranking",
               "name":"container/time_range_layer"
            });
            _loc3_.x = safeArea.x + 540;
            _loc3_.y = 104;
            _loc1_.passContentLayer.addChild(_loc3_);
            peek.allPartyListData.b = _loc3_;
         }
      }'''
    return replace_once(text, old, new, "party view ranking controls")


def patch_cell_view(text: str) -> str:
    text = replace_once(
        text,
        "   import flash.geom.Rectangle;\n",
        "   import flash.geom.Rectangle;\n"
        "   import haxe.ds.Option;\n",
        "ranking cell Option import",
    )
    text = replace_once(
        text,
        "   import jp.sipo.gipo.core.GearHolderImpl;\n",
        "   import jp.sipo.gipo.core.GearHolderImpl;\n"
        "   import pinball.asset.AssetGroupKind;\n"
        "   import pinball.common.tools._FunctionTools.BindImpl2_0;\n",
        "ranking cell asset imports",
    )
    old = '''      public function run() : void
      {
         foregroundLayout = uiProvider.build({
            "assetPath":"scene/rush/rush_event_ranking_party",
            "name":"layout/party_list_cell"
         });
         extraButtonLayer.addChild(foregroundLayout);
      }'''
    new = '''      public function run() : void
      {
         if(scenePeek.mode.index == 0 && int(scenePeek.mode.params[0]) < 0)
         {
            foregroundLayout = uiProvider.build({
               "assetPath":"scene/rush/rush_event_ranking",
               "name":"layout/list_cell"
            });
            extraButtonLayer.touchable = false;
         }
         else
         {
            foregroundLayout = uiProvider.build({
               "assetPath":"scene/rush/rush_event_ranking_party",
               "name":"layout/party_list_cell"
            });
         }
         extraButtonLayer.addChild(foregroundLayout);
      }'''
    text = replace_once(text, old, new, "ranking cell layout")
    old = '''      public function resizeWidth(param1:Number) : void
      {
         foregroundLayout.getContainer("right_align",{'''
    new = '''      public function resizeWidth(param1:Number) : void
      {
         if(scenePeek.mode.index == 0 && int(scenePeek.mode.params[0]) < 0)
         {
            return;
         }
         foregroundLayout.getContainer("right_align",{'''
    text = replace_once(text, old, new, "ranking cell fixed width")
    old = '''      public function apply(param1:int, param2:Object) : void
      {
         var _loc3_:int = 0;
         var _loc4_:int = 0;'''
    new = '''      public function apply(param1:int, param2:Object) : void
      {
         if(scenePeek.mode.index == 0 && int(scenePeek.mode.params[0]) < 0)
         {
            if(!param2.p)
            {
               foregroundLayout.getText("ranking_rank").set_text(param2.rank);
               foregroundLayout.getText("player_rank").set_text(param2.level);
               foregroundLayout.getText("user_name").set_text(param2.name);
               foregroundLayout.getText("kill_count").set_text(param2.count);
               foregroundLayout.getText("best_score").set_text(param2.time);
               foregroundLayout.getImage("rank_label").visible = param2.visible;
               var _loc3_:* = foregroundLayout.getContainer("party_thumbnails").getContainer("thumbnail000").getImage("image");
               _loc3_.changeTexture(Option.None);
               var _loc4_:* = param2.a;
               if(_loc4_ != null)
               {
                  view.asset.setTexture(AssetGroupKind.CharacterFaceThumbnail,_loc4_,new BindImpl2_0(apply,0,{
                     "p":_loc4_,
                     "r":param2.rank
                  }).execute);
               }
               _loc3_ = foregroundLayout.getContainer("party_thumbnails").getContainer("thumbnail001").getImage("image");
               _loc3_.changeTexture(Option.None);
               _loc4_ = param2.b;
               if(_loc4_ != null)
               {
                  view.asset.setTexture(AssetGroupKind.CharacterFaceThumbnail,_loc4_,new BindImpl2_0(apply,1,{
                     "p":_loc4_,
                     "r":param2.rank
                  }).execute);
               }
               _loc3_ = foregroundLayout.getContainer("party_thumbnails").getContainer("thumbnail002").getImage("image");
               _loc3_.changeTexture(Option.None);
               _loc4_ = param2.c;
               if(_loc4_ != null)
               {
                  view.asset.setTexture(AssetGroupKind.CharacterFaceThumbnail,_loc4_,new BindImpl2_0(apply,2,{
                     "p":_loc4_,
                     "r":param2.rank
                  }).execute);
               }
               return;
            }
            if(gear.checkPhaseBeforeDispose() && foregroundLayout.getText("ranking_rank").get_text() == param2.r)
            {
               _loc3_ = param1 != 1 ? (param1 != 2 ? "thumbnail000" : "thumbnail002") : "thumbnail001";
               foregroundLayout.getContainer("party_thumbnails").getContainer(_loc3_).getImage("image").changeTexture(Option.Some(view.asset.getTexture(param2.p)));
            }
            return;
         }
         _loc3_ = 0;
         _loc4_ = 0;'''
    return replace_once(text, old, new, "ranking cell data binding")


def patch_party_scene(text: str) -> str:
    text = replace_once(
        text,
        "   import pinball.common.tools._FunctionTools.BindImpl3_0;\n",
        "   import pinball.common.tools._FunctionTools.BindImpl3_0;\n"
        "   import pinball.context.SectionCommand;\n"
        "   import pinball.context.remote.real.RealRemote;\n"
        "   import pinball.remote.event.rush.reward.EventRushRewardRealRemote;\n",
        "party scene remote import",
    )
    text = replace_once(
        text,
        "   import pinball.ui.component.button.ButtonGroupPeek;\n",
        "   import pinball.ui.component.button.ButtonGroupPeek;\n"
        "   import pinball.ui.component.list.core.VerticalListPagerConfig;\n",
        "party scene pager import",
    )
    old = '''         partyList = new RushEventRankingPartyListLogic(allPartyListData);
         gear.addChild(partyList,{'''
    new = '''         partyList = new RushEventRankingPartyListLogic(allPartyListData);
         if(mode.index == 0 && int(mode.params[0]) < 0)
         {
            partyList.pagerConfig = VerticalListPagerConfig.Set(100);
         }
         gear.addChild(partyList,{'''
    text = replace_once(text, old, new, "party scene ranking pager")
    text = replace_once(
        text,
        "         partyList.set_cellSelectedBehavior(0);",
        "         partyList.set_cellSelectedBehavior(0);\n"
        "         if(mode.index == 0 && int(mode.params[0]) < 0)\n"
        "         {\n"
        "            partyList.addSelectHandler(copyPlayedParty);\n"
        "         }",
        "party scene pager click behavior",
    )
    old = '''         allPartyListData = _loc3_;
         var _loc4_:Array = [];'''
    new = '''         if(mode.index == 0 && int(mode.params[0]) < 0)
         {
            allPartyListData = [];
         }
         else
         {
            allPartyListData = _loc3_;
         }
         var _loc4_:Array = mode.index == 0 && int(mode.params[0]) < 0 ? [1,2] : [];'''
    text = replace_once(text, old, new, "party scene ranking initialization")

    old = '''      public function copyPlayedParty(param1:Object) : void
      {
         var _loc3_:* = null as PartyGroupSource;
         var _loc2_:Option = event.getPartyGroupSource();'''
    new = '''      public function copyPlayedParty(param1:Object) : void
      {
         var _loc3_:* = null as PartyGroupSource;
         var _loc2_:* = null;
         if(mode.index == 0 && int(mode.params[0]) < 0)
         {
            if(param1 == null)
            {
               return;
            }
            if("id" in param1)
            {
               if(Number(param1.id) > 0)
               {
                  changeSceneWithLoading(LoadingTaskKind.ProfileGetProfile(Number(param1.id)),ChangeSceneBackKind.AddCurrent);
               }
               return;
            }
            var _loc20_:* = param1.params[0];
            var _loc21_:* = _loc20_.rows;
            if(_loc21_ != null)
            {
               partyList.set_cellSelectedBehavior(1);
               partyList.abstractAdapter.appendAll(_loc21_);
               allPartyListData.item = _loc20_.item;
               allPartyListData.page = int(_loc20_.page);
               allPartyListData.row = int(_loc20_.row);
               allPartyListData.index = int(_loc20_.index);
               allPartyListData.total = int(_loc20_.total);
               allPartyListData.reward = _loc20_.reward;
               allPartyListData.name = _loc20_.name == null ? "连战" : Std.string(_loc20_.name);
               allPartyListData.enabled = _loc20_.enabled == null ? true : Boolean(_loc20_.enabled);
               var _loc24_:String = "<h2>" + Std.string(allPartyListData.name) + " 排行报酬</h2>";
               var _loc25_:* = _loc20_.reward;
               if(_loc25_ == null || int(_loc25_.length) == 0)
               {
                  _loc24_ += "<p>暂无报酬配置。</p>";
               }
               else
               {
                  var _loc26_:int = 0;
                  while(_loc26_ < int(_loc25_.length))
                  {
                     var _loc27_:* = _loc25_[_loc26_++];
                     var _loc28_:int = int(_loc27_.fromRank);
                     var _loc29_:* = _loc27_.toRank;
                     var _loc30_:String = _loc29_ == null ? "第" + Std.string(_loc28_) + "名起" : (int(_loc29_) == _loc28_ ? "第" + Std.string(_loc28_) + "名" : "第" + Std.string(_loc28_) + "～" + Std.string(_loc29_) + "名");
                     var _loc31_:String = "";
                     if(_loc27_.itemName != null && int(_loc27_.itemCount) > 0)
                     {
                        _loc31_ = Std.string(_loc27_.itemName) + " × " + Std.string(_loc27_.itemCount);
                     }
                     if(_loc27_.degreeName != null)
                     {
                        if(_loc31_ != "")
                        {
                           _loc31_ += " + ";
                        }
                        _loc31_ += "称号「" + Std.string(_loc27_.degreeName) + "」";
                     }
                     _loc24_ += "<p><b>" + _loc30_ + "</b>　" + _loc31_ + "</p>";
                  }
                  _loc24_ += "<p>排行榜按完整通关的战斗计时总和升序排列，每位玩家只保留最佳成绩。</p>";
               }
               allPartyListData.rewardText = _loc24_;
               if(allPartyListData.item != null && int(allPartyListData.row) < 0)
               {
                  allPartyListData.page = int(Math.floor(int(allPartyListData.length) / 100 + 1e-10));
                  allPartyListData.row = int(allPartyListData.length % 100);
                  partyList.abstractAdapter.append(allPartyListData.item);
               }
               var _loc22_:* = allPartyListData.b;
               if(_loc22_ != null)
               {
                  _loc22_.getText("text").set_text(Std.string(_loc20_.time) + " / 共" + Std.string(allPartyListData.total) + "人");
               }
               var _loc23_:* = viewSceneOrder as RushEventRankingPartyView;
               if(_loc23_ != null)
               {
                  _loc23_.partyListView.reload();
               }
            }
            return;
         }
         _loc2_ = event.getPartyGroupSource();'''
    text = replace_once(text, old, new, "party scene native payload")
    old = '''      public function buttonClicked(param1:int) : void
      {
         var _loc6_:* = null;'''
    new = '''      public function buttonClicked(param1:int) : void
      {
         if(mode.index == 0 && int(mode.params[0]) < 0)
         {
            if(param1 == 1)
            {
               if(allPartyListData.item == null)
               {
                  showInstantMessage("暂无个人排名",InstantMessagePosition.Center);
                  return;
               }
               partyList.changePage(int(allPartyListData.page));
               partyList.scrollTo(int(allPartyListData.row));
               return;
            }
            if(param1 == 2)
            {
               var _loc20_:String = "<html><body>" + (allPartyListData.rewardText == null ? "<h2>" + (allPartyListData.name == null ? "连战" : Std.string(allPartyListData.name)) + " 排行报酬</h2><p>暂无报酬配置。</p>" : Std.string(allPartyListData.rewardText)) + "</body></html>";
               changeSceneWithDetail(ChangeSceneNextKind.Scene(SceneKind.RichTextData("quest_detail_reward",_loc20_)),ChangeSceneBackKind.AddCurrent);
            }
            return;
         }
         var _loc6_:* = null;'''
    text = replace_once(text, old, new, "party scene native buttons")
    old = '''      public function afterTransition() : void
      {
         var _loc1_:Option = dialogEquipmentId;'''
    new = '''      public function afterTransition() : void
      {
         if(mode.index == 0 && int(mode.params[0]) < 0)
         {
            partyList.preventsShowEmptyStatePlaceholder = true;
            if(int(allPartyListData.length) == 0)
            {
               var _loc20_:* = serviceLauncher;
               var _loc21_:* = gear;
               if(_loc20_.hookDispatcherProvider.isAlive())
               {
                  var _loc22_:* = _loc20_.hookDispatcherProvider.createHookDispatcher(copyPlayedParty,SectionCommand.EventRushRewardRemote);
                  _loc21_.addChild(_loc22_,{
                     "fileName":"pinball/dialog/processing/ServiceLauncher.hx",
                     "lineNumber":36,
                     "className":"pinball.dialog.processing.ServiceLauncher",
                     "methodName":"startService"
                  });
                  new EventRushRewardRealRemote(remote as RealRemote,_loc22_,-eventId);
               }
            }
         }
         var _loc1_:Option = dialogEquipmentId;'''
    return replace_once(text, old, new, "party scene ranking request")


BASE = Path("scripts") / "pinball"
TARGETS = (
    Target(
        "pinball.loading.termsOfService.TermsOfServiceLoadingTask",
        BASE / "loading" / "termsOfService" / "TermsOfServiceLoadingTask.as",
        "e3bb6eede5b4362dd241acc6fe38a13fbbf5e96cba1de2a953557e89dad625fe",
        None,
    ),
    Target(
        "pinball.remote.tool.agreement.ToolAgreementRealRemote",
        BASE / "remote" / "tool" / "agreement" / "ToolAgreementRealRemote.as",
        "79b08b8182f92a44d5d31478555e9f0e9b690f7dd81a0dfeb1db1cd94f9c6caf",
        None,
    ),
    Target(
        "pinball.remote.event.rush.reward.EventRushRewardRealRemote",
        BASE / "remote" / "event" / "rush" / "reward" / "EventRushRewardRealRemote.as",
        "8585107afc536a1e54ff90e49d982b84a94485c141d81cc8c5feb16f8b66eccb",
        patch_event_rush_reward_remote,
    ),
    Target(
        "pinball.scene.event.rush.ranking.party.RushEventRankingPartyScene",
        BASE / "scene" / "event" / "rush" / "ranking" / "party" / "RushEventRankingPartyScene.as",
        "1631a1314490f8bc8038da278f98f3dc7424872cd1a774a6f0b583bf5f65d218",
        patch_party_scene,
    ),
    Target(
        "pinball.scene.event.rush.ranking.party.RushEventRankingPartyView",
        BASE / "scene" / "event" / "rush" / "ranking" / "party" / "RushEventRankingPartyView.as",
        "a7101be010e35f2b8061dfa968b2ec804ee0bc769b2600ac82544b78e55cd18b",
        patch_party_view,
    ),
    Target(
        "pinball.scene.event.rush.ranking.party.list.RushEventRankingPartyListView",
        BASE / "scene" / "event" / "rush" / "ranking" / "party" / "list" / "RushEventRankingPartyListView.as",
        "7580cbcec18bd6f0398fa9c6b90ef2380f42035ea9843ba7f8d8c4c34bd8d781",
        patch_list_view,
    ),
    Target(
        "pinball.scene.event.rush.ranking.party.list.cell._RushEventRankingPartyListCellView.RushEventRankingPartyListCellContentView",
        BASE / "scene" / "event" / "rush" / "ranking" / "party" / "list" / "cell" / "_RushEventRankingPartyListCellView" / "RushEventRankingPartyListCellContentView.as",
        "5df9272ea472a70ed9a10712357e0ef5921fc15deaa675a8e8a7e69062ca3f1e",
        patch_cell_view,
    ),
    Target(
        "pinball.scene.event.rush.top.RushEventTopScene",
        BASE / "scene" / "event" / "rush" / "top" / "RushEventTopScene.as",
        "d3624ed5b31237cbc446e69b55ad617278692e8272ae23c540daad9c5986c57c",
        patch_top_scene,
    ),
    Target(
        "pinball.scene.event.rush.top.RushEventTopView",
        BASE / "scene" / "event" / "rush" / "top" / "RushEventTopView.as",
        "f559f32d8a33fad9d5ec08cd9bf060d716f69887607cf18aeffc27b186f94ef6",
        patch_top_view,
    ),
)

# Only these existing method bodies may move from the temporary full-class
# carrier into the authoritative SWF. Constructors use the explicit sentinel
# understood by FindMethodBody.java; no method, field, or signature is added.
METHOD_PATCHES = (
    ("pinball.remote.event.rush.reward.EventRushRewardRealRemote", "<constructor>"),
    ("pinball.remote.event.rush.reward.EventRushRewardRealRemote", "successHandler"),
    ("pinball.scene.event.rush.ranking.party.RushEventRankingPartyScene", "run"),
    ("pinball.scene.event.rush.ranking.party.RushEventRankingPartyScene", "preparation"),
    ("pinball.scene.event.rush.ranking.party.RushEventRankingPartyScene", "copyPlayedParty"),
    ("pinball.scene.event.rush.ranking.party.RushEventRankingPartyScene", "buttonClicked"),
    ("pinball.scene.event.rush.ranking.party.RushEventRankingPartyScene", "afterTransition"),
    ("pinball.scene.event.rush.ranking.party.RushEventRankingPartyView", "run"),
    ("pinball.scene.event.rush.ranking.party.list.RushEventRankingPartyListView", "createListCell"),
    (
        "pinball.scene.event.rush.ranking.party.list.cell."
        "_RushEventRankingPartyListCellView.RushEventRankingPartyListCellContentView",
        "run",
    ),
    (
        "pinball.scene.event.rush.ranking.party.list.cell."
        "_RushEventRankingPartyListCellView.RushEventRankingPartyListCellContentView",
        "resizeWidth",
    ),
    (
        "pinball.scene.event.rush.ranking.party.list.cell."
        "_RushEventRankingPartyListCellView.RushEventRankingPartyListCellContentView",
        "apply",
    ),
    ("pinball.scene.event.rush.top.RushEventTopScene", "run"),
    ("pinball.scene.event.rush.top.RushEventTopScene", "buttonClicked"),
    ("pinball.scene.event.rush.top.RushEventTopView", "run"),
)


def verify_target(target: Target, text: str, *, patched: bool) -> None:
    if f"public class {target.relative.stem}" not in text:
        raise PatchError(f"class declaration is missing: {target.class_name}")
    if target.patcher is None:
        if "ranking_ranking_tab_total_ranking" in text:
            raise PatchError("global TermsOfService loader must remain unrelated to ranking")
        return
    if not patched:
        return
    shared = {
        "pinball.remote.event.rush.reward.EventRushRewardRealRemote": (
            'param3 < 0 ? "event/rush/leaderboard" : "event/rush/reward"',
            "EventRushRewardRemoteInput.Finished(_loc2_)",
            "if(_loc2_.rows != null)",
        ),
        "pinball.scene.event.rush.ranking.party.RushEventRankingPartyScene": (
            "VerticalListPagerConfig.Set(100)",
            "partyList.addSelectHandler(copyPlayedParty)",
            "partyList.set_cellSelectedBehavior(0)",
            'if("id" in param1)',
            "if(Number(param1.id) > 0)",
            "LoadingTaskKind.ProfileGetProfile(Number(param1.id))",
            "allPartyListData.item = _loc20_.item",
            "allPartyListData.reward = _loc20_.reward",
            "allPartyListData.name = _loc20_.name == null",
            "allPartyListData.enabled = _loc20_.enabled == null",
            "allPartyListData.total = int(_loc20_.total)",
            "allPartyListData.rewardText = _loc24_",
            "partyList.scrollTo(int(allPartyListData.row))",
            '"<html><body>" + (allPartyListData.rewardText == null',
            ' + "</body></html>"',
            "SceneKind.RichTextData(\"quest_detail_reward\"",
            "SectionCommand.EventRushRewardRemote",
            "new EventRushRewardRealRemote(remote as RealRemote,_loc22_,-eventId)",
        ),
        "pinball.scene.event.rush.ranking.party.RushEventRankingPartyView": (
            "VerticalListViewConfigPreset.rushRanking()",
            "ButtonConfigs.raidMyRanking",
            "ButtonConfigs.rushReward",
            "container/time_range_layer",
        ),
        "pinball.scene.event.rush.ranking.party.list.RushEventRankingPartyListView": (
            "param2.rank != null ? 204 : 329",
        ),
        "pinball.scene.event.rush.ranking.party.list.cell._RushEventRankingPartyListCellView.RushEventRankingPartyListCellContentView": (
            "scene/rush/rush_event_ranking",
            "extraButtonLayer.touchable = false",
            "ranking_rank",
            "AssetGroupKind.CharacterFaceThumbnail",
        ),
        "pinball.scene.event.rush.top.RushEventTopScene": (
            "RushEventRankingPartyMode.RushBattle(-1)",
            "buttonClicked,[0,1,2,3,4,5]",
            "buttonGroup.get(5).set_enabled(1)",
            "changeSceneFromLoadingTask(ChangeSceneNextKind.Scene(SceneKind.RushEventRankingParty",
        ),
        "pinball.scene.event.rush.top.RushEventTopView": (
            "ButtonConfigs.ranking",
        ),
    }
    for needle in shared[target.class_name]:
        if needle not in text:
            raise PatchError(f"patched semantic is missing in {target.class_name}: {needle}")
    if target.class_name.endswith("RushEventRankingPartyScene") and "LoadingTaskKind.TermsOfService" in text:
        raise PatchError("ranking reward must not hijack TermsOfService loading")
    if (
        target.class_name.endswith("RushEventTopScene")
        and "changeSceneWithLoading(ChangeSceneNextKind.Scene(" in text
    ):
        raise PatchError("ranking navigation passed ChangeSceneNextKind to LoadingTaskKind")


def atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        mode="w",
        encoding="utf-8",
        newline="\r\n",
        dir=path.parent,
        prefix=f".{path.name}.",
        suffix=".tmp",
        delete=False,
    ) as handle:
        temporary = Path(handle.name)
        handle.write(text)
        handle.flush()
        os.fsync(handle.fileno())
    try:
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def patch_tree(source_root: Path, output_root: Path) -> list[dict]:
    if output_root.exists() and any(output_root.iterdir()):
        raise PatchError(f"output root must be absent or empty: {output_root}")
    report: list[dict] = []
    for target in TARGETS:
        source = source_root / target.relative
        if not source.is_file():
            raise PatchError(f"exported source is missing: {source}")
        raw = source.read_bytes()
        source_hash = sha256_bytes(raw)
        if source_hash != target.baseline_sha256:
            raise PatchError(
                f"authoritative source drifted for {target.class_name}: {source_hash}"
            )
        text = raw.decode("utf-8-sig").replace("\r\n", "\n").replace("\r", "\n")
        verify_target(target, text, patched=False)
        output_text = target.patcher(text) if target.patcher is not None else text
        verify_target(target, output_text, patched=target.patcher is not None)
        destination = output_root / target.relative
        atomic_write(destination, output_text)
        output_hash = sha256_bytes(destination.read_bytes())
        report.append({
            "class_name": target.class_name,
            "source_sha256": source_hash,
            "output_sha256": output_hash,
            "changed": target.patcher is not None,
        })
    return report


def verify_tree(root: Path, *, require_baseline_terms: bool = True) -> None:
    for target in TARGETS:
        path = root / target.relative
        if not path.is_file():
            raise PatchError(f"verified source is missing: {path}")
        text = path.read_text(encoding="utf-8-sig")
        verify_target(target, text, patched=target.patcher is not None)
        if require_baseline_terms and target.patcher is None:
            if sha256_bytes(path.read_bytes()) != target.baseline_sha256:
                raise PatchError("TermsOfService loader did not remain byte-identical")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path)
    parser.add_argument("--output-root", type=Path)
    parser.add_argument("--verify-root", type=Path)
    args = parser.parse_args()
    if args.verify_root is not None:
        if args.source_root is not None or args.output_root is not None:
            raise PatchError("--verify-root cannot be combined with patch arguments")
        verify_tree(args.verify_root.resolve(), require_baseline_terms=False)
        print(f"[OK] verified Rush leaderboard client sources: {args.verify_root.resolve()}")
        return 0
    if args.source_root is None or args.output_root is None:
        parser.error("--source-root and --output-root are required together")
    report = patch_tree(args.source_root.resolve(), args.output_root.resolve())
    print(f"[OK] patched {sum(item['changed'] for item in report)} classes; checked {len(report)}")
    for item in report:
        print(
            f"{item['class_name']} changed={item['changed']} "
            f"sha256={item['output_sha256']}"
        )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (PatchError, OSError, UnicodeError) as error:
        print(f"[ERROR] {error}", file=sys.stderr)
        raise SystemExit(2)
