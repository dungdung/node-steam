var Steam = require('../steam_client');
var SteamID = require('../steamID');

var EMsg = Steam.EMsg;
var schema = Steam.Internal;

var protoMask = 0x80000000;


// Methods

var prototype = Steam.SteamClient.prototype;

prototype.setPersonaName = function(name) {
  this._send(EMsg.ClientChangeStatus | protoMask, new schema.CMsgClientChangeStatus({
    personaState: this._personaState,
    playerName: name
  }).toBuffer());
};

prototype.setPersonaState = function(state) {
  this._personaState = state;
  this._send(EMsg.ClientChangeStatus | protoMask, new schema.CMsgClientChangeStatus({
    personaState: state
  }).toBuffer());
};

prototype.sendMessage = function(target, message, type) {
  target = new SteamID(target);
  type = type || Steam.EChatEntryType.ChatMsg;
  
  var payload = new Buffer(Buffer.byteLength(message) + 1);
  payload.writeCString(message);
  
  if (target.accountType == Steam.EAccountType.Individual || target.accountType == Steam.EAccountType.ConsoleUser) {
    this._send(EMsg.ClientFriendMsg | protoMask, new schema.CMsgClientFriendMsg({
      steamid: target.toString(),
      message: payload,
      chatEntryType: type
    }).toBuffer());
    
  } else {
    // assume chat message
    var chatMsg = new schema.MsgClientChatMsg({
      steamIdChatter: this.steamID,
      steamIdChatRoom: toChatID(target),
      chatMsgType: type
    }).toBuffer();
    
    this._send(EMsg.ClientChatMsg, Buffer.concat([chatMsg, payload]));
  }
};

prototype.addFriend = function(steamID) {
  this._send(EMsg.ClientAddFriend | protoMask, new schema.CMsgClientAddFriend({
    steamidToAdd: steamID
  }).toBuffer());
};

prototype.removeFriend = function(steamID) {
  this._send(EMsg.ClientRemoveFriend | protoMask, new schema.CMsgClientRemoveFriend({
    friendid: steamID
  }).toBuffer());
};

prototype.joinChat = function(steamID) {
  this._send(EMsg.ClientJoinChat, new schema.MsgClientJoinChat({
    steamIdChat: toChatID(steamID)
  }).toBuffer());
};

prototype.leaveChat = function(steamID) {
  var leaveChat = new schema.MsgClientChatMemberInfo({
    steamIdChat: toChatID(steamID),
    type: Steam.EChatInfoType.StateChange
  }).toBuffer();
  
  var payload = new Buffer(20);
  payload.writeUInt64LE(this.steamID, 0);
  payload.writeUInt32LE(Steam.EChatMemberStateChange.Left, 8);
  payload.writeUInt64LE(this.steamID, 8 + 4);
  
  this._send(EMsg.ClientChatMemberInfo, Buffer.concat([leaveChat, payload]));
  delete this.chatRooms[steamID];
};

prototype.lockChat = function(steamID) {
  this._send(EMsg.ClientChatAction, new schema.MsgClientChatAction({
    steamIdChat: toChatID(steamID),
    steamIdUserToActOn: toChatID(steamID),
    chatAction: Steam.EChatAction.LockChat
  }).toBuffer());
};

prototype.unlockChat = function(steamID) {
  this._send(EMsg.ClientChatAction, new schema.MsgClientChatAction({
    steamIdChat: toChatID(steamID),
    steamIdUserToActOn: toChatID(steamID),
    chatAction: Steam.EChatAction.UnlockChat
  }).toBuffer());
};

prototype.setModerated = function(steamID) {
  this._send(EMsg.ClientChatAction, new schema.MsgClientChatAction({
    steamIdChat: toChatID(steamID),
    steamIdUserToActOn: toChatID(steamID),
    chatAction: Steam.EChatAction.SetModerated
  }).toBuffer());
};

prototype.setUnmoderated = function(steamID) {
  this._send(EMsg.ClientChatAction, new schema.MsgClientChatAction({
    steamIdChat: toChatID(steamID),
    steamIdUserToActOn: toChatID(steamID),
    chatAction: Steam.EChatAction.SetUnmoderated
  }).toBuffer());
};

