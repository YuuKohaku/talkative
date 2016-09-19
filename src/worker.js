'use strict';

var async = require("async");

var Broker = require('./broker.js');
var Lifesign = require('./lifesigns.js');

var LIFESIGN = "speaker-lifesign";
var BEACON = "speaker-tribune";
var BEACON_EXPIRY = 10; //s

var MODE_LISTENER = "listener";
var MODE_SPEAKER = "speaker";

function Worker(id, client) {
	this.bus = new Broker(client, id);
	this.lifesign = new Lifesign(client, id, LIFESIGN);

	this.message_interval = 500;
	this.errorlist = "errors-list";
	this.topic = "speech";

	this._client = client;
	this._id = id;
	this._timer = null;

	this.setMode(MODE_LISTENER);
}

//configuration
Worker.prototype.configure = function (p_name, p_val) {
	if (this[p_name] !== undefined)
		this[p_name] = p_val;
}

Worker.prototype.messageGenerator = function (fn) {
	if (fn && fn.constructor == Function)
		this._messageGenerator = fn;
}

Worker.prototype.onMessage = function (callback) {
	if (callback && callback.constructor == Function)
		this._messageHandler = callback;
}

Worker.prototype.setMode = function (mode) {
	if (mode != MODE_LISTENER && mode != MODE_SPEAKER)
		return;
	this.mode = mode;
	this._processMode();
}

//mode processing
Worker.prototype._isSpeaker = function () {
	return this.mode == MODE_SPEAKER;
}


Worker.prototype._processMode = function () {
	if (!this._isStopped()) {
		if (this._isSpeaker()) {
			this._timer = setInterval(this.sendMessage.bind(this), this.message_interval);
			this.lifesign.signalingMode();
			this.bus.unact(this.topic);
		} else {
			clearInterval(this._timer);
			this.lifesign.monitoringMode(this._processSpeakerStatus.bind(this));
			this.bus.act(this.topic, this.messageHandler.bind(this));
		}
	}
}

Worker.prototype._processSpeakerStatus = function (status, callback) {
	if (status == true) {
		console.log("speaker is alive");
		return;
	} else {
		this.tryToSpeak(callback);
	}
}

Worker.prototype.tryToSpeak = function (callback) {
	var self = this;
	if (!this._isStopped()) {
		this._client.incr(BEACON, function (err, res) {
			console.log(err, res);
			//@NOTE the only way it could fail is to lose redis connection
			if (err)
				return;
			//@NOTE someone already took the tribune
			if (parseInt(res) > 1)
				return;
			self.setMode(MODE_SPEAKER);
			async.series([
				             self._client.expire.bind(self._client, BEACON, BEACON_EXPIRY),
				             self.lifesign.signal.bind(self),
				             self.getAttention.bind(self),
				             self._client.del.bind(self._client, BEACON)
  	           ],
				function (err, res) {
					console.log("TRYING TO SPEAK", err, res);
				});
		});
	}
}

Worker.prototype.getAttention = function () {

}

//lifecycle
Worker.prototype.start = function (callback) {
	this._processMode();
	callback(true);
}

Worker.prototype.end = function (callback) {
	this._stopped = true;
	clearInterval(this._timer);
	this.bus.end();
	this.lifesign.end();
	this._client.quit();
	callback();
}

Worker.prototype._isStopped = function () {
	return this._stopped;
}


//messaging
Worker.prototype.messageHandler = function (msg) {
	if (this._messageHandler) {
		this._messageHandler(res, this.errorHandler);
	}
}

Worker.prototype.sendMessage = function (err, res) {
	var msg = this._generateMessage();
	this.bus.command(this.topic, msg);
}

Worker.prototype._generateMessage = function () {
	if (!this._messageGenerator)
		throw new Error('Message generator is not defined');
	return this._messageGenerator();
}

//Error fns
Worker.prototype.listErrors = function (callback) {
	var errlist = [];
	this.bus.drainList(this.errorlist, function (err, line) {
		errlist.push(line);
	}, function (err, res) {
		callback(err, errlist);
	});
}

Worker.prototype.errorHandler = function (err, msg) {
	if (!err)
		return;
	this._client.rpush(this.errorlist, msg);
}


module.exports = Worker;