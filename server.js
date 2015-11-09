var Bot     = require('telegram-api');
var Message = require('telegram-api/types/Message');
var Keyboard = require('telegram-api/types/Keyboard');
var Express = require('express');
var Crypto  = require('crypto');
var Geo     = require('geoip-lite');
var bodyParser = require('body-parser');
var validUrl   = require('valid-url');
var Settings   = require('./settings');
var App = Express();

var mongoose = require('mongoose');
mongoose.connect(Settings.db);

App.use(bodyParser.json());       // to support JSON-encoded bodies
App.use(bodyParser.urlencoded({     // to support URL-encoded bodies
    extended: true
})); 

var Auth = mongoose.model('Authorization', {
    clientId: Number,
    created: Date,
    status: String,
});

var Client = mongoose.model('Clients', {
    clientId: Number,
    create_code: String,
    codes: [String],
    url: [String],
    created: Date,
    status: String,
});

var bot = new Bot(Settings);
bot.start();

var kb = new Keyboard()
    .force().keys([['Authorize', 'Reject']])
    .oneTime().selective()
    .resize();
 
function random(len) {
    return Crypto.randomBytes(len).toString('hex').toUpperCase();
}

bot.on('command-notfound', function(message) {
    console.error(message);
});

bot.get(/^(authorize|yes|no|reject)$/i, function(message) {
    Auth.findOne({ clientId: message.chat.id, status: 'new' }, function(err, doc) {
        if (err || !doc) return bot.send(new Message().to(message.chat.id).text("I wasn't expecting any answer"));
        if (message.text.match(/authorize|yes/i)) {
            doc.status = "authorized";
        } else {
            doc.status = "denied";
        }
        bot.send(new Message().to(doc.clientId).text("You have " + doc.status + " access"));
        doc.save();
    });
});

bot.get(/^\/?(add|start|register)$/i, function(message) {
    var client = new Client;
    client.clientId = message.chat.id;
    client.create_code = random(3);
    client.status = 'new';
    client.created = new Date;
    client.save(function() {
        bot.send(new Message().text('Your registration code is: ' + client.create_code).to(message.chat.id));
    });
});


App.get('/login/:id([a-fA-F0-9]{24})/:code([a-fA-F0-9]{6})$', function(req, res) {
    Client.findOne({ _id: req.params.id }, function(err, doc) {
        if (err || !doc) return res.send({ login: false });
        var i = doc.codes.indexOf(req.params.code);
        if (i === -1) return res.send({ login: false });
        doc.codes.splice(i, 1);
        doc.save();
        res.send({login : true});
    });
});

App.get('/confirmation/status/:id([a-fA-F0-9]{24})', function(req, res) {
    Auth.findOne({_id: req.params.id}, function(err, doc) {
        if (err || !doc) return res.send({ error: "not found"});
        res.send({ error: false, status: doc.status})
    });
});

App.get('/code/:id([a-fA-F0-9]{24})/:ip', function(req, res) {
    var geodata = Geo.lookup(req.params.ip);
    Client.findOne({ _id: req.params.id }, function(err, doc) {
        if (err || !doc) return res.send({ confirm: false, reason: "Client not found" });
        var code = random(3);
        if (!doc.codes) doc.codes = [];
        doc.codes.push(code);
        doc.save(function() {
            bot.send(new Message().text('Login code: ' + code).to(doc.clientId));
            res.send({ code: code });
        });
    });
});

App.get('/confirmation/:id([a-fA-F0-9]{24})/:ip', function(req, res) {
    var geodata = Geo.lookup(req.params.ip);
    if (geodata) {
        req.params.ip = geodata.city + ", " + geodata.country + " (" + req.params.ip + ")";
    }
    Client.findOne({ _id: req.params.id }, function(err, doc) {
        if (err || !doc) return res.send({ confirm: false, reason: "Client not found" });

        var auth = new Auth;
        auth.clientId = doc.clientId;
        auth.status   = 'new';
        auth.save(function() {
            bot.send(new Message().keyboard(kb).text('There is a login attempt in ' + doc.url + ' from ' + req.params.ip).to(doc.clientId));
            res.send({ response_id: auth._id });
        });
    });
});

App.get('/confirm', function(req, res) {
    if (typeof req.body !== "object") {
        return res.send({"error": true, "string": "End-point is expecting json object"});
    }

    var valid = true;
    ['code', 'url'].forEach(function(v) {
        if (!req.body[v]) {
            res.send({"error": true, "string": "Missing " + v});
            return valid = false;
        }
    });

    if (!valid) return;

    if (!validUrl.isWebUri(req.body.url)) {
        return res.send({"error": true, "string": req.body.url + " is not a valid URL"});
    }


    Client.findOne({ create_code: req.body.code, status: 'new'}, function(err, doc) {
        if (err || !doc) return res.send({ confirm: false, reason: "Code not found" });
        doc.create_code = "";
        doc.status = "confirmed";
        doc.url    = req.body.url;
        doc.save();
        bot.send(new Message().text("You activated your account for " + req.body.url).to(doc.clientId));
        res.send({confirm: true, client_id: doc._id});
    });
});

App.use(Express.static(__dirname + '/public'));


var server = App.listen(8000, function () {
    var host = server.address().address;
    var port = server.address().port;

    console.log('Example app listening at http://%s:%s', host, port);
});