prototype.kick = function(steamIdChat, steamIdMember) {
  this._send(EMsg.ClientChatAction, new schema.MsgClientChatAction({
    steamIdChat: toChatID(steamIdChat),
    steamIdUserToActOn: steamIdMember,
    chatAction: Steam.EChatAction.Kick
  }).toBuffer());
};

prototype.ban = function(steamIdChat, steamIdMember) {
  this._send(EMsg.ClientChatAction, new schema.MsgClientChatAction({
    steamIdChat: toChatID(steamIdChat),
    steamIdUserToActOn: steamIdMember,
    chatAction: Steam.EChatAction.Ban
  }).toBuffer());
};

prototype.unban = function(steamIdChat, steamIdMember) {
  this._send(EMsg.ClientChatAction, new schema.MsgClientChatAction({
    steamIdChat: toChatID(steamIdChat),
    steamIdUserToActOn: steamIdMember,
    chatAction: Steam.EChatAction.UnBan
  }).toBuffer());
};

prototype.chatInvite = function(steamIdChat, steamIdInvited) {
  this._send(EMsg.ClientChatInvite | protoMask, new schema.CMsgClientChatInvite({
    steamIdInvited: steamIdInvited,
    steamIdChat: toChatID(steamIdChat)
  }).toBuffer());
};

prototype.getSteamLevel = function(steamids, callback) {
  var accountids = steamids.map(function(steamid) {
    return new SteamID(steamid).accountID;
  });
  
  this._send(EMsg.ClientFSGetFriendsSteamLevels | protoMask, new schema.CMsgClientFSGetFriendsSteamLevels({
    accountids: accountids
  }).toBuffer(), callback);
};


// Handlers

var handlers = prototype._handlers;

handlers[EMsg.ClientPersonaState] = function(data) {
  schema.CMsgClientPersonaState.decode(data).friends.forEach(function(friend) {
    this.emit('user', friend);
    this.users[friend.friendid] = friend;
  }.bind(this));
};

handlers[EMsg.ClientRichPresenceInfo] = function(data) {
  var info = schema.CMsgClientRichPresenceInfo.decode(data).richPresence[0];
  var vdf = require('../VDF').decode(info.richPresenceKv.toBuffer()).RP;
  this.emit.apply(this, ['richPresence', info.steamidUser, vdf.status].concat(Object.keys(vdf).filter(function(key) {
    return !key.indexOf('param');
  }).map(function(key) {
    return vdf[key];
  })));
};

handlers[EMsg.ClientFriendsList] = function(data) {
  var list = schema.CMsgClientFriendsList.decode(data);
  
  list.friends && list.friends.forEach(function(relationship) {
    var steamID = relationship.ulfriendid.toString();
    var isClan = new SteamID(steamID).accountType == Steam.EAccountType.Clan;
    if (list.bincremental) {
      this.emit(isClan ? 'group' : 'friend', steamID, relationship.efriendrelationship);
    }
    if (relationship.efriendrelationship == Steam.EFriendRelationship.None) {
      delete this[isClan ? 'groups' : 'friends'][steamID];
    } else {
      this[isClan ? 'groups' : 'friends'][steamID] = relationship.efriendrelationship;
    }
  }.bind(this));
  
  if (!list.bincremental) {
    this.emit('relationships');
  }
};

handlers[EMsg.ClientFriendMsgIncoming] = function(data) {
  var friendMsg = schema.CMsgClientFriendMsgIncoming.decode(data);
  
  // Steam cuts off after the first null
  var message = friendMsg.message.toString('utf8').split('\u0000')[0];
  
  this.emit('message', friendMsg.steamidFrom.toString(), message, friendMsg.chatEntryType);
  this.emit('friendMsg', friendMsg.steamidFrom.toString(), message, friendMsg.chatEntryType);
};

handlers[EMsg.ClientChatMsg] = function(data) {
  var chatMsg = schema.MsgClientChatMsg.decode(data);
  
  // Steam cuts off after the first null
  var message = data.toString('utf8').split('\u0000')[0];
  
  this.emit('message', toClanID(chatMsg.steamIdChatRoom.toString()), message, chatMsg.chatMsgType, chatMsg.steamIdChatter.toString());
  this.emit('chatMsg', toClanID(chatMsg.steamIdChatRoom.toString()), message, chatMsg.chatMsgType, chatMsg.steamIdChatter.toString());
};

