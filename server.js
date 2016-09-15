var mosca = require("mosca");
var ssh2r = require("./ssh2r");
var http = require('http');

var finalhandler = require('finalhandler');
var serveStatic = require('serve-static');

var http_serve = serveStatic("./");

var http_server = http.createServer(function(req, res) {
  var done = finalhandler(req, res);
  http_serve(req, res, done);
});

http_server.listen(8000);

var mqtt_server = new mosca.Server({
  http: {
    port: 3000,
    bundle: true,
  }
});
mqtt_server.on('ready', function setup() {
  console.log('Mosca server is up and running');
  ssh2r.rfmon();
});
