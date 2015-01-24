var Steam = require('../steam_client');

var EMsg = Steam.EMsg;
var schema = Steam.Internal;

var protoMask = 0x80000000;


// Methods

var prototype = Steam.SteamClient.prototype;

prototype.toGC = function(appid, type, body) {
  if (arguments.length > 3) {
    var sourceJobID = ++this._currentJobID;
    this._jobs[sourceJobID] = Array.prototype.slice.call(arguments, 3);
  }
  
  var header;
  if (type & protoMask) {
    header = schema.MsgGCHdrProtoBuf.serialize({
      msg: type >>> 0,
      proto: {
        jobIdSource: sourceJobID || null,
        // jobIdTarget: targetJobID
      }
    });
  } else {
    header = schema.MsgGCHdr.serialize({
      sourceJobID: sourceJobID,
      // targetJobID: targetJobID
    });
  }
  
  this._send(EMsg.ClientToGC | protoMask, new schema.CMsgGCClient({
    msgtype: type,
    appid: appid,
    payload: Buffer.concat([header, body])
  }).toBuffer());
};


// Handlers

var handlers = prototype._handlers;

handlers[EMsg.ClientFromGC] = function(data, jobid) {
  var msg = schema.CMsgGCClient.decode(data);
  var payload = msg.payload.toBuffer();
  
  var header, targetJobID, body;
  if (msg.msgtype & protoMask) {
    header = schema.MsgGCHdrProtoBuf.parse(payload);
    targetJobID = header.proto.jobIdTarget;
    body = payload.slice(schema.MsgGCHdrProtoBuf.baseSize + header.headerLength);
  } else {
    header = schema.MsgGCHdr.parse(payload);
    targetJobID = header.targetJobID;
    body = msg.payload.slice(schema.MsgGCHdr.baseSize);
  }
  
  this.emit.apply(this, ['fromGC', msg.appid, msg.msgtype, body].concat(this._jobs[targetJobID] || []));
};