handlers[EMsg.ClientChatEnter] = function(data) {
  var chatEnter = schema.MsgClientChatEnter.decode(data);
  
  if (chatEnter.enterResponse == Steam.EChatRoomEnterResponse.Success) {
    var numObj = data.readUint32();
    var chatName = data.readCString();
    
    var chatRoom = this.chatRooms[chatEnter.steamIdClan || chatEnter.steamIdChat] = {};
    while (numObj--) {
      var object = require('../VDF').parse(data.toBuffer()).MessageObject;
      chatRoom[object.steamid] = {
        rank: object.Details,
        permissions: object.permissions
      };
    }
  }
  
  this.emit('chatEnter', chatEnter.steamIdClan || chatEnter.steamIdChat, chatEnter.enterResponse);
};

handlers[EMsg.ClientChatMemberInfo] = function(data) {
  var membInfo = schema.MsgClientChatMemberInfo.decode(data);
  var clanID = toClanID(membInfo.steamIdChat);
  
  var payload = data.slice(schema.MsgClientChatMemberInfo.baseSize);
  
  if (membInfo.type == Steam.EChatInfoType.StateChange) {
    var chatterActedOn = payload.readUInt64LE(0);
    var stateChange = payload.readInt32LE(8);
    var chatterActedBy = payload.readUInt64LE(12);
    this.emit('chatStateChange', stateChange, chatterActedOn, clanID, chatterActedBy);
    payload = payload.slice(20);
  }  
  
  if (!this.chatRooms[clanID])
    return; // it's probably a chat we just left
  
  if (membInfo.type == Steam.EChatInfoType.InfoUpdate || stateChange == Steam.EChatMemberStateChange.Entered) {
    var object = require('../VDF').decode(payload).MessageObject;
    this.chatRooms[clanID][object.steamid] = {
      rank: object.Details,
      permissions: object.permissions
    };
  } else if (chatterActedOn == this.steamID) {
    delete this.chatRooms[clanID];
  } else {
    delete this.chatRooms[clanID][chatterActedOn];
  }
};

handlers[EMsg.ClientChatInvite] = function(data) {
  var chatInvite = schema.CMsgClientChatInvite.decode(data);
  this.emit('chatInvite', toClanID(chatInvite.steamIdChat), chatInvite.chatName, chatInvite.steamIdPatron);
};

handlers[EMsg.ClientClanState] = function(data) {
  var clanState = schema.CMsgClientClanState.decode(data);
  if (clanState.announcements.length)
    this.emit('announcement', clanState.steamidClan, clanState.announcements[0].headline); // TODO: more data
};

handlers[EMsg.ClientFSGetFriendsSteamLevelsResponse] = function(data, callback) {
  var friends = schema.CMsgClientFSGetFriendsSteamLevelsResponse.decode(data).friends;
  var output = {};
  friends.forEach(function(friend) {
    var sid = new SteamID(0);
    sid.accountUniverse = 1;
    sid.accountType = 1;
    sid.accountInstance = 1;
    sid.accountID = friend.accountid;
    output[sid.toString()] = friend.level;
  });
  
  callback(output);
};


// Private functions

function toChatID(steamID) {
  if (typeof steamID == 'string')
    steamID = new SteamID(steamID);
  
  if (steamID.accountType == Steam.EAccountType.Clan) {
    // this is a ClanID - convert to its respective ChatID
    steamID.accountInstance = SteamID.ChatInstanceFlags.Clan;
    steamID.accountType = Steam.EAccountType.Chat;
  }
  
  return steamID.toString();
}

function toClanID(steamID) {
  if (typeof steamID == 'string')
    steamID = new SteamID(steamID);
  
  if (steamID.accountInstance == SteamID.ChatInstanceFlags.Clan) {
    // not an anonymous chat - convert to its respective ClanID
    steamID.accountType = Steam.EAccountType.Clan;
    steamID.accountInstance = 0;
  }
  
  return steamID.toString();
}
