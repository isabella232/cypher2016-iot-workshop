var Client = require('ssh2').Client;
var options = {
  report: false,
  alpha: 0.9, // Smooth out interval between probe packets
  pinterval: 60*1000, // Initial expectation for probe interval
  dfactor: 5 // Assume disconnected if probe is later than dfactor*pinterval
};
var macDb = {};
var mqtt;
module.exports.rfmon = function (mclient, opts) {
  opts.report = true;
  if (opts)
    module.exports.setopts(opts);
  mqtt = mclient;
  return connect();
};
module.exports.stop = function (conn) {
  conn.end();
  opts.report = false;
  macDb = {};
};
module.exports.setopts = function (opts) {
  for (o in opts) {
    if (!opts.hasOwnProperty(o) || !options.hasOwnProperty(o))
      continue;
    options[o] = opts[0];
  }
};

function connect() {
  var conn = new Client();
  var macRe = new RegExp('[0-9a-fA-F]{2}:[0-9a-fA-F]{2}:[0-9a-fA-F]{2}:[0-9a-fA-F]{2}:[0-9a-fA-F]{2}:[0-9a-fA-F]{2}');
  conn.on('ready', function() {
    console.log('Client :: ready');
    conn.exec('monitor', function(err, stream) {
      if (err) throw err;
      stream.on('close', function(code, signal) {
        console.log('Stream :: close :: code: ' + code + ', signal: ' + signal);
        conn.end();
      }).on('data', function(data) {
        data = data.toString();
        //console.log('STDOUT: ' + data + 'STDOUT_END');
        while (data.match(macRe)) {
          //console.log(data.match(macRe));
          processMac(data.match(macRe)[0]);
          data = data.replace(macRe, '');
        }
        //console.log("done");
      }).stderr.on('data', function(data) {
        //console.log('STDERR: ' + data + 'STDERR_END');
      });
    });
  }).connect({
    host: '192.168.2.1',
    port: 22,
    username: 'root',
    password: 'root'
  });
  return conn;
}

function processMac(mac) {
  //console.log(mac);
  if (!macDb[mac]) {
    console.log("new! "+mac);
    macDb[mac] = {live: false};
  }
  if (macDb[mac].live) {
    var t = Date.now();
    var dt = t - macDb[mac].last;
    macDb[mac].last = t;
    macDb[mac].session += dt;
    macDb[mac].freq = options.alpha*macDb[mac].freq + (1- options.alpha)*dt;
  } else {
    console.log("Live: "+mac);
    macDb[mac].live = true;
    macDb[mac].last = Date.now();
    macDb[mac].freq = options.pinterval;
    macDb[mac].session = 0;
  }
  if (options.report) 
    mqtt.publish("rfmon/mac/"+mac, JSON.stringify(macDb[mac]));
}
var lastCount = -1;
setInterval(function () {
  var t = Date.now();
  var nl = 0, n = 0;
  for (mac in macDb) {
    if (!macDb.hasOwnProperty(mac))
      continue;
    ++n;
    if (!macDb[mac].live)
      continue;
    var dt = t - macDb[mac].last;
    if (dt > 5*macDb[mac].freq) {
      console.log("check", dt, macDb[mac].freq, options.dfactor*macDb[mac].freq);
      console.log("Exited: "+mac+" ("+Math.floor(macDb[mac].session/1000)+" secs)");
      macDb[mac].live = false;
    } else 
      ++nl;
  }
  if (nl != lastCount)
    console.log(nl+"/"+n+" clients live");
  lastCount = nl;
  if (options.report) 
    mqtt.publish("rfmon/count", nl);
}, 1000);

